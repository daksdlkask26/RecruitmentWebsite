"use client";

import { Check, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { CandidateProfileContract } from "@/shared/contracts/account/profile";
import type {
  ProfileEditorFeedback,
  ProfileSectionDraft,
} from "../client/use-profile-editor";
import { useWorkspaceLocale } from "../../dashboard/client/workspace-locale";

type VisibilitySection = NonNullable<
  CandidateProfileContract["visibility"]
>["candidateSections"][number];

function visibilitySections(locale: "vi" | "en") {
  return (
    locale === "vi"
      ? [
          ["avatar", "Ảnh đại diện", "Ảnh hồ sơ của bạn"],
          ["headline", "Tiêu đề", "Tiêu đề nghề nghiệp của bạn"],
          ["summary", "Tóm tắt", "Phần giới thiệu của bạn"],
          ["location", "Vị trí", "Thành phố hoặc khu vực"],
          ["skills", "Kỹ năng", "Các kỹ năng bạn đã chọn"],
          ["experience", "Kinh nghiệm", "Chức danh và công ty"],
          ["education", "Học vấn", "Trường học và bằng cấp"],
          [
            "links",
            "Liên kết nghề nghiệp",
            "Portfolio và liên kết mạng xã hội",
          ],
        ]
      : [
          ["avatar", "Avatar", "Your profile photo"],
          ["headline", "Headline", "Your professional title"],
          ["summary", "Summary", "Your introduction"],
          ["location", "Location", "City or region"],
          ["skills", "Skills", "Your selected skills"],
          ["experience", "Experience", "Role and company"],
          ["education", "Education", "School and degree"],
          ["links", "Professional links", "Portfolio and social links"],
        ]
  ) as Array<[VisibilitySection, string, string]>;
}

export function ProfileVisibilityForm(props: {
  profile: CandidateProfileContract;
  saving: boolean;
  feedback: ProfileEditorFeedback | null;
  onSave: (draft: ProfileSectionDraft) => Promise<boolean>;
}) {
  return <ProfileVisibilityEditor key={props.profile.revision} {...props} />;
}

function ProfileVisibilityEditor({
  profile,
  saving,
  feedback,
  onSave,
}: {
  profile: CandidateProfileContract;
  saving: boolean;
  feedback: ProfileEditorFeedback | null;
  onSave: (draft: ProfileSectionDraft) => Promise<boolean>;
}) {
  const locale = useWorkspaceLocale();
  const copy =
    locale === "vi"
      ? {
          kicker: "KIỂM SOÁT QUYỀN RIÊNG TƯ",
          title: "Ai có thể xem hồ sơ của bạn",
          description:
            "Chỉ chọn những thông tin nghề nghiệp bạn muốn chia sẻ. Thông tin liên hệ, tệp CV, đơn ứng tuyển, điểm số và tin nhắn luôn ở chế độ riêng tư.",
          discoverable: "Có thể tìm thấy bằng ID chính xác",
          discoverableHint:
            "Người tìm kiếm phải biết đầy đủ ID tài khoản của bạn. Không có tìm kiếm theo tên, email hoặc thư mục.",
          candidates: "Ứng viên",
          candidatesHint: "Chỉ hiển thị với người tìm kiếm đúng ID của bạn.",
          recruiters: "Nhà tuyển dụng sau khi bạn ứng tuyển",
          recruitersHint:
            "Thông tin hiện tại được hiển thị bổ sung bên cạnh đơn ứng tuyển đã gửi và không thể thay đổi.",
          changes: "Thay đổi có hiệu lực cho các lượt xem sau.",
          on: "Bật",
          off: "Tắt",
          saving: "Đang lưu…",
          save: "Lưu cài đặt quyền riêng tư",
          savedToast: "Đã lưu cài đặt quyền riêng tư.",
          errorToast: "Không thể lưu cài đặt quyền riêng tư.",
        }
      : {
          kicker: "PRIVACY CONTROLS",
          title: "Who can view your profile",
          description:
            "Choose only the professional details you want to share. Contact details, CV files, applications, scores, and messages remain private.",
          discoverable: "Discoverable by exact ID",
          discoverableHint:
            "Other candidates must know your full account ID. There is no name, email, or directory search.",
          candidates: "Candidates",
          candidatesHint: "Shown only to people who search your exact ID.",
          recruiters: "Recruiters after you apply",
          recruitersHint:
            "Current information shown in addition to your immutable submitted application.",
          changes: "Changes take effect for future views.",
          on: "On",
          off: "Off",
          saving: "Saving…",
          save: "Save privacy settings",
          savedToast: "Privacy settings saved.",
          errorToast: "Privacy settings could not be saved.",
        };
  const visibility = profile.visibility ?? {
    discoverableByExactId: false,
    candidateSections: [],
    recruiterSections: [],
  };
  const [discoverable, setDiscoverable] = useState(
    visibility.discoverableByExactId,
  );
  const [candidateSections, setCandidateSections] = useState<
    VisibilitySection[]
  >(visibility.candidateSections);
  const [recruiterSections, setRecruiterSections] = useState<
    VisibilitySection[]
  >(visibility.recruiterSections);

  const toggle = (
    value: VisibilitySection,
    audience: "candidate" | "recruiter",
  ) => {
    const current =
      audience === "candidate" ? candidateSections : recruiterSections;
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    if (audience === "candidate") setCandidateSections(next);
    else setRecruiterSections(next);
  };

  const handleSave = async () => {
    const saved = await onSave({
      section: "visibility",
      visibility: {
        discoverableByExactId: discoverable,
        candidateSections,
        recruiterSections,
      },
    });
    if (saved) toast.success(copy.savedToast, { id: "profile-visibility" });
    else toast.error(copy.errorToast, { id: "profile-visibility" });
  };

  return (
    <section
      className="profile-compact-section profile-visibility"
      aria-labelledby="profile-visibility-title"
    >
      <header className="profile-compact-header">
        <div>
          <p className="workspace-kicker">{copy.kicker}</p>
          <h2 id="profile-visibility-title">{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
      </header>
      <div
        className="profile-visibility__discovery"
        data-enabled={discoverable}
      >
        <span aria-hidden="true">{discoverable ? <Eye /> : <EyeOff />}</span>
        <div>
          <strong>{copy.discoverable}</strong>
          <p>{copy.discoverableHint}</p>
        </div>
        <label className="profile-visibility__switch">
          <input
            type="checkbox"
            checked={discoverable}
            onChange={(event) => setDiscoverable(event.target.checked)}
          />
          <span aria-hidden="true" />
          <b>{discoverable ? copy.on : copy.off}</b>
        </label>
      </div>
      <div className="profile-visibility__audiences">
        <Audience
          title={copy.candidates}
          description={copy.candidatesHint}
          selected={candidateSections}
          audience="candidate"
          onToggle={toggle}
          sections={visibilitySections(locale)}
        />
        <Audience
          title={copy.recruiters}
          description={copy.recruitersHint}
          selected={recruiterSections}
          audience="recruiter"
          onToggle={toggle}
          sections={visibilitySections(locale)}
        />
      </div>
      <footer className="profile-visibility__footer">
        <div className="profile-visibility__footer-note">
          <span className="profile-visibility__footer-icon" aria-hidden="true">
            <ShieldCheck />
          </span>
          <p>{copy.changes}</p>
        </div>
        <button
          type="button"
          className="profile-visibility__save"
          disabled={saving}
          aria-busy={saving}
          onClick={() => void handleSave()}
        >
          <Check aria-hidden="true" />
          <span>{saving ? copy.saving : copy.save}</span>
        </button>
      </footer>
      {feedback ? (
        <p
          className="profile-visibility__feedback"
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}
    </section>
  );
}

function Audience({
  title,
  description,
  selected,
  audience,
  onToggle,
  sections,
}: {
  title: string;
  description: string;
  selected: VisibilitySection[];
  audience: "candidate" | "recruiter";
  onToggle: (
    value: VisibilitySection,
    audience: "candidate" | "recruiter",
  ) => void;
  sections: Array<[VisibilitySection, string, string]>;
}) {
  return (
    <fieldset className="profile-visibility__audience">
      <legend>{title}</legend>
      <p>{description}</p>
      <div>
        {sections.map(([value, label, hint]) => (
          <label key={value}>
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={() => onToggle(value, audience)}
            />
            <span>
              <strong>{label}</strong>
              <small>{hint}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
