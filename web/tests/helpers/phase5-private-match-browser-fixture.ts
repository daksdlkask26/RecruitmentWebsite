import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/backend/database/prisma";
import {
  PRIVATE_SCORING_CONFIG_VERSION,
  privateScoreBand,
} from "@/backend/scoring-engine/hybrid-score-policy";
import { PrivateCvMatchRepository } from "@/backend/repositories/private-cv-match/prisma-private-cv-match-repository";
import type {
  AiEvaluationResult,
  AutomaticMatchingResult,
} from "@/backend/scoring-engine/scoring-contracts";

type ParseStatus = "READY" | "PARTIAL" | "FAILED";

export type Phase5BrowserFixtureInput = Readonly<{
  candidateUserId: string;
  employerUserId: string;
  confirmedCvId: string;
  companyName: string;
  activeJob: Readonly<{
    id: string;
    slug: string;
    title: string;
    version: number;
    updatedAt: Date;
    location: string;
    employmentType: string;
    workArrangement: string;
  }>;
  now?: Date;
}>;

export type Phase5BrowserPrivateMatchIds = Readonly<{
  fullHigh: string;
  fullMedium: string;
  fullLow: string;
  limited: string;
  incompleteCv: string;
  incompleteJd: string;
  missingCriteria: string;
  evidenceEmpty: string;
  failedParse: string;
  queued: string;
  analyzing: string;
  retrying: string;
  retryFailure: string;
  expired: string;
  revoked: string;
  deleted: string;
}>;

const repository = new PrivateCvMatchRepository();

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
      return nested;
    }
    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    );
  });
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function text(length: number, seed: string) {
  return Array.from({ length }, (_, index) => `${seed}-${index + 1}`).join(" ");
}

function checkId(key: string) {
  return `cf502-${key}-${randomUUID()}`;
}

function snapshots(
  input: Phase5BrowserFixtureInput,
  cv: Awaited<ReturnType<typeof prisma.candidateCv.findUniqueOrThrow>>,
  options: Readonly<{
    key: string;
    cvParseStatus?: ParseStatus;
    jdParseStatus?: ParseStatus;
    includeCriteria?: boolean;
  }>,
) {
  const includeCriteria = options.includeCriteria ?? true;
  const cvSnapshot = {
    versionId: cv.id,
    version: cv.version,
    displayName: cv.displayName,
    fileName: cv.fileName,
    mimeType: cv.mimeType,
    byteSize: cv.byteSize,
    pageCount: null,
    parseStatus: options.cvParseStatus ?? "READY",
    confirmedAt: (cv.confirmedAt ?? input.now ?? new Date()).toISOString(),
    checksumSha256: cv.checksumSha256,
  } as const;
  const jdSnapshot = {
    jobId: input.activeJob.id,
    slug: input.activeJob.slug,
    title: input.activeJob.title,
    company: input.companyName,
    location: input.activeJob.location,
    employmentType: input.activeJob.employmentType,
    workArrangement: input.activeJob.workArrangement,
    requiredExperienceYears: includeCriteria ? 2 : null,
    requirements: includeCriteria
      ? ["TypeScript delivery", "Testing evidence"]
      : [],
    requiredSkills: includeCriteria
      ? [{ code: "typescript", label: "TypeScript" }]
      : [],
    preferredSkills: includeCriteria
      ? [{ code: "testing", label: "Testing" }]
      : [],
    requiredLanguages: [],
    jdVersion: input.activeJob.version,
    jdUpdatedAt: input.activeJob.updatedAt.toISOString(),
    jdText: includeCriteria
      ? "TypeScript delivery with testing evidence and accessible interfaces."
      : "A role description without structured matching criteria.",
    parseStatus: options.jdParseStatus ?? "READY",
  } as const;
  return {
    cvSnapshot,
    jdSnapshot,
    cvDigest: cv.checksumSha256,
    jdDigest: digest(canonicalJson(jdSnapshot)),
    cvTextSnapshot:
      "TypeScript delivery, testing evidence, accessible interfaces, and measurable project outcomes.",
  };
}

