import type { CvUploadStatus } from "@/shared/contracts/cv-import/common";

const CV_SECURITY_UPLOAD_STORAGE_PREFIX = "nextgen-careers:cv-security:v1:";
const CV_SECURITY_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_POLLS = 30;
const DEFAULT_MAX_DURATION_MS = 60_000;
const DEFAULT_MAX_DELAY_MS = 5_000;
const DEFAULT_INITIAL_DELAY_MS = 0;

export const CV_SECURITY_TERMINAL_STATUSES = new Set<CvUploadStatus>([
  "SECURITY_CLEAN",
  "REVIEW_READY",
  "VALIDATION_FAILED",
  "INFECTED",
  "SCAN_FAILED",
  "EXTRACTION_FAILED",
  "PARSE_FAILED",
  "CONFIRMED",
  "CANCELLED",
  "DELETED",
  "EXPIRED",
]);

const CV_SECURITY_STATUSES = new Set<CvUploadStatus>([
  "AWAITING_CONTENT",
  "VALIDATION_QUEUED",
  "SCAN_QUEUED",
  "SCANNING",
  "SECURITY_CLEAN",
  "EXTRACTION_QUEUED",
  "EXTRACTING",
  "AWAITING_CONSENT",
  "PARSE_QUEUED",
  "PARSING",
  "REVIEW_READY",
  "VALIDATION_FAILED",
  "INFECTED",
  "SCAN_FAILED",
  "EXTRACTION_FAILED",
  "PARSE_FAILED",
  "CONFIRMED",
  "CANCELLED",
  "DELETED",
  "EXPIRED",
]);

export type CvSecurityPollResult = {
  uploadId: string;
  status: CvUploadStatus;
  clean: boolean;
  attempts: number;
};

export class CvSecurityUploadError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status?: CvUploadStatus;

  constructor(
    code: string,
    message: string,
    options?: { retryable?: boolean; status?: CvUploadStatus },
  ) {
    super(message);
    this.name = "CvSecurityUploadError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.status = options?.status;
  }
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function validUploadId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function storageKey(scope: string) {
  const normalized = scope.replace(/[^A-Za-z0-9._:-]/gu, "_").slice(0, 160);
  return `${CV_SECURITY_UPLOAD_STORAGE_PREFIX}${normalized || "default"}`;
}

export function saveCvSecurityUploadId(
  scope: string,
  uploadId: string,
  options?: { ttlMs?: number },
) {
  if (!validUploadId(uploadId)) return;
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(
      storageKey(scope),
      JSON.stringify({
        uploadId,
        expiresAt: Date.now() + (options?.ttlMs ?? CV_SECURITY_UPLOAD_TTL_MS),
      }),
    );
  } catch {
    // Private browsing and quota policies must not block the upload flow.
  }
}

export function readCvSecurityUploadId(scope: string): string | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(scope));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const candidate =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    if (
      !candidate ||
      !validUploadId(candidate.uploadId) ||
      typeof candidate.expiresAt !== "number" ||
      candidate.expiresAt <= Date.now()
    ) {
      storage.removeItem(storageKey(scope));
      return null;
    }
    return candidate.uploadId;
  } catch {
    try {
      storage.removeItem(storageKey(scope));
    } catch {
      // Ignore storage cleanup failures.
    }
    return null;
  }
}

