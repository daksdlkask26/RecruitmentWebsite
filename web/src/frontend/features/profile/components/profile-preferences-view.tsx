"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountPreferences } from "@/shared/contracts/account/preferences";
import { useAccountPreferences } from "../client/use-account-preferences";
import { AccountPreferencesForm } from "./account-preferences-form";
import { ProfileNavigation } from "./profile-navigation";
import { PageHeader } from "@/frontend/components/layout/page-header";
import { Panel, StatusPill } from "@/frontend/components/ui/design-system";
import {
  UnsavedChangesIndicator,
  useUnsavedChangesGuard,
} from "../client/unsaved-changes";
import { useWorkspaceLocale } from "../../dashboard/client/workspace-locale";

export function ProfilePreferencesView({
  initialPreferences,
  csrfProof,
}: {
  initialPreferences: AccountPreferences;
  csrfProof: string;
}) {
  const locale = useWorkspaceLocale();
  const copy =
    locale === "vi"
      ? {
          kicker: "TRẢI NGHIỆM CỦA BẠN",
          title: "Tùy chọn",
          subtitle:
            "Giữ múi giờ và thông báo nhất quán trên mọi thiết bị đã đăng nhập.",
          panel: "MẶC ĐỊNH TÀI KHOẢN",
          panelTitle: "Tùy chọn tài khoản",
          interfaceLanguage: "Ngôn ngữ giao diện",
          timezone: "Múi giờ",
          emailNotifications: "Thông báo qua email",
          emailNotificationsHint:
            "Chọn những cập nhật sản phẩm sẽ được gửi đến hộp thư của bạn.",
          applicationUpdates: "Cập nhật ứng dụng",
          jobRecommendations: "Đề xuất việc làm",
          accountSecurity: "Bảo mật tài khoản",
          alwaysOn: "Luôn bật",
          on: "Bật",
          off: "Tắt",
        }
      : {
          kicker: "YOUR EXPERIENCE",
          title: "Preferences",
          subtitle:
            "Keep timezone and notification settings consistent across every signed-in device.",
          panel: "ACCOUNT DEFAULTS",
          panelTitle: "Account preferences",
          interfaceLanguage: "Interface language",
          timezone: "Timezone",
          emailNotifications: "Email notifications",
          emailNotificationsHint:
            "Choose which product updates should reach your inbox.",
          applicationUpdates: "Application updates",
          jobRecommendations: "Job recommendations",
          accountSecurity: "Account security",
          alwaysOn: "Always on",
          on: "On",
          off: "Off",
        };
  const state = useAccountPreferences(initialPreferences, csrfProof);
  const [isEditing, setIsEditing] = useState(false);
  useUnsavedChangesGuard(state.dirty && isEditing);
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.feedback) feedbackRef.current?.focus();
  }, [state.feedback]);

  const languageLabel =
    state.preferences.language === "vi" ? "Tiếng Việt" : "English";
  const editLabel = locale === "vi" ? "Chỉnh sửa tùy chọn" : "Edit preferences";
  const cancelLabel = locale === "vi" ? "Hủy" : "Cancel";

  return (
    <div className="profile-page account-preferences-page">
      <ProfileNavigation active="preferences" />
      <PageHeader
        className="profile-heading"
        eyebrow={copy.kicker}
        title={copy.title}
        titleId="workspace-page-title"
        subtitle={copy.subtitle}
        status={{
          label: locale === "vi" ? "Tự động lưu" : "Auto-save",
          tone: "success",
          pulsing: true,
        }}
      />
      <Panel
        as="section"
        className="account-preferences-panel"
        eyebrow={copy.panel}
        title={copy.panelTitle}
        titleId="preferences-form-title"
        rightSlot={
          !isEditing ? (
            <StatusPill
              label={locale === "vi" ? "Đã lưu" : "Saved"}
              tone="success"
            />
          ) : (
            <UnsavedChangesIndicator dirty={state.dirty} />
          )
        }
      >
        <div
          ref={feedbackRef}
          className="account-preferences-feedback"
          role={
            state.feedback
              ? state.feedback.kind === "error"
                ? "alert"
                : "status"
              : undefined
          }
          aria-live="polite"
          aria-atomic="true"
          tabIndex={state.feedback ? -1 : undefined}
          data-feedback-kind={state.feedback?.kind}
        >
          {state.feedback?.message}
        </div>
        {!isEditing ? (
          <div className="account-preferences-summary">
            <div className="account-preference-summary-grid">
              <div className="account-preference-summary-item">
                <span>{copy.interfaceLanguage}</span>
                <strong>{languageLabel}</strong>
              </div>
              <div className="account-preference-summary-item">
                <span>{copy.timezone}</span>
                <strong>{state.preferences.timezone}</strong>
              </div>
            </div>
            <div className="account-preference-notification-summary">
              <div>
                <span>{copy.emailNotifications}</span>
                <p>{copy.emailNotificationsHint}</p>
              </div>
              <ul>
                <li
                  data-enabled={
                    state.preferences.emailNotifications.application_updates
                  }
                >
                  {copy.applicationUpdates}
                  <strong>
                    {state.preferences.emailNotifications.application_updates
                      ? copy.on
                      : copy.off}
                  </strong>
                </li>
                <li
                  data-enabled={
                    state.preferences.emailNotifications.job_recommendations
                  }
                >
                  {copy.jobRecommendations}
                  <strong>
                    {state.preferences.emailNotifications.job_recommendations
                      ? copy.on
                      : copy.off}
                  </strong>
                </li>
                <li data-enabled="true">
                  {copy.accountSecurity}
                  <strong>{copy.alwaysOn}</strong>
                </li>
              </ul>
            </div>
            <div className="account-preferences-actions">
              <button
                className="account-preferences-edit-button"
                type="button"
                onClick={() => setIsEditing(true)}
              >
                {editLabel} <span aria-hidden="true">&#8594;</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="account-preferences-editor">
            <AccountPreferencesForm
              preferences={state.preferences}
              saving={state.saving}
              onChange={state.update}
              onSave={async () => {
                const saved = await state.save();
                if (saved) setIsEditing(false);
                return saved;
              }}
            />
            <div className="account-preferences-actions">
              <button
                className="profile-section-secondary-button"
                type="button"
                onClick={() => {
                  state.discard();
                  setIsEditing(false);
                }}
              >
                {cancelLabel}
              </button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
