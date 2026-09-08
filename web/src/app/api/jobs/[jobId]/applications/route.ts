import { JobApplicationService } from "@/backend/services/jobs/job-application-service";
import { applicationSubmissionSchema } from "@/shared/contracts/jobs/actions";
import {
  jobErrorResponse,
  jobJson,
  parseBoundedJson,
  requireJobActor,
} from "@/backend/security/job-request-boundary";
import { JobServiceError } from "@/backend/services/jobs/job-types";
import {
  CvAdmissionError,
  CvAdmissionService,
} from "@/backend/services/cv-admission/cv-admission-service";
import {
  CV_MULTIPART_MAX_TOTAL_BYTES,
  CV_SOURCE_MAX_BYTES,
  cvIdempotencyKeySchema,
} from "@/shared/contracts/cv-import/common";

import {
  MultipartParsingError,
  parseBoundedMultipart,
} from "@/backend/cv/multipart/bounded-multipart-parser";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  // Reject oversized requests before body consumption.
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader && /^\d+$/u.test(contentLengthHeader)) {
    const declaredLength = Number(contentLengthHeader);
    if (declaredLength > CV_MULTIPART_MAX_TOTAL_BYTES) {
      return jobErrorResponse(
        new JobServiceError(413, {
          code: "REQUEST_TOO_LARGE",
          message: "The request is too large.",
        }),
      );
    }
  }

  try {
    const actor = await requireJobActor(request);
    const contentType =
      request.headers.get("content-type")?.toLowerCase() ?? "";
    let command: unknown;
    if (contentType.startsWith("multipart/form-data")) {
      const parsed = await parseBoundedMultipart(request, {
        maxTotalBytes: CV_MULTIPART_MAX_TOTAL_BYTES,
        maxFileBytes: CV_SOURCE_MAX_BYTES,
        maxFieldBytes: 64 * 1024,
        maxFields: 2,
        maxParts: 3,
      });
      const application = parsed.fields["application"];
      if (typeof application !== "string") {
        throw new JobServiceError(400, {
          code: "APPLICATION_CV_INELIGIBLE",
          message: "The application payload is missing.",
        });
      }
      try {
        command = JSON.parse(application);
      } catch {
        throw new JobServiceError(400, {
          code: "APPLICATION_CV_INELIGIBLE",
          message: "The application payload is invalid.",
        });
      }
      const cvFile = parsed.file;
      if (!cvFile) {
        throw new JobServiceError(400, {
          code: "APPLICATION_CV_INELIGIBLE",
          message: "Attach a CV file before applying.",
        });
      }
      if (cvFile.fieldName !== "cvFile") {
        throw new JobServiceError(400, {
          code: "APPLICATION_CV_INELIGIBLE",
          message: "Attach the CV using the cvFile field.",
        });
      }
      const idempotencyKey = cvIdempotencyKeySchema.safeParse(
        request.headers.get("idempotency-key"),
      );
      if (!idempotencyKey.success) {
        throw new JobServiceError(400, {
          code: "APPLICATION_CV_INELIGIBLE",
          message: "A valid Idempotency-Key is required.",
        });
      }
      const admission = await new CvAdmissionService().admit({
        candidateUserId: actor.userId,
        purpose: "JOB_APPLICATION_DIRECT",
        processingMode: "SCAN_ONLY",
        fileName: cvFile.fileName === "blob" ? "resume.pdf" : cvFile.fileName,
        contentType: cvFile.contentType,
        contentLength: cvFile.byteSize,
        body: (async function* () {
          yield cvFile.bytes;
        })(),
        idempotencyKey: idempotencyKey.data,
      });
      return jobJson(
        {
          uploadId: admission.uploadId,
          status: admission.status,
          retryAfterSeconds: admission.retryAfterSeconds,
        },
        { status: 202 },
      );
    } else {
      command = await parseBoundedJson(
        request,
        applicationSubmissionSchema,
        64 * 1024,
      );
    }
    const result = await new JobApplicationService().submit(
      actor,
      (await context.params).jobId,
      request.headers.get("idempotency-key") ?? "",
      command,
      new Date(),
      undefined,
    );
    return jobJson(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof CvAdmissionError) {
      const status =
        error.code === "PAYLOAD_TOO_LARGE"
          ? 413
          : error.code === "UPLOAD_RATE_LIMITED"
            ? 429
            : error.code === "UNSUPPORTED_MEDIA_TYPE"
              ? 415
              : error.code === "IDEMPOTENCY_KEY_REUSED" ||
                  error.code === "CV_QUOTA_EXCEEDED"
                ? 409
                : 400;
      return jobErrorResponse(
        new JobServiceError(status, {
          code: "APPLICATION_CV_INELIGIBLE",
          message: error.userMessage ?? "The CV could not be accepted.",
        }),
      );
    }
    if (error instanceof MultipartParsingError) {
      if (
        error.code === "PAYLOAD_TOO_LARGE" ||
        error.code === "FILE_TOO_LARGE"
      ) {
        return jobErrorResponse(
          new JobServiceError(413, {
            code: "REQUEST_TOO_LARGE",
            message: "The request is too large.",
          }),
        );
      }
      return jobErrorResponse(
        new JobServiceError(400, {
          code: "APPLICATION_CV_INELIGIBLE",
          message: error.message,
        }),
      );
    }
    return jobErrorResponse(error);
  }
}
