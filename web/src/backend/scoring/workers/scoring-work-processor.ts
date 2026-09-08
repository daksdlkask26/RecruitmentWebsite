import "server-only";

import { logCvClassificationOutcome } from "@/backend/cv/upload-observability";
import { prisma } from "@/backend/database/prisma";
import {
  CV_EXTRACTION_LIMITS,
  IsolatedDocumentExtractor,
} from "@/backend/cv/extraction/document-extractor";
import { extractDocx } from "@/backend/cv/extraction/docx";
import { extractPdf } from "@/backend/cv/extraction/pdf";
import { extractLegacyDocText } from "@/backend/cv/extraction/legacy-doc";
import { AutomaticMatchService } from "../services/automatic-match-service";
import { DocumentParsingService } from "../services/document-parsing-service";
import { PrismaScoringRepository } from "../repositories/prisma-scoring-repository";
import { ScoringPublicationService } from "../services/scoring-publication-service";
import type { ScoringWorkProcessor } from "./scoring-worker";
import { ApprovedAiAssessmentAdapter } from "../providers/approved-ai-assessment-adapter";
import { AiAssessmentProviderError } from "../providers/ai-assessment-provider-port";
import { inspectCvForAiPreflight } from "../domain/cv-preflight";
import {
  validateExtractedCvText,
  type ValidatedCvText,
} from "../domain/cv-content-validation";
import {
  ApprovedCvClassificationAdapter,
  decideCvClassification,
  type CvClassificationPort,
} from "../providers/cv-classification-adapter";
import { partitionJobSkillsForMatching } from "../domain/job-skill-requirement-policy";
import { OpenSafeCvArtifactService } from "@/backend/services/cv-admission/open-safe-cv-artifact-service";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function createScoringWorkProcessor(
  dependencies: {
    classifier?: CvClassificationPort;
  } = {},
): ScoringWorkProcessor {
  const matcher = new AutomaticMatchService();
  const parser = new DocumentParsingService("application-document-parser-v2");
  const documentExtractor = new IsolatedDocumentExtractor();
  const publication = new ScoringPublicationService(
    new PrismaScoringRepository(prisma),
  );
  const repository = new PrismaScoringRepository(prisma);
  const aiProvider = new ApprovedAiAssessmentAdapter();
  const classifier =
    dependencies.classifier ?? new ApprovedCvClassificationAdapter();
  return async (input) => {
    const [row, operation] = await Promise.all([
      prisma.jobApplication.findUnique({
        where: { id: input.applicationId },
        select: {
          candidateUserId: true,
          cvSnapshot: true,
          jobSnapshot: true,
          coverLetter: true,
          applicationDocuments: {
            where: {
              kind: "CV",
              committedAt: { not: null },
              deletedAt: null,
            },
            take: 1,
            select: {
              mediaType: true,
              byteLength: true,
              contentDigestHmac: true,
              sourceArtifactId: true,
              scanAssessmentId: true,
              sourceArtifact: { select: { uploadId: true } },
            },
          },
          jobPosting: {
            select: {
              skills: {
                orderBy: { position: "asc" },
                select: {
                  skillId: true,
                  displayName: true,
                  required: true,
                },
              },
            },
          },
        },
      }),
      prisma.scoringOperation.findUnique({
        where: { id: input.operationId },
        select: {
          kind: true,
          targetJobDescriptionVersionId: true,
          targetScoringConfigVersionId: true,
        },
      }),
    ]);
    if (!row || !operation) throw new Error("SCORING_INPUT_UNAVAILABLE");
    const matchingSkills = partitionJobSkillsForMatching(row.jobPosting.skills);
    const cv = record(row.cvSnapshot);
    const job = record(row.jobSnapshot);
    const cvText =
      (await uploadedApplicationCvText(
        row.applicationDocuments[0],
        documentExtractor,
        input.applicationId,
        row.candidateUserId,
      )) ??
      (await sourceCandidateCvText({
        candidateUserId: row.candidateUserId,
        cvSnapshot: cv,
        extractor: documentExtractor,
        applicationId: input.applicationId,
      })) ??
      "";
    let validatedCvText: ValidatedCvText;
    try {
      validatedCvText = validateExtractedCvText(cvText);
    } catch (error) {
      if (error instanceof Error && error.message === "CV_TEXT_UNAVAILABLE") {
        throw new Error("SCORING_CV_TEXT_UNAVAILABLE", { cause: error });
      }
      throw error;
    }
    const classification = await classifier.classify({
      cvText: validatedCvText.text,
    });
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
    if (
      !classificationDecision.accepted &&
      classification.source === "DETERMINISTIC_FALLBACK" &&
      classification.providerFailureCode
    )
      throw new Error(classification.providerFailureCode);
    if (!classificationDecision.accepted)
      throw new Error("CV_NOT_RECOGNIZED_AS_CV");
    const safeCvText = validatedCvText.text;
    const jdText = JSON.stringify(job);
    const preflightIssues = inspectCvForAiPreflight({
      cvText: safeCvText,
      jobTitle: typeof job.title === "string" ? job.title : "",
      requiredSkills: matchingSkills.requiredSkills.map(
        (skill) => skill.displayName,
      ),
    });
    const cvVersion = `cv-${String(cv.cvId ?? input.applicationId)}-v${String(cv.cvVersion ?? 1)}`;
    const cvParsed = parser.parse({
      text: safeCvText,
      snapshotVersion: cvVersion,
    });
    const jdParsed = parser.parse({
      text: jdText,
      snapshotVersion: operation.targetJobDescriptionVersionId,
    });
    const existing =
      operation.kind === "AI_RETRY"
        ? await repository.findCurrent(input.applicationId)
        : null;
    const automatic =
      existing?.automatic ??
      matcher.calculate({
        applicationId: input.applicationId,
        cvText: cvParsed.text,
        cvVersion,
        jdVersion: operation.targetJobDescriptionVersionId,
        configVersion: operation.targetScoringConfigVersionId,
        parserVersion: cvParsed.status.parserVersion,
        cvParse: cvParsed.status,
        jdParse: jdParsed.status,
        requiredSkills: matchingSkills.requiredSkills.map((skill) => ({
          code: skill.skillId,
          label: skill.displayName,
          kind: "REQUIRED" as const,
        })),
        preferredSkills: matchingSkills.preferredSkills.map((skill) => ({
          code: skill.skillId,
          label: skill.displayName,
          kind: "PREFERRED" as const,
        })),
        minimumExperienceYears:
          typeof job.minimumExperienceYears === "number"
            ? job.minimumExperienceYears
            : experienceMinimum(job.experienceLevel),
      }).result;
    const evidence = [
      ...automatic.foundRequiredSkills,
      ...automatic.preferredSkills,
    ]
      .flatMap((skill) =>
        skill.evidence.map((item) => ({
          title: skill.label,
          excerpt: item.excerpt,
        })),
      )
      .slice(0, 30);
    try {
      const ai = await aiProvider.assess({
        applicationId: input.applicationId,
        cvVersion: automatic.cvVersion,
        jdVersion: automatic.jdVersion,
        configVersion: automatic.configVersion,
        automaticScore: automatic.score,
        evidence: evidence.length
          ? evidence
          : [
              {
                title: "Candidate profile",
                excerpt: safeCvText.slice(0, 2_000),
              },
            ],
        jobTitle: typeof job.title === "string" ? job.title : "",
        requiredSkills: matchingSkills.requiredSkills.map(
          (skill) => skill.displayName,
        ),
        preferredSkills: matchingSkills.preferredSkills.map(
          (skill) => skill.displayName,
        ),
        keyRequirements: Array.isArray(job.keyRequirements)
          ? job.keyRequirements.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
        minimumExperienceYears: automatic.minimumExperienceYears,
        requiredLanguages: Array.isArray(job.requiredLanguages)
          ? job.requiredLanguages.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
        cvText: safeCvText,
        coverLetterText: row.coverLetter ?? "",
        preflightIssues,
      });
      await publication.publishHybrid({
        applicationId: input.applicationId,
        operationId: input.operationId,
        workItemId: input.workItemId,
        expectedGeneration: input.expectedGeneration,
        workerId: input.workerId,
        automatic,
        ai,
      });
      return "SCORED";
    } catch (error) {
      if (!(error instanceof AiAssessmentProviderError)) throw error;
      console.warn(
        `[application-scoring] AI_ASSESSMENT_FALLBACK ${input.applicationId} ${error.code}${error.diagnostic ? ` ${error.diagnostic}` : ""}`,
      );
      await publication.publishDeterministic({
        applicationId: input.applicationId,
        operationId: input.operationId,
        workItemId: input.workItemId,
        expectedGeneration: input.expectedGeneration,
        workerId: input.workerId,
        automatic,
        consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
        failureCode: error.code,
      });
      return "DETERMINISTIC_ONLY";
    }
  };
}

