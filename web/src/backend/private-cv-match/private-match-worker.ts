import "server-only";

import {
  logCvClassificationOutcome,
  logCvScoringFailure,
} from "@/backend/cv/upload-observability";
import { prisma } from "@/backend/database/prisma";
import {
  CV_EXTRACTION_LIMITS,
  IsolatedDocumentExtractor,
} from "@/backend/cv/extraction/document-extractor";
import { extractDocx } from "@/backend/cv/extraction/docx";
import { extractPdf } from "@/backend/cv/extraction/pdf";
import { extractLegacyDocText } from "@/backend/cv/extraction/legacy-doc";
import {
  Feature012AiEvaluationAdapter,
  Feature012AutomaticMatchingAdapter,
  isAiProviderError,
} from "@/backend/scoring-engine/scoring-engine-adapter";
import { validateExtractedCvText } from "@/backend/scoring/domain/cv-content-validation";
import { resolveMatchingSkillRequirements } from "@/backend/scoring/domain/job-skill-requirement-policy";
import { AUTOMATIC_WEIGHT } from "@/backend/scoring/domain/hybrid-score-calculator";
import {
  ApprovedCvClassificationAdapter,
  decideCvClassification,
  type CvClassificationPort,
} from "@/backend/scoring/providers/cv-classification-adapter";
import type { AiEvaluationPort } from "@/backend/scoring-engine/ai-evaluation-port";
import type { AutomaticMatchingPort } from "@/backend/scoring-engine/automatic-matching-port";
import { calculatePrivateHybridScore } from "@/backend/scoring-engine/hybrid-score-policy";
import {
  roundContribution,
  sanitizeCvText,
  type AiEvaluationResult,
  type AutomaticMatchingResult,
  type ScoringInput,
} from "@/backend/scoring-engine/scoring-contracts";
import {
  PrivateCvMatchRepository,
  type ClaimedPrivateAttempt,
} from "@/backend/repositories/private-cv-match/prisma-private-cv-match-repository";
import { safePrivateFailureCode } from "./private-match-errors";
import {
  PRIVATE_PARSER_VERSION,
  PRIVATE_SCORING_CONFIG_VERSION,
} from "./private-cv-match-service";
import { jsonRecord } from "./private-match-types";
import { OpenSafeCvArtifactService } from "@/backend/services/cv-admission/open-safe-cv-artifact-service";

const AI_FALLBACK_CODE = "AI_EVALUATION_UNAVAILABLE";
const positiveInteger = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};

export const privateMatchWorkerConfig = Object.freeze({
  // This is the outer deadline for extraction, deterministic matching,
  // classification, and the AI evaluation together. Individual providers
  // have shorter deadlines, but the worker must also have a final escape
  // hatch if a dependency ignores cancellation.
  timeoutMilliseconds: Math.min(
    60_000,
    positiveInteger("PRIVATE_CV_MATCH_TIMEOUT_MS", 60_000),
  ),
  leaseMilliseconds: Math.max(
    90_000,
    Math.min(
      75_000,
      positiveInteger("PRIVATE_CV_MATCH_TIMEOUT_MS", 60_000) + 15_000,
    ),
  ),
});
const sensitiveAttributePattern =
  /\b(?:gender|sex|male|female|age|date of birth|dob|marital status|nationality|religion|ethnicity|pregnan\w*|citizenship|identity card|national id|căn cước|cccd)\b/iu;
const sensitiveFieldPattern =
  /^\s*(?:name|address|photo|date of birth|dob)\s*[-:]/iu;

type WorkerResult = "IDLE" | "READY" | "LIMITED" | "FAILED" | "SKIPPED";

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeGeneratedText(
  value: string,
  fallback: string,
  maximum: number,
): string {
  const sentences = value
    .split(/(?<=[.!?])\s+|\r?\n/gu)
    .map((sentence) => sentence.trim())
    .filter(
      (sentence) =>
        sentence &&
        !sensitiveAttributePattern.test(sentence) &&
        !sensitiveFieldPattern.test(sentence),
    );
  return (sentences.join(" ").trim().slice(0, maximum) || fallback).slice(
    0,
    maximum,
  );
}

