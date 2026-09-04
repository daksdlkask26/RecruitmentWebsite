import {
  AdminHttpError,
  adminJson,
  adminRouteError,
  commandHeaders,
  parseAdminJson,
} from "@/backend/admin/http/admin-route";
import { SearchCatalogVersionAdminService } from "@/backend/admin/search/search-catalog-version-admin-service";
import { AdminRequestBoundary } from "@/backend/security/admin-request-boundary";
import { searchCatalogVersionCommandSchema } from "@/shared/contracts/admin/search-catalog-version";

const actionCommands = {
  publish: "PUBLISH",
  rollback: "ROLLBACK",
  retire: "RETIRE",
} as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ versionId: string; action: string }> },
) {
  try {
    const authority = await new AdminRequestBoundary().require(request, {
      sensitive: true,
    });
    const { versionId, action } = await context.params;
    const expected = actionCommands[action as keyof typeof actionCommands];
    if (!expected) throw new AdminHttpError(404, "TARGET_UNAVAILABLE");
    const command = await parseAdminJson(
      request,
      searchCatalogVersionCommandSchema,
    );
    if (command.command !== expected)
      throw new AdminHttpError(400, "VALIDATION_FAILED");
    const headers = commandHeaders(request, { strictIfMatch: true });
    if (!headers.idempotencyKey || !Number.isInteger(headers.expectedVersion))
      throw new AdminHttpError(400, "VALIDATION_FAILED");
    return adminJson(
      await new SearchCatalogVersionAdminService().command(
        authority,
        versionId,
        command,
        headers.expectedVersion,
        headers.idempotencyKey,
      ),
    );
  } catch (error) {
    return adminRouteError(error);
  }
}
