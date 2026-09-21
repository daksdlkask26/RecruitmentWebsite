import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";
import { createInAppNotification } from "@/backend/notifications/notification-service";
import { notifyActionableAdministrators } from "@/backend/notifications/admin-notification-fanout";
import type {
  RecruitmentAssignmentInput,
  RecruitmentMessageInput,
  RecruitmentReportInput,
  RecruitmentThreadQuery,
} from "@/shared/contracts/recruitment-messaging";

const staffRoles = ["HR_MANAGER", "RECRUITER"] as const;
const assignableRoles = ["OWNER", ...staffRoles] as const;
const terminalStages = new Set([
  "HIRED",
  "OFFER_DECLINED",
  "REJECTED",
  "WAITLISTED",
]);

export class RecruitmentMessagingError extends Error {
  constructor(
    readonly code:
      | "THREAD_UNAVAILABLE"
      | "NOT_ASSIGNED"
      | "READ_ONLY"
      | "APPLICATION_NOT_READY"
      | "ASSIGNMENT_FORBIDDEN"
      | "VALIDATION_ERROR",
    readonly status: 400 | 403 | 404 | 409 = 404,
  ) {
    super(code);
  }
}

const threadInclude = {
  application: {
    select: {
      id: true,
      stage: true,
      candidateUserId: true,
      jobPosting: {
        select: {
          id: true,
          title: true,
          companyId: true,
          company: { select: { displayName: true } },
        },
      },
      candidate: {
        select: { user: { select: { id: true, name: true, image: true } } },
      },
    },
  },
  assignedMembership: {
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      user: {
        select: { name: true, image: true, state: true, deletedAt: true },
      },
    },
  },
} as const;

type ThreadRow = Prisma.RecruitmentThreadGetPayload<{
  include: typeof threadInclude;
}>;

type ThreadAccessKind =
  | "CANDIDATE"
  | "ASSIGNEE"
  | "HR_MANAGER"
  | "STAFF_OBSERVER"
  | "OWNER";

function isTerminal(stage: string) {
  return terminalStages.has(stage);
}

function hasActiveAssignee(thread: ThreadRow) {
  const assigned = thread.assignedMembership;
  return Boolean(
    assigned &&
    assigned.status === "ACTIVE" &&
    assigned.user.state === "ACTIVE" &&
    !assigned.user.deletedAt &&
    assignableRoles.includes(assigned.role as (typeof assignableRoles)[number]),
  );
}

function visibleThread(
  thread: ThreadRow,
  actorId: string,
  accessKind?: ThreadAccessKind,
) {
  const assigned = thread.assignedMembership;
  const effectiveState = isTerminal(thread.application.stage)
    ? "READ_ONLY"
    : thread.state;
  const assignedUserCanSend =
    hasActiveAssignee(thread) && assigned?.userId === actorId;
  const ownerCanSend = accessKind === "OWNER" && hasActiveAssignee(thread);
  return {
    id: thread.id,
    applicationId: thread.applicationId,
    state: effectiveState,
    canSend:
      effectiveState === "OPEN" &&
      (thread.candidateUserId === actorId ||
        assignedUserCanSend ||
        ownerCanSend),
    candidate: thread.application.candidate.user,
    job: {
      id: thread.application.jobPosting.id,
      title: thread.application.jobPosting.title,
      companyId: thread.application.jobPosting.companyId,
      companyName: thread.application.jobPosting.company.displayName,
    },
    applicationStage: thread.application.stage,
    assignee: assigned
      ? {
          id: assigned.id,
          userId: assigned.userId,
          name: assigned.user.name,
          image: assigned.user.image,
          role: assigned.role,
        }
      : null,
    lastMessageAt: thread.lastMessageAt?.toISOString() ?? null,
    lastMessageSequence: thread.lastMessageSequence,
    unreadCount:
      thread.candidateUserId === actorId
        ? Math.max(
            0,
            (thread.lastMessageSequence ?? 0) -
              thread.candidateLastReadSequence,
          )
        : Math.max(
            0,
            (thread.lastMessageSequence ?? 0) - thread.staffLastReadSequence,
          ),
  };
}

export class RecruitmentMessagingService {
  constructor(private readonly db: typeof prisma = prisma) {}