function sanitizeAiEvaluation(result: AiEvaluationResult): AiEvaluationResult {
  return {
    ...result,
    summary: safeGeneratedText(
      result.summary,
      "The AI evaluation is complete with sensitive attributes excluded.",
      1_000,
    ),
    strengths: result.strengths
      .flatMap((strength) => {
        const evidence = safeGeneratedText(strength.evidence, "", 1_000);
        if (!evidence) return [];
        return [
          {
            title: safeGeneratedText(strength.title, "Relevant evidence", 160),
            evidence,
          },
        ];
      })
      .slice(0, 4),
    mainGap: result.mainGap
      ? safeGeneratedText(result.mainGap, "", 1_000) || null
      : null,
    actions: result.actions
      .flatMap((action) => {
        const safe = safeGeneratedText(action, "", 500);
        return safe ? [safe] : [];
      })
      .slice(0, 4),
  };
}

async function bytesFrom(
  source: AsyncIterable<Uint8Array>,
  expectedBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of source) {
    const copy = Uint8Array.from(chunk);
    length += copy.byteLength;
    if (length > expectedBytes || length > 5_000_000)
      throw new Error("CV_LENGTH_MISMATCH");
    chunks.push(copy);
  }
  if (length !== expectedBytes) throw new Error("CV_LENGTH_MISMATCH");
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function extractText(
  extractor: IsolatedDocumentExtractor,
  kind: "PDF" | "DOC" | "DOCX",
  source: Uint8Array,
  scanStatus: "CLEAN",
): Promise<{ text: string; pageCount: number | null }> {
  if (kind === "DOC") {
    const extracted = extractLegacyDocText(source);
    return {
      text: extracted.segments
        .map((segment) => segment.text)
        .join("\n")
        .trim(),
      pageCount: extracted.pageCount,
    };
  }
  try {
    const extracted = await extractor.extract({
      kind,
      scanStatus,
      source,
    });
    return {
      text: extracted.segments
        .map((segment) => segment.text)
        .join("\n")
        .trim(),
      pageCount: extracted.pageCount,
    };
  } catch {
    const recovered =
      kind === "PDF"
        ? await extractPdf(source, CV_EXTRACTION_LIMITS)
        : await extractDocx(source, CV_EXTRACTION_LIMITS);
    return {
      text: recovered.segments
        .map((segment) => segment.text)
        .join("\n")
        .trim(),
      pageCount: recovered.pageCount,
    };
  }
}

async function sourceCandidateCvText(input: {
  candidateUserId: string;
  cvVersionId: string;
  checksumSha256: string;
  mimeType: string;
  byteSize: number;
}): Promise<{ text: string; pageCount: number | null }> {
  const kind =
    input.mimeType === "application/pdf"
      ? "PDF"
      : input.mimeType === "application/msword"
        ? "DOC"
        : input.mimeType ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          ? "DOCX"
          : null;
  if (!kind) throw new Error("CV_FORMAT_UNSUPPORTED");
  const cv = await prisma.candidateCv.findFirst({
    where: { id: input.cvVersionId, candidateUserId: input.candidateUserId },
    select: {
      checksumSha256: true,
      sourceArtifactId: true,
      scanAssessmentId: true,
      sourceArtifact: { select: { uploadId: true } },
    },
  });
  if (!cv) throw new Error("CV_SOURCE_UNAVAILABLE");
  if (
    !cv.sourceArtifactId ||
    !cv.scanAssessmentId ||
    !cv.sourceArtifact?.uploadId
  ) {
    throw new Error("CV_SAFETY_EVIDENCE_UNAVAILABLE");
  }
  const extractor = new IsolatedDocumentExtractor();
  const opened = await new OpenSafeCvArtifactService().open({
    candidateUserId: input.candidateUserId,
    uploadId: cv.sourceArtifact.uploadId,
    artifactId: cv.sourceArtifactId,
    assessmentId: cv.scanAssessmentId,
    allowedPurposes: [
      "PROFILE_IMPORT",
      "PROFILE_DIRECT",
      "JOB_APPLICATION_DIRECT",
    ],
  });
  try {
    if (
      cv.checksumSha256.toLowerCase() !==
        opened.evidence.checksumSha256.toLowerCase() ||
      input.checksumSha256.toLowerCase() !==
        opened.evidence.checksumSha256.toLowerCase() ||
      input.byteSize !== opened.byteLength
    ) {
      throw new Error("CV_DIGEST_MISMATCH");
    }
    const source = await bytesFrom(opened.openStream(), opened.byteLength);
    return extractText(extractor, kind, source, opened.evidence.scanStatus);
  } finally {
    await opened.dispose();
  }
}