export function clearCvSecurityUploadId(scope: string) {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(scope));
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function newCvSecurityIdempotencyKey(prefix = "cv-security") {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}-key`
  );
}

function defaultSleep(milliseconds: number, signal?: AbortSignal) {
  if (milliseconds <= 0) {
    if (signal?.aborted) {
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    }
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, milliseconds);
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function waitUntilVisible(signal?: AbortSignal) {
  if (
    typeof document === "undefined" ||
    document.visibilityState !== "hidden"
  ) {
    if (signal?.aborted) {
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    }
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") finish(resolve);
    };
    const onAbort = () => finish(reject, true);
    const finish = (done: (value?: void | PromiseLike<void>) => void, aborted = false) => {
      document.removeEventListener("visibilitychange", onVisibility);
      signal?.removeEventListener("abort", onAbort);
      if (aborted) {
        done(new DOMException("The operation was aborted.", "AbortError") as never);
      } else {
        done();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get("Retry-After");
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

function statusFrom(body: unknown): CvUploadStatus | null {
  if (!body || typeof body !== "object" || !("status" in body)) return null;
  const value = body.status;
  return typeof value === "string" && CV_SECURITY_STATUSES.has(value as CvUploadStatus)
    ? (value as CvUploadStatus)
    : null;
}

export async function pollCvSecurityUpload(
  uploadId: string,
  options?: {
    signal?: AbortSignal;
    fetcher?: Fetcher;
    sleep?: Sleep;
    maxPolls?: number;
    maxDurationMs?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  },
): Promise<CvSecurityPollResult> {
  const fetcher = options?.fetcher ?? fetch;
  const sleep = options?.sleep ?? defaultSleep;
  const maxPolls = options?.maxPolls ?? DEFAULT_MAX_POLLS;
  const maxDurationMs = options?.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const startedAt = Date.now();
  let delayMs = options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;

  for (let attempts = 1; attempts <= maxPolls; attempts += 1) {
    if (Date.now() - startedAt >= maxDurationMs) {
      throw new CvSecurityUploadError(
        "CV_STATUS_TIMEOUT",
        "The CV security check is taking longer than expected.",
        { retryable: true },
      );
    }
    await waitUntilVisible(options?.signal);
    await sleep(Math.max(0, delayMs), options?.signal);
    await waitUntilVisible(options?.signal);

    let response: Response;
    try {
      response = await fetcher(
        `/api/account/cv-imports/${encodeURIComponent(uploadId)}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
          signal: options?.signal,
        },
      );
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      throw new CvSecurityUploadError(
        "CV_STATUS_REQUEST_FAILED",
        "The CV security status could not be loaded.",
        { retryable: true },
      );
    }

    const body: unknown = await response.json().catch(() => null);
    const status = statusFrom(body);
    if (!response.ok || !status) {
      throw new CvSecurityUploadError(
        response.ok ? "CV_STATUS_INVALID" : "CV_STATUS_REQUEST_FAILED",
        "The CV security status could not be loaded.",
        { retryable: true },
      );
    }
    if (CV_SECURITY_TERMINAL_STATUSES.has(status)) {
      return {
        uploadId,
        status,
        clean: status === "SECURITY_CLEAN",
        attempts,
      };
    }
    delayMs = Math.min(
      maxDelayMs,
      Math.max(
        1_000,
        retryAfterMilliseconds(response) ?? Math.min(maxDelayMs, delayMs * 2 || 1_000),
      ),
    );
  }

  throw new CvSecurityUploadError(
    "CV_STATUS_TIMEOUT",
    "The CV security check is taking longer than expected.",
    { retryable: true },
  );
}

type Mutation = (path: string, init: RequestInit) => Promise<Response>;

export async function requestCvSecurityRetry(
  uploadId: string,
  idempotencyKey: string,
  mutate: Mutation = (path, init) => fetch(path, init),
) {
  let response: Response;
  try {
    response = await mutate(
      `/api/account/cv-imports/${encodeURIComponent(uploadId)}/retries`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: "{}",
      },
    );
  } catch {
    throw new CvSecurityUploadError(
      "CV_RETRY_REQUEST_FAILED",
      "The CV retry request could not be sent.",
      { retryable: true },
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      body && typeof body === "object" && "code" in body && typeof body.code === "string"
        ? body.code
        : "CV_RETRY_REQUEST_FAILED";
    throw new CvSecurityUploadError(code, "The CV could not be queued for retry.", {
      retryable: code !== "RETRY_LIMIT_REACHED",
    });
  }
  return body;
}
