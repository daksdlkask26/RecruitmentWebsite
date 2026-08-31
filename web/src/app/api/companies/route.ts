import {
  accountErrorResponse,
  accountJson,
  AccountRequestError,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import { CompanyDiscoveryService } from "@/backend/services/companies/company-discovery-service";
import { companyListQuerySchema } from "@/shared/contracts/company";

export async function GET(request: Request) {
  try {
    await requireAccountRequest(request);
    const params = new URL(request.url).searchParams;
    const parsed = companyListQuerySchema.safeParse({
      q: params.get("q") ?? undefined,
      location: params.get("location") ?? undefined,
      page: params.get("page") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      throw new AccountRequestError(400, {
        code: "VALIDATION_ERROR",
        message: "Review the company list filters.",
      });
    }
    return accountJson(
      await new CompanyDiscoveryService().list({
        q: parsed.data.q,
        location: parsed.data.location,
        page: parsed.data.page,
        limit: parsed.data.limit,
      }),
    );
  } catch (error) {
    return accountErrorResponse(error);
  }
}
