import { z } from "zod";
import { NextResponse } from "next/server";
import {
  requireAccountRequest,
  accountErrorResponse,
  parseBoundedJson,
} from "@/backend/security/account-request-boundary";
import { UpdateContactConsentService } from "@/backend/applications/services/update-contact-consent";

const consentSchema = z
  .object({
    shared: z.boolean(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
) {
  try {
    const current = await requireAccountRequest(request, { mutation: true });
    const { applicationId } = await context.params;
    const input = await parseBoundedJson(request, consentSchema, 1024);
    const result = await new UpdateContactConsentService().execute({
      applicationId,
      userId: current.userId,
      sessionId: current.sessionId,
      shared: input.shared,
      expectedVersion: input.expectedVersion,
    });
    if (result.kind === "NOT_FOUND")
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Application is not available." },
        { status: 404, headers: { "Cache-Control": "private, no-store" } },
      );
    if (result.kind === "CONFLICT") {
      return NextResponse.json(
        {
          code: "CONFLICT",
          message: "Contact sharing changed. Refresh and try again.",
        },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return NextResponse.json(
      { shared: result.shared, version: result.version },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return accountErrorResponse(error);
  }
}
