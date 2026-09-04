import { z } from "zod";
import {
  jobPreferencesUpdateSchema,
  savedFilterPresetSchema,
  userJobStateViewSchema,
} from "@/shared/contracts/jobs/catalog";
import {
  parseBoundedJson,
  jobErrorResponse,
  jobJson,
  requireJobActor,
} from "@/backend/security/job-request-boundary";
import {
  projectUserJobState,
  readUserJobState,
  updateUserJobState,
  type UserJobStateMutation,
} from "@/backend/services/jobs/user-job-state-store";
import { withServerTiming } from "@/backend/observability/server-timing";

const mutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save"),
      jobId: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal("unsave"),
      jobId: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal("hide"),
      jobId: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal("unhide"),
      jobId: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal("update-preferences"),
      jobPreferences: jobPreferencesUpdateSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("save-filter-preset"),
      preset: savedFilterPresetSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("delete-filter-preset"),
      presetId: z.string().min(1).max(128),
    })
    .strict(),
]);

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const actor = await requireJobActor(request, { mutation: false });
    const authenticatedAt = performance.now();
    const response = jobJson(
      userJobStateViewSchema.parse(
        projectUserJobState(await readUserJobState(actor.userId)),
      ),
    );
    return withServerTiming(response, [
      { name: "auth", durationMs: authenticatedAt - startedAt },
      { name: "app", durationMs: performance.now() - authenticatedAt },
      { name: "total", durationMs: performance.now() - startedAt },
    ]);
  } catch (error) {
    return withServerTiming(jobErrorResponse(error), [
      { name: "total", durationMs: performance.now() - startedAt },
    ]);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireJobActor(request);
    const mutation = (await parseBoundedJson(
      request,
      mutationSchema,
      64 * 1024,
    )) as UserJobStateMutation;
    const state = await updateUserJobState(actor.userId, mutation);
    return jobJson(userJobStateViewSchema.parse(projectUserJobState(state)));
  } catch (error) {
    return jobErrorResponse(error);
  }
}
