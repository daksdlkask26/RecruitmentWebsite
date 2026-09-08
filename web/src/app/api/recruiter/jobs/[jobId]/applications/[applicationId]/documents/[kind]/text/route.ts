import { NextResponse } from "next/server";
import { requireSession } from "@/backend/auth/session/require-session";
import {
  DocumentExtractionError,
  IsolatedDocumentExtractor,
} from "@/backend/cv/extraction/document-extractor";
import {
  OpenApplicationDocumentError,
  OpenApplicationDocumentService,
} from "@/backend/applications/services/open-application-document";
import {
  buildStructuredDocumentContent,
  DOCUMENT_PDF_PREVIEW_VERSION,
  DOCUMENT_PREVIEW_PARSER_VERSION,
} from "@/backend/applications/services/document-preview-parser";
import {
  getCachedDocumentPreview,
  setCachedDocumentPreview,
} from "@/backend/applications/services/document-preview-cache";
import { structuredDocumentPreviewSchema } from "@/shared/contracts/applications/document-preview";

const noStore = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

type DocumentKind = "cv" | "cover-letter";

function isDocumentKind(value: unknown): value is DocumentKind {
  return value === "cv" || value === "cover-letter";
}

function textSegments(text: string) {
  return text
    .split(/\r?\n+/u)
    .map((value, index) => ({
      id: `text-line-${index + 1}`,
      kind: "paragraph" as const,
      text: value.replace(/\s+/gu, " ").trim(),
    }))
    .filter((segment) => segment.text.length > 0);
}

