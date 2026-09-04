import "server-only";

import { cache } from "react";
import { prisma } from "@/backend/database/prisma";
import type { Prisma } from "@/backend/generated/prisma/client";
import {
  type JobPreferences,
  type SavedFilterPreset,
  type UserJobState,
  savedFilterPresetSchema,
  userJobStateSchema,
} from "@/shared/contracts/jobs/catalog";
import {
  defaultJobPreferences,
  jobPreferencesSchema,
} from "@/shared/contracts/jobs/preferences";
import { z } from "zod";

const hiddenJobIdsSchema = z.array(z.string().min(1).max(128)).max(10_000);
const savedFilterPresetsSchema = z.array(savedFilterPresetSchema).max(100);

export type UserJobStateMutation =
  | { action: "save"; jobId: string }
  | { action: "unsave"; jobId: string }
  | { action: "hide"; jobId: string }
  | { action: "unhide"; jobId: string }
  | { action: "update-preferences"; jobPreferences: JobPreferences }
  | { action: "save-filter-preset"; preset: SavedFilterPreset }
  | { action: "delete-filter-preset"; presetId: string };

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function readUserJobStateFromDatabase(
  userId: string,
): Promise<UserJobState> {
  const [savedJobs, workspace] = await Promise.all([
    prisma.savedJob.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { jobPostingId: "asc" }],
      select: { jobPostingId: true },
    }),
    prisma.userJobWorkspaceState.findUnique({
      where: { userId },
      select: {
        hiddenJobIds: true,
        jobPreferences: true,
        savedFilterPresets: true,
      },
    }),
  ]);

  const preferences = jobPreferencesSchema.safeParse(workspace?.jobPreferences);
  const hiddenJobIds = hiddenJobIdsSchema.safeParse(workspace?.hiddenJobIds);
  const savedFilterPresets = savedFilterPresetsSchema.safeParse(
    workspace?.savedFilterPresets,
  );

  return userJobStateSchema.parse({
    userId,
    savedJobIds: savedJobs.map((job) => job.jobPostingId),
    hiddenJobIds: hiddenJobIds.success ? hiddenJobIds.data : [],
    appliedJobIds: [],
    jobPreferences: preferences.success
      ? preferences.data
      : defaultJobPreferences,
    savedFilterPresets: savedFilterPresets.success
      ? savedFilterPresets.data
      : [],
  });
}

export const readUserJobState = cache(readUserJobStateFromDatabase);

export function projectUserJobState(state: UserJobState) {
  return {
    savedJobIds: state.savedJobIds,
    hiddenJobIds: state.hiddenJobIds,
    appliedJobIds: state.appliedJobIds,
    savedFilterPresets: state.savedFilterPresets,
  };
}

async function persistWorkspaceState(
  userId: string,
  state: UserJobState,
): Promise<void> {
  await prisma.userJobWorkspaceState.upsert({
    where: { userId },
    create: {
      userId,
      hiddenJobIds: jsonValue(state.hiddenJobIds),
      jobPreferences: jsonValue(state.jobPreferences),
      savedFilterPresets: jsonValue(state.savedFilterPresets),
    },
    update: {
      hiddenJobIds: jsonValue(state.hiddenJobIds),
      jobPreferences: jsonValue(state.jobPreferences),
      savedFilterPresets: jsonValue(state.savedFilterPresets),
    },
  });
}

export async function updateUserJobState(
  userId: string,
  mutation: UserJobStateMutation,
): Promise<UserJobState> {
  switch (mutation.action) {
    case "save":
      await prisma.savedJob.createMany({
        data: { userId, jobPostingId: mutation.jobId },
        skipDuplicates: true,
      });
      break;
    case "unsave":
      await prisma.savedJob.deleteMany({
        where: { userId, jobPostingId: mutation.jobId },
      });
      break;
    case "hide": {
      const current = await readUserJobStateFromDatabase(userId);
      if (!current.hiddenJobIds.includes(mutation.jobId)) {
        await persistWorkspaceState(userId, {
          ...current,
          hiddenJobIds: [...current.hiddenJobIds, mutation.jobId],
        });
      }
      break;
    }
    case "unhide": {
      const current = await readUserJobStateFromDatabase(userId);
      await persistWorkspaceState(userId, {
        ...current,
        hiddenJobIds: current.hiddenJobIds.filter(
          (jobId) => jobId !== mutation.jobId,
        ),
      });
      break;
    }
    case "update-preferences": {
      const current = await readUserJobStateFromDatabase(userId);
      await persistWorkspaceState(userId, {
        ...current,
        jobPreferences: mutation.jobPreferences,
      });
      break;
    }
    case "save-filter-preset": {
      const current = await readUserJobStateFromDatabase(userId);
      const preset = savedFilterPresetSchema.parse(mutation.preset);
      await persistWorkspaceState(userId, {
        ...current,
        savedFilterPresets: [
          preset,
          ...current.savedFilterPresets.filter((item) => item.id !== preset.id),
        ].slice(0, 100),
      });
      break;
    }
    case "delete-filter-preset": {
      const current = await readUserJobStateFromDatabase(userId);
      await persistWorkspaceState(userId, {
        ...current,
        savedFilterPresets: current.savedFilterPresets.filter(
          (preset) => preset.id !== mutation.presetId,
        ),
      });
      break;
    }
  }

  return readUserJobStateFromDatabase(userId);
}
