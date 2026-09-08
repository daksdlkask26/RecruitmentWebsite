import { z } from "zod";
import {
  AccountRequestError,
  accountErrorResponse,
  accountJson,
  parseBoundedJson,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import {
  MultipartParsingError,
  parseBoundedMultipart,
} from "@/backend/cv/multipart/bounded-multipart-parser";
import {
  CV_MULTIPART_MAX_TOTAL_BYTES,
  CV_SOURCE_MAX_BYTES,
} from "@/shared/contracts/cv-import/common";
import { candidateCvSummarySchema } from "@/shared/contracts/cv-import/candidate-cv";
import { cvIdempotencyKeySchema } from "@/shared/contracts/cv-import/common";
import {
  CvAdmissionError,
  CvAdmissionService,
} from "@/backend/services/cv-admission/cv-admission-service";
import {
  CandidateCvFinalizationError,
  finalizeCandidateCvFromUpload,
} from "@/backend/services/cv-admission/finalize-candidate-cv";

const candidateCvFinalizeSchema = z.object({
  uploadId: z.string().min(1),
});

async function finalizeCandidateCv(candidateUserId: string, uploadId: string) {
  const candidateCv = await finalizeCandidateCvFromUpload({
    candidateUserId,
    uploadId,
    expectedPurpose: "PROFILE_DIRECT",
  });
  return {
    candidateCv: candidateCvSummarySchema.parse({
      id: candidateCv.id,
      displayName: candidateCv.displayName,
      fileName: candidateCv.fileName,
      mimeType: candidateCv.mimeType,
      byteSize: candidateCv.byteSize,
      version: candidateCv.version,
      confirmedAt: candidateCv.confirmedAt?.toISOString(),
    }),
    status: 201,
  };
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  // Preflight size check: reject oversized requests before body consumption
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader && /^\d+$/u.test(contentLengthHeader)) {
    const declaredLength = Number(contentLengthHeader);
    const maxRequestBytes = contentType.startsWith("multipart/form-data")
      ? CV_MULTIPART_MAX_TOTAL_BYTES
      : CV_SOURCE_MAX_BYTES;
    if (declaredLength > maxRequestBytes) {
      return accountErrorResponse(
        new AccountRequestError(413, {
          code: "REQUEST_TOO_LARGE",
          message: "The request is too large.",
        }),
      );
    }
  }

  try {
    const current = await requireAccountRequest(request, { mutation: true });

    // 1. JSON finalize pathway
    if (contentType.includes("application/json")) {
      const body = await parseBoundedJson(
        request,
        candidateCvFinalizeSchema,
        16 * 1024,
      );
      const result = await finalizeCandidateCv(current.userId, body.uploadId);
      return accountJson(result.candidateCv, { status: result.status });
    }

    // 2. Multipart pathway
    if (contentType.startsWith("multipart/form-data")) {
      const parsed = await parseBoundedMultipart(request, {
        maxTotalBytes: CV_MULTIPART_MAX_TOTAL_BYTES,
        maxFileBytes: CV_SOURCE_MAX_BYTES,
        maxFields: 4,
        maxParts: 5,
      });

      // If uploadId provided in multipart, finalize directly
      if (parsed.fields["uploadId"]) {
        const result = await finalizeCandidateCv(
          current.userId,
          parsed.fields["uploadId"],
        );
        return accountJson(result.candidateCv, { status: result.status });
      }

      const file = parsed.file;
      if (!file) {
        throw new AccountRequestError(400, {
          code: "VALIDATION_ERROR",
          message: "Attach a CV file.",
        });
      }
      if (file.fieldName !== "file") {
        throw new AccountRequestError(400, {
          code: "VALIDATION_ERROR",
          message: "Attach the CV using the file field.",
        });
      }

      if (file.byteSize < 1) {
        throw new AccountRequestError(400, {
          code: "VALIDATION_ERROR",
          message: "The CV file is empty.",
        });
      }
      const idempotency = cvIdempotencyKeySchema.safeParse(
        request.headers.get("idempotency-key"),
      );
      if (!idempotency.success) {
        throw new AccountRequestError(400, {
          code: "VALIDATION_ERROR",
          message: "A valid Idempotency-Key is required.",
        });
      }
      const fileBytes = file.bytes;
      const fileLength = fileBytes.byteLength;

      const admissionService = new CvAdmissionService();
      const admission = await admissionService.admit({
        candidateUserId: current.userId,
        purpose: "PROFILE_DIRECT",
        processingMode: "SCAN_ONLY",
        fileName: file.fileName === "blob" ? "resume.pdf" : file.fileName,
        contentType: file.contentType,
        contentLength: fileLength,
        body: (async function* () {
          yield fileBytes;
        })(),
        idempotencyKey: idempotency.data,
      });

      return accountJson(
        {
          uploadId: admission.uploadId,
          status: admission.status,
          retryAfterSeconds: admission.retryAfterSeconds,
        },
        { status: 202 },
      );
    }

    throw new AccountRequestError(400, {
      code: "INVALID_REQUEST",
      message: "Attach a CV file.",
    });
  } catch (error) {
    if (error instanceof CvAdmissionError) {
      const status =
        error.code === "PAYLOAD_TOO_LARGE"
          ? 413
          : error.code === "UPLOAD_RATE_LIMITED"
            ? 429
            : error.code === "CV_QUOTA_EXCEEDED" ||
                error.code === "IDEMPOTENCY_KEY_REUSED"
              ? 409
              : error.code === "UNSUPPORTED_MEDIA_TYPE"
                ? 415
                : 400;
      return accountErrorResponse(
        new AccountRequestError(status, {
          code: error.code,
          message: error.userMessage ?? "The CV could not be accepted.",
        }),
      );
    }
    if (error instanceof CandidateCvFinalizationError) {
      const status =
        error.code === "CV_NOT_FOUND"
          ? 404
          : error.code === "CV_PURPOSE_MISMATCH"
            ? 400
            : 409;
      return accountErrorResponse(
        new AccountRequestError(status, {
          code:
            error.code === "CV_NOT_FOUND"
              ? "NOT_FOUND"
              : error.code === "CV_PURPOSE_MISMATCH"
                ? "VALIDATION_ERROR"
                : "CV_NOT_READY",
          message:
            error.code === "CV_NOT_READY"
              ? "The CV scan is still in progress."
              : error.message,
        }),
      );
    }
    if (error instanceof MultipartParsingError) {
      if (
        error.code === "PAYLOAD_TOO_LARGE" ||
        error.code === "FILE_TOO_LARGE"
      ) {
        return accountErrorResponse(
          new AccountRequestError(413, {
            code: "REQUEST_TOO_LARGE",
            message: "The request is too large.",
          }),
        );
      }
      return accountErrorResponse(
        new AccountRequestError(400, {
          code: "INVALID_REQUEST",
          message: error.message,
        }),
      );
    }
    return accountErrorResponse(error);
  }
}