  async workspace(userId: string) {
    const ownerMembership = await this.db.companyMembership.findFirst({
      where: {
        userId,
        role: "OWNER",
        status: "ACTIVE",
        removedAt: null,
      },
      select: { id: true },
    });
    const ownerOversight = Boolean(ownerMembership);
    return {
      ownerOversight,
      items: ownerOversight
        ? await this.ownerOverview(userId, {})
        : await this.list(userId, { assignment: "mine" }),
    };
  }

  private async ensureApplicationThreads(
    companyIds: string[],
    query: Pick<RecruitmentThreadQuery, "jobId" | "stage">,
  ) {
    if (!companyIds.length) return;
    const unthreaded = await this.db.jobApplication.findMany({
      where: {
        jobPosting: { companyId: { in: companyIds } },
        ...(query.jobId ? { jobPostingId: query.jobId } : {}),
        ...(query.stage ? { stage: query.stage } : {}),
        recruitmentThread: null,
      },
      select: {
        id: true,
        candidateUserId: true,
        jobPostingId: true,
        jobPosting: { select: { companyId: true } },
      },
      take: 100,
    });
    if (!unthreaded.length) return;
    await this.db.$transaction(
      unthreaded.map((application) =>
        this.db.recruitmentThread.upsert({
          where: { applicationId: application.id },
          create: {
            applicationId: application.id,
            companyId: application.jobPosting.companyId,
            jobPostingId: application.jobPostingId,
            candidateUserId: application.candidateUserId,
          },
          update: {},
        }),
      ),
    );
  }

  private async membership(userId: string, companyId: string) {
    return this.db.companyMembership.findFirst({
      where: {
        companyId,
        userId,
        status: "ACTIVE",
        removedAt: null,
        user: { state: "ACTIVE", deletedAt: null },
      },
      select: { id: true, userId: true, role: true },
    });
  }

  private async access(
    threadId: string,
    userId: string,
  ): Promise<{
    thread: ThreadRow;
    kind: ThreadAccessKind;
    membershipId?: string;
  }> {
    const thread = await this.db.recruitmentThread.findUnique({
      where: { id: threadId },
      include: threadInclude,
    });
    if (!thread) throw new RecruitmentMessagingError("THREAD_UNAVAILABLE");
    if (thread.candidateUserId === userId) {
      if (!thread.assignedMembershipId)
        throw new RecruitmentMessagingError("NOT_ASSIGNED");
      return { thread, kind: "CANDIDATE" };
    }
    const membership = await this.membership(userId, thread.companyId);
    if (!membership) throw new RecruitmentMessagingError("THREAD_UNAVAILABLE");
    if (membership.role === "OWNER")
      return { thread, kind: "OWNER", membershipId: membership.id };
    if (!staffRoles.includes(membership.role as (typeof staffRoles)[number]))
      throw new RecruitmentMessagingError("THREAD_UNAVAILABLE");
    if (membership.role === "HR_MANAGER")
      return { thread, kind: "HR_MANAGER", membershipId: membership.id };
    if (thread.assignedMembershipId !== membership.id)
      return { thread, kind: "STAFF_OBSERVER", membershipId: membership.id };
    return { thread, kind: "ASSIGNEE", membershipId: membership.id };
  }

