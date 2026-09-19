import {
  AccountRequestError,
  parseBoundedJson,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import {
  PrivateCvMatchError,
  PrivateCvMatchService,
} from "@/backend/private-cv-match/private-cv-match-service";
import {
  PrivateMatchProjectionError,
  projectPrivateMatchStatus,
} from "@/backend/private-cv-match/private-match-projection";
import {
  createPrivateMatchRequestSchema,
  privateMatchErrorResponseSchema,
  privateMatchListResponseSchema,
} from "@/shared/contracts/private-cv-match";

const noStore = { "Cache-Control": "no-store" };

function errorResponse(error: unknown): Response {
  if (error instanceof PrivateMatchProjectionError) {
    return Response.json(
      privateMatchErrorResponseSchema.parse({ code: "UNAVAILABLE" }),
      { status: 404, headers: noStore },
    );
  }
  if (error instanceof PrivateCvMatchError) {
    return Response.json(
      privateMatchErrorResponseSchema.parse({ code: error.code }),
      {
        status: error.status,
        headers: noStore,
      },
    );
  }
  if (error instanceof AccountRequestError) {
    const code =
      error.status === 401
        ? "AUTH_REQUIRED"
        : error.status === 403
          ? "FORBIDDEN"
          : "INVALID_REQUEST";
    return Response.json({ code }, { status: error.status, headers: noStore });
  }
  return Response.json(
    { code: "INTERNAL_FAILURE" },
    { status: 503, headers: noStore },
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireAccountRequest(request, { mutation: true });
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    const body = await parseBoundedJson(
      request,
      createPrivateMatchRequestSchema,
      16 * 1024,
    );
    const result = await new PrivateCvMatchService().create(
      actor.userId,
      body,
      idempotencyKey,
    );
    return Response.json(projectPrivateMatchStatus(result.check), {
      status: result.replay ? 200 : 202,
      headers: noStore,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireAccountRequest(request);
    const result = await new PrivateCvMatchService().list(actor.userId);
    return Response.json(privateMatchListResponseSchema.parse(result), {
      headers: noStore,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
