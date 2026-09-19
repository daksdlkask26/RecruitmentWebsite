import "server-only";

import { createHash } from "node:crypto";
import {
  privateMatchResponseSchema,
  privateMatchStatusSchema,
  type PrivateMatchStatus,
  type PrivateMatchResponse,
  type MatchPresentationState,
} from "@/shared/contracts/private-cv-match";
import type { PrivateCheckRecord } from "@/backend/repositories/private-cv-match/prisma-private-cv-match-repository";
import {
  AI_WEIGHT,
  AUTOMATIC_WEIGHT,
  PRIVATE_SCORING_CONFIG_VERSION,
  privateScoreBand,
} from "@/backend/scoring-engine/hybrid-score-policy";
import {
  jsonRecord,
  privateCvSnapshotSchema,
  privateJdSnapshotSchema,
} from "./private-match-types";

const evidenceClassifications = new Set([
  "SKILL",
  "PROJECT",
  "IMPACT",
  "EXPERIENCE",
  "EDUCATION",
  "OTHER",
]);

export class PrivateMatchProjectionError extends Error {
  readonly code = "PRIVATE_MATCH_PROJECTION_UNAVAILABLE";

  constructor() {
    super("PRIVATE_MATCH_PROJECTION_UNAVAILABLE");
    this.name = "PrivateMatchProjectionError";
  }
}

function projectionError(): never {
  throw new PrivateMatchProjectionError();
}

function finiteNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" ||
          typeof value === "bigint" ||
          (value !== null && typeof value === "object")
        ? Number(value)
        : null;
  return parsed !== null && Number.isFinite(parsed) ? parsed : null;
}

function requiredNumber(value: unknown): number {
  const parsed = finiteNumber(value);
  if (parsed === null) projectionError();
  return parsed;
}

function textValue(value: unknown, maximum: number): string {
  if (typeof value !== "string") projectionError();
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum) projectionError();
  return trimmed;
}

function nullableText(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined) return null;
  return textValue(value, maximum);
}

