import { z } from "zod";
import { CandidateApplicationTrackingService } from "@/backend/candidate-applications/candidate-application-tracking-service";
import { CandidateApplicationSubmissionService } from "@/backend/candidate-applications/candidate-application-submission-service";
import {
  candidateApplicationError,
  CandidateApplicationError,
} from "@/backend/candidate-applications/candidate-application-errors";
import {
  jobErrorResponse,
  jobJson,
  parseBoundedJson,
  requireJobActor,
} from "@/backend/security/job-request-boundary";
import {
  applicationSubmitCommandSchema,
  candidateApplicationListResponseSchema,
} from "@/shared/contracts/candidate-applications";
import { idempotencyKeySchema } from "@/shared/contracts/jobs/actions";
import { withServerTiming } from "@/backend/observability/server-timing";

const querySchema = z
  .object({
    cursor: z.string().min(1).max(128).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(24),
  })
  .strict();

function errorResponse(error: unknown) {
  return jobErrorResponse(candidateApplicationError(error));
}

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const actor = await requireJobActor(request, { mutation: false });
    const authenticatedAt = performance.now();
    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success) {
      throw new CandidateApplicationError(
        400,
        "APPLICATION_LIST_REQUEST_INVALID",
        "Choose valid application list filters.",
      );
    }
    const result = await new CandidateApplicationTrackingService().list(
      actor,
      parsed.data,
    );
    const response = jobJson(
      candidateApplicationListResponseSchema.parse(result),
    );
    return withServerTiming(response, [
      { name: "auth", durationMs: authenticatedAt - startedAt },
      { name: "app", durationMs: performance.now() - authenticatedAt },
      { name: "total", durationMs: performance.now() - startedAt },
    ]);
  } catch (error) {
    return withServerTiming(errorResponse(error), [
      { name: "total", durationMs: performance.now() - startedAt },
    ]);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireJobActor(request, { mutation: true });
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    if (!idempotencyKeySchema.safeParse(idempotencyKey).success) {
      throw new CandidateApplicationError(
        400,
        "APPLICATION_IDEMPOTENCY_KEY_INVALID",
        "Refresh the review page and try submitting again.",
      );
    }
    const command = await parseBoundedJson(
      request,
      applicationSubmitCommandSchema,
      16 * 1024,
    );
    const receipt = await new CandidateApplicationSubmissionService().submit(
      actor,
      idempotencyKey,
      command,
    );
    return jobJson(receipt, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
