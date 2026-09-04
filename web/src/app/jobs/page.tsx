import { headers } from "next/headers";
import { JobDiscoveryService } from "@/backend/services/jobs/job-discovery-service";
import { optionalJobActor } from "@/backend/security/job-request-boundary";
import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import {
  LiveJobSearchExperience,
  type JobsLiveCopy,
} from "@/frontend/features/jobs/components/live-job-search-experience";
import { listCandidateVisibleJobSearchTaxonomy } from "@/backend/services/jobs/job-search-taxonomy";
import { jobsPageQuery } from "./jobs-page-query";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const vietnameseCopy: JobsLiveCopy = {
  locale: "vi",
  kicker: "Không gian ứng viên",
  title: "Việc làm",
  intro:
    "Khám phá các cơ hội đã được xác minh và tìm công việc phù hợp với bước tiến tiếp theo của bạn.",
  jobs: "việc làm",
  openRoles: "vị trí đang tuyển",
  filters: "Bộ lọc việc làm",
  results: "Kết quả tìm kiếm",
  loadFailed: "Không thể tải việc làm",
  opportunities: "việc làm phù hợp",
  showing: "Đang hiển thị",
  of: "trên",
  tryAgain: "Danh sách việc làm tạm thời chưa thể tải. Vui lòng thử lại.",
  retry: "Thử lại",
  firstPage: "Trang đầu",
  previousPage: "Trang trước",
  nextPage: "Trang sau",
  lastPage: "Trang cuối",
  page: "Trang",
  perPage: "Mỗi trang:",
  resultPages: "Các trang kết quả việc làm",
  empty: "Không tìm thấy việc làm phù hợp",
  emptyCopy:
    "Hãy kiểm tra từ khóa hoặc nới rộng một vài tiêu chí để xem thêm cơ hội.",
  resetSearch: "Đặt lại tìm kiếm",
  emptyPage: "Không có việc làm ở trang này",
  emptyPageCopy: "Hãy quay lại trang đầu để xem các kết quả hiện có.",
  clear: "Xóa bộ lọc",
  searchResultsFor: "Đang hiển thị kết quả cho “{query}”.",
  includingRelatedTerm: "Đồng thời bao gồm “{term}”.",
  searchLiteral: "Tìm nguyên văn “{query}”",
  didYouMean: "Có phải bạn muốn tìm “{query}”?",
  searchSuggested: "Tìm “{query}”",
  undo: "Hoàn tác",
  literalMode: "Đang tìm nguyên văn “{query}”.",
  enableSmartSearch: "Bật tìm kiếm thông minh",
  interpretedAsOccupation: "Đã hiểu “{original}” là nghề “{occupation}”.",
  correctionHint: "Đã sửa từ “{query}”.",
  matchedFacets: "Tín hiệu khớp",
};

const englishCopy: JobsLiveCopy = {
  locale: "en",
  kicker: "Candidate workspace",
  title: "Jobs",
  intro:
    "Discover verified opportunities and find work that fits your next career move.",
  jobs: "jobs",
  openRoles: "open roles",
  filters: "Job filters",
  results: "Search results",
  loadFailed: "Jobs could not be loaded",
  opportunities: "matching jobs",
  showing: "Showing",
  of: "of",
  tryAgain: "The job list is temporarily unavailable. Please try again.",
  retry: "Try again",
  firstPage: "First page",
  previousPage: "Previous page",
  nextPage: "Next page",
  lastPage: "Last page",
  page: "Page",
  perPage: "Per page:",
  resultPages: "Job result pages",
  empty: "No jobs match these criteria",
  emptyCopy:
    "Try checking your keyword or widening one or more criteria to see more opportunities.",
  resetSearch: "Reset search",
  emptyPage: "No jobs on this page",
  emptyPageCopy: "Return to the first page to see the available results.",
  clear: "Clear filters",
  searchResultsFor: "Showing results for “{query}”.",
  includingRelatedTerm: "Also including “{term}”.",
  searchLiteral: "Search instead for “{query}”",
  didYouMean: "Did you mean “{query}”?",
  searchSuggested: "Search for “{query}”",
  undo: "Undo",
  literalMode: "Searching literally for “{query}”.",
  enableSmartSearch: "Enable smart search",
  interpretedAsOccupation: "Interpreted “{original}” as “{occupation}”.",
  correctionHint: "Corrected from “{query}”.",
  matchedFacets: "Matched signals",
};

export default async function JobsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const workspace = await getWorkspaceContext();
  const copy = workspace?.initialLocale === "vi" ? vietnameseCopy : englishCopy;
  const actor = await optionalJobActor(await headers());
  const initialQuery = jobsPageQuery(raw);
  const [search, taxonomy] = await Promise.all([
    new JobDiscoveryService()
      .search(initialQuery, actor)
      .then((result) => ({ result, error: null }))
      .catch(() => ({ result: null, error: copy.tryAgain })),
    listCandidateVisibleJobSearchTaxonomy().catch(() => ({
      industries: [],
      locations: [],
    })),
  ]);

  return (
    <div className="jobs-page">
      <LiveJobSearchExperience
        initialCriteria={initialQuery}
        initialResult={search.result}
        initialError={search.error}
        copy={copy}
        taxonomy={taxonomy}
      />
    </div>
  );
}
