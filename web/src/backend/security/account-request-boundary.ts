import "server-only";
import { z, type ZodType } from "zod";
import { prisma } from "@/backend/database/prisma";
import { serverEnvironment } from "@/backend/env/runtime";
import { requireSession } from "@/backend/auth/session/require-session";
import { validateSameOrigin } from "@/backend/security/csrf/csrf";
import { validCsrfProof } from "@/backend/security/csrf/csrf-proof";
import { noStoreHeaders } from "@/backend/security/response-headers";
import {
  accountErrorSchema,
  type AccountError,
  type FieldErrors,
} from "@/shared/contracts/account/common";

export type AuthenticatedAccountContext = {
  userId: string;
  sessionId: string;
};

export type AccountErrorStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 413
  | 415
  | 429
  | 503;

export class AccountRequestError extends Error {
  constructor(
    readonly status: AccountErrorStatus,
    readonly body: AccountError,
  ) {
    super(body.code);
  }
}

function validationFields(error: z.ZodError): FieldErrors {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues.slice(0, 25)) {
    const path = issue.path.length ? issue.path.join(".") : "request";
    const message =
      issue.code === "unrecognized_keys"
        ? "Contains unsupported fields."
        : "Enter a valid value.";
    const messages = fields[path] ?? [];
    if (!messages.includes(message) && messages.length < 5) {
      messages.push(message);
    }
    fields[path] = messages;
  }
  return fields;
}

export async function parseBoundedJson<T>(
  request: Request,
  schema: ZodType<T>,
  maxBytes: number,
): Promise<T> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("ACCOUNT_BODY_LIMIT_INVALID");
  }
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/u.test(length) || Number(length) > maxBytes)) {
    throw new AccountRequestError(413, {
      code: "REQUEST_TOO_LARGE",
      message: "The request is too large.",
    });
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new AccountRequestError(400, {
      code: "INVALID_REQUEST",
      message: "Send a valid JSON request.",
    });
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new AccountRequestError(400, {
      code: "INVALID_REQUEST",
      message: "Send a valid JSON request.",
    });
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new AccountRequestError(413, {
      code: "REQUEST_TOO_LARGE",
      message: "The request is too large.",
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AccountRequestError(400, {
      code: "INVALID_REQUEST",
      message: "Send a valid JSON request.",
    });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AccountRequestError(400, {
      code: "VALIDATION_ERROR",
      message: "Review the highlighted fields.",
      fieldErrors: validationFields(parsed.error),
    });
  }
  return parsed.data;
}

export async function requireAccountRequest(
  request: Request,
  options: { mutation?: boolean; now?: Date } = {},
): Promise<AuthenticatedAccountContext> {
  const current = await requireSession(
    request.headers,
    options.now ?? new Date(),
  );
  if (!current) {
    throw new AccountRequestError(401, {
      code: "AUTHENTICATION_REQUIRED",
      message: "Sign in to continue.",
    });
  }
  if (options.mutation) {
    if (
      !validateSameOrigin(request, serverEnvironment.NEXT_PUBLIC_APP_URL) ||
      !validCsrfProof(current.sessionId, request.headers.get("x-csrf-token"))
    ) {
      throw new AccountRequestError(403, {
        code: "REQUEST_FORBIDDEN",
        message: "Refresh the page and try again.",
      });
    }
  }
  const account = await prisma.userAccount.findUnique({
    where: { id: current.userId },
    select: { state: true },
  });
  if (account?.state !== "ACTIVE") {
    throw new AccountRequestError(403, {
      code: "ACCOUNT_UNAVAILABLE",
      message: "This account cannot perform that action.",
    });
  }
  return current;
}

export function accountJson(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init.headers).entries()),
      ...noStoreHeaders,
    },
  });
}

export function accountErrorResponse(error: unknown): Response {
  if (error instanceof AccountRequestError) {
    const body = accountErrorSchema.parse(error.body);
    return accountJson(body, {
      status: error.status,
      headers: body.retryAfterSeconds
        ? { "Retry-After": String(body.retryAfterSeconds) }
        : undefined,
    });
  }
  return accountJson(
    {
      code: "INTERNAL_ERROR",
      message: "The request could not be completed.",
    },
    { status: 503 },
  );
}
