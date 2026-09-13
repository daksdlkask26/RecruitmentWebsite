import {
  accountErrorResponse,
  accountJson,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import {
  TeamApplicationOwnerError,
  TeamApplicationOwnerService,
} from "@/backend/services/company-members/team-application-owner-service";

export async function GET(request: Request) {
  try {
    const account = await requireAccountRequest(request);
    const companyId =
      new URL(request.url).searchParams.get("companyId") ?? undefined;
    const searchParams = new URL(request.url).searchParams;
    searchParams.delete("companyId");
    return accountJson(
      await new TeamApplicationOwnerService().list(
        account.userId,
        companyId,
        Object.fromEntries(searchParams.entries()),
      ),
    );
  } catch (error) {
    if (error instanceof TeamApplicationOwnerError) {
      return accountJson(
        { code: error.code, message: "Owner access is required." },
        {
          status:
            error.code === "TEAM_OWNER_FORBIDDEN"
              ? 403
              : error.code === "TEAM_APPLICATION_LIST_REQUEST_INVALID" ||
                  error.code === "TEAM_APPLICATION_CURSOR_INVALID"
                ? 400
                : 404,
        },
      );
    }
    return accountErrorResponse(error);
  }
}
