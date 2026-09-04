"use client";

import type { ImageSearchFallbackReason } from "../client/use-image-search";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { ImagePlus, Search } from "lucide-react";
import { useEffect, useState } from "react";

const fallbackContent: Record<
  ImageSearchFallbackReason,
  { heading: string; description: string }
> = {
  LOW_CONFIDENCE: {
    heading: "Image text was not clear enough",
    description:
      "OpenAI did not receive sufficiently reliable text to create job filters. Try a clearer image.",
  },
  INTERPRETER_UNAVAILABLE: {
    heading: "AI filter suggestions are unavailable",
    description:
      "OpenAI could not create filter suggestions for this image. No recognized text was added to your search.",
  },
  INTERPRETER_INVALID_OUTPUT: {
    heading: "AI filters need another attempt",
    description:
      "The AI response could not be converted into supported job filters. No recognized text was added to your search.",
  },
  UNKNOWN: {
    heading: "No compatible AI filters were created",
    description:
      "This image did not produce supported job filters. No recognized text was added to your search.",
  },
};

export function ImageSearchRecovery({
  error,
  fallbackReason,
  retryAt,
  onRetry,
  onManual,
}: {
  error: string | null;
  fallbackReason: ImageSearchFallbackReason | null;
  retryAt?: string | null;
  onRetry(): void;
  onManual(): void;
}) {
  const vi = useWorkspaceLocale() === "vi";
  const [now, setNow] = useState(() => Date.now());
  const retryDate = retryAt ? new Date(retryAt) : null;
  const retryTimestamp = retryDate?.getTime() ?? Number.NaN;
  useEffect(() => {
    if (!Number.isFinite(retryTimestamp) || retryTimestamp <= now) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(retryTimestamp - now, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [now, retryTimestamp]);
  const retryLabel =
    retryDate && !Number.isNaN(retryDate.getTime())
      ? retryDate.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  const retryBlocked = Number.isFinite(retryTimestamp) && retryTimestamp > now;

  const actions = (manualLabel: string) => (
    <div className="image-search-recovery-actions">
      <button
        className="image-search-recovery-primary"
        type="button"
        disabled={retryBlocked}
        onClick={onRetry}
      >
        <ImagePlus aria-hidden="true" />
        {vi ? "Thử hình ảnh khác" : "Try another image"}
      </button>
      <button
        className="image-search-recovery-secondary"
        type="button"
        onClick={() => onManual()}
      >
        <Search aria-hidden="true" />
        {manualLabel}
      </button>
    </div>
  );

  if (fallbackReason) {
    const content = vi
      ? {
          LOW_CONFIDENCE: {
            heading: "Văn bản trong ảnh chưa đủ rõ",
            description:
              "Không có bộ lọc nào được thêm. Hãy thử một hình ảnh rõ hơn.",
          },
          INTERPRETER_UNAVAILABLE: {
            heading: "Chưa thể đề xuất bộ lọc",
            description:
              "Không có văn bản nhận dạng nào được thêm vào tìm kiếm của bạn.",
          },
          INTERPRETER_INVALID_OUTPUT: {
            heading: "Cần thử lại để tạo bộ lọc",
            description:
              "Kết quả chưa thể chuyển thành bộ lọc được hỗ trợ. Tìm kiếm hiện tại vẫn giữ nguyên.",
          },
          UNKNOWN: {
            heading: "Không tìm thấy bộ lọc phù hợp",
            description:
              "Hình ảnh này không tạo được bộ lọc được hỗ trợ. Tìm kiếm hiện tại vẫn giữ nguyên.",
          },
        }[fallbackReason]
      : fallbackContent[fallbackReason];
    return (
      <div
        role="status"
        className="image-search-recovery image-search-recovery-warning"
      >
        <h3>{content.heading}</h3>
        <p>{content.description}</p>
        {actions(vi ? "Tiếp tục tìm việc" : "Continue to Find jobs")}
      </div>
    );
  }
  if (!error) return null;
  return (
    <div
      role="alert"
      className="image-search-recovery image-search-recovery-error"
    >
      <h3>
        {vi
          ? "Tìm kiếm bằng hình ảnh chưa khả dụng"
          : "Image search unavailable"}
      </h3>
      <p>{error}</p>
      {retryLabel ? (
        <p className="image-search-recovery-retry-detail">
          {vi ? `Thử lại sau ${retryLabel}.` : `Try again after ${retryLabel}.`}
        </p>
      ) : null}
      <p>
        {vi
          ? "Bạn vẫn có thể tìm kiếm bằng văn bản."
          : "Ordinary text search is still available."}
      </p>
      {actions(vi ? "Tìm kiếm thủ công" : "Search manually")}
    </div>
  );
}
