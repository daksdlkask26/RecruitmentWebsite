"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { mutateWithCurrentCsrf } from "@/frontend/features/authentication/client/current-csrf-proof";
import { useCsrfProof } from "@/frontend/features/authentication/client/csrf-proof-context";
import { savedJobOutcomeSchema } from "@/shared/contracts/jobs/actions";
import {
  savedFilterPresetSchema,
  userJobStateViewSchema,
  type SavedFilterPreset,
  type UserJobState,
} from "@/shared/contracts/jobs/catalog";
import {
  searchModeSchema,
  type SearchMode,
} from "@/shared/contracts/search/search-interpretation";
import type { StructuredSearchFilter } from "@/shared/contracts/search/natural-language-search";
import type { JobSearchIntent } from "@/shared/contracts/search/job-search-intent";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { jobCopy } from "./job-copy";

export type JobInteractionSeed = {
  saved: boolean;
  applied: boolean;
  hidden?: boolean;
};

export type JobInteractionRecord = JobInteractionSeed & {
  hidden: boolean;
};

export type FilterPreset = SavedFilterPreset;
export type FilterPresetMetadata = Readonly<{
  q?: string;
  searchMode?: SearchMode;
  resolverVersion?: string;
  catalogVersion?: string;
  structuredFilters?: readonly StructuredSearchFilter[];
  searchIntent?: JobSearchIntent;
}>;
type UserJobStateView = Pick<
  UserJobState,
  "savedJobIds" | "hiddenJobIds" | "appliedJobIds" | "savedFilterPresets"
>;
type UserJobStateMutation =
  | { action: "hide"; jobId: string }
  | { action: "unhide"; jobId: string }
  | { action: "save-filter-preset"; preset: FilterPreset }
  | { action: "delete-filter-preset"; presetId: string };

type JobInteractionContextValue = {
  records: Record<string, JobInteractionRecord>;
  registerJob: (jobId: string, seed: JobInteractionSeed) => void;
  toggleSaved: (jobId: string) => Promise<boolean>;
  markApplied: (jobId: string) => void;
  clearApplied: (jobId: string) => void;
  hideJob: (jobId: string) => void;
  undoHide: (jobId: string) => void;
  savedFilterPresets: FilterPreset[];
  saveFilterPreset: (
    name: string,
    filters: Record<string, unknown>,
    metadata?: FilterPresetMetadata,
  ) => void;
  deleteFilterPreset: (presetId: string) => void;
};

const JobInteractionContext = createContext<JobInteractionContextValue | null>(
  null,
);

function syncUserJobState(
  csrfProof: string,
  mutation: UserJobStateMutation,
): Promise<void> {
  return mutateWithCurrentCsrf(
    "/api/jobs/user-state",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mutation),
    },
    csrfProof,
  ).then(async (response) => {
    if (!response.ok) throw new Error("USER_JOB_STATE_UPDATE_FAILED");
    userJobStateViewSchema.parse(await response.json());
  });
}

async function readUserJobStateView() {
  try {
    const response = await fetch("/api/jobs/user-state", {
      cache: "no-store",
    });
    if (!response.ok) return null;
    return userJobStateViewSchema.parse(await response.json());
  } catch {
    return null;
  }
}

