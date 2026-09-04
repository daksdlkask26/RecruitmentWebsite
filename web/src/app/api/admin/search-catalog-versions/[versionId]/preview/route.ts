import { adminJson, adminRouteError } from "@/backend/admin/http/admin-route";
import { SearchCatalogVersionAdminService } from "@/backend/admin/search/search-catalog-version-admin-service";
import { AdminRequestBoundary } from "@/backend/security/admin-request-boundary";

export async function GET(
  request: Request,
  context: { params: Promise<{ versionId: string }> },
) {
  try {
    const authority = await new AdminRequestBoundary().require(request);
    const { versionId } = await context.params;
    return adminJson(
      await new SearchCatalogVersionAdminService().preview(
        authority,
        versionId,
      ),
    );
  } catch (error) {
    return adminRouteError(error);
  }
}