function extractionKind(mediaType: string | null) {
  if (mediaType === "application/pdf") return "PDF" as const;
  if (mediaType === "application/msword") return "DOC" as const;
  if (
    mediaType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "DOCX" as const;
  return null;
}

function cacheVersion(request: Request) {
  const value = new URL(request.url).searchParams.get("cacheVersion");
  return value && value.length <= 120 ? value : "latest";
}

function cacheKey(input: {
  applicationId: string;
  kind: DocumentKind;
  contentVersion: string | null | undefined;
  scoringVersion: string;
  previewVersion: string;
}) {
  return [
    input.applicationId,
    input.kind,
    input.contentVersion ?? "unknown-content",
    input.scoringVersion,
    input.previewVersion,
  ].join(":");
}

function profileFallbackPreview(input: {
  kind: DocumentKind;
  fileName: string | null;
  mediaType: string | null;
  applicationProfileSnapshot?: unknown;
  startedAt: number;
}) {
  if (input.kind !== "cv") return null;
  const content = buildStructuredDocumentContent({
    kind: "cv",
    segments: [],
    applicationProfileSnapshot: input.applicationProfileSnapshot,
    preferProfileSnapshot: true,
  });
  if (
    content.kind !== "cv" ||
    (!content.name &&
      !content.title &&
      !content.summary &&
      !content.experience.length &&
      !content.education.length &&
      !content.skills.length)
  ) {
    return null;
  }
  return structuredDocumentPreviewSchema.parse({
    kind: "cv",
    previewStatus: "LIMITED",
    fileName: input.fileName,
    mediaType: input.mediaType,
    pageCount: null,
    parserVersion: DOCUMENT_PREVIEW_PARSER_VERSION,
    processingMilliseconds: Math.max(0, Date.now() - input.startedAt),
    cacheHit: false,
    content,
  });
}

/**
 * Parsing is an enhancement, not a prerequisite for opening an application
 * document. Keep the document usable and direct the recruiter to its original
 * file when a PDF/DOC/DOCX extractor cannot produce readable text.
 */
function limitedPreview(input: {
  kind: DocumentKind;
  fileName: string | null;
  mediaType: string | null;
  applicationProfileSnapshot?: unknown;
  startedAt: number;
}) {
  const profileFallback = profileFallbackPreview(input);
  if (profileFallback) return profileFallback;
  return structuredDocumentPreviewSchema.parse({
    kind: input.kind,
    previewStatus: "LIMITED",
    fileName: input.fileName,
    mediaType: input.mediaType,
    pageCount: null,
    parserVersion: DOCUMENT_PREVIEW_PARSER_VERSION,
    processingMilliseconds: Math.max(0, Date.now() - input.startedAt),
    cacheHit: false,
    content: buildStructuredDocumentContent({ kind: input.kind, segments: [] }),
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<unknown> },
) {
  const current = await requireSession(request.headers);
  if (!current) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "Authentication required." },
      { status: 401, headers: noStore },
    );
  }

  const rawParams = await context.params;
  const params =
    rawParams && typeof rawParams === "object"
      ? (rawParams as Record<string, unknown>)
      : {};
  const jobId = typeof params.jobId === "string" ? params.jobId : "";
  const applicationId =
    typeof params.applicationId === "string" ? params.applicationId : "";
  const kind = isDocumentKind(params.kind) ? params.kind : null;
  if (!kind) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", message: "The document kind is invalid." },
      { status: 400, headers: noStore },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await new OpenApplicationDocumentService().execute({
      userId: current.userId,
      sessionId: current.sessionId,
      jobId,
      applicationId,
      kind,
      preview: false,
      streamPolicy: "SKIP_PDF",
    });
    const previewVersion =
      result.document.mediaType === "application/pdf"
        ? DOCUMENT_PDF_PREVIEW_VERSION
        : DOCUMENT_PREVIEW_PARSER_VERSION;
    const key = cacheKey({
      applicationId,
      kind,
      contentVersion: result.document.contentVersion,
      scoringVersion: cacheVersion(request),
      previewVersion,
    });
    const cached = getCachedDocumentPreview(key);
    if (cached) {
      return NextResponse.json(
        structuredDocumentPreviewSchema.parse({
          ...cached,
          fileName: result.document.fileName ?? cached.fileName,
        }),
        { headers: noStore },
      );
    }

    if (result.document.mediaType === "application/pdf") {
      const preview = structuredDocumentPreviewSchema.parse({
        kind,
        previewStatus: "ORIGINAL",
        fileName: result.document.fileName,
        mediaType: result.document.mediaType,
        pageCount: null,
        parserVersion: DOCUMENT_PDF_PREVIEW_VERSION,
        processingMilliseconds: Math.max(0, Date.now() - startedAt),
        cacheHit: false,
        content: buildStructuredDocumentContent({ kind, segments: [] }),
      });
      setCachedDocumentPreview(key, preview);
      return NextResponse.json(preview, { headers: noStore });
    }

    let segments;
    let pageCount: number | null = null;
    try {
      if (result.document.text !== null) {
        segments = textSegments(result.document.text);
        pageCount = 1;
      } else {
        const parserKind = extractionKind(result.document.mediaType);
        if (!parserKind || !result.stream) {
          const preview = limitedPreview({
            kind,
            fileName: result.document.fileName,
            mediaType: result.document.mediaType,
            applicationProfileSnapshot:
              result.document.applicationProfileSnapshot,
            startedAt,
          });
          setCachedDocumentPreview(key, preview);
          return NextResponse.json(preview, { headers: noStore });
        }
        const extracted = await new IsolatedDocumentExtractor().extract({
          kind: parserKind,
          // OpenApplicationDocumentService has already enforced the persisted
          // CLEAN evidence for CVs. Cover letters use the legacy document
          // path and are not part of the CV admission boundary.
          scanStatus:
            kind === "cv"
              ? result.document.scanStatus === "CLEAN"
                ? "CLEAN"
                : "QUEUED"
              : "CLEAN",
          source: result.stream,
        });
        segments = extracted.segments;
        pageCount = extracted.pageCount;
      }
    } catch {
      const preview = limitedPreview({
        kind,
        fileName: result.document.fileName,
        mediaType: result.document.mediaType,
        applicationProfileSnapshot: result.document.applicationProfileSnapshot,
        startedAt,
      });
      setCachedDocumentPreview(key, preview);
      return NextResponse.json(preview, { headers: noStore });
    }

    if (!segments.length) {
      const preview = limitedPreview({
        kind,
        fileName: result.document.fileName,
        mediaType: result.document.mediaType,
        applicationProfileSnapshot: result.document.applicationProfileSnapshot,
        startedAt,
      });
      setCachedDocumentPreview(key, preview);
      return NextResponse.json(preview, { headers: noStore });
    }

    const content = buildStructuredDocumentContent({
      kind,
      segments,
      applicationProfileSnapshot: result.document.applicationProfileSnapshot,
      preferProfileSnapshot:
        kind === "cv" &&
        result.document.applicationProfileSnapshot !== null &&
        result.document.applicationProfileSnapshot !== undefined,
    });
    const preview = structuredDocumentPreviewSchema.parse({
      kind,
      previewStatus: "PARSED",
      fileName: result.document.fileName,
      mediaType: result.document.mediaType,
      pageCount,
      parserVersion: DOCUMENT_PREVIEW_PARSER_VERSION,
      processingMilliseconds: Math.max(0, Date.now() - startedAt),
      cacheHit: false,
      content,
    });
    setCachedDocumentPreview(key, preview);
    return NextResponse.json(preview, { headers: noStore });
  } catch (error) {
    if (error instanceof OpenApplicationDocumentError) {
      const notFound = error.code === "UNAVAILABLE";
      return NextResponse.json(
        {
          code: notFound ? "DOCUMENT_NOT_FOUND" : "PREVIEW_UNAVAILABLE",
          message: notFound
            ? "The document is not available."
            : "Parsed preview is unavailable for this document.",
        },
        { status: notFound ? 404 : 409, headers: noStore },
      );
    }
    if (error instanceof DocumentExtractionError) {
      return NextResponse.json(
        {
          code: "DOCUMENT_PARSE_FAILED",
          message: "Couldn't load document — try downloading the original.",
        },
        { status: 422, headers: noStore },
      );
    }
    return NextResponse.json(
      {
        code: "DOCUMENT_PREVIEW_UNAVAILABLE",
        message: "Couldn't load document — try downloading the original.",
      },
      { status: 500, headers: noStore },
    );
  }
}
