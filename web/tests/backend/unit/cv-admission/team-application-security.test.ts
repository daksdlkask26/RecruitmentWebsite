import { describe, expect, it, vi, beforeEach } from "vitest";
import { openTeamApplicationCv } from "@/backend/services/company-members/team-application-cv-service";
import { TeamApplicationService } from "@/backend/services/company-members/team-application-service";
import { prisma } from "@/backend/database/prisma";
import { Prisma } from "@/backend/generated/prisma/client";
import * as authModule from "@/backend/services/company-members/team-application-authorization";
import * as notificationsModule from "@/backend/notifications/notification-service";

function asMock<T>(value: unknown): T {
  return value as T;
}

function candidateApplication(
  applicationId: string,
): Awaited<ReturnType<TeamApplicationService["getCandidate"]>> {
  return {
    applicationId,
    companyId: "company-1",
    companyName: "Acme Corp",
    companySlug: "acme-corp",
    appliedRole: "RECRUITER",
    status: "SUBMITTED",
    invitationStatus: null,
    invitationId: null,
    submittedAt: new Date().toISOString(),
    ownerViewed: false,
    ownerFirstViewedAt: null,
    decidedAt: null,
    joinedAt: null,
    invitationExpiresAt: null,
  };
}

describe("Slice 4 — Team Application Security Boundary End-to-End", () => {
  const candidateUserId = "candidate-test-user-1";
  const ownerUserId = "owner-user-1";
  const companyId = "company-1";
  const applicationId = "team-app-1";
  const uploadId = "upload-clean-1";
  const artifactId = "artifact-clean-1";
  const assessmentId = "assessment-clean-1";
  const checksumSha256 = Buffer.alloc(32, 1);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("openTeamApplicationCv", () => {
    it("fails closed when application has no scan assessment or artifact provenance", async () => {
      vi.spyOn(authModule, "requireTeamApplicationOwner").mockResolvedValue(
        asMock<
          Awaited<ReturnType<typeof authModule.requireTeamApplicationOwner>>
        >(undefined),
      );
      vi.spyOn(prisma.teamApplication, "findUnique").mockResolvedValue(
        asMock<Awaited<ReturnType<typeof prisma.teamApplication.findUnique>>>({
          id: applicationId,
          candidateUserId,
          cvFileName: "resume.pdf",
          cvMimeType: "application/pdf",
          cvByteSize: 1024,
          cvStorageKey: "legacy-key",
          cvDeleteAfter: null,
          cvDeletedAt: null,
          cvSourceArtifactId: null,
          cvScanAssessmentId: null,
        }),
      );

      await expect(
        openTeamApplicationCv(ownerUserId, applicationId),
      ).rejects.toMatchObject({ code: "TEAM_CV_UNAVAILABLE" });
    });

    it("fails closed when caller is not an authorized company owner", async () => {
      vi.spyOn(authModule, "requireTeamApplicationOwner").mockRejectedValue(
        new authModule.TeamApplicationAuthorizationError("MEMBERSHIP_REQUIRED"),
      );

      await expect(
        openTeamApplicationCv("unauthorized-user", applicationId),
      ).rejects.toMatchObject({ code: "TEAM_CV_UNAVAILABLE" });
    });

    it("fails closed when scan assessment is not CLEAN", async () => {
      vi.spyOn(authModule, "requireTeamApplicationOwner").mockResolvedValue(
        asMock<
          Awaited<ReturnType<typeof authModule.requireTeamApplicationOwner>>
        >(undefined),
      );
      vi.spyOn(prisma.teamApplication, "findUnique").mockResolvedValue(
        asMock<Awaited<ReturnType<typeof prisma.teamApplication.findUnique>>>({
          id: applicationId,
          candidateUserId,
          cvFileName: "resume.pdf",
          cvMimeType: "application/pdf",
          cvByteSize: 1024,
          cvStorageKey: "secure/locator",
          cvDeleteAfter: null,
          cvDeletedAt: null,
          cvSourceArtifactId: artifactId,
          cvScanAssessmentId: assessmentId,
        }),
      );

      vi.spyOn(prisma.cvStoredArtifact, "findUnique").mockResolvedValue(
        asMock<Awaited<ReturnType<typeof prisma.cvStoredArtifact.findUnique>>>({
          id: artifactId,
          uploadId,
        }),
      );

      // Upload found, but status is INFECTED
      vi.spyOn(prisma.cvUpload, "findFirst").mockResolvedValue(
        asMock<Awaited<ReturnType<typeof prisma.cvUpload.findFirst>>>({
          id: uploadId,
          accountId: candidateUserId,
          status: "INFECTED",
          purpose: "TEAM_APPLICATION_DIRECT",
          processingMode: "SCAN_ONLY",
          declaredMediaType: "application/pdf",
          declaredBytes: 1024,
          actualBytes: 1024,
          sourceSha256: checksumSha256,
          policyVersion: "unified-cv-v1",
          displayFilenameCiphertext: null,
          expiresAt: new Date(Date.now() + 3600_000),
        }),
      );

      await expect(
        openTeamApplicationCv(ownerUserId, applicationId),
      ).rejects.toMatchObject({ code: "TEAM_CV_UNAVAILABLE" });
    });
  });

  describe("TeamApplicationService.submitWithUploadId", () => {
    it("rejects the legacy prepared-plaintext submit contract before database access", async () => {
      const cleanup = vi.fn().mockResolvedValue(undefined);
      const accountLookup = vi.spyOn(prisma.userAccount, "findUnique");

      await expect(
        new TeamApplicationService().submit(
          candidateUserId,
          companyId,
          "RECRUITER",
          { cleanup } as never,
        ),
      ).rejects.toMatchObject({ code: "TEAM_APPLICATION_UNAVAILABLE" });

      expect(cleanup).toHaveBeenCalledOnce();
      expect(accountLookup).not.toHaveBeenCalled();
    });

    it("creates TeamApplication with secure artifact and assessment references", async () => {
      vi.spyOn(prisma.userAccount, "findUnique").mockResolvedValue(
        asMock<Awaited<ReturnType<typeof prisma.userAccount.findUnique>>>({
          id: candidateUserId,
          email: "candidate@example.com",
          state: "ACTIVE",
          candidateIdentity: { userId: candidateUserId },
        }),
      );

      // Mock clean safety evidence
      vi.spyOn(prisma.cvUpload, "findFirst").mockResolvedValue(
        asMock<Awaited<ReturnType<typeof prisma.cvUpload.findFirst>>>({
          id: uploadId,
          accountId: candidateUserId,
          status: "SECURITY_CLEAN",
          purpose: "TEAM_APPLICATION_DIRECT",
          processingMode: "SCAN_ONLY",
          declaredMediaType: "application/pdf",
          declaredBytes: 1024,
          actualBytes: 1024,
          sourceSha256: checksumSha256,
          policyVersion: "unified-cv-v1",
          displayFilenameCiphertext: null,
          expiresAt: new Date(Date.now() + 3600_000),
        }),
      );

      vi.spyOn(prisma.cvStoredArtifact, "findFirst").mockResolvedValue(
        asMock<Awaited<ReturnType<typeof prisma.cvStoredArtifact.findFirst>>>({
          id: artifactId,
          storageAdapter: "filesystem",
          storageLocator: "cv/test-loc",
          encryptionKeyVersion: 1,
          plaintextBytes: 1024,
          ciphertextBytes: 1056,
          plaintextSha256: checksumSha256,
        }),
      );

      vi.spyOn(prisma.cvScanAssessment, "findFirst").mockResolvedValue(
        asMock<Awaited<ReturnType<typeof prisma.cvScanAssessment.findFirst>>>({
          id: assessmentId,
          status: "CLEAN",
          completedAt: new Date(),
          sourceArtifactId: artifactId,
          policyVersion: "unified-cv-v1",
          engineName: "clamav",
          engineVersion: "1.4.3",
          signatureVersion: "test-signatures",
          signaturePublishedAt: new Date(),
        }),
      );

      vi.spyOn(prisma.teamApplication, "findFirst").mockResolvedValue(null);

      let createdApplicationData: Record<string, unknown> | null = null;
      const transactionClient = {
        company: {
          findFirst: vi.fn().mockResolvedValue({
            id: companyId,
            displayName: "Acme Corp",
          }),
        },
        companyMembership: {
          findMany: vi.fn().mockResolvedValue([{ userId: ownerUserId }]),
          findUnique: vi.fn().mockResolvedValue(null),
        },
        teamOpportunity: {
          upsert: vi.fn().mockResolvedValue({ id: "opp-1", state: "OPEN" }),
        },
        teamApplication: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi
            .fn()
            .mockImplementation(
              async ({ data }: { data: Record<string, unknown> }) => {
                createdApplicationData = data;
                return { id: applicationId };
              },
            ),
        },
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
        inAppNotification: {
          create: vi.fn().mockResolvedValue({ id: "notif-1" }),
        },
      };
      vi.spyOn(prisma, "$transaction").mockImplementation((async (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) =>
        callback(
          asMock<Prisma.TransactionClient>(transactionClient),
        )) as unknown as typeof prisma.$transaction);

      const notificationSpy = vi
        .spyOn(notificationsModule, "createInAppNotification")
        .mockResolvedValue(
          asMock<
            Awaited<
              ReturnType<typeof notificationsModule.createInAppNotification>
            >
          >({ id: "notif-1" }),
        );

      const service = new TeamApplicationService();
      vi.spyOn(service, "getCandidate").mockResolvedValue(
        candidateApplication(applicationId),
      );

      const result = await service.submitWithUploadId(
        candidateUserId,
        companyId,
        "RECRUITER",
        uploadId,
      );

      expect(result.created).toBe(true);
      expect(createdApplicationData).not.toBeNull();
      const capturedApplication = asMock<Record<string, unknown>>(
        createdApplicationData,
      );
      expect(capturedApplication["cvSourceArtifactId"]).toBe(artifactId);
      expect(capturedApplication["cvScanAssessmentId"]).toBe(assessmentId);
      expect(capturedApplication["status"]).toBe("SUBMITTED");
      expect(notificationSpy).toHaveBeenCalled();
    });

    it("prevents duplicate submission by returning existing application without re-notifying", async () => {
      vi.spyOn(prisma.userAccount, "findUnique").mockResolvedValue(
        asMock<Awaited<ReturnType<typeof prisma.userAccount.findUnique>>>({
          id: candidateUserId,
          email: "candidate@example.com",
          state: "ACTIVE",
          candidateIdentity: { userId: candidateUserId },
        }),
      );

      // Mock clean safety evidence
      vi.spyOn(prisma.cvUpload, "findFirst").mockResolvedValue(
        asMock<Awaited<ReturnType<typeof prisma.cvUpload.findFirst>>>({
          id: uploadId,
          accountId: candidateUserId,
          status: "SECURITY_CLEAN",
          purpose: "TEAM_APPLICATION_DIRECT",
          processingMode: "SCAN_ONLY",
          declaredMediaType: "application/pdf",
          declaredBytes: 1024,
          actualBytes: 1024,
          sourceSha256: checksumSha256,
          policyVersion: "unified-cv-v1",
          displayFilenameCiphertext: null,
          expiresAt: new Date(Date.now() + 3600_000),
        }),
      );

      vi.spyOn(prisma.cvStoredArtifact, "findFirst").mockResolvedValue(
        asMock<Awaited<ReturnType<typeof prisma.cvStoredArtifact.findFirst>>>({
          id: artifactId,
          storageAdapter: "filesystem",
          storageLocator: "cv/test-loc",
          encryptionKeyVersion: 1,
          plaintextBytes: 1024,
          ciphertextBytes: 1056,
          plaintextSha256: checksumSha256,
        }),
      );

      vi.spyOn(prisma.cvScanAssessment, "findFirst").mockResolvedValue(
        asMock<Awaited<ReturnType<typeof prisma.cvScanAssessment.findFirst>>>({
          id: assessmentId,
          status: "CLEAN",
          completedAt: new Date(),
          sourceArtifactId: artifactId,
          policyVersion: "unified-cv-v1",
          engineName: "clamav",
          engineVersion: "1.4.3",
          signatureVersion: "test-signatures",
          signaturePublishedAt: new Date(),
        }),
      );

      // Existing application found with same activeKey
      vi.spyOn(prisma.teamApplication, "findFirst").mockResolvedValue(
        asMock<Awaited<ReturnType<typeof prisma.teamApplication.findFirst>>>({
          id: "existing-app-id",
        }),
      );

      const notificationSpy = vi.spyOn(
        notificationsModule,
        "createInAppNotification",
      );
      const service = new TeamApplicationService();
      vi.spyOn(service, "getCandidate").mockResolvedValue(
        candidateApplication("existing-app-id"),
      );

      const result = await service.submitWithUploadId(
        candidateUserId,
        companyId,
        "RECRUITER",
        uploadId,
      );

      expect(result.created).toBe(false);
      expect(result.application.applicationId).toBe("existing-app-id");
      expect(notificationSpy).not.toHaveBeenCalled();
    });
  });
});
