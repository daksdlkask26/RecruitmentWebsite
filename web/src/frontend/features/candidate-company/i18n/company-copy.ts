import type { WorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";

const companyCopyExtensions = {
  candidateWorkspace: "Candidate workspace",
  companyCount: (count: number) =>
    `${count} ${count === 1 ? "company" : "companies"}`,
  backToCompany: "Back to company",
  joinCompany: (company: string) => `Join ${company}`,
  jobsLoadError: "Jobs could not be loaded. Please try again.",
  teamApplicationUnavailable:
    "Team applications are not currently available for this company.",
  searching: "Searching...",
  verifiedCompany: "Verified company",
  companyInformation: "Company information",
  founded: "Founded",
  companySize: "Company size",
  employees: "Employees",
  industry: "Industry",
  jobSearchLabel: "Search company jobs",
  jobSearchPlaceholder: "Job title, skill, or keyword",
  jobResultPages: "Job result pages",
  cvSentToOwner: (company: string, role: string) =>
    `Your CV was sent to the Owner of ${company} for the ${role} opportunity.`,
  currentStatus: (status: string) => `Current status: ${status}.`,
  teamRole: "Team role",
  cv: "CV",
  submitting: "Submitting...",
  applicationsEyebrow: "Applications",
  refresh: "Refresh",
  refreshError: "Team Applications could not be refreshed.",
  unableToRefresh: "Unable to refresh.",
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
  noMatchingApplicationsDescription:
    "Try changing the status, role, or sort filters.",
  applicationCount: (count: number) =>
    `${count} team application${count === 1 ? "" : "s"}`,
  submittedOn: (date: string) => `Submitted ${date}`,
  ownerViewedOn: (date: string) => `Owner viewed ${date}`,
  ownerNotViewed: "Owner has not viewed the CV",
  invitationExpiresOn: (date: string) =>
    `Invitation expires ${date}. Open the invitation to accept it.`,
  noInvitation: "No invitation",
  invitationStatus: (status: string) =>
    status === "PENDING"
      ? "Invitation pending"
      : `Invitation ${status.toLowerCase()}`,
  viewCompanyLink: "View company",
  withdrawing: "Withdrawing...",
  withdraw: "Withdraw",
  withdrawConfirm:
    "Withdraw this team application? The Owner will no longer be able to invite you from it.",
  withdrawDialogTitle: "Withdraw team application",
  withdrawDialogDescription: (company: string, role: string) =>
    `You are withdrawing your ${role} application to ${company}. The Owner will no longer be able to invite you from this application.`,
  cancelAction: "Cancel",
  confirmWithdraw: "Withdraw application",
  withdrawSuccess: (company: string) =>
    `Your application to ${company} was withdrawn.`,
  reviewInvitation: "Review invitation",
  noTeamApplications: "No Team Applications yet",
  noTeamApplicationsDescription:
    "Open a company to apply as an HR Manager or Recruiter.",
  browseCompanies: "Browse companies",
  attachCv: "Attach a PDF or DOCX CV.",
  unsupportedCv: "Only PDF and DOCX CV files are supported.",
  emptyCv: "The CV file is empty.",
  oversizedCv: "The CV must be 5,000,000 bytes or smaller.",
  submitError: "The team application could not be submitted.",
  withdrawError: "This team application could not be withdrawn.",
  teamApplicationError: (code?: string) => {
    switch (code) {
      case "TEAM_COMPANY_UNAVAILABLE":
        return "This company is not currently accepting team applications.";
      case "TEAM_OPPORTUNITY_CLOSED":
        return "This team role is no longer open.";
      case "TEAM_MEMBER_EXISTS":
        return "You are already a member of this company.";
      case "TEAM_APPLICATION_DUPLICATE":
        return "You already have an active application for this team role.";
      default:
        return null;
    }
  },
  roleLabel: (role: string) =>
    role === "HR_MANAGER" ? "HR Manager" : "Recruiter",
  statusLabel: (status: string) =>
    ({
      SUBMITTED: "Submitted",
      VIEWED: "Viewed by owner",
      REJECTED: "Not selected",
      INVITATION_SENT: "Invitation sent",
      WITHDRAWN: "Withdrawn",
      JOINED: "Joined company",
    })[status] ?? status,
  invitationEmailStatusLabel: (status: string) =>
    status === "DEAD" ? "Delivery failed" : status.toLowerCase(),
  ownerRole: "Owner",
  submitted: "Submitted",
  searchResultsFor: "Showing companies matching “{query}”.",
  includingRelatedTerm: "Also including “{term}”.",
  searchLiteral: "Search literally for “{query}”",
  didYouMean: "Did you mean “{query}”?",
  searchSuggested: "Search for “{query}”",
  literalMode: "Searching literally for “{query}”.",
  enableSmartSearch: "Enable smart search",
  interpretedAsOccupation: "Interpreted “{original}” as “{occupation}”.",
  correctionHint: "Corrected from “{query}”.",
  matchedFacets: "Matched signals",
} as const;

const vietnameseCompanyCopyExtensions = {
  candidateWorkspace: "Không gian ứng viên",
  companyCount: (count: number) => `${count} công ty`,
  backToCompany: "Quay lại công ty",
  joinCompany: (company: string) => `Tham gia ${company}`,
  jobsLoadError: "Không thể tải việc làm. Vui lòng thử lại.",
  teamApplicationUnavailable:
    "Hiện chưa thể ứng tuyển vào đội ngũ của công ty này.",
  searching: "Đang tìm kiếm...",
  verifiedCompany: "Công ty đã xác minh",
  companyInformation: "Thông tin công ty",
  founded: "Năm thành lập",
  companySize: "Quy mô công ty",
  employees: "Nhân viên",
  industry: "Ngành",
  jobSearchLabel: "Tìm kiếm việc làm của công ty",
  jobSearchPlaceholder: "Tên việc làm, kỹ năng hoặc từ khóa",
  jobResultPages: "Trang kết quả việc làm",
  cvSentToOwner: (company: string, role: string) =>
    `CV của bạn đã được gửi cho Owner của ${company} để ứng tuyển vị trí ${role}.`,
  currentStatus: (status: string) => `Trạng thái hiện tại: ${status}.`,
  teamRole: "Vị trí trong đội ngũ",
  cv: "CV",
  submitting: "Đang gửi...",
  applicationsEyebrow: "Hồ sơ ứng tuyển",
  refresh: "Làm mới",
  refreshError: "Không thể làm mới hồ sơ ứng tuyển đội ngũ.",
  unableToRefresh: "Không thể làm mới.",
  filterApplications: "Lọc hồ sơ đơn",
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
  noMatchingApplicationsDescription:
    "Hãy thử thay đổi bộ lọc trạng thái, vị trí hoặc sắp xếp.",
  applicationCount: (count: number) => `${count} hồ sơ ứng tuyển đội ngũ`,
  submittedOn: (date: string) => `Đã nộp ${date}`,
  ownerViewedOn: (date: string) => `Owner đã xem ${date}`,
  ownerNotViewed: "Owner chưa xem CV",
  invitationExpiresOn: (date: string) =>
    `Lời mời hết hạn vào ${date}. Mở lời mời để chấp nhận.`,
  noInvitation: "Chưa có lời mời",
  invitationStatus: (status: string) =>
    ({
      PENDING: "Lời mời đang chờ",
      REVOKED: "Lời mời đã thu hồi",
      ACCEPTED: "Đã chấp nhận lời mời",
      DECLINED: "Đã từ chối lời mời",
      EXPIRED: "Lời mời đã hết hạn",
    })[status] ?? status,
  viewCompanyLink: "Xem công ty",
  withdrawing: "Đang rút đơn...",
  withdraw: "Rút đơn",
  withdrawConfirm:
    "Rút hồ sơ ứng tuyển đội ngũ này? Owner sẽ không thể gửi lời mời cho bạn từ hồ sơ này.",
  withdrawDialogTitle: "Rút hồ sơ ứng tuyển đội ngũ",
  withdrawDialogDescription: (company: string, role: string) =>
    `Bạn đang rút hồ sơ ${role} tại ${company}. Owner sẽ không thể gửi lời mời từ hồ sơ này nữa.`,
  cancelAction: "Hủy",
  confirmWithdraw: "Rút hồ sơ",
  withdrawSuccess: (company: string) =>
    `Hồ sơ ứng tuyển vào ${company} đã được rút.`,
  reviewInvitation: "Xem lời mời",
  noTeamApplications: "Chưa có hồ sơ ứng tuyển đội ngũ",
  noTeamApplicationsDescription:
    "Mở một công ty để ứng tuyển vị trí Quản lý nhân sự hoặc Chuyên viên tuyển dụng.",
  browseCompanies: "Xem danh sách công ty",
  attachCv: "Hãy đính kèm CV PDF hoặc DOCX.",
  unsupportedCv: "Chỉ hỗ trợ CV định dạng PDF và DOCX.",
  emptyCv: "Tệp CV đang trống.",
  oversizedCv: "CV phải có kích thước tối đa 5.000.000 byte.",
  submitError: "Không thể gửi hồ sơ ứng tuyển đội ngũ.",
  withdrawError: "Không thể rút hồ sơ ứng tuyển đội ngũ này.",
  teamApplicationError: (code?: string) => {
    switch (code) {
      case "TEAM_COMPANY_UNAVAILABLE":
        return "Công ty hiện chưa tiếp nhận hồ sơ ứng tuyển đội ngũ.";
      case "TEAM_OPPORTUNITY_CLOSED":
        return "Vị trí trong đội ngũ này không còn mở.";
      case "TEAM_MEMBER_EXISTS":
        return "Bạn đã là thành viên của công ty này.";
      case "TEAM_APPLICATION_DUPLICATE":
        return "Bạn đã có hồ sơ đang hoạt động cho vị trí này.";
      default:
        return null;
    }
  },
  roleLabel: (role: string) =>
    role === "HR_MANAGER" ? "Quản lý nhân sự" : "Chuyên viên tuyển dụng",
  statusLabel: (status: string) =>
    ({
      SUBMITTED: "Đã nộp",
      VIEWED: "Owner đã xem",
      REJECTED: "Không được chọn",
      INVITATION_SENT: "Đã gửi lời mời",
      WITHDRAWN: "Đã rút đơn",
      JOINED: "Đã tham gia công ty",
    })[status] ?? status,
  invitationEmailStatusLabel: (status: string) =>
    ({
      PENDING: "Đang chờ",
      PROCESSING: "Đang xử lý",
      SENT: "Đã gửi",
      RETRYABLE: "Có thể gửi lại",
      DEAD: "Gửi thất bại",
    })[status] ?? status,
  ownerRole: "Owner",
  submitted: "Đã nộp",
  searchResultsFor: "Đang hiển thị công ty phù hợp với “{query}”.",
  includingRelatedTerm: "Đồng thời bao gồm “{term}”.",
  searchLiteral: "Tìm nguyên văn “{query}”",
  didYouMean: "Có phải bạn muốn tìm “{query}”?",
  searchSuggested: "Tìm “{query}”",
  literalMode: "Đang tìm nguyên văn “{query}”.",
  enableSmartSearch: "Bật tìm kiếm thông minh",
  interpretedAsOccupation: "Đã hiểu “{original}” là “{occupation}”.",
  correctionHint: "Đã sửa từ “{query}”.",
  matchedFacets: "Tín hiệu khớp",
} as const;

const englishCompanyCopy = {
  company: "Company",
  companies: "Companies",
  discoverDescription:
    "Discover verified companies, their teams, and open opportunities.",
  viewCompany: "View company",
  verified: "Verified",
  verifiedEmployersLabel: "verified employers",
  popular: "Popular",
  informationTechnology: "Information Technology",
  manufacturing: "Manufacturing",
  education: "Education",
  salesMarketing: "Sales & Marketing",
  openRoles: (count: number) =>
    `${count} ${count === 1 ? "open role" : "open roles"}`,
  unavailable: "Unavailable",
  noCompanies: "No companies are available yet",
  noCompaniesDescription: "Verified public company profiles will appear here.",
  teamApplications: "Team Applications",
  joinTeam: "Join the company team",
  teamDescription:
    "Submit your CV directly to the Owner for a lightweight review.",
  hrManager: "HR Manager",
  recruiter: "Recruiter",
  openPositions: "Open positions",
  ordinaryJobsDescription:
    "These ordinary jobs use the existing job application workflow.",
  keyword: "Keyword",
  location: "Location",
  allLocations: "All locations",
  search: "Search",
  clear: "Clear",
  searchCompanies: "Search companies",
  companySearchPlaceholder: "Company name, industry, or location",
  noMatchingCompanies: "No companies match your search",
  noMatchingCompaniesDescription:
    "Try another company name, industry, or location.",
  paginationShowing: "Showing",
  paginationOf: "of",
  perPage: "Per page",
  paginationPage: "Page",
  firstPage: "First page",
  previousPage: "Previous page",
  nextPage: "Next page",
  lastPage: "Last page",
  backToCompanies: "Back to Companies",
  applyAs: (role: string) => `Apply as ${role}`,
  positionsShown: (count: number) =>
    `${count} ${count === 1 ? "position" : "positions"} shown`,
  jobUnit: "jobs",
  noMatchingPositions: "No open positions match these filters",
  noMatchingPositionsDescription:
    "Clear the filters to view all current positions.",
  applicationReceived: "Application received",
  applicationAlreadySubmitted: "Application already submitted",
  submitCvDescription:
    "Submit one CV for the Owner to review. This is separate from ordinary job applications and does not use scoring or a hiring pipeline.",
  cvRequirement: "PDF or DOCX only, up to exactly 5,000,000 bytes.",
  cvScanning: "CV uploaded. We are checking it for safety...",
  cvRetryable:
    "The safety check could not finish. Retry it without uploading the file again.",
  cvInfected: "This CV was blocked because the safety scan detected a threat.",
  cvStatusError: "The CV could not pass the safety check.",
  cvReady: "CV safety check passed. Finishing your application...",
  retryCv: "Retry safety check",
  apply: (role: string) => `Apply as ${role}`,
  viewTeamApplications: "View Team Applications",
  trackTeamApplications:
    "Track applications to join a company as HR Manager or Recruiter.",
} as const;

const vietnameseCompanyCopy = {
  company: "Công ty",
  companies: "Các công ty",
  discoverDescription:
    "Khám phá các công ty đã xác minh, đội ngũ và vị trí đang tuyển.",
  viewCompany: "Xem công ty",
  verified: "Đã xác minh",
  verifiedEmployersLabel: "nhà tuyển dụng đã xác minh",
  popular: "Phổ biến",
  informationTechnology: "Công nghệ thông tin",
  manufacturing: "Sản xuất",
  education: "Giáo dục",
  salesMarketing: "Kinh doanh & tiếp thị",
  openRoles: (count: number) => `${count} vị trí đang tuyển`,
  unavailable: "Chưa có thông tin",
  noCompanies: "Chưa có công ty nào",
  noCompaniesDescription:
    "Các hồ sơ công ty công khai đã xác minh sẽ hiển thị tại đây.",
  teamApplications: "Ứng tuyển đội ngũ",
  joinTeam: "Gia nhập đội ngũ công ty",
  teamDescription: "Gửi CV trực tiếp cho Owner để được xem xét.",
  hrManager: "Quản lý nhân sự",
  recruiter: "Chuyên viên tuyển dụng",
  openPositions: "Vị trí đang tuyển",
  ordinaryJobsDescription:
    "Các công việc thông thường sử dụng quy trình ứng tuyển hiện có.",
  keyword: "Từ khóa",
  location: "Địa điểm",
  allLocations: "Tất cả địa điểm",
  search: "Tìm kiếm",
  clear: "Xóa bộ lọc",
  searchCompanies: "Tìm kiếm công ty",
  companySearchPlaceholder: "Tên công ty, ngành hoặc địa điểm",
  noMatchingCompanies: "Không có công ty phù hợp với tìm kiếm",
  noMatchingCompaniesDescription:
    "Hãy thử tên công ty, ngành hoặc địa điểm khác.",
  paginationShowing: "Hiển thị",
  paginationOf: "trên tổng số",
  perPage: "Mỗi trang",
  paginationPage: "Trang",
  firstPage: "Trang đầu",
  previousPage: "Trang trước",
  nextPage: "Trang sau",
  lastPage: "Trang cuối",
  backToCompanies: "Quay lại danh sách công ty",
  applyAs: (role: string) => `Ứng tuyển vị trí ${role}`,
  positionsShown: (count: number) => `${count} vị trí được hiển thị`,
  jobUnit: "việc làm",
  noMatchingPositions: "Không có vị trí phù hợp với bộ lọc",
  noMatchingPositionsDescription: "Xóa bộ lọc để xem các vị trí hiện có.",
  applicationReceived: "Đã nhận hồ sơ",
  applicationAlreadySubmitted: "Hồ sơ đã được gửi trước đó",
  submitCvDescription:
    "Gửi một CV để Owner xem xét. Đây là quy trình riêng, không dùng chấm điểm hoặc pipeline tuyển dụng.",
  cvRequirement: "Chỉ PDF hoặc DOCX, tối đa 5.000.000 byte.",
  cvScanning: "CV đã được tải lên. Đang kiểm tra an toàn...",
  cvRetryable:
    "Kiểm tra an toàn chưa hoàn tất. Bạn có thể thử lại mà không cần tải lại tệp.",
  cvInfected: "CV bị chặn vì quá trình quét an toàn phát hiện mối đe dọa.",
  cvStatusError: "CV không vượt qua kiểm tra an toàn.",
  cvReady: "CV đã vượt qua kiểm tra an toàn. Đang hoàn tất hồ sơ...",
  retryCv: "Thử lại kiểm tra an toàn",
  apply: (role: string) => `Ứng tuyển vị trí ${role}`,
  viewTeamApplications: "Xem ứng tuyển đội ngũ",
  trackTeamApplications: "Theo dõi hồ sơ ứng tuyển HR Manager hoặc Recruiter.",
} as const;

type WidenCompanyCopy<T> = T extends (...args: infer Args) => infer Return
  ? (...args: Args) => null extends Return ? string | null : string
  : T extends string
    ? string
    : T;

export type CompanyCopy = {
  [Key in keyof typeof englishCompanyCopy]: WidenCompanyCopy<
    (typeof englishCompanyCopy)[Key]
  >;
} & {
  [Key in keyof typeof companyCopyExtensions]: WidenCompanyCopy<
    (typeof companyCopyExtensions)[Key]
  >;
};

export function getCompanyCopy(locale: WorkspaceLocale): CompanyCopy {
  return locale === "vi"
    ? {
        ...vietnameseCompanyCopy,
        ...companyCopyExtensions,
        ...vietnameseCompanyCopyExtensions,
      }
    : { ...englishCompanyCopy, ...companyCopyExtensions };
}

export { englishCompanyCopy, vietnameseCompanyCopy };
