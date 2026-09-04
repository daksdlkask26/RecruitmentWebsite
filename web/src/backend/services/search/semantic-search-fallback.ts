import "server-only";

import { createHash } from "node:crypto";
import { searchReleaseFlags } from "./search-release-flags";

export const SEMANTIC_FALLBACK_POLICY_VERSION = "semantic-fallback-v1" as const;
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 128;
const DEFAULT_TIMEOUT_MS = 120;

export type SemanticSearchCandidate = Readonly<{
  id: string;
  score: number;
}>;

export type SemanticFallbackProvider = (input: {
  query: string;
  catalogVersion: string;
  modelVersion: string;
}) => Promise<readonly SemanticSearchCandidate[]>;

export type SemanticFallbackResult = Readonly<{
  enabled: boolean;
  used: boolean;
  reason:
    | "DISABLED"
    | "DETERMINISTIC_RESULTS_AVAILABLE"
    | "PROVIDER_UNAVAILABLE"
    | "TIMEOUT"
    | "CIRCUIT_OPEN"
    | "PROVIDER_ERROR"
    | "SUCCESS"
    | "CACHE";
  candidates: readonly SemanticSearchCandidate[];
  latencyMs: number;
}>;

type CacheEntry = {
  expiresAt: number;
  candidates: readonly SemanticSearchCandidate[];
};

const cache = new Map<string, CacheEntry>();
let consecutiveFailures = 0;
let circuitOpenedUntil = 0;

function enabled() {
  return searchReleaseFlags().semanticFallbackEnabled;
}

function cacheKey(query: string, catalogVersion: string, modelVersion: string) {
  return createHash("sha256")
    .update(`${query}\u0000${catalogVersion}\u0000${modelVersion}`)
    .digest("hex");
}

function cached(key: string) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.candidates;
}

function remember(key: string, candidates: readonly SemanticSearchCandidate[]) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, candidates });
}

function boundedCandidates(value: readonly SemanticSearchCandidate[]) {
  return value
    .filter(
      (candidate) =>
        candidate.id.length <= 180 &&
        Number.isFinite(candidate.score) &&
        candidate.score >= 0 &&
        candidate.score <= 1,
    )
    .slice(0, 50);
}

export async function getSemanticSearchCandidates(input: {
  query: string;
  catalogVersion: string;
  modelVersion: string;
  deterministicCandidateCount: number;
  provider?: SemanticFallbackProvider;
  timeoutMs?: number;
}): Promise<SemanticFallbackResult> {
  const started = performance.now();
  const finish = (
    reason: SemanticFallbackResult["reason"],
    candidates: readonly SemanticSearchCandidate[] = [],
    used = false,
  ): SemanticFallbackResult => ({
    enabled: enabled(),
    used,
    reason,
    candidates,
    latencyMs: performance.now() - started,
  });
  if (!enabled()) return finish("DISABLED");
  if (input.deterministicCandidateCount > 0)
    return finish("DETERMINISTIC_RESULTS_AVAILABLE");
  if (!input.provider) return finish("PROVIDER_UNAVAILABLE");
  if (circuitOpenedUntil > Date.now()) return finish("CIRCUIT_OPEN");

  const key = cacheKey(input.query, input.catalogVersion, input.modelVersion);
  const hit = cached(key);
  if (hit) return finish("CACHE", hit, true);

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutMs = Math.max(20, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const candidates = await Promise.race([
      input.provider({
        query: input.query,
        catalogVersion: input.catalogVersion,
        modelVersion: input.modelVersion,
      }),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error("SEMANTIC_TIMEOUT")),
          timeoutMs,
        );
      }),
    ]);
    const bounded = boundedCandidates(candidates);
    consecutiveFailures = 0;
    circuitOpenedUntil = 0;
    remember(key, bounded);
    return finish("SUCCESS", bounded, true);
  } catch (error) {
    consecutiveFailures += 1;
    if (consecutiveFailures >= 3) circuitOpenedUntil = Date.now() + 30_000;
    return finish(
      error instanceof Error && error.message === "SEMANTIC_TIMEOUT"
        ? "TIMEOUT"
        : "PROVIDER_ERROR",
    );
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
