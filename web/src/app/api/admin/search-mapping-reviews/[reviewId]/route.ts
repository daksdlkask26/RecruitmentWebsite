import { adminJson, adminRouteError } from "@/backend/admin/http/admin-route";
import { SearchMappingReviewAdminService } from "@/backend/admin/search/search-mapping-review-admin-service";
import { AdminRequestBoundary } from "@/backend/security/admin-request-boundary";

export async function GET(
  request: Request,
  context: { params: Promise<{ reviewId: string }> },
) {
  try {
    const authority = await new AdminRequestBoundary().require(request);
    const { reviewId } = await context.params;
    return adminJson(
      await new SearchMappingReviewAdminService().detail(authority, reviewId),
    );
  } catch (error) {
    return adminRouteError(error);
  }
}
