import {
  accountErrorResponse,
  accountJson,
  AccountRequestError,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import { CompanyJobSearchService } from "@/backend/services/companies/company-job-search-service";
import { CompanyDiscoveryAuthorizationError } from "@/backend/services/companies/company-discovery-authorization";
import { companyJobSearchQuerySchema } from "@/shared/contracts/company";

export async function GET(
  request: Request,
  context: { params: Promise<{ companyId: string }> },
) {
  try {
    const account = await requireAccountRequest(request);
    const { companyId } = await context.params;
    const params = new URL(request.url).searchParams;
    const parsed = companyJobSearchQuerySchema.safeParse({
      q: params.get("q") ?? undefined,
      searchMode: params.get("searchMode") ?? undefined,
      location: params.get("location") ?? undefined,
      page: params.get("page") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      throw new AccountRequestError(400, {
        code: "VALIDATION_ERROR",
        message: "Review the company job filters.",
      });
    }
    return accountJson(
      await new CompanyJobSearchService().search(companyId, parsed.data, {
        kind: "user",
        userId: account.userId,
        sessionId: account.sessionId,
      }),
    );
  } catch (error) {
    if (error instanceof CompanyDiscoveryAuthorizationError) {
      return accountJson(
        {
          code: "COMPANY_UNAVAILABLE",
          message: "This company is not available.",
        },
        { status: 404 },
      );
    }
    return accountErrorResponse(error);
  }
}
