export const CV_IMPORT_POLLING_MAX_DELAY_MS = 30_000;

export type CvPollingOutcome = "initial" | "advanced" | "unchanged" | "error";

export function nextCvPollingDelay(input: {
  baseDelayMs?: number;
  previousDelayMs?: number | null;
  outcome: CvPollingOutcome;
  maxDelayMs?: number;
  random?: () => number;
}): number {
  const baseDelayMs = Number.isSafeInteger(input.baseDelayMs)
    ? Math.max(1, input.baseDelayMs ?? 2_000)
    : 2_000;
  const maxDelayMs = Number.isSafeInteger(input.maxDelayMs)
    ? Math.max(baseDelayMs, input.maxDelayMs ?? CV_IMPORT_POLLING_MAX_DELAY_MS)
    : Math.max(baseDelayMs, CV_IMPORT_POLLING_MAX_DELAY_MS);
  const reset =
    input.outcome === "initial" ||
    input.outcome === "advanced" ||
    input.previousDelayMs === null ||
    input.previousDelayMs === undefined;
  const previousDelayMs = input.previousDelayMs ?? baseDelayMs;
  const target = reset
    ? baseDelayMs
    : Math.min(maxDelayMs, Math.max(baseDelayMs, previousDelayMs * 2));
  if (reset) return target;
  const random = Math.min(1, Math.max(0, input.random?.() ?? Math.random()));
  const jittered = Math.round(target * (0.9 + random * 0.2));
  return Math.min(maxDelayMs, Math.max(baseDelayMs, jittered));
}
