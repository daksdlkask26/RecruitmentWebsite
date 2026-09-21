"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCsrfProof } from "@/frontend/features/authentication/client/csrf-proof-context";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import styles from "./company-invitation.module.css";

type Invitation = {
  companyName: string;
  role: "HR_MANAGER" | "RECRUITER";
  expiresAt: string;
};

function invitationCopy(locale: "vi" | "en") {
  return locale === "vi"
    ? {
        checking: "Đang kiểm tra lời mời",
        checkingDescription:
          "Chúng tôi đang xác minh lời mời này thuộc về tài khoản bạn đã đăng nhập.",
        eyebrow: "LỜI MỜI ĐỘI NGŨ SMART HIRE",
        join: (companyName: string) => `Tham gia ${companyName}`,
        invitedAs: (role: string) =>
          `Bạn được mời tham gia với vai trò ${role}. Hãy chọn có tham gia đội ngũ tuyển dụng này hay không.`,
        expires: (date: string) => `Lời mời hết hạn vào ${date}.`,
        accept: "Chấp nhận lời mời",
        decline: "Từ chối",
        declineConfirm:
          "Từ chối lời mời tham gia công ty này? Thao tác này không thể hoàn tác.",
        joined: "Bạn đã tham gia công ty",
        joinedDescription:
          "Quyền truy cập công ty của bạn đã được kích hoạt. Bạn có thể tiếp tục đến không gian nhà tuyển dụng.",
        declined: "Đã từ chối lời mời",
        declinedDescription:
          "Chủ sở hữu đã được thông báo. Bạn chưa được thêm vào công ty.",
        unavailable: "Lời mời không khả dụng",
        unavailableDescription:
          "Liên kết có thể đã hết hạn, bị thu hồi, được xử lý trước đó hoặc dành cho tài khoản khác.",
        hrManager: "Quản lý nhân sự",
        recruiter: "Nhà tuyển dụng",
      }
    : {
        checking: "Checking your invitation",
        checkingDescription:
          "We are verifying that this invitation belongs to your signed-in account.",
        eyebrow: "SMARTHIRE TEAM INVITATION",
        join: (companyName: string) => `Join ${companyName}`,
        invitedAs: (role: string) =>
          `You were invited to join as ${role}. Choose whether to join this hiring team.`,
        expires: (date: string) => `This invitation expires ${date}.`,
        accept: "Accept invitation",
        decline: "Decline",
        declineConfirm:
          "Decline this company invitation? This cannot be undone.",
        joined: "You joined the company",
        joinedDescription:
          "Your company access is now active. You can continue to the recruiter workspace.",
        declined: "Invitation declined",
        declinedDescription:
          "The Owner has been notified. You have not been added to the company.",
        unavailable: "Invitation unavailable",
        unavailableDescription:
          "This link may be expired, revoked, already handled, or assigned to another account.",
        hrManager: "HR Manager",
        recruiter: "Recruiter",
      };
}

export default function CompanyInvitationPage() {
  const locale = useWorkspaceLocale();
  const copy = invitationCopy(locale);
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const invitationId = searchParams.get("invitationId") ?? "";
  const reference = token ? { token } : invitationId ? { invitationId } : null;
  const csrf = useCsrfProof();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "accepted" | "declined" | "unavailable"
  >(reference ? "loading" : "unavailable");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token && !invitationId) return;
    const query = token
      ? `token=${encodeURIComponent(token)}`
      : `invitationId=${encodeURIComponent(invitationId)}`;
    void fetch(`/api/recruiter/company/team/invitations/accept?${query}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        setInvitation((await response.json()) as Invitation);
        setState("ready");
      })
      .catch(() => setState("unavailable"));
  }, [invitationId, token]);

  async function decide(decision: "accept" | "decline") {
    if (decision === "decline" && !window.confirm(copy.declineConfirm)) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/recruiter/company/team/invitations/${decision === "accept" ? "accept" : "decline"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify(reference),
        },
      );
      if (!response.ok) throw new Error("unavailable");
      setState(decision === "accept" ? "accepted" : "declined");
    } catch {
      setState("unavailable");
    } finally {
      setBusy(false);
    }
  }

  const role =
    invitation?.role === "HR_MANAGER" ? copy.hrManager : copy.recruiter;
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-live="polite">
        <span className={styles.icon} aria-hidden="true">
          ✦
        </span>
        {state === "loading" ? (
          <>
            <h1>{copy.checking}</h1>
            <p>{copy.checkingDescription}</p>
          </>
        ) : null}
        {state === "ready" && invitation ? (
          <>
            <p className={styles.eyebrow}>{copy.eyebrow}</p>
            <h1>{copy.join(invitation.companyName)}</h1>
            <p>{copy.invitedAs(role)}</p>
            <p className={styles.expiry}>
              {copy.expires(
                new Date(invitation.expiresAt).toLocaleString(
                  locale === "vi" ? "vi-VN" : "en-US",
                ),
              )}
            </p>
            <div className={styles.actions}>
              <button
                className={styles.accept}
                disabled={busy}
                onClick={() => void decide("accept")}
              >
                {copy.accept}
              </button>
              <button
                className={styles.decline}
                disabled={busy}
                onClick={() => void decide("decline")}
              >
                {copy.decline}
              </button>
            </div>
          </>
        ) : null}
        {state === "accepted" ? (
          <>
            <h1>{copy.joined}</h1>
            <p>{copy.joinedDescription}</p>
          </>
        ) : null}
        {state === "declined" ? (
          <>
            <h1>{copy.declined}</h1>
            <p>{copy.declinedDescription}</p>
          </>
        ) : null}
        {state === "unavailable" ? (
          <>
            <h1>{copy.unavailable}</h1>
            <p>{copy.unavailableDescription}</p>
          </>
        ) : null}
      </section>
    </main>
  );
}
