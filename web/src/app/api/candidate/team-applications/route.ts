import {
  accountErrorResponse,
  accountJson,
  AccountRequestError,
  parseBoundedJson,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import { TeamApplicationCvError } from "@/backend/services/company-members/team-application-cv-service";
import {
  TeamApplicationCommandError,
  TeamApplicationService,
} from "@/backend/services/company-members/team-application-service";
import {
  CvAdmissionError,
  CvAdmissionService,
} from "@/backend/services/cv-admission/cv-admission-service";
import {
  teamApplicationFinalizeSchema,
  teamApplicationSubmitSchema,
} from "@/shared/contracts/company-members/team-applications";
import {
  CV_MULTIPART_MAX_TOTAL_BYTES,
  CV_SOURCE_MAX_BYTES,
  cvIdempotencyKeySchema,
} from "@/shared/contracts/cv-import/common";
import {
  parseBoundedMultipart,
  MultipartParsingError,
} from "@/backend/cv/multipart/bounded-multipart-parser";

function commandResponse(error: TeamApplicationCommandError) {
  const messages: Record<string, string> = {
    TEAM_COMPANY_UNAVAILABLE: "This company is not available.",
    TEAM_OPPORTUNITY_CLOSED: "This team opportunity is no longer open.",
    TEAM_MEMBER_EXISTS: "You already have access to this company.",
    TEAM_APPLICATION_UNAVAILABLE: "This application is unavailable.",
    TEAM_APPLICATION_CONFLICT: "This application has already changed.",
    TEAM_APPLICATION_DUPLICATE: "You have already applied for this role.",
  };
  return accountJson(
    {
      code: error.code,
      message: messages[error.code] ?? "Unable to submit the application.",
    },
    { status: error.code === "TEAM_APPLICATION_UNAVAILABLE" ? 404 : 409 },
  );
}

function cvResponse(error: TeamApplicationCvError) {
  const messages: Record<string, string> = {
    TEAM_CV_FILE_REQUIRED: "Attach a PDF or DOCX CV.",
    TEAM_CV_FILE_TYPE_INVALID: "Only PDF and DOCX CV files are supported.",
    TEAM_CV_FILE_INVALID: "The CV is invalid or exceeds the 5MB limit.",
    TEAM_CV_UNAVAILABLE: "The CV is unavailable.",
  };
  return accountJson(
    {
      code: error.code,
      message: messages[error.code] ?? "The CV could not be processed.",
    },
    { status: 400 },
  );
}

export async function GET(request: Request) {
  try {
    const account = await requireAccountRequest(request);
    return accountJson(
      await new TeamApplicationService().listCandidate(account.userId),
    );
  } catch (error) {
    return accountErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const account = await requireAccountRequest(request, { mutation: true });
    const contentType =
      request.headers.get("content-type")?.toLowerCase() ?? "";

    // 1. JSON finalize pathway: accepts { companyId, role, uploadId }
    if (contentType.includes("application/json")) {
      const body = await parseBoundedJson(
        request,
        teamApplicationFinalizeSchema,
        16 * 1024,
      );
      const result = await new TeamApplicationService().submitWithUploadId(
        account.userId,
        body.companyId,
        body.role,
        body.uploadId,
      );
      return accountJson(result.application, {
        status: result.created ? 201 : 409,
      });
    }

    // 2. Multipart pathway: verifies boundary limits, admits CV into quarantine, returns 202 Accepted
    if (contentType.startsWith("multipart/form-data")) {
      const parsed = await parseBoundedMultipart(request, {
        maxTotalBytes: CV_MULTIPART_MAX_TOTAL_BYTES,
        maxFileBytes: CV_SOURCE_MAX_BYTES,
        maxFields: 4,
        maxParts: 5,
      });

      const fields = teamApplicationSubmitSchema.safeParse({
        companyId: parsed.fields["companyId"],
        role: parsed.fields["role"],
        uploadId: parsed.fields["uploadId"] || undefined,
      });

      if (!fields.success) {
        throw new AccountRequestError(400, {
          code: "VALIDATION_ERROR",
          message: "Choose a supported team role and company.",
        });
      }

      // If client provided pre-admitted clean uploadId in multipart: finalize directly
      if (fields.data.uploadId) {
        const result = await new TeamApplicationService().submitWithUploadId(
          account.userId,
          fields.data.companyId,
          fields.data.role,
          fields.data.uploadId,
        );
        return accountJson(result.application, {
          status: result.created ? 201 : 409,
        });
      }

      const file = parsed.file;
      if (!file) {
        throw new TeamApplicationCvError("TEAM_CV_FILE_REQUIRED");
      }
      if (file.fieldName !== "cv") {
        throw new TeamApplicationCvError("TEAM_CV_FILE_INVALID");
      }

      if (file.byteSize < 1) {
        throw new TeamApplicationCvError("TEAM_CV_FILE_INVALID");
      }
      const idempotency = cvIdempotencyKeySchema.safeParse(
        request.headers.get("idempotency-key"),
      );
      if (!idempotency.success) {
        throw new AccountRequestError(400, {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "A valid Idempotency-Key is required.",
        });
      }
      const fileBytes = file.bytes;
      const fileLength = fileBytes.byteLength;

      const admissionService = new CvAdmissionService();
      const admission = await admissionService.admit({
        candidateUserId: account.userId,
        purpose: "TEAM_APPLICATION_DIRECT",
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
      message: "Attach a company, role, and CV.",
    });
  } catch (error) {
    if (error instanceof MultipartParsingError) {
      if (
        error.code === "PAYLOAD_TOO_LARGE" ||
        error.code === "FILE_TOO_LARGE"
      ) {
        return accountJson(
          {
            code: "PAYLOAD_TOO_LARGE",
            message: "File size must not exceed 5MB.",
          },
          { status: 413 },
        );
      }
      return accountJson(
        { code: "VALIDATION_ERROR", message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof CvAdmissionError) {
      if (error.code === "PAYLOAD_TOO_LARGE") {
        return accountJson(
          { code: "PAYLOAD_TOO_LARGE", message: error.message },
          { status: 413 },
        );
      }
      if (error.code === "UNSUPPORTED_MEDIA_TYPE") {
        return accountJson(
          { code: "UNSUPPORTED_MEDIA_TYPE", message: error.message },
          { status: 415 },
        );
      }
      if (error.code === "UPLOAD_RATE_LIMITED") {
        return accountJson(
          { code: error.code, message: error.userMessage ?? error.message },
          { status: 429 },
        );
      }
      if (error.code === "CV_QUOTA_EXCEEDED") {
        return accountJson(
          { code: error.code, message: error.userMessage ?? error.message },
          { status: 409 },
        );
      }
      return accountJson(
        { code: error.code, message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof TeamApplicationCommandError) {
      return commandResponse(error);
    }
    if (error instanceof TeamApplicationCvError) {
      return cvResponse(error);
    }
    return accountErrorResponse(error);
  }
}
