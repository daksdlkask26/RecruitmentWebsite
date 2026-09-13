import {
  accountErrorResponse,
  accountJson,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import {
  TeamApplicationOwnerError,
  TeamApplicationOwnerService,
} from "@/backend/services/company-members/team-application-owner-service";

export async function GET(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
) {
  try {
    const account = await requireAccountRequest(request);
    const { applicationId } = await context.params;
    const companyId =
      new URL(request.url).searchParams.get("companyId") ?? undefined;
    return accountJson(
      await new TeamApplicationOwnerService().get(
        account.userId,
        applicationId,
        companyId,
      ),
    );
  } catch (error) {
    if (error instanceof TeamApplicationOwnerError) {
      return accountJson(
        { code: error.code, message: "This team application is unavailable." },
        { status: error.code === "TEAM_OWNER_FORBIDDEN" ? 403 : 404 },
      );
    }
    return accountErrorResponse(error);
  }
}
