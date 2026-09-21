import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/backend/auth/session/require-session";
import {
  AccountRequestError,
  accountErrorResponse,
  parseBoundedJson,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import { ManualPriorityService } from "@/backend/scoring/services/manual-priority-service";

const noStore = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
) {
  const current = await requireSession(request.headers);
  if (!current)
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "Authentication required." },
      { status: 401, headers: noStore },
    );
  try {
    return NextResponse.json(
      await new ManualPriorityService().current(
        current.userId,
        (await context.params).applicationId,
      ),
      { headers: noStore },
    );
  } catch {
    return NextResponse.json(
      { code: "UNAVAILABLE", message: "The application is not available." },
      { status: 404, headers: noStore },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
) {
  try {
    const current = await requireAccountRequest(request, { mutation: true });
    const raw = await parseBoundedJson(request, z.unknown(), 16 * 1024);
    const params = await context.params;
    const service = new ManualPriorityService();
    const record =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;
    const removeRaw = record
      ? Object.fromEntries(
          Object.entries(record).filter(([key]) => key !== "action"),
        )
      : raw;
    const result =
      record?.action === "remove"
        ? await service.remove({
            userId: current.userId,
            sessionId: current.sessionId,
            applicationId: params.applicationId,
            raw: removeRaw,
          })
        : await service.set({
            userId: current.userId,
            sessionId: current.sessionId,
            applicationId: params.applicationId,
            raw,
          });
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    if (error instanceof AccountRequestError)
      return accountErrorResponse(error);
    const unavailable =
      error instanceof Error && error.message === "APPLICATION_UNAVAILABLE";
    const conflict =
      error instanceof Error && error.message === "PRIORITY_CONFLICT";
    return NextResponse.json(
      {
        code: unavailable
          ? "UNAVAILABLE"
          : conflict
            ? "CONFLICT"
            : "INVALID_REQUEST",
        message: unavailable
          ? "The application is not available."
          : conflict
            ? "This priority changed. Refresh before saving."
            : "Select a priority and enter a reason before saving.",
      },
      { status: unavailable ? 404 : conflict ? 409 : 400, headers: noStore },
    );
  }
}
