import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AccountRequestError,
  accountErrorResponse,
  parseBoundedJson,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import { AiRetryService } from "@/backend/scoring/services/ai-retry-service";

const noStore = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
) {
  try {
    const current = await requireAccountRequest(request, { mutation: true });
    const raw = await parseBoundedJson(request, z.unknown(), 16 * 1024);
    const result = await new AiRetryService().request({
      userId: current.userId,
      sessionId: current.sessionId,
      applicationId: (await context.params).applicationId,
      idempotencyKey: request.headers.get("idempotency-key") ?? "",
      raw,
    });
    return NextResponse.json(result, { status: 202, headers: noStore });
  } catch (error) {
    if (error instanceof AccountRequestError)
      return accountErrorResponse(error);
    const unavailable =
      error instanceof Error && error.message === "APPLICATION_UNAVAILABLE";
    return NextResponse.json(
      {
        code: unavailable ? "UNAVAILABLE" : "INVALID_REQUEST",
        message: unavailable
          ? "The application is not available."
          : "AI retry is not available in the current state.",
      },
      { status: unavailable ? 404 : 409, headers: noStore },
    );
  }
}