function safeLog(input: {
  checkId?: string;
  state: string;
  failureCode?: string;
}) {
  // Deliberately allow-list logging. CV text, quotes, prompts, and provider
  // payloads must never enter application logs.
  console.info(
    JSON.stringify({
      checkId: input.checkId,
      state: input.state,
      ...(input.failureCode
        ? { failureCode: input.failureCode.slice(0, 80) }
        : {}),
    }),
  );
}

function scoringInput(
  attempt: ClaimedPrivateAttempt,
  cvText: string,
  automatic?: AutomaticMatchingResult,
): ScoringInput {
  const job = jsonRecord(attempt.check.jdSnapshot);
  const requiredSkillCandidates = Array.isArray(job.requiredSkills)
    ? job.requiredSkills.flatMap((item) => {
        const skill = jsonRecord(item as never);
        return typeof skill.code === "string" && typeof skill.label === "string"
          ? [{ code: skill.code, label: skill.label }]
          : [];
      })
    : [];
  const preferredSkillCandidates = Array.isArray(job.preferredSkills)
    ? job.preferredSkills.flatMap((item) => {
        const skill = jsonRecord(item as never);
        return typeof skill.code === "string" && typeof skill.label === "string"
          ? [{ code: skill.code, label: skill.label }]
          : [];
      })
    : [];
  const matchingSkills = resolveMatchingSkillRequirements(
    requiredSkillCandidates,
    preferredSkillCandidates,
  );
  const requiredSkills = matchingSkills.requiredSkills.map((skill) => ({
    ...skill,
    kind: "REQUIRED" as const,
  }));
  const preferredSkills = matchingSkills.preferredSkills.map((skill) => ({
    ...skill,
    kind: "PREFERRED" as const,
  }));
  return {
    inputId: attempt.check.id,
    cvText: sanitizeCvText(cvText),
    cvVersion: `cv-${attempt.check.cvVersionId}-v${attempt.check.cvVersion}`,
    cvDigest: attempt.check.cvDigest,
    jdText: text(job.jdText, "{}"),
    jdVersion: `jd-${attempt.check.jobPostingId}-v${attempt.check.jdVersion}`,
    jdDigest: attempt.check.jdDigest,
    configVersion:
      attempt.check.scoringConfigVersion || PRIVATE_SCORING_CONFIG_VERSION,
    parserVersion: PRIVATE_PARSER_VERSION,
    jobTitle: text(job.title),
    requiredSkills,
    preferredSkills,
    keyRequirements: Array.isArray(job.requirements)
      ? job.requirements
          .filter((item): item is string => typeof item === "string")
          .slice(0, 100)
      : [],
    minimumExperienceYears:
      typeof job.requiredExperienceYears === "number"
        ? job.requiredExperienceYears
        : null,
    requiredLanguages: Array.isArray(job.requiredLanguages)
      ? job.requiredLanguages
          .filter((item): item is string => typeof item === "string")
          .slice(0, 20)
      : [],
    automaticScore: automatic?.score,
    automaticEvidence: automatic?.evidence
      .map((item) => ({ title: item.criterionId, excerpt: item.quote }))
      .slice(0, 30),
  };
}

async function deterministicForRetry(
  repository: PrivateCvMatchRepository,
  attempt: ClaimedPrivateAttempt,
) {
  if (attempt.deterministicResultByAttempt)
    return attempt.deterministicResultByAttempt;
  if (!attempt.deterministicResultId) return null;
  return repository.findAutomaticResult(
    attempt.deterministicResultId,
    attempt.check.candidateUserId,
  );
}