export function JobInteractionProvider({
  children,
  initialUserJobState,
}: {
  children: React.ReactNode;
  initialUserJobState?: UserJobStateView;
}) {
  const locale = useWorkspaceLocale();
  const copy = useMemo(() => jobCopy(locale), [locale]);
  const csrfProof = useCsrfProof();
  const [records, setRecords] = useState<Record<string, JobInteractionRecord>>(
    {},
  );
  const [savedFilterPresets, setSavedFilterPresets] = useState<FilterPreset[]>(
    [],
  );
  const hasLocalPresetChanges = useRef(false);
  const presetMutationQueue = useRef(Promise.resolve());

  useEffect(() => {
    let active = true;
    const state = initialUserJobState
      ? Promise.resolve(initialUserJobState)
      : readUserJobStateView();
    void state.then((view) => {
      if (!active || !view) return;
      if (!hasLocalPresetChanges.current) {
        setSavedFilterPresets(view.savedFilterPresets);
      }
      setRecords((current) => {
        const next = { ...current };
        const ids = new Set([...view.savedJobIds, ...view.hiddenJobIds]);
        for (const jobId of ids) {
          const existing = next[jobId] ?? {
            saved: false,
            applied: false,
            hidden: false,
          };
          const updated = {
            ...existing,
            saved: existing.saved || view.savedJobIds.includes(jobId),
            applied: existing.applied,
            hidden: existing.hidden || view.hiddenJobIds.includes(jobId),
          };
          next[jobId] = updated;
        }
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, [initialUserJobState]);

  const registerJob = useCallback((jobId: string, seed: JobInteractionSeed) => {
    setRecords((current) => {
      const existing = current[jobId];
      const hidden = seed.hidden ?? existing?.hidden ?? false;
      if (
        existing &&
        existing.saved === seed.saved &&
        existing.applied === seed.applied &&
        existing.hidden === hidden
      ) {
        return current;
      }
      return {
        ...current,
        [jobId]: {
          saved: seed.saved,
          applied: seed.applied,
          hidden,
        },
      };
    });
  }, []);

  const toggleSaved = useCallback(
    async (jobId: string) => {
      const current = records[jobId]?.saved ?? false;
      const response = await mutateWithCurrentCsrf(
        "/api/saved-jobs/" + encodeURIComponent(jobId),
        { method: current ? "DELETE" : "PUT" },
        csrfProof,
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(copy.updateFailed);
      }
      const outcome = savedJobOutcomeSchema.parse(body);
      setRecords((state) => ({
        ...state,
        [jobId]: {
          saved: outcome.saved,
          applied: state[jobId]?.applied ?? false,
          hidden: state[jobId]?.hidden ?? false,
        },
      }));
      toast(outcome.saved ? copy.savedSuccess : copy.removedSuccess);
      return outcome.saved;
    },
    [
      copy.removedSuccess,
      copy.savedSuccess,
      copy.updateFailed,
      csrfProof,
      records,
    ],
  );

  const markApplied = useCallback((jobId: string) => {
    setRecords((state) => ({
      ...state,
      [jobId]: {
        saved: state[jobId]?.saved ?? false,
        applied: true,
        hidden: state[jobId]?.hidden ?? false,
      },
    }));
  }, []);

  const clearApplied = useCallback((jobId: string) => {
    setRecords((state) => {
      const existing = state[jobId];
      if (!existing || !existing.applied) return state;
      return {
        ...state,
        [jobId]: {
          ...existing,
          applied: false,
        },
      };
    });
  }, []);

  const undoHide = useCallback(
    (jobId: string) => {
      setRecords((state) => ({
        ...state,
        [jobId]: {
          saved: state[jobId]?.saved ?? false,
          applied: state[jobId]?.applied ?? false,
          hidden: false,
        },
      }));
      void syncUserJobState(csrfProof, { action: "unhide", jobId }).catch(
        () => undefined,
      );
    },
    [csrfProof],
  );

  const hideJob = useCallback(
    (jobId: string) => {
      setRecords((state) => ({
        ...state,
        [jobId]: {
          saved: state[jobId]?.saved ?? false,
          applied: state[jobId]?.applied ?? false,
          hidden: true,
        },
      }));
      void syncUserJobState(csrfProof, { action: "hide", jobId }).catch(
        () => undefined,
      );
      toast(copy.jobHidden, {
        description: copy.jobHiddenDescription,
        duration: 5000,
        action: {
          label: copy.undo,
          onClick: () => undoHide(jobId),
        },
      });
    },
    [copy.jobHidden, copy.jobHiddenDescription, copy.undo, csrfProof, undoHide],
  );

  const saveFilterPreset = useCallback(
    (
      name: string,
      filters: Record<string, unknown>,
      metadata: FilterPresetMetadata = {},
    ) => {
      const trimmedName = name.trim();
      if (!trimmedName) return;

      const id =
        globalThis.crypto?.randomUUID?.() ??
        "preset-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      const rawQuery =
        metadata.q?.trim() ??
        (typeof filters.q === "string" ? filters.q.trim() : "");
      const parsedMode = searchModeSchema.safeParse(
        metadata.searchMode ?? filters.searchMode ?? "SMART",
      );
      const preset = savedFilterPresetSchema.parse({
        id,
        name: trimmedName,
        filters,
        q: rawQuery,
        searchMode: parsedMode.success ? parsedMode.data : "SMART",
        ...(metadata.resolverVersion
          ? { resolverVersion: metadata.resolverVersion }
          : {}),
        ...(metadata.catalogVersion
          ? { catalogVersion: metadata.catalogVersion }
          : {}),
        ...(metadata.structuredFilters?.length
          ? { structuredFilters: [...metadata.structuredFilters] }
          : {}),
        ...(metadata.searchIntent
          ? { searchIntent: metadata.searchIntent }
          : {}),
      });
      hasLocalPresetChanges.current = true;
      setSavedFilterPresets((current) => [preset, ...current].slice(0, 100));
      const persist = async () => {
        await syncUserJobState(csrfProof, {
          action: "save-filter-preset",
          preset,
        });
      };
      presetMutationQueue.current = presetMutationQueue.current
        .catch(() => undefined)
        .then(persist)
        .catch(() => {
          setSavedFilterPresets((current) =>
            current.filter((item) => item.id !== preset.id),
          );
        });
      toast(copy.filterSaved, {
        description: copy.filterSavedDescription(preset.name),
      });
    },
    [copy, csrfProof],
  );

  const deleteFilterPreset = useCallback(
    (presetId: string) => {
      const deletedPreset = savedFilterPresets.find(
        (preset) => preset.id === presetId,
      );
      if (!deletedPreset) return;
      hasLocalPresetChanges.current = true;
      setSavedFilterPresets((current) =>
        current.filter((preset) => preset.id !== presetId),
      );
      const persist = async () => {
        await syncUserJobState(csrfProof, {
          action: "delete-filter-preset",
          presetId,
        });
      };
      presetMutationQueue.current = presetMutationQueue.current
        .catch(() => undefined)
        .then(persist)
        .catch(() => {
          setSavedFilterPresets((current) =>
            current.some((preset) => preset.id === deletedPreset.id)
              ? current
              : [deletedPreset, ...current].slice(0, 100),
          );
        });
    },
    [csrfProof, savedFilterPresets],
  );

  const value = useMemo(
    () => ({
      records,
      registerJob,
      toggleSaved,
      markApplied,
      clearApplied,
      hideJob,
      undoHide,
      savedFilterPresets,
      saveFilterPreset,
      deleteFilterPreset,
    }),
    [
      hideJob,
      clearApplied,
      markApplied,
      records,
      registerJob,
      saveFilterPreset,
      savedFilterPresets,
      toggleSaved,
      undoHide,
      deleteFilterPreset,
    ],
  );

  return (
    <JobInteractionContext.Provider value={value}>
      {children}
    </JobInteractionContext.Provider>
  );
}

export function useJobInteraction(
  jobId: string,
  seed: JobInteractionSeed,
): JobInteractionRecord & {
  toggleSaved: () => Promise<boolean>;
  markApplied: () => void;
  clearApplied: () => void;
  hide: () => void;
  undoHide: () => void;
} {
  const context = useContext(JobInteractionContext);
  if (!context) {
    throw new Error(
      "useJobInteraction must be used within JobInteractionProvider",
    );
  }

  const registerJob = context.registerJob;
  useEffect(() => {
    registerJob(jobId, {
      saved: seed.saved,
      applied: seed.applied,
      hidden: seed.hidden,
    });
  }, [jobId, registerJob, seed.applied, seed.hidden, seed.saved]);

  const record = context.records[jobId] ?? {
    saved: seed.saved,
    applied: seed.applied,
    hidden: seed.hidden ?? false,
  };

  return {
    ...record,
    toggleSaved: () => context.toggleSaved(jobId),
    markApplied: () => context.markApplied(jobId),
    clearApplied: () => context.clearApplied(jobId),
    hide: () => context.hideJob(jobId),
    undoHide: () => context.undoHide(jobId),
  };
}

export function useOptionalJobInteraction() {
  return useContext(JobInteractionContext);
}
