import { listSearchSuggestions } from "@/backend/services/search/search-suggestions";
import { searchSuggestionsQuerySchema } from "@/shared/contracts/search/search-suggestions";
import { searchCatalogProvider } from "@/backend/services/search/catalogs/search-catalog-provider";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const allowed = new Set(["scope", "q", "limit"]);
    if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) {
      return Response.json(
        { error: { code: "SEARCH_SUGGESTIONS_INVALID" } },
        { status: 400 },
      );
    }
    const input = searchSuggestionsQuerySchema.parse({
      scope: url.searchParams.get("scope") ?? "JOBS",
      q: url.searchParams.get("q") ?? "",
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const catalog =
      input.scope === "JOBS"
        ? await searchCatalogProvider.getActiveSnapshot()
        : undefined;
    return Response.json(
      await listSearchSuggestions({
        ...input,
        ...(catalog ? { catalogIndex: catalog.index } : {}),
      }),
      {
        headers: {
          "cache-control": "private, max-age=0, must-revalidate",
        },
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return Response.json(
        { error: { code: "SEARCH_SUGGESTIONS_INVALID" } },
        { status: 400 },
      );
    }
    return Response.json(
      { error: { code: "SEARCH_SUGGESTIONS_UNAVAILABLE" } },
      { status: 500 },
    );
  }
}