  async list(userId: string, query: RecruitmentThreadQuery) {
    const memberships = await this.db.companyMembership.findMany({
      where: {
        userId,
        status: "ACTIVE",
        removedAt: null,
        role: { in: ["OWNER", ...staffRoles] },
        user: { state: "ACTIVE", deletedAt: null },
      },
      select: { id: true, companyId: true, role: true },
    });
    const companyIds = [...new Set(memberships.map((item) => item.companyId))];
    if (!companyIds.length) return [];
    if (query.companyId && !companyIds.includes(query.companyId)) return [];
    const scopedCompanyIds = query.companyId ? [query.companyId] : companyIds;
    const staffMemberships = memberships.filter((item) =>
      staffRoles.includes(item.role as (typeof staffRoles)[number]),
    );
    const ownStaffMembershipIds = staffMemberships
      .filter((item) => scopedCompanyIds.includes(item.companyId))
      .map((item) => item.id);
    const ownerCompanyIds = memberships
      .filter(
        (item) =>
          scopedCompanyIds.includes(item.companyId) && item.role === "OWNER",
      )
      .map((item) => item.companyId);
    const hrManagerCompanyIds = memberships
      .filter(
        (item) =>
          scopedCompanyIds.includes(item.companyId) &&
          item.role === "HR_MANAGER",
      )
      .map((item) => item.companyId);
    const oversightCompanyIds = [
      ...new Set([...ownerCompanyIds, ...hrManagerCompanyIds]),
    ];
    // An HR Manager's or Owner's inbox is also the assignment queue.
    // Materialize application-owned threads lazily here; they remain
    // inaccessible to the candidate until a member is assigned.
    await this.ensureApplicationThreads(
      [...new Set([...ownerCompanyIds, ...hrManagerCompanyIds])],
      query,
    );
    const common: Prisma.RecruitmentThreadWhereInput = {
      companyId: { in: scopedCompanyIds },
      ...(query.jobId ? { jobPostingId: query.jobId } : {}),
      ...(query.stage ? { application: { stage: query.stage } } : {}),
    };
    const access: Prisma.RecruitmentThreadWhereInput =
      query.assignment === "unassigned"
        ? oversightCompanyIds.length
          ? {
              companyId: { in: oversightCompanyIds },
              assignedMembershipId: null,
            }
          : { id: "__no_visible_recruitment_threads__" }
        : {
            OR: [
              ...((query.assignment === "mine"
                ? ownerCompanyIds
                : oversightCompanyIds
              ).length
                ? [
                    {
                      companyId: {
                        in:
                          query.assignment === "mine"
                            ? ownerCompanyIds
                            : oversightCompanyIds,
                      },
                    },
                  ]
                : []),
              ...(ownStaffMembershipIds.length
                ? [{ assignedMembershipId: { in: ownStaffMembershipIds } }]
                : []),
            ],
          };
    const where: Prisma.RecruitmentThreadWhereInput = {
      AND: [common, access],
    };
    const rows = await this.db.recruitmentThread.findMany({
      where,
      include: threadInclude,
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    return rows.map((thread) =>
      visibleThread(
        thread,
        userId,
        ownerCompanyIds.includes(thread.companyId) ? "OWNER" : undefined,
      ),
    );
  }

  async detail(threadId: string, userId: string) {
    const { thread, kind } = await this.access(threadId, userId);
    if (kind === "OWNER") {
      await this.db.auditEvent.create({
        data: {
          actorType: "user",
          actorUserId: userId,
          actorSessionId: null,
          action: "recruitment_messaging.owner_oversight_viewed",
          targetType: "recruitment_thread",
          targetId: thread.id,
          result: "SUCCESS",
          correlationId: randomUUID(),
          context: {
            companyId: thread.companyId,
            applicationId: thread.applicationId,
          },
        },
      });
    }
    const messages = await this.db.recruitmentMessage.findMany({
      where: { threadId },
      orderBy: { sequence: "asc" },
      take: 100,
      select: {
        id: true,
        sequence: true,
        senderUserId: true,
        content: true,
        createdAt: true,
      },
    });
    return {
      thread: visibleThread(thread, userId, kind),
      access: kind,
      messages: messages.map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      })),
    };
  }

  async detailForApplication(applicationId: string, userId: string) {
    const thread = await this.db.recruitmentThread.findUnique({
      where: { applicationId },
      select: { id: true },
    });
    if (!thread) throw new RecruitmentMessagingError("NOT_ASSIGNED");
    return this.detail(thread.id, userId);
  }

  async assign(
    applicationId: string,
    actorId: string,
    input: RecruitmentAssignmentInput,
  ) {
    const application = await this.db.jobApplication.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        candidateUserId: true,
        jobPostingId: true,
        stage: true,
        jobPosting: { select: { companyId: true } },
      },
    });
    if (!application) throw new RecruitmentMessagingError("THREAD_UNAVAILABLE");
    const actorMembership = await this.membership(
      actorId,
      application.jobPosting.companyId,
    );
    if (
      !actorMembership ||
      (actorMembership.role !== "HR_MANAGER" &&
        actorMembership.role !== "OWNER")
    )
      throw new RecruitmentMessagingError("ASSIGNMENT_FORBIDDEN", 403);
    if (isTerminal(application.stage))
      throw new RecruitmentMessagingError("READ_ONLY", 409);
    const targetRoles =
      actorMembership.role === "OWNER" ? assignableRoles : staffRoles;
    const assignee = await this.db.companyMembership.findFirst({
      where: {
        id: input.membershipId,
        companyId: application.jobPosting.companyId,
        status: "ACTIVE",
        removedAt: null,
        role: { in: [...targetRoles] },
        user: { state: "ACTIVE", deletedAt: null },
      },
      select: { id: true },
    });
    if (!assignee) throw new RecruitmentMessagingError("VALIDATION_ERROR", 400);
    const thread = await this.db.$transaction(async (tx) => {
      const previous = await tx.recruitmentThread.findUnique({
        where: { applicationId },
        select: { assignedMembershipId: true },
      });
      const next = await tx.recruitmentThread.upsert({
        where: { applicationId },
        create: {
          applicationId,
          companyId: application.jobPosting.companyId,
          jobPostingId: application.jobPostingId,
          candidateUserId: application.candidateUserId,
          assignedMembershipId: assignee.id,
        },
        update: { assignedMembershipId: assignee.id, state: "OPEN" },
        include: threadInclude,
      });
      await tx.auditEvent.create({
        data: {
          actorType: "user",
          actorUserId: actorId,
          actorSessionId: null,
          action: previous
            ? "recruitment_messaging.thread_reassigned"
            : "recruitment_messaging.thread_assigned",
          targetType: "recruitment_thread",
          targetId: next.id,
          result: "SUCCESS",
          correlationId: randomUUID(),
          context: {
            applicationId,
            companyId: application.jobPosting.companyId,
            previousMembershipId: previous?.assignedMembershipId ?? null,
            assignedMembershipId: assignee.id,
          },
        },
      });
      return next;
    });
    return visibleThread(
      thread,
      actorId,
      actorMembership.role === "OWNER" ? "OWNER" : undefined,
    );
  }

  async openForStaff(applicationId: string, actorId: string) {
    const application = await this.db.jobApplication.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        candidateUserId: true,
        jobPostingId: true,
        stage: true,
        jobPosting: { select: { companyId: true } },
      },
    });
    if (!application) throw new RecruitmentMessagingError("THREAD_UNAVAILABLE");
    if (isTerminal(application.stage))
      throw new RecruitmentMessagingError("READ_ONLY", 409);
    if (application.stage === "APPLIED")
      throw new RecruitmentMessagingError("APPLICATION_NOT_READY", 409);
    const membership = await this.membership(
      actorId,
      application.jobPosting.companyId,
    );
    if (
      !membership ||
      !staffRoles.includes(membership.role as (typeof staffRoles)[number])
    )
      throw new RecruitmentMessagingError("THREAD_UNAVAILABLE");

    try {
      const thread = await this.db.$transaction(async (tx) => {
        const existing = await tx.recruitmentThread.findUnique({
          where: { applicationId },
          include: threadInclude,
        });
        if (existing) return existing;
        const created = await tx.recruitmentThread.create({
          data: {
            applicationId,
            companyId: application.jobPosting.companyId,
            jobPostingId: application.jobPostingId,
            candidateUserId: application.candidateUserId,
            assignedMembershipId: membership.id,
          },
          include: threadInclude,
        });
        await tx.auditEvent.create({
          data: {
            actorType: "user",
            actorUserId: actorId,
            actorSessionId: null,
            action: "recruitment_messaging.thread_created",
            targetType: "recruitment_thread",
            targetId: created.id,
            result: "SUCCESS",
            correlationId: randomUUID(),
            context: {
              applicationId,
              companyId: application.jobPosting.companyId,
              assignedMembershipId: membership.id,
            },
          },
        });
        return created;
      });
      return visibleThread(thread, actorId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.db.recruitmentThread.findUnique({
          where: { applicationId },
          include: threadInclude,
        });
        if (existing) return visibleThread(existing, actorId);
      }
      throw error;
    }
  }

  async eligibleAssignees(threadId: string, actorId: string) {
    const { thread, kind } = await this.access(threadId, actorId);
    if (kind !== "HR_MANAGER" && kind !== "OWNER")
      throw new RecruitmentMessagingError("ASSIGNMENT_FORBIDDEN", 403);
    const targetRoles = kind === "OWNER" ? assignableRoles : staffRoles;
    return this.db.companyMembership.findMany({
      where: {
        companyId: thread.companyId,
        status: "ACTIVE",
        removedAt: null,
        role: { in: [...targetRoles] },
        user: { state: "ACTIVE", deletedAt: null },
      },
      select: { id: true, role: true, user: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async ownerOverview(
    userId: string,
    query: Omit<RecruitmentThreadQuery, "assignment">,
  ) {
    const owners = await this.db.companyMembership.findMany({
      where: {
        userId,
        role: "OWNER",
        status: "ACTIVE",
        removedAt: null,
        user: { state: "ACTIVE", deletedAt: null },
      },
      select: { companyId: true },
    });
    const ownerCompanyIds = owners.map((owner) => owner.companyId);
    if (!ownerCompanyIds.length)
      throw new RecruitmentMessagingError("THREAD_UNAVAILABLE");
    // Do not delegate to the general staff inbox: an owner who also holds a
    // staff role at another company must not gain owner oversight there.
    if (query.companyId && !ownerCompanyIds.includes(query.companyId))
      return [];
    await this.ensureApplicationThreads(ownerCompanyIds, query);
    const rows = await this.db.recruitmentThread.findMany({
      where: {
        companyId: query.companyId ?? { in: ownerCompanyIds },
        ...(query.jobId ? { jobPostingId: query.jobId } : {}),
        ...(query.stage ? { application: { stage: query.stage } } : {}),
      },
      include: threadInclude,
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    return rows.map((thread) =>
      visibleThread(
        thread,
        userId,
        ownerCompanyIds.includes(thread.companyId) ? "OWNER" : undefined,
      ),
    );
  }

  async ownerDetail(threadId: string, userId: string) {
    const detail = await this.detail(threadId, userId);
    if (detail.access !== "OWNER")
      throw new RecruitmentMessagingError("THREAD_UNAVAILABLE");
    return detail;
  }

  async send(threadId: string, userId: string, input: RecruitmentMessageInput) {
    const { thread, kind, membershipId } = await this.access(threadId, userId);
    if (kind === "OWNER" && !hasActiveAssignee(thread))
      throw new RecruitmentMessagingError("NOT_ASSIGNED", 403);
    if (
      kind === "STAFF_OBSERVER" ||
      (kind === "HR_MANAGER" && thread.assignedMembershipId !== membershipId)
    )
      throw new RecruitmentMessagingError("NOT_ASSIGNED", 403);
    if (isTerminal(thread.application.stage) || thread.state === "READ_ONLY")
      throw new RecruitmentMessagingError("READ_ONLY", 409);
    const senderMembershipId =
      kind === "CANDIDATE"
        ? null
        : (membershipId ?? thread.assignedMembershipId ?? null);
    const existing = await this.db.recruitmentMessage.findUnique({
      where: {
        senderUserId_clientOperationId: {
          senderUserId: userId,
          clientOperationId: input.clientOperationId,
        },
      },
    });
    if (existing)
      return {
        id: existing.id,
        sequence: existing.sequence,
        senderUserId: existing.senderUserId,
        content: existing.content,
        createdAt: existing.createdAt.toISOString(),
        deduplicated: true,
      };
    try {
      const accepted = await this.db.$transaction(async (tx) => {
        const updated = await tx.recruitmentThread.update({
          where: { id: threadId },
          data: { nextMessageSequence: { increment: 1 } },
        });
        const sequence = updated.nextMessageSequence - 1;
        const message = await tx.recruitmentMessage.create({
          data: {
            threadId,
            sequence,
            senderUserId: userId,
            senderMembershipId,
            clientOperationId: input.clientOperationId,
            content: input.content,
          },
        });
        await tx.recruitmentThread.update({
          where: { id: threadId },
          data: {
            lastMessageSequence: sequence,
            lastMessageAt: message.createdAt,
          },
        });
        return {
          id: message.id,
          sequence: message.sequence,
          senderUserId: message.senderUserId,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
          deduplicated: false,
        };
      });
      if (!accepted.deduplicated) {
        const recipientUserId =
          kind === "CANDIDATE"
            ? thread.assignedMembership?.userId
            : thread.candidateUserId;
        if (recipientUserId) {
          try {
            await createInAppNotification(this.db, {
              recipientUserId,
              kind: "MESSAGE_RECEIVED",
              contextType: "APPLICATION",
              contextId: thread.applicationId,
              variables: {
                jobId: thread.jobPostingId,
                threadId,
                recipientRole: kind === "CANDIDATE" ? "RECRUITER" : "CANDIDATE",
              },
              deduplicationKey: `recruitment-message:${threadId}:${accepted.id}`,
              correlationId: randomUUID(),
              occurredAt: new Date(),
            });
          } catch {
            // Message durability is authoritative; notification delivery is
            // best-effort and must not turn an accepted send into a retry.
          }
        }
      }
      return accepted;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const duplicate = await this.db.recruitmentMessage.findUnique({
          where: {
            senderUserId_clientOperationId: {
              senderUserId: userId,
              clientOperationId: input.clientOperationId,
            },
          },
        });
        if (duplicate)
          return {
            id: duplicate.id,
            sequence: duplicate.sequence,
            senderUserId: duplicate.senderUserId,
            content: duplicate.content,
            createdAt: duplicate.createdAt.toISOString(),
            deduplicated: true,
          };
      }
      throw error;
    }
  }

  async markRead(threadId: string, userId: string, sequence: number) {
    const { thread, kind } = await this.access(threadId, userId);
    if (kind === "OWNER" || kind === "STAFF_OBSERVER") return;
    const last = Math.min(
      Math.max(0, sequence),
      thread.lastMessageSequence ?? 0,
    );
    await this.db.recruitmentThread.update({
      where: { id: threadId },
      data:
        kind === "CANDIDATE"
          ? {
              candidateLastReadSequence: {
                set: Math.max(last, thread.candidateLastReadSequence),
              },
              candidateLastReadAt: new Date(),
            }
          : {
              staffLastReadSequence: {
                set: Math.max(last, thread.staffLastReadSequence),
              },
              staffLastReadAt: new Date(),
            },
    });
  }

  async report(
    threadId: string,
    userId: string,
    input: RecruitmentReportInput,
  ) {
    const { thread, kind } = await this.access(threadId, userId);
    if (kind === "OWNER") throw new RecruitmentMessagingError("READ_ONLY", 403);
    if (kind === "STAFF_OBSERVER")
      throw new RecruitmentMessagingError("NOT_ASSIGNED", 403);
    const targetUserId =
      kind === "CANDIDATE"
        ? thread.assignedMembership?.userId
        : thread.candidateUserId;
    if (!targetUserId) throw new RecruitmentMessagingError("NOT_ASSIGNED");
    if (input.evidenceMessageId) {
      const evidence = await this.db.recruitmentMessage.findFirst({
        where: { id: input.evidenceMessageId, threadId },
        select: { id: true },
      });
      if (!evidence)
        throw new RecruitmentMessagingError("VALIDATION_ERROR", 400);
    }
    const unresolvedKey = createHash("sha256")
      .update(
        [userId, threadId, targetUserId, input.targetType, input.category].join(
          "\0",
        ),
      )
      .digest("hex");
    const result = await this.db.$transaction(async (tx) => {
      const duplicate = await tx.messagingReport.findFirst({
        where: {
          reporterUserId: userId,
          recruitmentThreadId: threadId,
          targetUserId,
          targetType: input.targetType,
          category: input.category,
          state: "PENDING_REVIEW",
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (duplicate) return { reportId: duplicate.id, deduplicated: true };
      const report = await tx.messagingReport.create({
        data: {
          reporterUserId: userId,
          targetUserId,
          recruitmentThreadId: threadId,
          targetType: input.targetType,
          recruitmentEvidenceMessageId: input.evidenceMessageId ?? null,
          category: input.category,
          normalizedDetail: input.detail || null,
          unresolvedKey,
        },
        select: { id: true },
      });
      await createInAppNotification(tx, {
        recipientUserId: userId,
        kind: "MESSAGE_REPORT_RECEIVED",
        deduplicationKey: `recruitment-report:${report.id}:received`,
        correlationId: report.id,
        occurredAt: new Date(),
        contextType: "MESSAGING_REPORT",
        contextId: report.id,
      });
      await notifyActionableAdministrators(tx, {
        kind: "MESSAGE_REPORT_RECEIVED_ADMIN",
        eventKey: `${report.id}:received`,
        correlationId: report.id,
        occurredAt: new Date(),
        contextType: "MESSAGING_REPORT",
        contextId: report.id,
        state: "PENDING_REVIEW",
      });
      return { reportId: report.id, deduplicated: false };
    });
    return { receipt: "REPORT_RECEIVED" as const, ...result };
  }
}
