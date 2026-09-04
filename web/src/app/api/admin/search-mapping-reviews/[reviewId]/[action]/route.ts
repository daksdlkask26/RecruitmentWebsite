import {
  AdminHttpError,
  adminJson,
  adminRouteError,
  commandHeaders,
  parseAdminJson,
} from "@/backend/admin/http/admin-route";
import { SearchMappingReviewAdminService } from "@/backend/admin/search/search-mapping-review-admin-service";
import { AdminRequestBoundary } from "@/backend/security/admin-request-boundary";
import { searchMappingReviewCommandSchema } from "@/shared/contracts/admin/search-mapping-review";

const actionCommands = {
  approve: "APPROVE",
  reject: "REJECT",
  merge: "MERGE",
  "intentional-untranslated": "INTENTIONAL_UNTRANSLATED",
} as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ reviewId: string; action: string }> },
) {
  try {
    const authority = await new AdminRequestBoundary().require(request, {
      sensitive: true,
    });
    const { reviewId, action } = await context.params;
    const expected = actionCommands[action as keyof typeof actionCommands];
    if (!expected) throw new AdminHttpError(404, "TARGET_UNAVAILABLE");
    const command = await parseAdminJson(
      request,
      searchMappingReviewCommandSchema,
    );
    if (command.command !== expected)
      throw new AdminHttpError(400, "VALIDATION_FAILED");
    const headers = commandHeaders(request, { strictIfMatch: true });
    if (!headers.idempotencyKey || !Number.isInteger(headers.expectedVersion))
      throw new AdminHttpError(400, "VALIDATION_FAILED");
    return adminJson(
      await new SearchMappingReviewAdminService().command(
        authority,
        reviewId,
        command,
        headers.expectedVersion,
        headers.idempotencyKey,
      ),
    );
  } catch (error) {
    return adminRouteError(error);
  }
}
