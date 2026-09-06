import {
  AccountRequestError,
  accountErrorResponse,
  accountJson,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import {
  isCvFileValidationError,
  validatedCvUploadSource,
} from "@/backend/cv/validated-file-upload";
import { logCvUploadRejection } from "@/backend/cv/upload-observability";
import {
  cvUploadContentValidationMessage,
  CvUploadContentValidationError,
  validateCvUploadContent,
} from "@/backend/cv/preflight-cv-upload";
import { prepareDirectApplicationCv } from "@/backend/services/jobs/prepare-direct-application-cv";
import { saveDirectCandidateCv } from "@/backend/services/profile/save-direct-candidate-cv";

async function sourceFrom(formData: FormData) {
  const entry = formData.get("file");
  if (!(entry instanceof File)) {
    logCvUploadRejection({ reason: "FILE_REQUIRED" });
    throw new AccountRequestError(400, {
      code: "VALIDATION_ERROR",
      message: "Attach a CV file.",
    });
  }
  try {
    const validated = await validatedCvUploadSource(entry);
    try {
      await validateCvUploadContent({
        bytes: validated.bytes,
        kind: validated.kind,
      });
    } catch (error) {
      if (error instanceof CvUploadContentValidationError) {
        logCvUploadRejection({
          reason: error.code,
          byteSize: entry.size,
          declaredMimeType: entry.type,
        });
        throw new AccountRequestError(400, {
          code: "VALIDATION_ERROR",
          message: cvUploadContentValidationMessage(error.code),
        });
      }
      throw error;
    }
    return {
      fileName: validated.fileName,
      mimeType: validated.mimeType,
      byteSize: validated.byteSize,
      source: validated.source,
    };
  } catch (error) {
    if (isCvFileValidationError(error)) {
      logCvUploadRejection({
        reason: error.code,
        byteSize: entry.size,
        declaredMimeType: entry.type,
      });
      throw new AccountRequestError(400, {
        code: "VALIDATION_ERROR",
        message: error.message,
      });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const current = await requireAccountRequest(request, { mutation: true });
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("multipart/form-data")
    ) {
      throw new AccountRequestError(400, {
        code: "INVALID_REQUEST",
        message: "Attach a CV file.",
      });
    }
    const prepared = await prepareDirectApplicationCv(
      await sourceFrom(await request.formData()),
      { deferStorage: true },
    );
    const saved = await saveDirectCandidateCv(
      current.userId,
      prepared,
      new Date(),
    );
    return accountJson(saved, { status: 201 });
  } catch (error) {
    return accountErrorResponse(error);
  }
}
