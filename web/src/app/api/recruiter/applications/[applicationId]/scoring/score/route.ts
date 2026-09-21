import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AccountRequestError,
  accountErrorResponse,
  parseBoundedJson,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import { ApplicationScoringService } from "@/backend/scoring/services/application-scoring-service";

const noStore = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function isSchemaMismatch(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2022"
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
) {
  try {
    const current = await requireAccountRequest(request, { mutation: true });
    const raw = await parseBoundedJson(request, z.unknown(), 16 * 1024);
    const operation = await new ApplicationScoringService().request({
      userId: current.userId,
      sessionId: current.sessionId,
      applicationId: (await context.params).applicationId,
      idempotencyKey: request.headers.get("idempotency-key") ?? "",
      raw,
    });
    return NextResponse.json(operation, {
      status: 202,
      headers: noStore,
    });
  } catch (error) {
    if (error instanceof AccountRequestError)
      return accountErrorResponse(error);
    const message = error instanceof Error ? error.message : "";
    if (isSchemaMismatch(error)) {
      return NextResponse.json(
        {
          code: "DATABASE_SCHEMA_OUT_OF_DATE",
          message:
            "The scoring database schema is out of date. Apply the pending Prisma migrations and restart the application.",
        },
        { status: 503, headers: noStore },
      );
    }
    if (message === "APPLICATION_UNAVAILABLE") {
      return NextResponse.json(
        { code: "UNAVAILABLE", message: "The application is not available." },
        { status: 404, headers: noStore },
      );
    }
    if (message === "AI_ANALYSIS_CONSENT_REQUIRED") {
      return NextResponse.json(
        {
          code: "CONSENT_REQUIRED",
          message: "This candidate has not consented to AI scoring.",
        },
        { status: 409, headers: noStore },
      );
    }
    if (message === "IDEMPOTENCY_KEY_REQUIRED" || error instanceof z.ZodError) {
      return NextResponse.json(
        { code: "INVALID_REQUEST", message: "A request key is required." },
        { status: 400, headers: noStore },
      );
    }
    console.error(
      "[application-scoring] failed to queue single application",
      error,
    );
    return NextResponse.json(
      {
        code: "SCORING_REQUEST_FAILED",
        message: "The candidate could not be queued for scoring right now.",
      },
      { status: 500, headers: noStore },
    );
  }
}
