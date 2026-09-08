import "server-only";

import {
  CV_EXTRACTION_LIMITS,
  DocumentExtractionError,
  IsolatedDocumentExtractor,
} from "./extraction/document-extractor";
import { extractDocx } from "./extraction/docx";
import { extractLegacyDocText } from "./extraction/legacy-doc";
import { extractPdf } from "./extraction/pdf";
import {
  validateExtractedCvText,
  type CvContentValidationCode,
} from "@/backend/scoring/domain/cv-content-validation";
import {
  ApprovedCvClassificationAdapter,
  decideCvClassification,
  type CvClassificationFailureCode,
  type CvClassificationPort,
} from "@/backend/scoring/providers/cv-classification-adapter";
import { logCvClassificationOutcome } from "@/backend/cv/upload-observability";
import type { CvFileKind } from "@/shared/cv-file-validation";

export type CvUploadContentFailureCode =
  | CvContentValidationCode
  | "CV_NOT_RECOGNIZED_AS_CV"
  | CvClassificationFailureCode;

export class CvUploadContentValidationError extends Error {
  readonly name = "CvUploadContentValidationError";

  constructor(readonly code: CvUploadContentFailureCode) {
    super(code);
  }
}

export function cvUploadContentValidationMessage(
  code: CvUploadContentFailureCode,
): string {
  switch (code) {
    case "CV_TEXT_UNAVAILABLE":
    case "CV_TEXT_TOO_SHORT":
    case "CV_TEXT_INVALID":
      return "We couldn't read any content from this file. Please make sure it's a text-based CV, not a scanned image.";
    case "CV_NOT_RECOGNIZED_AS_CV":
      return "The uploaded file does not appear to be a valid CV. Please upload a file containing your resume information (work experience, education, skills, etc.).";
    case "CV_CLASSIFICATION_TIMEOUT":
      return "CV verification took too long. Please upload the file again.";
    case "CV_CLASSIFICATION_UNAVAILABLE":
    case "CV_CLASSIFICATION_MALFORMED":
    case "CV_CLASSIFICATION_NOT_CONFIGURED":
      return "We couldn't verify this CV right now. Please try uploading it again.";
  }
}

async function extractContent(
  kind: CvFileKind,
  source: Uint8Array,
  scanStatus:
    | "QUEUED"
    | "PROCESSING"
    | "CLEAN"
    | "INFECTED"
    | "INDETERMINATE" = "QUEUED",
) {
  // This helper may perform document parsing and classification, so it is a
  // post-scan operation. DOC has an in-process parser and the PDF/DOCX
  // recovery path below can bypass the isolated extractor; guard both paths
  // before selecting the document kind.
  if (scanStatus !== "CLEAN") {
    throw new DocumentExtractionError("CV_EXTRACTION_REQUIRES_CLEAN_SCAN");
  }
  if (kind === "DOC") return extractLegacyDocText(source);

  const extractor = new IsolatedDocumentExtractor();
  try {
    return await extractor.extract({
      kind,
      scanStatus,
      source,
    });
  } catch (error) {
    if (
      error instanceof DocumentExtractionError &&
      error.code === "CV_EXTRACTION_REQUIRES_CLEAN_SCAN"
    ) {
      throw error;
    }
    // The fallback remains bounded and applies the same active-content and
    // archive limits. It protects a post-CLEAN upload from a child-process
    // startup failure without turning extraction into an unbounded operation.
    const recovered =
      kind === "PDF"
        ? await extractPdf(source, CV_EXTRACTION_LIMITS)
        : await extractDocx(source, CV_EXTRACTION_LIMITS);
    void error;
    return recovered;
  }
}

export async function validateCvUploadContent(input: {
  bytes: Uint8Array;
  kind: CvFileKind;
  classifier?: CvClassificationPort;
  scanStatus?: "QUEUED" | "PROCESSING" | "CLEAN" | "INFECTED" | "INDETERMINATE";
}) {
  let extracted;
  try {
    extracted = await extractContent(
      input.kind,
      input.bytes,
      input.scanStatus ?? "QUEUED",
    );
  } catch {
    throw new CvUploadContentValidationError("CV_TEXT_UNAVAILABLE");
  }

  const rawText = extracted.segments.map((segment) => segment.text).join("\n");
  let validated;
  try {
    validated = validateExtractedCvText(rawText);
  } catch (error) {
    const code =
      error instanceof Error &&
      (error.message === "CV_TEXT_UNAVAILABLE" ||
        error.message === "CV_TEXT_TOO_SHORT" ||
        error.message === "CV_TEXT_INVALID")
        ? (error.message as CvContentValidationCode)
        : "CV_TEXT_UNAVAILABLE";
    throw new CvUploadContentValidationError(code);
  }

  let classification;
  try {
    classification = await (
      input.classifier ?? new ApprovedCvClassificationAdapter()
    ).classify({ cvText: validated.text });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("CV_CLASSIFICATION_")
    )
      throw new CvUploadContentValidationError(
        error.message as CvClassificationFailureCode,
      );
    throw new CvUploadContentValidationError("CV_CLASSIFICATION_UNAVAILABLE");
  }

  const decision = decideCvClassification({
    cvText: validated.text,
    classification,
  });
  logCvClassificationOutcome({
    isCv: classification.isCv,
    confidence: classification.confidence,
    accepted: decision.accepted,
    source: classification.source,
    decisionBasis: decision.basis,
    structuralConfidence: decision.structuralClassification.confidence,
  });
  if (
    !decision.accepted &&
    classification.source === "DETERMINISTIC_FALLBACK" &&
    classification.providerFailureCode
  )
    throw new CvUploadContentValidationError(
      classification.providerFailureCode,
    );
  if (!decision.accepted)
    throw new CvUploadContentValidationError("CV_NOT_RECOGNIZED_AS_CV");

  return Object.freeze({
    text: validated.text,
    classification,
    decision,
  });
}
