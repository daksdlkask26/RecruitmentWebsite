import {
  adminJson,
  adminListQuery,
  adminRouteError,
} from "@/backend/admin/http/admin-route";
import { SearchCatalogVersionAdminService } from "@/backend/admin/search/search-catalog-version-admin-service";
import { AdminRequestBoundary } from "@/backend/security/admin-request-boundary";

export async function GET(request: Request) {
  try {
    const authority = await new AdminRequestBoundary().require(request);
    const query = adminListQuery(request);
    const filter = query.filter;
    return adminJson(
      await new SearchCatalogVersionAdminService().list(authority, {
        page: query.page,
        perPage: query.perPage,
        q: typeof filter.q === "string" ? filter.q : undefined,
        status: typeof filter.status === "string" ? filter.status : undefined,
      }),
    );
  } catch (error) {
    return adminRouteError(error);
  }
}
