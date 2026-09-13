import type { WorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";

type Copy = {
  manageTeam: string;
  title: string;
  description: string;
  pendingDecision: (count: number) => string;
  manageTeamLink: string;
  refreshSelection: string;
  companyScope: string;
  chooseCompany: string;
  allCompanies: string;
  filterApplications: string;
  allStatuses: string;
  allRoles: string;
  sortApplications: string;
  newestFirst: string;
  oldestFirst: string;
  loadMoreApplications: string;
  loadingApplications: string;
  loadMoreError: string;
  retryLoadMore: string;
  noMatchingApplications: string;
  candidateCvs: string;
  applicationCount: (count: number) => string;
  applicationDetail: string;
  appliedRole: string;
  submitted: string;
  currentStatus: string;
  cv: string;
  invitationEmail: string;
  deliveryFailed: string;
  rejectionReason: (reason: string) => string;
  viewCv: string;
  invitationExpires: (date: string) => string;
  deliveryFailedDescription: string;
  invitationRole: string;
  optionalRejectionReason: string;
  rejectionPlaceholder: string;
  working: string;
  retryInvitationEmail: string;
  acceptAndInvite: string;
  rejectApplication: string;
  selectApplication: string;
  chooseCandidate: string;
  noApplications: string;
  noApplicationsDescription: string;
  viewed: string;
  roleLabel: (role: string) => string;
  statusLabel: (status: string) => string;
  emailStatusLabel: (status: string) => string;
  confirmAccept: (role: string, candidate: string) => string;
  confirmReject: (candidate: string) => string;
  confirmDecisionTitle: string;
  cancelDecision: string;
  confirmAcceptAction: string;
  confirmRejectAction: string;
  acceptSuccess: string;
  rejectSuccess: string;
  loadError: string;
  decisionError: (decision: "accept" | "reject") => string;
  genericDecisionError: string;
  errorForCode: (code?: string) => string | null;
};

const englishCopy: Copy = {
  manageTeam: "Manage team",
  title: "Team Applications",
  description:
    "Review CVs from candidates who want to join as an HR Manager or Recruiter. These applications stay outside ordinary job pipelines.",
  pendingDecision: (count) => `${count} awaiting decision`,
  manageTeamLink: "Manage team",
  refreshSelection: "Select an application to refresh its details.",
  companyScope: "Company scope",
  chooseCompany: "Choose a company to view its Team Applications.",
  allCompanies: "Choose a company",
  filterApplications: "Filter applications",
  allStatuses: "All statuses",
  allRoles: "All roles",
  sortApplications: "Sort applications",
  newestFirst: "Newest submitted",
  oldestFirst: "Oldest submitted",
  loadMoreApplications: "Next page",
  loadingApplications: "Loading applications...",
  loadMoreError: "The next page could not be loaded.",
  retryLoadMore: "Retry next page",
  noMatchingApplications: "No applications match these filters.",
  candidateCvs: "Candidate CVs",
  applicationCount: (count) => `${count} application${count === 1 ? "" : "s"}`,
  applicationDetail: "Application detail",
  appliedRole: "Applied role",
  submitted: "Submitted",
  currentStatus: "Current status",
  cv: "CV",
  invitationEmail: "Invitation email",
  deliveryFailed: "Delivery failed",
  rejectionReason: (reason) => `Rejection reason: ${reason}`,
  viewCv: "View CV",
  invitationExpires: (date) => `Invitation expires ${date}`,
  deliveryFailedDescription:
    "The invitation email failed to deliver. Retry it after checking the candidate email.",
  invitationRole: "Invitation role",
  optionalRejectionReason: "Optional rejection reason",
  rejectionPlaceholder:
    "This will be emailed to the candidate if you reject the application.",
  working: "Working...",
  retryInvitationEmail: "Retry invitation email",
  acceptAndInvite: "Accept and invite",
  rejectApplication: "Reject application",
  selectApplication: "Select an application",
  chooseCandidate: "Choose a candidate CV to review.",
  noApplications: "No Team Applications yet",
  noApplicationsDescription:
    "Candidate submissions for HR Manager or Recruiter will appear here.",
  viewed: "Viewed",
  roleLabel: (role) => (role === "HR_MANAGER" ? "HR Manager" : "Recruiter"),
  statusLabel: (status) =>
    ({
      SUBMITTED: "Submitted",
      VIEWED: "Viewed by owner",
      REJECTED: "Not selected",
      INVITATION_SENT: "Invitation sent",
      WITHDRAWN: "Withdrawn",
      JOINED: "Joined company",
    })[status] ?? status,
  emailStatusLabel: (status) =>
    status === "DEAD" ? "Delivery failed" : status.toLowerCase(),
  confirmAccept: (role, candidate) =>
    `Send a ${role} invitation to ${candidate}?`,
  confirmReject: (candidate) => `Reject ${candidate}'s team application?`,
  confirmDecisionTitle: "Confirm team application decision",
  cancelDecision: "Cancel",
  confirmAcceptAction: "Accept and invite",
  confirmRejectAction: "Reject application",
  acceptSuccess: "The application was accepted and the invitation was sent.",
  rejectSuccess: "The team application was rejected.",
  loadError: "The application could not be loaded.",
  decisionError: (decision) => `The application could not be ${decision}ed.`,
  genericDecisionError: "The decision could not be completed.",
  errorForCode: (code) =>
    ({
      TEAM_OWNER_FORBIDDEN:
        "You are not authorized to view this company’s team applications.",
      TEAM_APPLICATION_UNAVAILABLE: "This team application is unavailable.",
      TEAM_APPLICATION_CONFLICT:
        "This team application is no longer available for this action.",
      TEAM_MEMBER_EXISTS: "This candidate is already a member of the company.",
      TEAM_ROLE_INVALID: "Choose a valid invitation role.",
      TEAM_APPLICATION_CURSOR_INVALID:
        "This page has expired. Restart the list.",
      TEAM_APPLICATION_LIST_REQUEST_INVALID:
        "Choose valid application filters.",
    })[code ?? ""] ?? null,
};

const vietnameseCopy: Copy = {
  manageTeam: "Quản lý đội ngũ",
  title: "Hồ sơ ứng tuyển đội ngũ",
  description:
    "Xem CV của các ứng viên muốn tham gia với vai trò Quản lý nhân sự hoặc Chuyên viên tuyển dụng. Các hồ sơ này nằm ngoài pipeline tuyển dụng thông thường.",
  pendingDecision: (count) => `${count} hồ sơ đang chờ quyết định`,
  manageTeamLink: "Quản lý đội ngũ",
  refreshSelection: "Chọn một hồ sơ để làm mới thông tin chi tiết.",
  companyScope: "Phạm vi công ty",
  chooseCompany: "Chọn công ty để xem hồ sơ ứng tuyển đội ngũ.",
  allCompanies: "Chọn công ty",
  filterApplications: "Lọc hồ sơ",
  allStatuses: "Tất cả trạng thái",
  allRoles: "Tất cả vị trí",
  sortApplications: "Sắp xếp hồ sơ",
  newestFirst: "Nộp gần nhất",
  oldestFirst: "Nộp lâu nhất",
  loadMoreApplications: "Trang tiếp theo",
  loadingApplications: "Đang tải hồ sơ...",
  loadMoreError: "Không thể tải trang tiếp theo.",
  retryLoadMore: "Thử lại trang tiếp theo",
  noMatchingApplications: "Không có hồ sơ nào phù hợp với bộ lọc.",
  candidateCvs: "CV ứng viên",
  applicationCount: (count) => `${count} hồ sơ`,
  applicationDetail: "Chi tiết hồ sơ",
  appliedRole: "Vị trí ứng tuyển",
  submitted: "Ngày nộp",
  currentStatus: "Trạng thái hiện tại",
  cv: "CV",
  invitationEmail: "Email lời mời",
  deliveryFailed: "Gửi thất bại",
  rejectionReason: (reason) => `Lý do từ chối: ${reason}`,
  viewCv: "Xem CV",
  invitationExpires: (date) => `Lời mời hết hạn vào ${date}`,
  deliveryFailedDescription:
    "Email lời mời không gửi được. Hãy kiểm tra email ứng viên rồi thử lại.",
  invitationRole: "Vị trí trong lời mời",
  optionalRejectionReason: "Lý do từ chối (không bắt buộc)",
  rejectionPlaceholder:
    "Lý do này sẽ được gửi qua email cho ứng viên nếu bạn từ chối hồ sơ.",
  working: "Đang xử lý...",
  retryInvitationEmail: "Gửi lại email lời mời",
  acceptAndInvite: "Chấp nhận và gửi lời mời",
  rejectApplication: "Từ chối hồ sơ",
  selectApplication: "Chọn một hồ sơ",
  chooseCandidate: "Chọn CV ứng viên để xem xét.",
  noApplications: "Chưa có hồ sơ ứng tuyển đội ngũ",
  noApplicationsDescription:
    "Hồ sơ ứng tuyển Quản lý nhân sự hoặc Chuyên viên tuyển dụng sẽ hiển thị tại đây.",
  viewed: "Đã xem",
  roleLabel: (role) =>
    role === "HR_MANAGER" ? "Quản lý nhân sự" : "Chuyên viên tuyển dụng",
  statusLabel: (status) =>
    ({
      SUBMITTED: "Đã nộp",
      VIEWED: "Owner đã xem",
      REJECTED: "Không được chọn",
      INVITATION_SENT: "Đã gửi lời mời",
      WITHDRAWN: "Đã rút đơn",
      JOINED: "Đã tham gia công ty",
    })[status] ?? status,
  emailStatusLabel: (status) =>
    ({
      PENDING: "Đang chờ",
      PROCESSING: "Đang xử lý",
      SENT: "Đã gửi",
      RETRYABLE: "Có thể gửi lại",
      DEAD: "Gửi thất bại",
    })[status] ?? status,
  confirmAccept: (role, candidate) =>
    `Gửi lời mời vị trí ${role} cho ${candidate}?`,
  confirmReject: (candidate) =>
    `Từ chối hồ sơ ứng tuyển đội ngũ của ${candidate}?`,
  confirmDecisionTitle: "Xác nhận quyết định hồ sơ đội ngũ",
  cancelDecision: "Hủy",
  confirmAcceptAction: "Chấp nhận và gửi lời mời",
  confirmRejectAction: "Từ chối hồ sơ",
  acceptSuccess: "Đã chấp nhận hồ sơ và gửi lời mời.",
  rejectSuccess: "Đã từ chối hồ sơ ứng tuyển đội ngũ.",
  loadError: "Không thể tải hồ sơ ứng tuyển.",
  decisionError: () => "Không thể hoàn tất quyết định cho hồ sơ.",
  genericDecisionError: "Không thể hoàn tất quyết định.",
  errorForCode: (code) =>
    ({
      TEAM_OWNER_FORBIDDEN:
        "Bạn không có quyền xem hồ sơ ứng tuyển đội ngũ của công ty này.",
      TEAM_APPLICATION_UNAVAILABLE:
        "Hồ sơ ứng tuyển đội ngũ này không còn khả dụng.",
      TEAM_APPLICATION_CONFLICT:
        "Hồ sơ ứng tuyển đội ngũ không còn khả dụng cho thao tác này.",
      TEAM_MEMBER_EXISTS: "Ứng viên này đã là thành viên của công ty.",
      TEAM_ROLE_INVALID: "Hãy chọn một vị trí hợp lệ trong lời mời.",
      TEAM_APPLICATION_CURSOR_INVALID:
        "Trang này đã hết hiệu lực. Hãy tải lại danh sách.",
      TEAM_APPLICATION_LIST_REQUEST_INVALID: "Hãy chọn bộ lọc hợp lệ.",
    })[code ?? ""] ?? null,
};

export function getCompanyTeamApplicationsCopy(locale: WorkspaceLocale): Copy {
  return locale === "vi" ? vietnameseCopy : englishCopy;
}

export function formatCompanyTeamApplicationDate(
  value: string,
  locale: WorkspaceLocale,
) {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "medium",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}
