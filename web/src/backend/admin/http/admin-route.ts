import "server-only";
import { ZodError, type z } from "zod";
import { AdminBoundaryError } from "@/backend/security/admin-request-boundary";
import { AdminCommandConflict } from "@/backend/repositories/admin/prisma-admin-command-repository";
import { SupportError } from "@/backend/support/support-errors";
import { NotificationError } from "@/backend/notifications/notification-errors";

export function adminNoStoreHeaders(extra: HeadersInit = {}) {
  const headers = new Headers({
    "cache-control": "no-store, max-age=0",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow, noarchive",
  });
  const supplied = extra instanceof Headers ? extra : new Headers(extra);
  supplied.forEach((value, key) => {
    if (key !== "set-cookie") headers.set(key, value);
  });
  for (const cookie of supplied.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  return headers;
}

export async function parseAdminJson<T>(
  request: Request,
  schema: z.ZodType<T>,
) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AdminHttpError(415, "VALIDATION_FAILED");
  }
  return schema.parse(await request.json());
}

export class AdminHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(code);
  }
}

export function adminJson(value: unknown, init: ResponseInit = {}) {
  return Response.json(value, {
    ...init,
    headers: adminNoStoreHeaders(init.headers),
  });
}

export function adminRouteError(error: unknown) {
  if (error instanceof NotificationError) {
    return adminJson({ code: error.code }, { status: error.status });
  }
  if (error instanceof SupportError) {
    return adminJson(
      {
        code: error.code,
        ...(error.retryAfterSeconds
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      },
      { status: error.status },
    );
  }
  if (error instanceof AdminBoundaryError) {
    return adminJson({ code: error.code }, { status: error.status });
  }
  if (error instanceof AdminHttpError) {
    return adminJson(
      {
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }
  if (error instanceof AdminCommandConflict) {
    return adminJson(
      { code: error.code, currentVersion: error.currentVersion },
      { status: 409 },
    );
  }
  if (error instanceof Error) {
    const known: Record<string, number> = {
      UNAUTHORIZED: 401,
      TARGET_UNAVAILABLE: 404,
      INVALID_STATE: 409,
      STALE_CONFLICT: 409,
      LAST_USABLE_ADMIN: 409,
      PROTECTED_ADMIN_ACTION: 409,
      LAST_ACTIVE_OWNER: 409,
      RATIONALE_LENGTH_INVALID: 400,
      STEP_UP_REQUIRED: 403,
      FILE_SIZE_INVALID: 400,
      FILE_TYPE_INVALID: 400,
      DUPLICATE_AUTHORITY: 409,
      OWNER_COMPANY_LIMIT_REACHED: 409,
      ACTIVE_REQUEST_EXISTS: 409,
      RELATIONSHIP_REQUIRED: 404,
      PREREQUISITE_INTEGRATION_UNAVAILABLE: 503,
      EVIDENCE_UNAVAILABLE: 409,
      RESUBMISSION_LIMIT: 409,
      LOOKUP_REQUIRED: 409,
      EMAIL_VERIFICATION_REQUIRED: 409,
      CHALLENGE_UNAVAILABLE: 400,
      IDEMPOTENCY_KEY_INVALID: 400,
      IDEMPOTENCY_CONFLICT: 409,
      POLICY_VERSION_INVALID: 409,
      MISMATCH_EXPLANATION_REQUIRED: 400,
      ENRICHED_FACTS_REQUIRED: 409,
      REJECTION_REASON_INVALID: 400,
      APPLICANT_SUSPENDED: 423,
      ADMIN_AUTHORITY_STALE: 403,
      VALIDATION_FAILED: 400,
      TITLE_MAPPING_REQUIRED: 400,
      CATALOG_INCOMPLETE: 409,
      ACTION_BLOCKED: 423,
      CLAIM_REQUIRED: 409,
      ASSIGNED_TO_OTHER: 423,
      CORRECTION_REQUEST_OPEN: 409,
      FEATURE_CAPACITY_CONFLICT: 409,
      INVALID_REPORT_RANGE: 400,
      ANALYTICS_RANGE_UNAVAILABLE: 404,
    };
    if (known[error.message])
      return adminJson(
        { code: error.message },
        { status: known[error.message] },
      );
    if (error.message === "REPORT_TARGET_UNAVAILABLE")
      return adminJson({ code: "UNAVAILABLE" }, { status: 404 });
    if (error.message === "RATE_LIMITED")
      return adminJson(
        {
          code: "RATE_LIMITED",
          retryAfterSeconds: (error as Error & { retryAfterSeconds?: number })
            .retryAfterSeconds,
        },
        { status: 429 },
      );
  }
  if (error instanceof ZodError) {
    return adminJson(
      {
        code: "VALIDATION_FAILED",
        fieldErrors: error.issues.map((issue) => ({
          field: issue.path.join("."),
          code: issue.message,
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }
  if (error && typeof error === "object" && "issues" in error) {
    return adminJson({ code: "VALIDATION_FAILED" }, { status: 400 });
  }
  return adminJson({ code: "INTERNAL_FAILURE" }, { status: 500 });
}

export function commandHeaders(
  request: Request,
  options: { strictIfMatch?: boolean } = {},
) {
  const ifMatch = options.strictIfMatch
    ? request.headers.get("If-Match")
    : (request.headers.get("If-Match") ??
      request.headers.get("if-match-version"));
  const parsed = options.strictIfMatch
    ? ifMatch?.match(/^"(\d+)"$/u)
    : ifMatch?.match(/^"?(\d+)"?$/u);
  return {
    idempotencyKey: request.headers.get("idempotency-key") ?? "",
    expectedVersion: parsed ? Number(parsed[1]) : Number.NaN,
  };
}

export function adminListQuery(request: Request) {
  const query = new URL(request.url).searchParams;
  let filter: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(query.get("filter") ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      filter = parsed as Record<string, unknown>;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return {
    page: Math.max(1, Number(query.get("page") ?? 1)),
    perPage: Math.min(100, Math.max(1, Number(query.get("perPage") ?? 25))),
    filter,
  };
}