async function uploadedApplicationCvText(
  document:
    | {
        mediaType: string;
        byteLength: number;
        contentDigestHmac: string;
        sourceArtifactId: string | null;
        scanAssessmentId: string | null;
        sourceArtifact: { uploadId: string } | null;
      }
    | undefined,
  extractor: IsolatedDocumentExtractor,
  applicationId: string,
  candidateUserId: string,
): Promise<string | null> {
  if (!document) return null;
  const kind =
    document.mediaType === "application/pdf"
      ? "PDF"
      : document.mediaType === "application/msword"
        ? "DOC"
        : document.mediaType ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          ? "DOCX"
          : null;
  if (document.byteLength <= 0 || !kind) {
    console.warn(
      `[application-scoring] CV_TEXT_EXTRACTION_FALLBACK ${applicationId} APPLICATION_CV_INELIGIBLE`,
    );
    return null;
  }
  if (
    !document.sourceArtifactId ||
    !document.scanAssessmentId ||
    !document.sourceArtifact
  ) {
    console.warn(
      `[application-scoring] CV_TEXT_EXTRACTION_FALLBACK ${applicationId} APPLICATION_CV_EVIDENCE_MISSING`,
    );
    return null;
  }

  try {
    const opened = await new OpenSafeCvArtifactService().open({
      candidateUserId,
      uploadId: document.sourceArtifact.uploadId,
      artifactId: document.sourceArtifactId,
      assessmentId: document.scanAssessmentId,
      allowedPurposes: [
        "PROFILE_IMPORT",
        "PROFILE_DIRECT",
        "JOB_APPLICATION_DIRECT",
      ],
    });
    try {
      if (
        opened.byteLength !== document.byteLength ||
        document.contentDigestHmac.toLowerCase() !==
          opened.evidence.checksumSha256.toLowerCase()
      ) {
        throw new Error("APPLICATION_CV_LENGTH_MISMATCH");
      }
      const source = await readVerifiedBytes(
        opened.openStream(),
        document.byteLength,
      );
      const extracted = await extractDocumentWithRecovery(
        extractor,
        kind,
        source,
        opened.evidence.scanStatus,
      );
      const text = extracted.segments
        .map((segment) => segment.text)
        .join("\n")
        .trim();
      return text || null;
    } finally {
      await opened.dispose();
    }
  } catch (error) {
    const code =
      error instanceof Error
        ? error.message
        : "APPLICATION_CV_EXTRACTION_FAILED";
    console.warn(
      `[application-scoring] CV_TEXT_EXTRACTION_FALLBACK ${applicationId} ${code}`,
    );
    return null;
  }
}

