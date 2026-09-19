import {
  AccountRequestError,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import {
  PrivateCvMatchError,
  PrivateCvMatchService,
} from "@/backend/private-cv-match/private-cv-match-service";
import {
  PrivateMatchProjectionError,
  projectPrivateMatchCheck,
} from "@/backend/private-cv-match/private-match-projection";
import { privateMatchErrorResponseSchema } from "@/shared/contracts/private-cv-match";

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

type RouteContext = { params: Promise<{ checkId: string }> };

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const actor = await requireAccountRequest(request);
    const check = await new PrivateCvMatchService().get(
      actor.userId,
      (await context.params).checkId,
    );
    return Response.json(projectPrivateMatchCheck(check), { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const actor = await requireAccountRequest(request, { mutation: true });
    await new PrivateCvMatchService().delete(
      actor.userId,
      (await context.params).checkId,
    );
    return new Response(null, { status: 204, headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