async function createCheck(
  input: Phase5BrowserFixtureInput,
  cv: Awaited<ReturnType<typeof prisma.candidateCv.findUniqueOrThrow>>,
  options: Readonly<{
    key: string;
    expiresAt?: Date;
    createdAt?: Date;
    cvParseStatus?: ParseStatus;
    jdParseStatus?: ParseStatus;
    includeCriteria?: boolean;
  }>,
) {
  const now = input.now ?? new Date();
  const source = snapshots(input, cv, options);
  const check = await repository.createCheck({
    id: checkId(options.key),
    candidateUserId: input.candidateUserId,
    cvVersionId: source.cvSnapshot.versionId,
    cvVersion: source.cvSnapshot.version,
    cvDigest: source.cvDigest,
    jobPostingId: source.jdSnapshot.jobId,
    jdVersion: source.jdSnapshot.jdVersion,
    jdDigest: source.jdDigest,
    scoringConfigVersion: PRIVATE_SCORING_CONFIG_VERSION,
    creationDedupeKey: digest(`${options.key}:${randomUUID()}`),
    cvSnapshot: source.cvSnapshot,
    jdSnapshot: source.jdSnapshot,
    expiresAt: options.expiresAt ?? new Date(now.getTime() + 86_400_000),
    createdAt: options.createdAt ?? new Date(now.getTime() - 60_000),
  });
  const initialAttempt = check.attempts[0];
  if (!initialAttempt)
    throw new Error(`CF502_INITIAL_ATTEMPT_MISSING:${options.key}`);
  await prisma.privateCvMatchCheck.update({
    where: { id: check.id },
    data: { cvTextSnapshot: source.cvTextSnapshot },
  });
  return { check, initialAttemptId: initialAttempt.id, source };
}

function automaticResult(
  checkIdValue: string,
  source: ReturnType<typeof snapshots>,
  score: number,
  options: Readonly<{ evidenceEmpty?: boolean; incomplete?: boolean }>,
): AutomaticMatchingResult {
  const matchedRequirements = options.evidenceEmpty
    ? [
        {
          id: "typescript",
          label: "TypeScript",
          kind: "REQUIRED" as const,
          matched: false,
        },
      ]
    : [
        {
          id: "typescript",
          label: "TypeScript",
          kind: "REQUIRED" as const,
          matched: true,
        },
        {
          id: "testing",
          label: "Testing",
          kind: "PREFERRED" as const,
          matched: true,
        },
      ];
  const evidence = options.evidenceEmpty
    ? []
    : [
        {
          criterionId: "typescript",
          criterionVersion: "v1",
          classification: "SKILL" as const,
          quote: "TypeScript delivery",
          location: { section: "Skills", page: 1 },
          confidence: 0.95,
          exclusionFlags: [],
        },
        {
          criterionId: "testing",
          criterionVersion: "v1",
          classification: "PROJECT" as const,
          quote: "testing evidence",
          location: { section: "Projects", page: 1 },
          confidence: 0.91,
          exclusionFlags: [],
        },
      ];
  return {
    resultId: `cf502-automatic-${checkIdValue}`,
    score,
    weight: 0.4,
    weightedContribution: round(score * 0.4),
    matchedRequirements,
    gaps: options.evidenceEmpty
      ? [
          {
            code: "typescript",
            title: "TypeScript evidence",
            description: "No traceable evidence was found in the CV snapshot.",
            kind: "REQUIRED" as const,
          },
        ]
      : [],
    requiredExperience: 2,
    detectedExperience: 3,
    evidenceCoverage: options.evidenceEmpty ? 0 : 100,
    evidenceConfidence: options.evidenceEmpty ? 0 : 95,
    evidence,
    parserProvenance: {
      parserVersion: "phase5-browser-parser-v1",
      cvStatus: source.cvSnapshot.parseStatus,
      jdStatus: source.jdSnapshot.parseStatus,
    },
    mayBeIncomplete: options.incomplete ?? false,
    cvVersion: `cv-${source.cvSnapshot.versionId}-v${source.cvSnapshot.version}`,
    jdVersion: `jd-${source.jdSnapshot.jobId}-v${source.jdSnapshot.jdVersion}`,
    configVersion: PRIVATE_SCORING_CONFIG_VERSION,
  };
}

function aiResult(
  checkIdValue: string,
  score: number,
  source: ReturnType<typeof snapshots>,
  now: Date,
  longCopy = false,
): AiEvaluationResult {
  return {
    resultId: `cf502-ai-${checkIdValue}`,
    score,
    weight: 0.6,
    weightedContribution: round(score * 0.6),
    summary: longCopy
      ? text(80, "EN VI evidence summary for candidate self-assessment")
      : "The report shows traceable evidence signals for this private review.",
    strengths: [
      {
        title: "Traceable project evidence",
        evidence: "The CV includes testing evidence in the project section.",
      },
    ],
    mainGap: longCopy
      ? text(40, "Review the remaining evidence before deciding next steps")
      : "Review the requirement evidence before applying.",
    actions: longCopy
      ? [
          text(
            60,
            "Review requirement evidence and update the CV before applying",
          ),
          text(60, "Add a concise project outcome with measurable context"),
        ]
      : ["Review requirement evidence before applying."],
    evidenceConfidence: 92,
    evidenceLevel: "HIGH",
    provider: "phase5-browser-provider",
    model: "phase5-browser-model",
    promptVersion: "phase5-browser-prompt-v1",
    policyVersion: "phase5-browser-policy-v1",
    durationMs: 120,
    completedAt: now,
    cvVersion: `cv-${source.cvSnapshot.versionId}-v${source.cvSnapshot.version}`,
    jdVersion: `jd-${source.jdSnapshot.jobId}-v${source.jdSnapshot.jdVersion}`,
    configVersion: PRIVATE_SCORING_CONFIG_VERSION,
  };
}