function automaticFromStoredResult(
  result: NonNullable<
    Awaited<ReturnType<PrivateCvMatchRepository["findAutomaticResult"]>>
  >,
  attempt: ClaimedPrivateAttempt,
): AutomaticMatchingResult {
  const matchedRequirements = Array.isArray(result.matchedRequirements)
    ? (result.matchedRequirements as unknown as AutomaticMatchingResult["matchedRequirements"])
    : [];
  const gaps = Array.isArray(result.gaps)
    ? (result.gaps as unknown as AutomaticMatchingResult["gaps"])
    : [];
  const evidence = result.evidence.map((item) => ({
    criterionId: item.criterionId,
    criterionVersion: item.criterionVersion,
    classification: item.classification,
    quote: item.quote,
    location: jsonRecord(item.location) as {
      section: string;
      page: number | null;
    },
    confidence: number(jsonRecord(item.confidenceMetadata).confidence, 0.5),
    exclusionFlags: Array.isArray(item.exclusionFlags)
      ? item.exclusionFlags.filter(
          (flag): flag is string => typeof flag === "string",
        )
      : [],
  }));
  return {
    resultId: result.id,
    score: number(result.score),
    weight: AUTOMATIC_WEIGHT,
    weightedContribution: roundContribution(
      number(result.score),
      AUTOMATIC_WEIGHT,
    ),
    matchedRequirements,
    gaps,
    requiredExperience:
      result.requiredExperience === null
        ? null
        : number(result.requiredExperience),
    detectedExperience:
      result.detectedExperience === null
        ? null
        : number(result.detectedExperience),
    evidenceCoverage: number(result.evidenceCoverage),
    evidenceConfidence: Math.min(
      100,
      Math.max(0, Math.round(number(result.evidenceCoverage) * 0.95)),
    ),
    evidence,
    parserProvenance: jsonRecord(
      result.parserProvenance,
    ) as AutomaticMatchingResult["parserProvenance"],
    mayBeIncomplete: result.mayBeIncomplete,
    cvVersion: `cv-${attempt.check.cvVersionId}-v${attempt.check.cvVersion}`,
    jdVersion: `jd-${attempt.check.jobPostingId}-v${attempt.check.jdVersion}`,
    configVersion: attempt.check.scoringConfigVersion,
  };
}

export class PrivateMatchWorker {
  constructor(
    private readonly dependencies: Readonly<{
      repository?: PrivateCvMatchRepository;
      automatic?: AutomaticMatchingPort;
      ai?: AiEvaluationPort;
      classifier?: CvClassificationPort;
      now?: () => Date;
      workerId?: string;
      timeoutMilliseconds?: number;
    }> = {},
  ) {}

