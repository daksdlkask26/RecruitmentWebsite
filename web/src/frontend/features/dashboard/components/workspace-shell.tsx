"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { postWithCurrentCsrf } from "@/frontend/features/authentication/client/current-csrf-proof";
import { CsrfProofProvider } from "@/frontend/features/authentication/client/csrf-proof-context";
import { AuthStatus } from "@/frontend/features/authentication/components/auth-status";
import { SmartHireBrand } from "@/frontend/components/ui/smarthire-brand";
import { ThemeToggle } from "@/frontend/components/ui/theme-toggle";
import {
  ACCOUNT_NAME_UPDATED_EVENT,
  type AccountNameUpdatedDetail,
} from "@/frontend/features/profile/client/account-identity-events";
import {
  useWorkspaceLocale,
  WorkspaceLocaleProvider,
  type WorkspaceLocale,
} from "../client/workspace-locale";
import { WorkspaceNavigation } from "./workspace-navigation";
import { closeMessagingConnectionOnLogout } from "@/frontend/features/messaging/client/use-chat-connection";
import { AppProviders } from "@/frontend/providers/app-providers";

import { RecruiterHeaderAction } from "@/frontend/features/recruiter-header/components/recruiter-header-action";
import type { RecruiterHeaderStatus } from "@/shared/contracts/recruiter-header-status";
import type { RecruiterJobManagementData } from "@/shared/contracts/recruiter-job-posting";
import { recruiterRoutes } from "@/shared/routing/recruiter-routes";
import {
  WORKSPACE_MODE_COOKIE,
  type WorkspaceMode,
} from "@/shared/utils/workspace-mode";
import {
  RecruiterJobPostingManagement,
  RecruiterWorkspaceNavigation,
} from "@/frontend/features/recruiter-workspace/job-posting-management";
import { NotificationCenter } from "@/frontend/features/notifications/components/notification-center";
import { UnsavedChangesNavigationDialog } from "@/frontend/features/profile/client/unsaved-changes";
import {
  getAccountInitials,
  getCandidateGreetingName,
} from "./workspace-greeting";
const SIDEBAR_MINIMUM_WIDTH = 220;
const SIDEBAR_WIDTH_STEP = 16;
const SIDEBAR_MAXIMUM_FALLBACK_WIDTH = 360;

function clampSidebarWidth(width: number, maximumWidth: number) {
  return Math.min(Math.max(width, SIDEBAR_MINIMUM_WIDTH), maximumWidth);
}

export function WorkspaceShell({
  children,
  initialRecruiterStatus,
  csrfProof,
  profile = { name: "SmartHire member", email: "" },
  initialLocale = "en",
  contentMode = "default",
  initialWorkspaceMode = "candidate",
  initialRecruiterJobData,
  recruiterContent,
}: {
  children: React.ReactNode;
  initialRecruiterStatus?: RecruiterHeaderStatus | null;
  csrfProof: string;
  profile?: {
    name: string;
    email: string;
    image?: string | null;
  };
  initialLocale?: WorkspaceLocale;
  contentMode?: "default" | "job-board";
  initialWorkspaceMode?: "candidate" | "recruiter";
  initialRecruiterJobData?: RecruiterJobManagementData | null;
  recruiterContent?: React.ReactNode;
}) {
  return (
    <AppProviders>
      <WorkspaceLocaleProvider initialLocale={initialLocale}>
        <WorkspaceShellContent
          csrfProof={csrfProof}
          initialRecruiterStatus={initialRecruiterStatus}
          profile={profile}
          contentMode={contentMode}
          initialWorkspaceMode={initialWorkspaceMode}
          initialRecruiterJobData={initialRecruiterJobData}
          recruiterContent={recruiterContent}
        >
          {children}
        </WorkspaceShellContent>
      </WorkspaceLocaleProvider>
    </AppProviders>
  );
}