function arrayValue(value: unknown): unknown[] {
  if (!Array.isArray(value)) projectionError();
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested))
      return nested;
    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    );
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeForTrace(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function quoteIsTraceable(quote: string, cvText: string): boolean {
  const normalizedQuote = normalizeForTrace(quote);
  return (
    Boolean(normalizedQuote) &&
    normalizeForTrace(cvText).includes(normalizedQuote)
  );
}

function validPage(value: unknown): number | null | undefined {
  if (value === null) return null;
  const page = finiteNumber(value);
  return page !== null && Number.isInteger(page) && page > 0 ? page : undefined;
}

function storedHybridWeight(value: unknown, expected: 0.4 | 0.6): 0.4 | 0.6 {
  const weight = finiteNumber(value);
  if (weight !== expected) projectionError();
  return expected;
}

function completedDurationSeconds(
  startedAt: Date | null,
  completedAt: Date | null,
): number | null {
  if (!startedAt || !completedAt) return null;
  return Math.max(
    0,
    Math.round((completedAt.getTime() - startedAt.getTime()) / 100) / 10,
  );
}

type SnapshotState = Readonly<{
  cv: ReturnType<typeof privateCvSnapshotSchema.parse>;
  job: ReturnType<typeof privateJdSnapshotSchema.parse>;
}>;

function snapshots(check: PrivateCheckRecord): SnapshotState {
  const cv = privateCvSnapshotSchema.safeParse(check.cvSnapshot);
  const job = privateJdSnapshotSchema.safeParse(check.jdSnapshot);
  if (!cv.success || !job.success) projectionError();
  if (
    cv.data.versionId !== check.cvVersionId ||
    cv.data.version !== check.cvVersion ||
    cv.data.checksumSha256.toLowerCase() !== check.cvDigest.toLowerCase() ||
    job.data.jobId !== check.jobPostingId ||
    job.data.jdVersion !== check.jdVersion ||
    sha256(canonicalJson(job.data)).toLowerCase() !==
      check.jdDigest.toLowerCase()
  ) {
    projectionError();
  }
  return { cv: cv.data, job: job.data };
}

function snapshotCompleteness(snapshot: SnapshotState): MatchPresentationState {
  if (
    snapshot.cv.parseStatus === "FAILED" ||
    snapshot.job.parseStatus === "FAILED"
  ) {
    return "UNAVAILABLE";
  }
  if (
    snapshot.cv.parseStatus === "PARTIAL" ||
    snapshot.job.parseStatus === "PARTIAL"
  ) {
    return "INCOMPLETE";
  }
  const hasCriteria =
    snapshot.job.requirements.length > 0 ||
    snapshot.job.requiredSkills.length > 0 ||
    snapshot.job.preferredSkills.length > 0 ||
    snapshot.job.requiredLanguages.length > 0 ||
    snapshot.job.requiredExperienceYears !== null;
  return hasCriteria ? "AVAILABLE" : "INCOMPLETE";
}

function provenance(
  check: PrivateCheckRecord,
  completeness: MatchPresentationState,
  presentationState: MatchPresentationState,
  scoreEligible: boolean,
) {
  const attempt = check.currentAttempt;
  return {
    inputSource: "CV" as const,
    completeness,
    presentationState,
    scoreEligible,
    cvVersionId: check.cvVersionId,
    cvVersion: check.cvVersion,
    jdVersion: check.jdVersion,
    scoringConfigVersion: check.scoringConfigVersion,
    aiProvider: attempt?.provider ?? null,
    aiModel: attempt?.model ?? null,
    promptVersion: attempt?.promptVersion ?? null,
    inputPolicyVersion: attempt?.inputPolicyVersion ?? null,
  };
}

function base(
  check: PrivateCheckRecord,
  snapshot: SnapshotState,
  completeness: MatchPresentationState,
  presentationState: MatchPresentationState,
  scoreEligible: boolean,
) {
  return {
    checkId: check.id,
    inputSource: "CV" as const,
    completeness,
    presentationState,
    scoreEligible,
    createdAt: check.createdAt.toISOString(),
    expiresAt: check.expiresAt.toISOString(),
    provenance: provenance(
      check,
      completeness,
      presentationState,
      scoreEligible,
    ),
    cv: {
      versionId: snapshot.cv.versionId,
      version: snapshot.cv.version,
      displayName: snapshot.cv.displayName,
      fileName: snapshot.cv.fileName,
      mimeType: snapshot.cv.mimeType,
      byteSize: snapshot.cv.byteSize,
      pageCount: snapshot.cv.pageCount,
      parseStatus: snapshot.cv.parseStatus,
      confirmedAt: snapshot.cv.confirmedAt,
    },
    job: {
      jobId: snapshot.job.jobId,
      slug: snapshot.job.slug,
      title: snapshot.job.title,
      company: snapshot.job.company,
      location: snapshot.job.location,
      employmentType: snapshot.job.employmentType,
      workArrangement: snapshot.job.workArrangement,
      requiredExperienceYears: snapshot.job.requiredExperienceYears,
      requirements: [...snapshot.job.requirements],
      jdVersion: snapshot.job.jdVersion,
      jdUpdatedAt: snapshot.job.jdUpdatedAt,
    },
  };
}

function validateAttemptLineage(
  check: PrivateCheckRecord,
  attempt: NonNullable<PrivateCheckRecord["currentAttempt"]>,
) {
  if (
    check.currentAttemptId !== attempt.id ||
    attempt.checkId !== check.id ||
    attempt.scoringPolicyVersion !== check.scoringConfigVersion ||
    check.scoringConfigVersion !== PRIVATE_SCORING_CONFIG_VERSION
  ) {
    projectionError();
  }
}

function deterministicResult(
  check: PrivateCheckRecord,
  attempt: NonNullable<PrivateCheckRecord["currentAttempt"]>,
) {
  const result =
    attempt.deterministicResultByAttempt ?? attempt.deterministicResult ?? null;
  if (!result || attempt.deterministicResultId !== result.id) return null;
  const linkedAttempt = (
    result as typeof result & {
      attempt?: { id: string; checkId: string } | null;
    }
  ).attempt;
  const owner = linkedAttempt
    ? linkedAttempt
    : check.attempts.find((item) => item.id === result.attemptId);
  if (!owner || owner.checkId !== check.id) projectionError();
  if (attempt.deterministicResultByAttempt && result.attemptId !== attempt.id) {
    projectionError();
  }
  return result;
}

function parseMatchedRequirements(value: unknown) {
  const values = arrayValue(value);
  let malformed = false;
  const matched = values.flatMap((entry) => {
    const item = jsonRecord(entry as never);
    const id = nullableText(item.id, 128);
    const label = nullableText(item.label, 200);
    if (
      !id ||
      !label ||
      (item.kind !== "REQUIRED" && item.kind !== "PREFERRED")
    ) {
      malformed = true;
      return [];
    }
    if (typeof item.matched !== "boolean") {
      malformed = true;
      return [];
    }
    return [{ id, label, kind: item.kind, matched: item.matched }];
  });
  return { matched, malformed };
}

function parseGaps(value: unknown) {
  const values = arrayValue(value);
  let malformed = false;
  const gaps = values.flatMap((entry) => {
    const item = jsonRecord(entry as never);
    const code = nullableText(item.code, 160);
    const title = nullableText(item.title, 300);
    const description = nullableText(item.description, 500);
    const kind = item.kind;
    if (
      !code ||
      !title ||
      !description ||
      (kind !== "REQUIRED" && kind !== "PREFERRED" && kind !== "EXPERIENCE")
    ) {
      malformed = true;
      return [];
    }
    return [{ code, title, description, kind }];
  });
  return { gaps, malformed };
}

function parseParserProvenance(value: unknown) {
  const item = jsonRecord(value as never);
  const parserVersion = nullableText(item.parserVersion, 80);
  const cvStatus = nullableText(item.cvStatus, 80);
  const jdStatus = nullableText(item.jdStatus, 80);
  if (!parserVersion || !cvStatus || !jdStatus) projectionError();
  return { parserVersion, cvStatus, jdStatus };
}

function parseEvidence(
  result: NonNullable<
    NonNullable<
      PrivateCheckRecord["currentAttempt"]
    >["deterministicResultByAttempt"]
  >,
  matchedIds: ReadonlySet<string>,
  cvTextSnapshot: string | null,
) {
  let malformed = false;
  const evidence = result.evidence.flatMap((item) => {
    const quote = textValue(item.quote, 1_000);
    const criterionId = textValue(item.criterionId, 128);
    const criterionVersion = textValue(item.criterionVersion, 64);
    const location = jsonRecord(item.location);
    const section = nullableText(location.section, 120);
    const page = validPage(location.page);
    const confidence = finiteNumber(
      jsonRecord(item.confidenceMetadata).confidence,
    );
    if (
      !section ||
      page === undefined ||
      confidence === null ||
      confidence < 0 ||
      confidence > 1 ||
      !criterionVersion ||
      !matchedIds.has(criterionId) ||
      !cvTextSnapshot ||
      !quoteIsTraceable(quote, cvTextSnapshot) ||
      !evidenceClassifications.has(item.classification)
    ) {
      malformed = true;
      return [];
    }
    return [
      {
        type: item.classification as
          | "SKILL"
          | "PROJECT"
          | "IMPACT"
          | "EXPERIENCE"
          | "EDUCATION"
          | "OTHER",
        quote,
        criterion: criterionId,
        location: `${section}${page === null ? "" : ` \u00b7 p.${page}`}`,
        confidence,
      },
    ];
  });
  return { evidence, malformed };
}

function automaticComponent(
  result: NonNullable<
    NonNullable<
      PrivateCheckRecord["currentAttempt"]
    >["deterministicResultByAttempt"]
  >,
  snapshot: SnapshotState,
  check: PrivateCheckRecord,
  scoreEligible: boolean,
) {
  const storedLineage = jsonRecord(result.parserProvenance);
  const expectedLineage = {
    cvVersion: `cv-${check.cvVersionId}-v${check.cvVersion}`,
    jdVersion: `jd-${check.jobPostingId}-v${check.jdVersion}`,
    configVersion: check.scoringConfigVersion,
  };
  if (
    storedLineage.cvVersion !== expectedLineage.cvVersion ||
    storedLineage.jdVersion !== expectedLineage.jdVersion ||
    storedLineage.configVersion !== expectedLineage.configVersion
  ) {
    projectionError();
  }
  const parsedScore = requiredNumber(result.score);
  const parsedContribution = requiredNumber(result.weightedContribution);
  const parsedCoverage = requiredNumber(result.evidenceCoverage);
  const parsedWeight = storedHybridWeight(result.weight, AUTOMATIC_WEIGHT);
  const requiredExperience =
    result.requiredExperience === null
      ? null
      : requiredNumber(result.requiredExperience);
  const detectedExperience =
    result.detectedExperience === null
      ? null
      : requiredNumber(result.detectedExperience);
  if (
    parsedScore < 0 ||
    parsedScore > 100 ||
    parsedContribution < 0 ||
    parsedContribution > 60 ||
    parsedCoverage < 0 ||
    parsedCoverage > 100 ||
    parsedContribution > parsedWeight * 100
  ) {
    projectionError();
  }
  const { matched, malformed: matchedMalformed } = parseMatchedRequirements(
    result.matchedRequirements,
  );
  const { gaps, malformed: gapsMalformed } = parseGaps(result.gaps);
  const parserProvenance = parseParserProvenance(result.parserProvenance);
  const { evidence, malformed: evidenceMalformed } = parseEvidence(
    result,
    new Set(matched.map((item) => item.id)),
    check.cvTextSnapshot,
  );
  const matchedWithEvidence = new Set(evidence.map((item) => item.criterion));
  const missingMatchedEvidence = matched.some(
    (item) => item.matched && !matchedWithEvidence.has(item.id),
  );
  const qualityIncomplete =
    result.mayBeIncomplete ||
    matchedMalformed ||
    gapsMalformed ||
    evidenceMalformed ||
    missingMatchedEvidence ||
    snapshot.cv.parseStatus !== "READY" ||
    snapshot.job.parseStatus !== "READY" ||
    check.cvTextSnapshot === null;
  const componentScoreEligible = scoreEligible && !qualityIncomplete;
  return {
    componentScoreEligible,
    score: componentScoreEligible ? parsedScore : null,
    weight: parsedWeight,
    weightedContribution: componentScoreEligible ? parsedContribution : null,
    evidenceCoverage: componentScoreEligible ? parsedCoverage : null,
    evidenceConfidence: componentScoreEligible
      ? Math.min(100, Math.max(0, Math.round(parsedCoverage * 0.95)))
      : null,
    matchedRequirements: matched,
    gaps,
    requiredExperience: componentScoreEligible ? requiredExperience : null,
    detectedExperience: componentScoreEligible ? detectedExperience : null,
    evidence,
    parserProvenance,
    mayBeIncomplete: qualityIncomplete,
  };
}

function aiComponent(
  result: NonNullable<
    NonNullable<PrivateCheckRecord["currentAttempt"]>["aiResultByAttempt"]
  >,
  scoreEligible: boolean,
) {
  const score = requiredNumber(result.score);
  const contribution = requiredNumber(result.weightedContribution);
  const weight = storedHybridWeight(result.weight, AI_WEIGHT);
  if (
    score < 0 ||
    score > 100 ||
    contribution < 0 ||
    contribution > 60 ||
    contribution > weight * 100
  ) {
    projectionError();
  }
  const strengths = arrayValue(result.strengths).flatMap((value) => {
    const item = jsonRecord(value as never);
    const title = nullableText(item.title, 160);
    const evidence = nullableText(item.evidence, 1_000);
    if (!title || !evidence) projectionError();
    return [{ title, evidence }];
  });
  if (strengths.length > 4) projectionError();
  const actions = arrayValue(result.actions).map((value) =>
    textValue(value, 500),
  );
  if (actions.length > 4) projectionError();
  const summary = textValue(result.summary, 1_000);
  const mainGap = nullableText(result.mainGap, 1_000);
  const evidenceConfidence = requiredNumber(result.evidenceConfidence);
  if (
    !Number.isInteger(evidenceConfidence) ||
    evidenceConfidence < 0 ||
    evidenceConfidence > 100
  ) {
    projectionError();
  }
  const evidenceLevel = result.evidenceLevel;
  if (
    evidenceLevel !== "LOW" &&
    evidenceLevel !== "MEDIUM" &&
    evidenceLevel !== "HIGH"
  ) {
    projectionError();
  }
  return {
    score: scoreEligible ? score : null,
    weight,
    weightedContribution: scoreEligible ? contribution : null,
    summary,
    strengths,
    mainGap,
    actions,
    evidenceConfidence: scoreEligible ? evidenceConfidence : null,
    evidenceLevel,
    provider: textValue(result.provider, 100),
    model: textValue(result.model, 200),
    promptVersion: textValue(result.promptVersion, 100),
    policyVersion: textValue(result.policyVersion, 100),
    durationMs: requiredNumber(result.durationMs),
    completedAt: result.completedAt.toISOString(),
  };
}

function retryInProgress(check: PrivateCheckRecord, now: Date): boolean {
  return check.attempts.some(
    (attempt) =>
      attempt.trigger === "AI_RETRY" &&
      (attempt.state === "QUEUED" ||
        (attempt.state === "AI_RUNNING" &&
          attempt.leaseExpiresAt !== null &&
          attempt.leaseExpiresAt > now)),
  );
}

function statusResponse(
  check: PrivateCheckRecord,
  snapshot: SnapshotState,
  completeness: MatchPresentationState,
  failureCode: string | null = null,
): PrivateMatchStatus {
  const attempt =
    check.attempts.find((item) => item.state === "FAILED") ??
    check.attempts[0] ??
    null;
  const state =
    failureCode || check.state === "FAILED"
      ? "FAILED"
      : check.state === "ANALYZING"
        ? "ANALYZING"
        : "QUEUED";
  return privateMatchStatusSchema.parse({
    ...base(check, snapshot, completeness, "UNAVAILABLE", false),
    view: "STATUS",
    state,
    failureCode: failureCode ?? attempt?.failureCode ?? null,
    durationSeconds: completedDurationSeconds(
      attempt?.startedAt ?? null,
      attempt?.completedAt ?? null,
    ),
  });
}

export function projectPrivateMatchCheck(
  check: PrivateCheckRecord,
  now = new Date(),
): PrivateMatchResponse {
  const snapshot = snapshots(check);
  const baseCompleteness = snapshotCompleteness(snapshot);
  const attempt = check.currentAttempt;
  if (!attempt || !check.currentAttemptId) {
    return statusResponse(check, snapshot, baseCompleteness);
  }
  try {
    validateAttemptLineage(check, attempt);
    const deterministic = deterministicResult(check, attempt);
    if (!deterministic) {
      return statusResponse(
        check,
        snapshot,
        baseCompleteness,
        "RESULT_UNAVAILABLE",
      );
    }
    const preliminaryEligible = baseCompleteness === "AVAILABLE";
    const automaticWithState = automaticComponent(
      deterministic,
      snapshot,
      check,
      preliminaryEligible,
    );
    const { componentScoreEligible, ...automatic } = automaticWithState;
    const completeness: MatchPresentationState =
      automatic.mayBeIncomplete || !componentScoreEligible
        ? baseCompleteness === "UNAVAILABLE"
          ? "UNAVAILABLE"
          : "INCOMPLETE"
        : "AVAILABLE";
    const scoreEligible = completeness === "AVAILABLE";
    const common = base(
      check,
      snapshot,
      completeness,
      completeness,
      scoreEligible,
    );
    const completedAt = attempt.completedAt;
    if (!completedAt) {
      return statusResponse(
        check,
        snapshot,
        completeness,
        "RESULT_UNAVAILABLE",
      );
    }
    if (attempt.state === "READY" && attempt.aiResultByAttempt) {
      if (
        attempt.aiResultByAttempt.attemptId !== attempt.id ||
        attempt.aiResultId !== attempt.aiResultByAttempt.id
      ) {
        projectionError();
      }
      const aiEvaluation = aiComponent(
        attempt.aiResultByAttempt,
        scoreEligible,
      );
      let hybridScore: number | null = null;
      let matchBand: "HIGH_MATCH" | "MEDIUM_MATCH" | "LOW_MATCH" | null = null;
      if (scoreEligible) {
        const automaticScore = automatic.score;
        const aiScore = aiEvaluation.score;
        if (automaticScore === null || aiScore === null) projectionError();
        const calculated =
          Math.round(
            (automaticScore * AUTOMATIC_WEIGHT +
              aiScore * AI_WEIGHT +
              Number.EPSILON) *
              10,
          ) / 10;
        hybridScore = requiredNumber(attempt.hybridScore);
        if (hybridScore !== calculated) projectionError();
        const calculatedBand = privateScoreBand(hybridScore);
        if (attempt.matchBand !== calculatedBand.code) projectionError();
        matchBand = calculatedBand.code as
          | "HIGH_MATCH"
          | "MEDIUM_MATCH"
          | "LOW_MATCH";
      }
      return privateMatchResponseSchema.parse({
        ...common,
        view: "FULL_REPORT",
        state: "READY",
        mode: "HYBRID",
        hybridScore,
        matchBand,
        automatic,
        aiEvaluation,
        evidenceConfidence: scoreEligible
          ? aiEvaluation.evidenceConfidence
          : null,
        summary: aiEvaluation.summary,
        actions: aiEvaluation.actions,
        canApply: true,
        completedAt: completedAt.toISOString(),
        retryInProgress: retryInProgress(check, now),
      });
    }
    if (attempt.state === "LIMITED") {
      return privateMatchResponseSchema.parse({
        ...common,
        view: "LIMITED_REPORT",
        state: "LIMITED",
        mode: "LIMITED",
        automatic,
        aiEvaluation: null,
        hybridScore: null,
        matchBand: null,
        canRetryAi: true,
        canApply: true,
        retryInProgress: retryInProgress(check, now),
        completedAt: completedAt.toISOString(),
        failureCode: attempt.failureCode,
      });
    }
    return statusResponse(check, snapshot, completeness, "RESULT_UNAVAILABLE");
  } catch (error) {
    if (error instanceof PrivateMatchProjectionError) throw error;
    throw new PrivateMatchProjectionError();
  }
}

export function projectPrivateMatchStatus(
  check: PrivateCheckRecord,
): PrivateMatchStatus {
  const snapshot = snapshots(check);
  return statusResponse(check, snapshot, snapshotCompleteness(snapshot));
}