async function markQueuedOrAnalyzing(
  input: Phase5BrowserFixtureInput,
  cv: Awaited<ReturnType<typeof prisma.candidateCv.findUniqueOrThrow>>,
  key: string,
  state: "QUEUED" | "ANALYZING",
) {
  const created = await createCheck(input, cv, { key });
  await prisma.privateCvMatchCheck.update({
    where: { id: created.check.id },
    data: { state },
  });
  if (state === "ANALYZING") {
    await prisma.privateCvMatchAttempt.update({
      where: { id: created.initialAttemptId },
      data: {
        state: "AUTOMATIC_RUNNING",
        leaseOwner: `cf502-${key}`,
        leaseExpiresAt: new Date((input.now ?? new Date()).getTime() + 60_000),
        startedAt: input.now ?? new Date(),
      },
    });
  }
  return created.check.id;
}

async function markReport(
  input: Phase5BrowserFixtureInput,
  cv: Awaited<ReturnType<typeof prisma.candidateCv.findUniqueOrThrow>>,
  options: Readonly<{
    key: string;
    score: number;
    aiScore?: number;
    limited?: boolean;
    cvParseStatus?: ParseStatus;
    jdParseStatus?: ParseStatus;
    includeCriteria?: boolean;
    evidenceEmpty?: boolean;
    incomplete?: boolean;
    longCopy?: boolean;
  }>,
) {
  const now = input.now ?? new Date();
  const created = await createCheck(input, cv, options);
  await prisma.privateCvMatchAttempt.update({
    where: { id: created.initialAttemptId },
    data: {
      state: "AUTOMATIC_RUNNING",
      leaseOwner: `cf502-${options.key}`,
      leaseExpiresAt: new Date(now.getTime() + 120_000),
      startedAt: now,
    },
  });
  const automatic = automaticResult(
    created.check.id,
    created.source,
    options.score,
    {
      evidenceEmpty: options.evidenceEmpty,
      incomplete: options.incomplete,
    },
  );
  await repository.saveAutomaticResult({
    attemptId: created.initialAttemptId,
    workerId: `cf502-${options.key}`,
    result: automatic,
    calculatedAt: now,
    leaseMilliseconds: 120_000,
  });
  await repository.beginAi({
    attemptId: created.initialAttemptId,
    workerId: `cf502-${options.key}`,
    now,
    leaseMilliseconds: 120_000,
  });
  if (options.limited) {
    await repository.publishLimited({
      attemptId: created.initialAttemptId,
      workerId: `cf502-${options.key}`,
      failureCode: "AI_PROVIDER_TIMEOUT",
      completedAt: now,
    });
  } else {
    const aiScore = options.aiScore ?? 90;
    const hybridScore = round(options.score * 0.4 + aiScore * 0.6);
    await repository.publishHybrid({
      attemptId: created.initialAttemptId,
      workerId: `cf502-${options.key}`,
      result: aiResult(
        created.check.id,
        aiScore,
        created.source,
        now,
        options.longCopy,
      ),
      hybridScore,
      matchBand: privateScoreBand(hybridScore).code,
      completedAt: now,
    });
  }
  return created.check.id;
}

