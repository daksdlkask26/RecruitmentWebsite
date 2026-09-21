"use client";

import { useSyncExternalStore } from "react";
import { TopBar } from "@/frontend/components/layout/top-bar";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { JOB_SEARCH_CRITERIA_CHANGED_EVENT } from "./job-search-events";

export const jobsWorkspaceTabs = [
  { id: "search", href: "/jobs" },
  { id: "saved", href: "/jobs/saved" },
  { id: "matches", href: "/jobs/matches" },
  { id: "settings", href: "/jobs/settings" },
] as const;

export type JobsWorkspaceTab = (typeof jobsWorkspaceTabs)[number]["id"];

function subscribeToSearchChanges(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(JOB_SEARCH_CRITERIA_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(JOB_SEARCH_CRITERIA_CHANGED_EVENT, onChange);
  };
}

function getSearchSnapshot() {
  return window.location.search;
}

function getServerSearchSnapshot() {
  return "";
}

export function JobsWorkspaceNav({
  activeTab,
}: {
  activeTab: JobsWorkspaceTab;
}) {
  const locale = useWorkspaceLocale();
  const searchParams = new URLSearchParams(
    useSyncExternalStore(
      subscribeToSearchChanges,
      getSearchSnapshot,
      getServerSearchSnapshot,
    ),
  );
  const sharedSearch = new URLSearchParams();
  for (const name of ["q", "searchMode", "location", "district"]) {
    for (const value of searchParams.getAll(name)) {
      if (value) sharedSearch.append(name, value);
    }
  }
  const sharedSearchSuffix = sharedSearch.size
    ? `?${sharedSearch.toString()}`
    : "";
  const labels =
    locale === "vi"
      ? {
          search: "Tìm việc",
          saved: "Việc đã lưu",
          matches: "Việc làm đề xuất",
          settings: "Cài đặt gợi ý việc làm",
          navigation: "Điều hướng việc làm",
        }
      : {
          search: "Find jobs",
          saved: "Saved Jobs",
          matches: "Suggested Jobs",
          settings: "Job Recommendation Settings",
          navigation: "Jobs navigation",
        };

  return (
    <TopBar
      className="jobs-workspace-nav"
      ariaLabel={labels.navigation}
      tabs={jobsWorkspaceTabs.map((tab) => ({
        href: `${tab.href}${sharedSearchSuffix}`,
        label: labels[tab.id],
        active: activeTab === tab.id,
      }))}
    />
  );
}

export function JobsWorkspace({
  activeTab,
  children,
}: {
  activeTab?: Exclude<JobsWorkspaceTab, "search">;
  children: React.ReactNode;
}) {
  return (
    <div className="jobs-workspace-page">
      {activeTab ? <JobsWorkspaceNav activeTab={activeTab} /> : null}
      <div className="jobs-workspace-content">{children}</div>
    </div>
  );
}
