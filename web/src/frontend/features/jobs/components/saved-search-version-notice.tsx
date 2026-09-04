"use client";

import type { SavedFilterPreset } from "@/shared/contracts/jobs/catalog";
import type {
  SearchInterpretation,
  SearchMetadata,
} from "@/shared/contracts/search/search-interpretation";
import { assessSavedSearchVersion } from "@/shared/utils/jobs/saved-search-version-policy";

export function SavedSearchVersionNotice({
  preset,
  interpretation,
  metadata,
  locale,
}: {
  preset: SavedFilterPreset | null;
  interpretation?: SearchInterpretation;
  metadata?: SearchMetadata;
  locale: "vi" | "en";
}) {
  if (!preset) return null;
  const assessment = assessSavedSearchVersion({
    saved: preset,
    currentCatalogVersion: metadata?.catalogVersion,
    currentResolverVersion: metadata?.resolverVersion,
    currentInterpretation: interpretation,
  });
  if (!assessment.needsReview) return null;

  const message =
    assessment.state === "AMBIGUOUS"
      ? locale === "vi"
        ? "Tìm kiếm đã lưu hiện có nhiều cách hiểu. Hãy kiểm tra lại diễn giải và bộ lọc trước khi tiếp tục."
        : "This saved search is now ambiguous. Review the interpretation and filters before continuing."
      : assessment.state === "MEANING_CHANGED"
        ? locale === "vi"
          ? "Ý nghĩa tìm kiếm đã thay đổi sau khi phân giải lại. Hãy kiểm tra các chip diễn giải trước khi tiếp tục."
          : "The search meaning changed after re-resolution. Review the interpretation chips before continuing."
        : assessment.state === "STALE"
          ? locale === "vi"
            ? "Tìm kiếm này được lưu bằng phiên bản bộ giải hoặc catalog cũ. Hệ thống đã phân giải lại; hãy kiểm tra kết quả."
            : "This search was saved with an older resolver or catalog. It was re-resolved; review the result before continuing."
          : locale === "vi"
            ? "Đây là tìm kiếm cũ chưa có phiên bản diễn giải. Hệ thống sẽ phân giải lại theo catalog hiện tại."
            : "This is a legacy saved search without resolver metadata. It will be re-resolved with the current catalog.";

  return (
    <p className="job-save-filter-notice" role="status" aria-live="polite">
      {message}
    </p>
  );
}
