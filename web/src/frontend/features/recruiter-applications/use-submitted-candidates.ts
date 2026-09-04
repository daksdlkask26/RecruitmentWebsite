"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApplicationPage,
  SubmittedCandidate,
} from "@/shared/contracts/applications";
import type { WorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { recruiterApplicationsCopy } from "./recruiter-applications-copy";

type State = Readonly<{
  items: SubmittedCandidate[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
}>;

type SubmittedCandidatesCacheEntry = Readonly<{
  items: SubmittedCandidate[];
  nextCursor: string | null;
  updatedAt: number;
}>;

const SUBMITTED_CANDIDATES_CACHE_MAX_AGE_MS = 10 * 60_000;
const submittedCandidatesCache = new Map<
  string,
  SubmittedCandidatesCacheEntry
>();
const submittedCandidatesRequests = new Map<string, Promise<ApplicationPage>>();

function readSubmittedCandidatesCache(jobId: string) {
  const entry = submittedCandidatesCache.get(jobId);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > SUBMITTED_CANDIDATES_CACHE_MAX_AGE_MS) {
    submittedCandidatesCache.delete(jobId);
    return null;
  }
  return entry;
}

function writeSubmittedCandidatesCache(
  jobId: string,
  items: SubmittedCandidate[],
  nextCursor: string | null,
) {
  submittedCandidatesCache.set(jobId, {
    items,
    nextCursor,
    updatedAt: Date.now(),
  });
}

async function requestSubmittedCandidatesPage(jobId: string, cursor?: string) {
  const requestKey = `${jobId}:${cursor ?? "first"}`;
  const existing = submittedCandidatesRequests.get(requestKey);
  if (existing) return existing;

  const request = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const query = new URLSearchParams({ limit: "25" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(
        `/api/recruiter/jobs/${encodeURIComponent(jobId)}/applications?${query}`,
        { cache: "no-store", signal: controller.signal },
      );
      const payload = (await response.json().catch(() => null)) as
        | (ApplicationPage & { message?: string })
        | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.message ?? "Unable to load candidates.");
      }
      return payload;
    } finally {
      window.clearTimeout(timeout);
      submittedCandidatesRequests.delete(requestKey);
    }
  })();
  submittedCandidatesRequests.set(requestKey, request);
  return request;
}

export function useSubmittedCandidates(
  jobId: string,
  locale: WorkspaceLocale = "en",
) {
  const initialCache = readSubmittedCandidatesCache(jobId);
  const [state, setState] = useState<State>(() => ({
    items: initialCache?.items ?? [],
    nextCursor: initialCache?.nextCursor ?? null,
    loading: !initialCache,
    loadingMore: false,
    refreshing: false,
    error: null,
  }));
  const requestId = useRef(0);
  const itemsRef = useRef(initialCache?.items ?? []);

  const load = useCallback(
    async (cursor?: string, append = false) => {
      const currentRequest = ++requestId.current;
      const hasCachedItems =
        !append && Boolean(readSubmittedCandidatesCache(jobId));
      setState((current) => ({
        ...current,
        ...(append
          ? { loadingMore: true }
          : {
              loading: !hasCachedItems,
              refreshing: hasCachedItems,
              error: null,
            }),
      }));
      try {
        const payload = await requestSubmittedCandidatesPage(jobId, cursor);
        if (currentRequest !== requestId.current) return;
        const items = append
          ? [...itemsRef.current, ...payload.items]
          : payload.items;
        itemsRef.current = items;
        writeSubmittedCandidatesCache(jobId, items, payload.nextCursor);
        setState(() => ({
          items,
          nextCursor: payload.nextCursor,
          loading: false,
          loadingMore: false,
          refreshing: false,
          error: null,
        }));
      } catch (error) {
        if (currentRequest !== requestId.current) return;
        if (
          error instanceof DOMException &&
          ["AbortError", "TimeoutError"].includes(error.name)
        ) {
          setState((current) => ({
            ...current,
            loading: false,
            loadingMore: false,
            refreshing: false,
            error: recruiterApplicationsCopy(locale).submitted.loadError,
          }));
          return;
        }
        setState((current) => ({
          ...current,
          loading: false,
          loadingMore: false,
          refreshing: false,
          error: recruiterApplicationsCopy(locale).submitted.loadError,
        }));
      }
    },
    [jobId, locale],
  );

  useEffect(() => {
    const run = async () => {
      await load();
    };
    void run();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  return {
    ...state,
    retry: () => void load(),
    refresh: () => void load(),
    loadMore: () =>
      state.nextCursor && !state.loadingMore
        ? void load(state.nextCursor, true)
        : undefined,
  };
}