/**
 * Recover the selected saved CV directly from its encrypted source artifact
 * when an old application-document locator is missing.  This is deliberately
 * scoped by both account and upload id; profileSnapshot is never used as an
 * AI CV substitute because it may contain historical profile entries from
 * other imports. If neither the committed application document nor this
 * scoped artifact is available, the work item fails instead of publishing a
 * misleading zero score.
 */
async function sourceCandidateCvText(input: {
  candidateUserId: string;
  cvSnapshot: Record<string, unknown>;
  extractor: IsolatedDocumentExtractor;
  applicationId: string;
}): Promise<string | null> {
  const cvId =
    typeof input.cvSnapshot.cvId === "string" ? input.cvSnapshot.cvId : "";
  const uploadId = cvId.startsWith("candidate-cv-")
    ? cvId.slice("candidate-cv-".length)
    : null;
  const mediaType =
    typeof input.cvSnapshot.mimeType === "string"
      ? input.cvSnapshot.mimeType
      : "";
  const documentKind =
    mediaType === "application/pdf"
      ? "PDF"
      : mediaType === "application/msword"
        ? "DOC"
        : mediaType ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          ? "DOCX"
          : null;
  const byteLength =
    typeof input.cvSnapshot.byteSize === "number"
      ? input.cvSnapshot.byteSize
      : 0;
  const checksum =
    typeof input.cvSnapshot.checksumSha256 === "string"
      ? input.cvSnapshot.checksumSha256
      : "";
  if (!uploadId) return null;
  if (!documentKind || byteLength < 1 || !/^[a-f0-9]{64}$/iu.test(checksum)) {
    return null;
  }

  try {
    const opened = await new OpenSafeCvArtifactService().open({
      candidateUserId: input.candidateUserId,
      uploadId,
      allowedPurposes: [
        "PROFILE_IMPORT",
        "PROFILE_DIRECT",
        "JOB_APPLICATION_DIRECT",
      ],
    });
    try {
      if (
        opened.byteLength !== byteLength ||
        opened.evidence.checksumSha256.toLowerCase() !== checksum.toLowerCase()
      ) {
        throw new Error("APPLICATION_SOURCE_CV_INTEGRITY_MISMATCH");
      }
      const source = await readVerifiedBytes(opened.openStream(), byteLength);
      const extracted = await extractDocumentWithRecovery(
        input.extractor,
        documentKind!,
        source,
        opened.evidence.scanStatus,
      );
      const text = extracted.segments
        .map((segment) => segment.text)
        .join("\n")
        .trim();
      return text || null;
    } finally {
      await opened.dispose();
    }
  } catch (error) {
    const code =
      error instanceof Error
        ? error.message
        : "APPLICATION_SOURCE_CV_EXTRACTION_FAILED";
    console.warn(
      `[application-scoring] SOURCE_CV_EXTRACTION_FALLBACK ${input.applicationId} ${code}`,
    );
    return null;
  }
}

