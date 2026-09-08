import {
  accountErrorResponse,
  accountJson,
  AccountRequestError,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import {
  CvAdmissionError,
  CvAdmissionService,
  type CvAdmissionPurpose,
} from "@/backend/services/cv-admission/cv-admission-service";
import {
  CV_SOURCE_MAX_BYTES,
  cvIdempotencyKeySchema,
} from "@/shared/contracts/cv-import/common";

const validPurposes = new Set<CvAdmissionPurpose>([
  "PROFILE_DIRECT",
  "JOB_APPLICATION_DIRECT",
  "TEAM_APPLICATION_DIRECT",
]);

export async function POST(request: Request) {
  try {
    const account = await requireAccountRequest(request, { mutation: true });

    // 1. Boundary check: Content-Length must be present and <= 5MB before any body reading
    const contentLengthHeader = request.headers.get("content-length");
    if (!contentLengthHeader || !/^\d+$/u.test(contentLengthHeader)) {
      throw new AccountRequestError(400, {
        code: "VALIDATION_ERROR",
        message: "Content-Length header is required.",
      });
    }

    const contentLength = Number(contentLengthHeader);
    if (contentLength < 1 || contentLength > CV_SOURCE_MAX_BYTES) {
      throw new AccountRequestError(413, {
        code: "PAYLOAD_TOO_LARGE",
        message: "File size must not exceed 5MB.",
      });
    }

    // 2. Boundary check: Idempotency-Key
    const idempotencyKey = cvIdempotencyKeySchema.safeParse(
      request.headers.get("idempotency-key"),
    );
    if (!idempotencyKey.success) {
      throw new AccountRequestError(400, {
        code: "VALIDATION_ERROR",
        message: "A valid Idempotency-Key header is required.",
      });
    }

    // 3. Boundary check: Purpose
    const rawPurpose = request.headers.get("x-cv-purpose");
    if (!rawPurpose || !validPurposes.has(rawPurpose as CvAdmissionPurpose)) {
      throw new AccountRequestError(400, {
        code: "VALIDATION_ERROR",
        message:
          "X-CV-Purpose must be PROFILE_DIRECT, JOB_APPLICATION_DIRECT, or TEAM_APPLICATION_DIRECT.",
      });
    }
    const purpose = rawPurpose as CvAdmissionPurpose;

    // 4. Filename & Content-Type
    const rawFilename = request.headers.get("x-cv-filename");
    let fileName = "uploaded-cv.pdf";
    if (rawFilename) {
      try {
        fileName = decodeURIComponent(rawFilename);
      } catch {
        throw new AccountRequestError(400, {
          code: "VALIDATION_ERROR",
          message: "X-CV-Filename is invalid.",
        });
      }
    }
    const contentType =
      request.headers.get("content-type") || "application/octet-stream";

    if (!request.body) {
      throw new AccountRequestError(400, {
        code: "VALIDATION_ERROR",
        message: "Request body is required.",
      });
    }

    const service = new CvAdmissionService();
    try {
      const result = await service.admit({
        candidateUserId: account.userId,
        purpose,
        fileName,
        contentType,
        contentLength,
        body: (async function* () {
          const reader = request.body!.getReader();
          try {
            while (true) {
              const next = await reader.read();
              if (next.done) return;
              if (next.value) yield next.value;
            }
          } finally {
            reader.releaseLock();
          }
        })(),
        idempotencyKey: idempotencyKey.data,
        processingMode:
          purpose === "PROFILE_IMPORT" ? "IMPORT_AND_PARSE" : "SCAN_ONLY",
      });

      return accountJson(
        {
          uploadId: result.uploadId,
          status: result.status,
          retryAfterSeconds: result.retryAfterSeconds,
        },
        { status: 202 },
      );
    } catch (error) {
      if (error instanceof CvAdmissionError) {
        if (error.code === "PAYLOAD_TOO_LARGE") {
          throw new AccountRequestError(413, {
            code: "PAYLOAD_TOO_LARGE",
            message: error.userMessage ?? "File size must not exceed 5MB.",
          });
        }
        if (error.code === "IDEMPOTENCY_KEY_REUSED") {
          throw new AccountRequestError(409, {
            code: "IDEMPOTENCY_KEY_REUSED",
            message:
              error.userMessage ??
              "Idempotency key was reused with different payload.",
          });
        }
        if (error.code === "UPLOAD_RATE_LIMITED") {
          throw new AccountRequestError(429, {
            code: "UPLOAD_RATE_LIMITED",
            message:
              error.userMessage ?? "Too many CV uploads. Try again later.",
          });
        }
        if (error.code === "CV_QUOTA_EXCEEDED") {
          throw new AccountRequestError(409, {
            code: "CV_QUOTA_EXCEEDED",
            message:
              error.userMessage ?? "The CV storage limit has been reached.",
          });
        }
        if (error.code === "UNSUPPORTED_MEDIA_TYPE") {
          throw new AccountRequestError(415, {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: error.userMessage ?? "Unsupported media type.",
          });
        }
        if (
          error.code === "CONTENT_LENGTH_MISMATCH" ||
          error.code === "DOCUMENT_REJECTED"
        ) {
          throw new AccountRequestError(400, {
            code: "DOCUMENT_REJECTED",
            message: error.userMessage ?? "The document could not be accepted.",
          });
        }
      }
      throw error;
    }
  } catch (error) {
    return accountErrorResponse(error);
  }
}
