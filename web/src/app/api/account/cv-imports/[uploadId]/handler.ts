import {
  assertCvEmptyRequestBody,
  CvAccountRequestBoundary,
  cvJsonResponse,
} from "@/backend/security/cv-account-request-boundary";
import {
  cvHttpErrorResponse,
  CvImportServiceError,
} from "@/backend/services/cv-import/cv-http-errors";
import { getCvImportResource } from "@/backend/services/cv-import/cv-import-projection";
import { CvRetentionService } from "@/backend/services/cv-import/cv-retention-service";
import { cvUploadIdSchema } from "@/shared/contracts/cv-import/common";
import { cvDeletionOutcomeSchema } from "@/shared/contracts/cv-import/consent-retention";
import { cvStatusPollingAfterMs } from "@/shared/contracts/cv-import/upload";

type ImportBoundary = Pick<CvAccountRequestBoundary, "authorize">;
type RetentionService = Readonly<{
  deleteOwnedImport(
    input: Parameters<CvRetentionService["deleteOwnedImport"]>[0],
  ): Promise<unknown>;
}>;

export function createCvImportResourceHandlers(dependencies?: {
  boundary?: ImportBoundary;
  retention?: RetentionService;
  project?: typeof getCvImportResource;
}) {
  const boundary = dependencies?.boundary ?? new CvAccountRequestBoundary();
  const retention = dependencies?.retention ?? new CvRetentionService();
  const project = dependencies?.project ?? getCvImportResource;

  async function idFrom(context: { params: Promise<{ uploadId: string }> }) {
    const id = cvUploadIdSchema.safeParse((await context.params).uploadId);
    if (!id.success) throw new CvImportServiceError("CV_IMPORT_NOT_FOUND");
    return id.data;
  }

  return Object.freeze({
    async GET(
      request: Request,
      context: { params: Promise<{ uploadId: string }> },
    ): Promise<Response> {
      try {
        const id = await idFrom(context);
        const current = await boundary.authorize(request, {
          resource: { type: "upload", id },
        });
        const resource = await project(current.accountId, id);
        const pollingAfterMs = cvStatusPollingAfterMs(
          resource.status,
          "stage" in resource ? resource.processingMode : undefined,
          resource,
        );
        return cvJsonResponse(resource, {
          headers: pollingAfterMs
            ? { "Retry-After": String(Math.ceil(pollingAfterMs / 1000)) }
            : undefined,
        });
      } catch (error) {
        return cvHttpErrorResponse(
          error,
          request.headers.get("x-request-id") ?? undefined,
        );
      }
    },

    async DELETE(
      request: Request,
      context: { params: Promise<{ uploadId: string }> },
    ): Promise<Response> {
      try {
        await assertCvEmptyRequestBody(request);
        const id = await idFrom(context);
        const current = await boundary.authorize(request, {
          mutation: true,
          resource: { type: "upload", id },
        });
        const outcome = await retention.deleteOwnedImport({
          accountId: current.accountId,
          uploadId: id,
        });
        return cvJsonResponse(cvDeletionOutcomeSchema.parse(outcome), {
          status: 202,
          headers: { "Retry-After": "2" },
        });
      } catch (error) {
        return cvHttpErrorResponse(
          error,
          request.headers.get("x-request-id") ?? undefined,
        );
      }
    },
  });
}
