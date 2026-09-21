import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AccountRequestError,
  accountErrorResponse,
  parseBoundedJson,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import { JobRescoreService } from "@/backend/scoring/services/job-rescore-service";

const noStore = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const current = await requireAccountRequest(request, { mutation: true });
    const raw = await parseBoundedJson(request, z.unknown(), 16 * 1024);
    const operation = await new JobRescoreService().request({
      userId: current.userId,
      sessionId: current.sessionId,
      jobId: (await context.params).jobId,
      idempotencyKey: request.headers.get("idempotency-key") ?? "",
      raw,
    });
    return NextResponse.json(operation, { status: 202, headers: noStore });
  } catch (error) {
    if (error instanceof AccountRequestError)
      return accountErrorResponse(error);
    const code =
      error instanceof Error && error.message === "APPLICATION_UNAVAILABLE"
        ? "UNAVAILABLE"
        : "INVALID_REQUEST";
    return NextResponse.json(
      {
        code,
        message:
          code === "UNAVAILABLE"
            ? "Applications are not available."
            : "Confirm the background rescore and provide valid versions.",
      },
      { status: code === "UNAVAILABLE" ? 404 : 400, headers: noStore },
    );
  }
}
