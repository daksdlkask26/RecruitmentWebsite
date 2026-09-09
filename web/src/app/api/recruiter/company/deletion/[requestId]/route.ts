import {
  AccountRequestError,
  accountErrorResponse,
  accountJson,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import { getCompanyDeletionReceipt } from "@/backend/services/jobs/company-deletion-manifest-service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };

function notFound() {
  // Keep this response identical for an unknown request and a request owned by
  // another account. The body contains no company, report, or object data.
  return accountJson(
    { code: "COMPANY_DELETION_NOT_FOUND" },
    { status: 404 },
  );
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const actor = await requireAccountRequest(request);
    const { requestId } = await context.params;
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(requestId)) return notFound();
    const receipt = await getCompanyDeletionReceipt(requestId, actor.userId);
    return receipt ? accountJson(receipt) : notFound();
  } catch (error) {
    if (error instanceof AccountRequestError) return accountErrorResponse(error);
    return notFound();
  }
}