function WorkspaceShellContent({
  children,
  initialRecruiterStatus,
  csrfProof,
  profile,
  contentMode,
  initialWorkspaceMode,
  initialRecruiterJobData,
  recruiterContent,
}: {
  children: React.ReactNode;
  initialRecruiterStatus?: RecruiterHeaderStatus | null;
  csrfProof: string;
  profile: {
    name: string;
    email: string;
    image?: string | null;
  };
  contentMode: "default" | "job-board";
  initialWorkspaceMode: "candidate" | "recruiter";
  initialRecruiterJobData?: RecruiterJobManagementData | null;
  recruiterContent?: React.ReactNode;
}) {
  const router = useRouter();
  const locale = useWorkspaceLocale();
  const [busy, setBusy] = useState(false);
  const [navigating, startNavigation] = useTransition();
  const [status, setStatus] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const workspaceMode = initialWorkspaceMode;
  const candidateJobBoard =
    workspaceMode === "candidate" && contentMode === "job-board";
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_MINIMUM_WIDTH);
  const [sidebarMaximumWidth, setSidebarMaximumWidth] = useState(
    SIDEBAR_MAXIMUM_FALLBACK_WIDTH,
  );
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarResizeSession = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    const synchronizeName = (event: Event) => {
      const name = (event as CustomEvent<AccountNameUpdatedDetail>).detail
        ?.name;
      if (typeof name !== "string" || !name.trim()) return;
      setNameOverride(name);
      router.refresh();
    };
    window.addEventListener(ACCOUNT_NAME_UPDATED_EVENT, synchronizeName);
    return () =>
      window.removeEventListener(ACCOUNT_NAME_UPDATED_EVENT, synchronizeName);
  }, [router]);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    const updateMaximumWidth = () => {
      if (sidebar.dataset.collapsed === "true") return;
      const itemWidths = Array.from(
        sidebar.querySelectorAll<HTMLElement>(
          ".workspace-navigation a, .workspace-navigation button",
        ),
        (item) => item.scrollWidth,
      );
      const widthSizer = sidebar.querySelector<HTMLElement>(
        ".workspace-sidebar-width-sizer",
      );
      const sidebarStyles = window.getComputedStyle(sidebar);
      const horizontalPadding =
        (Number.parseFloat(sidebarStyles.paddingLeft) || 0) +
        (Number.parseFloat(sidebarStyles.paddingRight) || 0);
      const maximumWidth = Math.max(
        SIDEBAR_MINIMUM_WIDTH,
        Math.ceil(
          Math.max(0, ...itemWidths, widthSizer?.scrollWidth ?? 0) +
            horizontalPadding,
        ),
      );

      setSidebarMaximumWidth(maximumWidth);
      setSidebarWidth((width) => clampSidebarWidth(width, maximumWidth));
    };

    const animationFrame = window.requestAnimationFrame(updateMaximumWidth);
    window.addEventListener("resize", updateMaximumWidth);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updateMaximumWidth);
    };
  }, [locale]);

  const workspaceProfile = nameOverride
    ? { ...profile, name: nameOverride }
    : profile;

  const avatar = /^data:image\/(?:png|jpeg);base64,/u.test(
    workspaceProfile.image ?? "",
  )
    ? workspaceProfile.image
    : null;
  const greetingName = getCandidateGreetingName(workspaceProfile.name);
  const accountInitials = getAccountInitials(workspaceProfile.name);
  const copy = getWorkspaceCopy(locale, workspaceProfile.name);
  function getWorkspaceCopy(currentLocale: WorkspaceLocale, name: string) {
    return currentLocale === "vi"
      ? {
          product: "Không gian nhân tài",
          sidebar: "Thanh bên không gian làm việc",
          expand: "Mở rộng thanh bên",
          collapse: "Thu gọn thanh bên",
          workspace: "Không gian ứng viên",
          greeting: "Chào mừng trở lại",
          recruiterWorkspace: "Không gian nhà tuyển dụng",
          recruiterGreeting: "Quản lý quy trình tuyển dụng",
          candidateWorkspace: "Không gian ứng viên",
          openProfile: `Mở hồ sơ của ${name}`,
          manageProfile: "Quản lý hồ sơ",
          signOutError: "Không thể đăng xuất. Hãy thử lại.",
          resizeSidebar: "Điều chỉnh kích thước thanh bên",
          widthOf: "trên",
          resizeSidebarHint:
            "Kéo để điều chỉnh kích thước. Nhấp đúp để đặt lại độ rộng mặc định.",
        }
      : {
          product: "Talent workspace",
          sidebar: "Workspace sidebar",
          expand: "Expand workspace sidebar",
          collapse: "Collapse workspace sidebar",
          workspace: "Candidate workspace",
          greeting: "Welcome back",
          recruiterWorkspace: "Recruiter workspace",
          recruiterGreeting: "Manage your hiring workflow",
          candidateWorkspace: "Candidate workspace",
          openProfile: `Open profile for ${name}`,
          manageProfile: "Manage profile",
          signOutError: "Unable to sign out. Please try again.",
          resizeSidebar: "Resize workspace sidebar",
          widthOf: "of",
          resizeSidebarHint:
            "Drag to resize. Double-click to reset the default width.",
        };
  }

  const accountTitle = workspaceProfile.name;

  function persistWorkspaceMode(mode: WorkspaceMode) {
    if (mode === "recruiter") openRecruiterWorkspace();
    else openCandidateWorkspace();
  }

  function clearPersistedWorkspaceMode() {
    document.cookie = `${WORKSPACE_MODE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  }

  function openRecruiterWorkspace() {
    document.cookie = `${WORKSPACE_MODE_COOKIE}=recruiter; Path=/; Max-Age=31536000; SameSite=Lax`;
    startNavigation(() => router.push(recruiterRoutes.jobPostings));
  }

  function openCandidateWorkspace() {
    clearPersistedWorkspaceMode();
    startNavigation(() => router.push("/dashboard"));
  }

  async function signOut() {
    if (busy || navigating) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await postWithCurrentCsrf(
        "/api/identity/logout",
        csrfProof,
      );
      if (!response.ok) {
        setStatus(copy.signOutError);
        return;
      }
      closeMessagingConnectionOnLogout();
      clearPersistedWorkspaceMode();
      startNavigation(() => router.replace("/login"));
    } catch {
      setStatus(copy.signOutError);
    } finally {
      setBusy(false);
    }
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (sidebarCollapsed) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarResizeSession.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebarWidth,
    };
    setSidebarResizing(true);
  }

  function resizeSidebar(event: ReactPointerEvent<HTMLDivElement>) {
    const session = sidebarResizeSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    setSidebarWidth(
      clampSidebarWidth(
        session.startWidth + event.clientX - session.startX,
        sidebarMaximumWidth,
      ),
    );
  }

  function finishSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (sidebarResizeSession.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    sidebarResizeSession.current = null;
    setSidebarResizing(false);
  }

  function resizeSidebarWithKeyboard(
    event: React.KeyboardEvent<HTMLDivElement>,
  ) {
    let targetWidth: number | null = null;
    if (event.key === "ArrowLeft")
      targetWidth = sidebarWidth - SIDEBAR_WIDTH_STEP;
    if (event.key === "ArrowRight")
      targetWidth = sidebarWidth + SIDEBAR_WIDTH_STEP;
    if (event.key === "Home") targetWidth = SIDEBAR_MINIMUM_WIDTH;
    if (event.key === "End") targetWidth = sidebarMaximumWidth;
    if (targetWidth === null) return;

    event.preventDefault();
    setSidebarWidth(clampSidebarWidth(targetWidth, sidebarMaximumWidth));
  }

  return (
    <main className="workspace-page" lang={locale}>
      <UnsavedChangesNavigationDialog />
      <div
        className="workspace-layout"
        data-sidebar-collapsed={sidebarCollapsed}
        data-sidebar-resizing={sidebarResizing}
        style={
          {
            "--sh-sidebar-expanded-width": `${sidebarWidth}px`,
          } as CSSProperties
        }
      >
        <aside
          ref={sidebarRef}
          className="workspace-sidebar"
          aria-label={copy.sidebar}
          data-collapsed={sidebarCollapsed}
          data-resizing={sidebarResizing}
        >
          <div className="workspace-sidebar-header">
            <div className="workspace-sidebar-brand">
              <SmartHireBrand />
              <span className="workspace-product-label">{copy.product}</span>
            </div>
            <button
              className="workspace-sidebar-toggle"
              type="button"
              aria-controls="workspace-navigation"
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? copy.expand : copy.collapse}
              title={sidebarCollapsed ? copy.expand : copy.collapse}
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d={sidebarCollapsed ? "m7 4 6 6-6 6" : "m13 4-6 6 6 6"} />
              </svg>
            </button>
          </div>
          <div
            className="workspace-sidebar-resize-handle"
            role="separator"
            tabIndex={sidebarCollapsed ? -1 : 0}
            aria-label={copy.resizeSidebar}
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_MINIMUM_WIDTH}
            aria-valuemax={sidebarMaximumWidth}
            aria-valuenow={sidebarWidth}
            aria-valuetext={`${sidebarWidth}px ${copy.widthOf} ${sidebarMaximumWidth}px`}
            aria-description={copy.resizeSidebarHint}
            title={copy.resizeSidebarHint}
            onPointerDown={startSidebarResize}
            onPointerMove={resizeSidebar}
            onPointerUp={finishSidebarResize}
            onPointerCancel={finishSidebarResize}
            onKeyDown={resizeSidebarWithKeyboard}
            onDoubleClick={() =>
              setSidebarWidth(
                clampSidebarWidth(SIDEBAR_MINIMUM_WIDTH, sidebarMaximumWidth),
              )
            }
          />
          {workspaceMode === "recruiter" ? (
            <RecruiterWorkspaceNavigation
              busy={busy || navigating}
              collapsed={sidebarCollapsed}
              onSignOut={() => void signOut()}
            />
          ) : (
            <WorkspaceNavigation
              busy={busy || navigating}
              collapsed={sidebarCollapsed}
              onSignOut={() => void signOut()}
            />
          )}
        </aside>
        <div
          className="workspace-main"
          data-workspace-mode={workspaceMode}
          data-content-mode={
            workspaceMode === "recruiter" ? "default" : contentMode
          }
        >
          <header
            className="workspace-header"
            data-job-search={candidateJobBoard ? "true" : undefined}
          >
            <div className="workspace-header-identity">
              <p className="workspace-topbar-kicker">
                {workspaceMode === "recruiter"
                  ? copy.recruiterWorkspace
                  : copy.workspace}
              </p>
              <p className="workspace-topbar-title">
                {workspaceMode === "recruiter" ? (
                  copy.recruiterGreeting
                ) : (
                  <>
                    {copy.greeting}{" "}
                    {greetingName ? (
                      <span className="workspace-topbar-name">
                        {greetingName}
                      </span>
                    ) : null}
                  </>
                )}
              </p>
            </div>
            {candidateJobBoard ? (
              <div
                id="workspace-job-search-slot"
                className="workspace-header-job-search-slot"
              />
            ) : null}
            <div className="workspace-header-actions">
              <NotificationCenter csrfProof={csrfProof} locale={locale} />
              <ThemeToggle compact />
              <Link
                className="workspace-account-chip"
                href="/profile"
                aria-label={copy.openProfile}
                title={accountTitle}
              >
                <span className="workspace-account-avatar" aria-hidden="true">
                  {avatar ? (
                    <Image
                      src={avatar}
                      alt=""
                      width={40}
                      height={40}
                      unoptimized
                    />
                  ) : (
                    <span className="workspace-account-initials">
                      {accountInitials}
                    </span>
                  )}
                </span>
                <span className="workspace-account-copy">
                  <strong>{workspaceProfile.name || greetingName}</strong>
                  {workspaceProfile.email ? (
                    <small>{workspaceProfile.email}</small>
                  ) : null}
                </span>
                <svg
                  className="workspace-account-chevron"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="m7 10 5 5 5-5" />
                </svg>
              </Link>
              {workspaceMode === "recruiter" ? (
                <button
                  className="recruiter-header-action recruiter-header-action--secondary"
                  type="button"
                  onClick={() => persistWorkspaceMode("candidate")}
                >
                  <span
                    className="recruiter-header-action__icon"
                    aria-hidden="true"
                  >
                    &lt;
                  </span>
                  <span className="recruiter-header-action__label">
                    {copy.candidateWorkspace}
                  </span>
                </button>
              ) : (
                <RecruiterHeaderAction
                  initialStatus={initialRecruiterStatus}
                  onOpenWorkspace={() => persistWorkspaceMode("recruiter")}
                />
              )}
            </div>
          </header>
          <div className="workspace-status">
            <AuthStatus status={status} tone="error" />
          </div>
          <section
            className="workspace-content"
            data-content-mode={
              workspaceMode === "recruiter" ? "default" : contentMode
            }
            data-workspace-mode={workspaceMode}
          >
            <CsrfProofProvider value={csrfProof}>
              {workspaceMode === "recruiter"
                ? (recruiterContent ?? (
                    <RecruiterJobPostingManagement
                      initialData={initialRecruiterJobData}
                    />
                  ))
                : children}
            </CsrfProofProvider>
          </section>
        </div>
      </div>
    </main>
  );
}