  async processNext(): Promise<WorkerResult> {
    const repository =
      this.dependencies.repository ?? new PrivateCvMatchRepository();
    const now = this.dependencies.now?.() ?? new Date();
    const workerId =
      this.dependencies.workerId ?? `private-match-worker-${process.pid}`;
    const timeoutMilliseconds = Math.min(
      60_000,
      this.dependencies.timeoutMilliseconds ??
        privateMatchWorkerConfig.timeoutMilliseconds,
    );
    const leaseMilliseconds = Math.max(90_000, timeoutMilliseconds + 15_000);
    const attempt = await repository.claimNextAttempt(
      workerId,
      now,
      leaseMilliseconds,
    );
    if (!attempt) return "IDLE";
    const checkId = attempt.check.id;
    let deterministicPublished = Boolean(
      attempt.deterministicResultId || attempt.deterministicResultByAttempt,
    );
    const processClaimedAttempt = async (): Promise<WorkerResult> => {
      try {
        await repository.setCheckAnalyzing(checkId, now);
        let cvText = attempt.check.cvTextSnapshot;
        let pageCount: number | null = null;
        if (!cvText?.trim()) {
          const cv = jsonRecord(attempt.check.cvSnapshot);
          const extracted = await sourceCandidateCvText({
            candidateUserId: attempt.check.candidateUserId,
            cvVersionId: attempt.check.cvVersionId,
            checksumSha256: attempt.check.cvDigest,
            mimeType: text(cv.mimeType),
            byteSize: number(cv.byteSize),
          });
          cvText = extracted.text;
          pageCount = extracted.pageCount;
          if (!cvText.trim()) throw new Error("CV_TEXT_UNAVAILABLE");
          await repository.setCvTextSnapshot(checkId, sanitizeCvText(cvText));
        }
        const validatedCvText = validateExtractedCvText(cvText ?? "");
        const classification = await (
          this.dependencies.classifier ?? new ApprovedCvClassificationAdapter()
        ).classify({ cvText: validatedCvText.text });
        const classificationDecision = decideCvClassification({
          cvText: validatedCvText.text,
          classification,
        });
        logCvClassificationOutcome({
          isCv: classification.isCv,
          confidence: classification.confidence,
          accepted: classificationDecision.accepted,
          source: classification.source,
          decisionBasis: classificationDecision.basis,
          structuralConfidence:
            classificationDecision.structuralClassification.confidence,
        });
        if (!classificationDecision.accepted)
          throw new Error("CV_NOT_RECOGNIZED_AS_CV");
        cvText = validatedCvText.text;
        // A lease may be recovered after the deterministic result was saved or
        // while the AI call was running. In both cases the fixed deterministic
        // component must be reused instead of being recalculated.
        const initialAutomatic =
          attempt.trigger === "INITIAL" &&
          !attempt.deterministicResultId &&
          !attempt.deterministicResultByAttempt;
        let automatic: AutomaticMatchingResult;
        if (initialAutomatic) {
          automatic = await (
            this.dependencies.automatic ??
            new Feature012AutomaticMatchingAdapter()
          ).match(scoringInput(attempt, cvText));
          await repository.saveAutomaticResult({
            attemptId: attempt.id,
            workerId,
            result: automatic,
            calculatedAt: new Date(),
            leaseMilliseconds,
          });
          deterministicPublished = true;
        } else {
          const stored = await deterministicForRetry(repository, attempt);
          if (!stored)
            throw new Error("PRIVATE_DETERMINISTIC_RESULT_UNAVAILABLE");
          automatic = automaticFromStoredResult(stored, attempt);
        }
        if (pageCount !== null) {
          // Page count is display metadata only. The immutable scoring payload
          // and score components remain independent of this best-effort value.
          void pageCount;
        }
        await repository.beginAi({
          attemptId: attempt.id,
          workerId,
          now: new Date(),
          leaseMilliseconds,
        });
        const rawAi = await (
          this.dependencies.ai ?? new Feature012AiEvaluationAdapter()
        ).evaluate(scoringInput(attempt, cvText, automatic));
        const ai = sanitizeAiEvaluation(rawAi);
        const hybrid = calculatePrivateHybridScore(automatic, ai);
        await repository.publishHybrid({
          attemptId: attempt.id,
          workerId,
          result: ai,
          hybridScore: hybrid.value,
          matchBand: hybrid.band,
          completedAt: new Date(),
        });
        safeLog({ checkId, state: "READY" });
        return "READY";
      } catch (error) {
        const completedAt = new Date();
        const message = safePrivateFailureCode(error);
        logCvScoringFailure({ reason: message, workItemId: checkId });
        if (!deterministicPublished && attempt.trigger === "INITIAL") {
          await repository
            .markFailed({
              attemptId: attempt.id,
              workerId,
              failureCode: message.startsWith("CV_")
                ? message
                : "AUTOMATIC_MATCH_FAILED",
              completedAt,
            })
            .catch(() => false);
          safeLog({
            checkId,
            state: "FAILED",
            // `message` is already reduced to the allow-listed safe failure
            // code. Keep the public attempt failure coarse, but retain the
            // safe diagnostic code in logs so an operator can distinguish a
            // missing source from a deterministic matcher failure without
            // logging CV text, quotes, prompts, or provider payloads.
            failureCode: message,
          });
          return "FAILED";
        }
        // AI provider outages, timeouts, malformed output, and circuit-open
        // responses all publish the deterministic result as LIMITED. The
        // diagnostic provider message is intentionally discarded.
        if (deterministicPublished || attempt.trigger === "AI_RETRY") {
          const failureCode = isAiProviderError(error)
            ? error.code
            : AI_FALLBACK_CODE;
          await repository
            .publishLimited({
              attemptId: attempt.id,
              workerId,
              failureCode: failureCode.slice(0, 80),
              completedAt,
            })
            .catch(() => undefined);
          safeLog({
            checkId,
            state: "LIMITED",
            failureCode: failureCode.slice(0, 80),
          });
          return "LIMITED";
        }
        await repository
          .markFailed({
            attemptId: attempt.id,
            workerId,
            failureCode: "PRIVATE_MATCH_FAILED",
            completedAt,
          })
          .catch(() => false);
        safeLog({
          checkId,
          state: "FAILED",
          failureCode: "PRIVATE_MATCH_FAILED",
        });
        return "FAILED";
      }
    };

    try {
      return await withTimeout(processClaimedAttempt(), timeoutMilliseconds);
    } catch (error) {
      const failureCode = safePrivateFailureCode(error);
      logCvScoringFailure({ reason: failureCode, workItemId: checkId });
      await repository
        .markFailed({
          attemptId: attempt.id,
          workerId,
          failureCode:
            failureCode === "INTERNAL_FAILURE"
              ? "SCORING_TIMEOUT"
              : failureCode,
          completedAt: new Date(),
        })
        .catch(() => false);
      safeLog({
        checkId,
        state: "FAILED",
        failureCode:
          failureCode === "INTERNAL_FAILURE" ? "SCORING_TIMEOUT" : failureCode,
      });
      return "FAILED";
    }
  }
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("SCORING_TIMEOUT")),
      milliseconds,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function processPrivateMatchWorkOnce(
  dependencies: ConstructorParameters<typeof PrivateMatchWorker>[0] = {},
): Promise<WorkerResult> {
  return new PrivateMatchWorker(dependencies).processNext();
}