export async function seedPhase5BrowserPrivateMatches(
  input: Phase5BrowserFixtureInput,
): Promise<Phase5BrowserPrivateMatchIds> {
  const now = input.now ?? new Date();
  const cv = await prisma.candidateCv.findUniqueOrThrow({
    where: { id: input.confirmedCvId },
  });

  const fullHigh = await markReport(input, cv, {
    key: "full-high",
    score: 85,
    aiScore: 90,
  });
  const fullMedium = await markReport(input, cv, {
    key: "full-medium",
    score: 65,
    aiScore: 65,
  });
  const fullLow = await markReport(input, cv, {
    key: "full-low",
    score: 35,
    aiScore: 40,
  });
  const limited = await markReport(input, cv, {
    key: "limited",
    score: 70,
    limited: true,
  });
  const incompleteCv = await markReport(input, cv, {
    key: "incomplete-cv",
    score: 70,
    aiScore: 70,
    cvParseStatus: "PARTIAL",
    incomplete: true,
  });
  const incompleteJd = await markReport(input, cv, {
    key: "incomplete-jd",
    score: 70,
    aiScore: 70,
    jdParseStatus: "PARTIAL",
    incomplete: true,
  });
  const missingCriteria = await markReport(input, cv, {
    key: "missing-criteria",
    score: 45,
    aiScore: 45,
    includeCriteria: false,
  });
  const evidenceEmpty = await markReport(input, cv, {
    key: "evidence-empty",
    score: 25,
    aiScore: 30,
    evidenceEmpty: true,
  });
  const failedParse = await markReport(input, cv, {
    key: "failed-parse",
    score: 40,
    aiScore: 40,
    cvParseStatus: "FAILED",
    incomplete: true,
  });
  const queued = await markQueuedOrAnalyzing(input, cv, "queued", "QUEUED");
  const analyzing = await markQueuedOrAnalyzing(
    input,
    cv,
    "analyzing",
    "ANALYZING",
  );
  const retrying = await markReport(input, cv, {
    key: "retrying",
    score: 70,
    limited: true,
  });
  await repository.createAiRetryAttempt({
    candidateUserId: input.candidateUserId,
    checkId: retrying,
    now,
    scoringPolicyVersion: PRIVATE_SCORING_CONFIG_VERSION,
  });
  const retryFailure = await markReport(input, cv, {
    key: "retry-failure",
    score: 70,
    limited: true,
  });
  const failedRetry = await repository.createAiRetryAttempt({
    candidateUserId: input.candidateUserId,
    checkId: retryFailure,
    now,
    scoringPolicyVersion: PRIVATE_SCORING_CONFIG_VERSION,
  });
  if (!failedRetry) throw new Error("CF502_RETRY_ATTEMPT_NOT_CREATED");
  await prisma.privateCvMatchAttempt.update({
    where: { id: failedRetry.id },
    data: {
      state: "FAILED",
      failureCode: "AI_PROVIDER_TIMEOUT",
      completedAt: now,
    },
  });
  const expired = await createCheck(input, cv, {
    key: "expired",
    expiresAt: new Date(now.getTime() - 1_000),
  });
  const revoked = await createCheck(input, cv, { key: "revoked" });
  await prisma.privateCvMatchCheck.update({
    where: { id: revoked.check.id },
    data: {
      state: "INACCESSIBLE",
      inaccessibleAt: now,
      deleteAfter: new Date(now.getTime() + 30 * 86_400_000),
    },
  });
  const deleted = await createCheck(input, cv, { key: "deleted" });
  await prisma.privateCvMatchCheck.update({
    where: { id: deleted.check.id },
    data: {
      state: "INACCESSIBLE",
      deletedAt: now,
      inaccessibleAt: now,
      deleteAfter: new Date(now.getTime() + 30 * 86_400_000),
    },
  });
  return {
    fullHigh,
    fullMedium,
    fullLow,
    limited,
    incompleteCv,
    incompleteJd,
    missingCriteria,
    evidenceEmpty,
    failedParse,
    queued,
    analyzing,
    retrying,
    retryFailure,
    expired: expired.check.id,
    revoked: revoked.check.id,
    deleted: deleted.check.id,
  };
}

export async function setPhase5CandidateProfileEmpty(
  candidateUserId: string,
  empty: boolean,
) {
  const profile = await prisma.candidateProfile.findUniqueOrThrow({
    where: { candidateUserId },
  });
  if (empty) {
    await prisma.$transaction([
      prisma.profileExperience.deleteMany({ where: { profileId: profile.id } }),
      prisma.profileEducation.deleteMany({ where: { profileId: profile.id } }),
      prisma.candidateProfileSkill.deleteMany({
        where: { profileId: profile.id },
      }),
      prisma.candidateProfile.update({
        where: { id: profile.id },
        data: {
          headline: null,
          summary: null,
          location: null,
          phone: null,
          bio: null,
          interests: null,
          revision: { increment: 1 },
        },
      }),
    ]);
    return;
  }
  await prisma.candidateProfile.update({
    where: { id: profile.id },
    data: {
      headline: "TypeScript Engineer",
      summary: "Builds accessible recruitment products.",
      location: "Ho Chi Minh City",
      revision: { increment: 1 },
    },
  });
}

export async function seedPhase5LongCopyReport(
  input: Phase5BrowserFixtureInput,
): Promise<string> {
  const cv = await prisma.candidateCv.findUniqueOrThrow({
    where: { id: input.confirmedCvId },
  });
  return markReport(input, cv, {
    key: "long-copy",
    score: 80,
    aiScore: 82,
    longCopy: true,
  });
}