async function readVerifiedBytes(
  stream: AsyncIterable<Uint8Array>,
  expectedBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.byteLength;
    if (bytes > expectedBytes) throw new Error("CV_LENGTH_MISMATCH");
    chunks.push(Uint8Array.from(chunk));
  }
  if (bytes !== expectedBytes) throw new Error("CV_LENGTH_MISMATCH");
  const source = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    source.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return source;
}

/**
 * The normal parser runs in a short-lived isolated child.  A Windows/Node
 * worker can occasionally fail before the child consumes stdin (for example
 * when the host is under memory pressure).  The same bounded, active-content
 * rejecting PDF/DOC/DOCX implementations are safe as a last-resort fallback for
 * an already scanned application document, so scoring does not silently turn
 * a valid CV into an empty profile snapshot.
 */
async function extractDocumentWithRecovery(
  extractor: IsolatedDocumentExtractor,
  kind: "PDF" | "DOC" | "DOCX",
  source: Uint8Array,
  scanStatus: "CLEAN",
) {
  if (kind === "DOC") return extractLegacyDocText(source);
  try {
    return await extractor.extract({ kind, scanStatus, source });
  } catch (error) {
    const recovered =
      kind === "PDF"
        ? await extractPdf(source, CV_EXTRACTION_LIMITS)
        : await extractDocx(source, CV_EXTRACTION_LIMITS);
    const code = error instanceof Error ? error.message : "EXTRACTION_FAILED";
    console.warn(
      `[application-scoring] isolated extractor failed; used bounded in-process recovery (${code})`,
    );
    return recovered;
  }
}

function experienceMinimum(value: unknown): number | null {
  switch (value) {
    case "ENTRY":
      return 0;
    case "JUNIOR":
      return 1;
    case "MID":
      return 3;
    case "SENIOR":
      return 5;
    case "LEAD":
      return 7;
    case "MANAGER":
      return 5;
    default:
      return null;
  }
}
