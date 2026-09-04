import {
  adminListQuery,
  adminJson,
  adminRouteError,
} from "@/backend/admin/http/admin-route";
import { SearchMappingReviewAdminService } from "@/backend/admin/search/search-mapping-review-admin-service";
import { AdminRequestBoundary } from "@/backend/security/admin-request-boundary";

export async function GET(request: Request) {
  try {
    const authority = await new AdminRequestBoundary().require(request);
    const query = adminListQuery(request);
    const filter = query.filter;
    return adminJson(
      await new SearchMappingReviewAdminService().list(authority, {
        page: query.page,
        perPage: query.perPage,
        q: typeof filter.q === "string" ? filter.q : undefined,
        status: typeof filter.status === "string" ? filter.status : undefined,
        catalogScope:
          filter.catalogScope === "ALL" || filter.catalogScope === "ACTIVE"
            ? filter.catalogScope
            : undefined,
      }),
    );
  } catch (error) {
    return adminRouteError(error);
  }
}
