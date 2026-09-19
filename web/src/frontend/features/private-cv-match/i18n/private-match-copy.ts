import type { WorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";

export type PrivateMatchLocale = WorkspaceLocale;

const english = {
  common: {
    breadcrumb: "Breadcrumb",
    candidatePortal: "Candidate portal",
    cvMatchCheck: "CV Match Check",
    analysis: "Analysis",
    matchReport: "Match Report",
    report: "Report",
    backToCheck: "Back to CV Match Check",
    tryAgain: "Try again",
    ready: "Ready",
    selected: "Selected",
    required: "Required",
    notSpecified: "Not specified",
    processing: "Processing",
    complete: "Complete",
    inProgress: "In progress",
    next: "Next",
    step: (value: number) => `Step ${value}`,
    currentJd: "Current JD",
  },
  job: {
    selected: "SELECTED JOB",
    source: (version: number) => `SmartHire job post · Version ${version}`,
    sourceShort: "Source: SmartHire job post",
    employment: {
      CONTRACT: "Contract",
      FULL_TIME: "Full-time",
      INTERNSHIP: "Internship",
      PART_TIME: "Part-time",
      TEMPORARY: "Temporary",
    },
    arrangement: {
      HYBRID: "Hybrid",
      ON_SITE: "On-site",
      ONSITE: "On-site",
      REMOTE: "Remote",
    },
    flexibleExperience: "Experience flexible",
    entryLevel: "Entry level",
    experience: (years: number) => `${years}+ years`,
  },
  privacy: {
    title: "Private and fair by design",
    onlyYou: "Only you can see this report.",
    sensitiveExcluded: "Sensitive personal attributes are excluded.",
    notSent: "The report is not sent to recruiters.",
    privateSelfAssessment: "Private self-assessment",
  },
  stepper: {
    aria: "Assessment steps",
    labels: ["Choose job and CV", "Analyze evidence", "Review report"],
  },
  analysisSteps: [
    ["Read your CV", "Extracted skills, experience and project evidence."],
    ["Understand the job", "Mapped required and preferred qualifications."],
    ["Compare evidence", "Checked each requirement against CV evidence."],
    [
      "Prepare guidance",
      "Generated an explainable score and improvement plan.",
    ],
  ],
  status: {
    analyzing: "Analysis in progress",
    completed: "Completed just now",
  },
  readyView: {
    heading: "Your match report is ready",
    finishedPrefix: "The analysis finished in",
    secondsUnit: "s",
    finished: (seconds: number) => `The analysis finished in ${seconds}s.`,
    reviewBeforeApply: "Review the result before you apply.",
    limitedStatus: "Reduced-capability preview",
    completedStatus: "Analysis complete",
    limitedHeadline: "Your rule-based match preview is ready",
    highHeadline: "Review higher-alignment evidence before you apply",
    mediumHeadline: "Review mixed evidence before you apply",
    lowHeadline: "Review missing evidence before you apply",
    limitedDescription:
      "Automatic matching completed successfully. The AI evaluation failed, so no hybrid final score is calculated.",
    description:
      "SmartHire compared your CV evidence with the job requirements. Open the report to see matched skills, gaps and practical improvements.",
    privatePreview: "Private preview · Not shared with the employer",
    deterministicMatch: "DETERMINISTIC MATCH",
    previewScore: "PREVIEW MATCH SCORE",
    aiUnavailable: "AI evaluation unavailable",
    strongPotential: "Higher evidence alignment",
    goodPotential: "Mixed evidence alignment",
    moreEvidence: "More evidence to review",
    progressTitle: "Analysis progress",
    progressDescription: "Each stage completed successfully.",
    sourcesTitle: "Sources used for this report",
    parsedUpdated: (date: string) => `Parsed successfully · Updated ${date}`,
    jobDescriptionVersion: (version: number) =>
      `Job description version ${version}`,
    guidanceTitle: "This is guidance, not a hiring decision",
    guidanceDescription:
      "This private preview uses the approved 40/60 method: 40% automatic matching and 60% AI evaluation. A later employer result changes only when the submitted CV or job version changes.",
    insideTitle: "Inside your report",
    requirementEvidence: "Requirement evidence",
    requirementEvidenceDescription: "See what matched and what is missing.",
    explainableScore: "Explainable score",
    explainableScoreDescription: "Review categories, weights and formula.",
    improvementPlan: "Improvement plan",
    improvementPlanDescription: "Get focused actions before applying.",
    openReport: "View full match report",
    limitedOpenNote: "The report will open in limited mode.",
  },
  report: {
    limitedTitle: "Private CV match report — limited mode",
    title: "Private CV match report",
    role: "Role:",
    company: "Company:",
    aiTemporarilyUnavailable: "AI temporarily unavailable",
    rerun: "Re-run AI evaluation",
    rerunning: "Re-running...",
    retryAi: "Retry AI",
    retrying: "Retrying...",
    apply: "Apply now",
    closedApplication: "This job is no longer accepting applications.",
    deterministic: "DETERMINISTIC MATCH",
    sourceLabel: "Evidence source",
    sourceCv: "Candidate CV",
    completeEvidence: "Evidence is complete for this report.",
    incompleteEvidence:
      "Some CV evidence is incomplete. Treat this score as a limited guide and verify the missing source content.",
    privateScore: "PRIVATE SCORE",
    auditMethod: "Audit Method:",
    hybridMethod: "40/60 Hybrid",
    deterministicMethod: "Deterministic only",
    strongMatch: "Higher evidence alignment",
    goodMatch: "Mixed evidence alignment",
    lowMatch: "Evidence gaps to review",
    unavailable: "AI evaluation unavailable",
    highHeadline: "Review the evidence before you apply",
    mediumHeadline: "You meet several core requirements",
    limitedHeadline: "You can still review rule-based matches",
    independentPreview: "Independent candidate preview",
    reducedPreview: "Reduced-capability preview",
    limitedSummary:
      "Automatic matching completed successfully. The AI evaluation failed, so no hybrid final score is calculated.",
    limitedGap: "Retry AI to produce the approved 40/60 hybrid score.",
    deterministicNote:
      "Same CV + same job version + same method = the same underlying score.",
    privateToYou: "100% Private to you",
    automaticMatching: "Automatic matching",
    aiEvaluation: "AI evaluation",
    weight: (value: number) => `Weight ${value}%`,
    qualitySignal: "Quality signal",
    weightedContribution: (value: number | string) =>
      `Weighted contribution: ${value}`,
    deterministicAvailable: "Available deterministic component",
    aiContributionUnavailable: "AI contribution unavailable",
    evidenceCoverage: "Evidence coverage",
    clearEvidence: (matched: number, total: number) =>
      `Clear evidence for ${matched} of ${total} checks`,
    evidenceConfidence: "Evidence confidence",
    confidenceNotScored: "Confidence is not part of the score",
    high: "High",
    medium: "Medium",
    low: "Low",
    matchedRequirements: "Matched requirements",
    matchedRequirementsDescription:
      "Strong evidence was found for these job requirements.",
    noMatchedRequirements:
      "No strong evidence was found for the listed job requirements.",
    preferred: "preferred",
    missing: "missing",
    requiredExperience: "Required:",
    detectedExperience: "Detected:",
    years: (value: number) => `${value} years`,
    exceedsBy: (value: number) =>
      `Exceeds by ${value} ${value === 1 ? "year" : "years"}`,
    gapsTitle: "Gaps to address or verify",
    items: (value: number) => `${value} items`,
    noGaps: "No gaps were identified in the deterministic comparison.",
    evidenceTitle: "Evidence found in your CV",
    parsedFrom: (kind: "PDF" | "DOC" | "DOCX") =>
      `Parsed from attached ${kind}`,
    noEvidence: "No bounded evidence quotes are available.",
    evidenceTypes: {
      PROJECT: "Project",
      IMPACT: "Impact",
      SKILL: "Skill",
      EXPERIENCE: "Experience",
      EDUCATION: "Education",
      OTHER: "Evidence",
    },
    beforeApply: "Before you apply",
    focusedActions: (value: number) => `${value} focused actions`,
    actionsDescription: "Three focused actions can strengthen your CV:",
    guidanceUnavailable:
      "AI improvement guidance is unavailable. Retry AI to receive prioritized, explainable actions.",
    recommendedAction: "Recommended next step",
    uploadRecheck: "Upload revised CV & Re-check",
    hybridUnavailable: "Hybrid score unavailable",
    howCalculated: (score: number | string) => `How ${score} was calculated`,
    finalNotCalculated: "Final score: not calculated",
    deterministicEvidenceAvailable: "Deterministic evidence remains available.",
    limitedPrivacy:
      "This limited report is visible only to you. Retrying AI does not submit an application or affect recruiter ranking.",
    fullPrivacy:
      "This report is visible only to you. It is not included in your application and will not change a recruiter's ranking.",
  },
  delete: {
    short: "Delete",
    trigger: "Delete this preview",
    title: "Delete this private preview?",
    description:
      "Access is revoked immediately. Private data is physically deleted within 30 days. Application and employer data are never affected.",
    close: "Close delete confirmation",
    privacy: "This action only removes your private CV Match Check report.",
    keep: "Keep preview",
    deleting: "Deleting…",
    confirm: "Delete preview",
  },
  pageStates: {
    analyzingTitle: "Analyzing your CV",
    analyzingDescription:
      "SmartHire is comparing the selected CV with the job requirements.",
    processing: "PROCESSING",
    processingTitle: "SmartHire is checking your CV evidence",
    processingDescription:
      "This private analysis compares skills, experience and evidence with the selected job. It does not change your profile or application.",
    processingNote:
      "You can leave this page — we'll save the result when it's ready.",
    progressTitle: "Analysis progress",
    progressDescription:
      "Each stage completes safely before the report is published.",
    nextTitle: "What happens next",
    nextDescription:
      "When the analysis is complete, you can review the preview before choosing whether to apply.",
    failedTitle: "We could not finish this private check",
    failedDescription:
      "The report was not published because the source evidence could not be analyzed safely.",
    unavailableTitle: "This match check is no longer available.",
    unavailableDescription: "This private preview can no longer be opened.",
    startNew: "Start a new check",
    loadErrorTitle: "We could not load this report",
    loadErrorDescription:
      "Please try again. Your private preview has not been changed.",
    retryUnavailable:
      "AI evaluation is still unavailable. Your deterministic report remains available; try again later.",
  },
  list: {
    loading: "Loading saved CV match checks",
    states: {
      READY: "Ready",
      LIMITED: "Limited",
      FAILED: "Failed",
      ANALYZING: "Analyzing",
      QUEUED: "Queued",
    },
    created: (date: string) => `Created ${date}`,
    expiresIn: (days: number) => `Expires in ${days} days`,
    viewPreview: "View preview",
    eyebrow: "Candidate workspace",
    title: "CV Match Check",
    subtitle: "Review your private CV-to-job previews before you apply.",
    newCheck: "New private check",
    privatePreviews: "Your private previews",
    privateBadge: "100% Private",
    privateDescription:
      "Only you can see these reports. They never change a recruiter's ranking or your application.",
    loadFailed: "Saved previews could not be loaded",
    firstTitle: "Check your first CV match",
    firstDescription:
      "Get a private, explainable preview for one job before you apply.",
    startNew: "Start a new check",
    savedTitle: "Saved CV match checks",
    savedDescription: "Your private CV-to-job previews are saved here.",
    storage: "Storage",
    benefits: [
      ["Instant preview", "Deep match breakdown in seconds"],
      ["High precision", "Skill-by-skill evaluation"],
      ["Completely private", "No data shared with employers"],
    ],
  },
  setup: {
    jobUnavailableTitle: "This job is no longer available for a private check.",
    jobUnavailableDescription:
      "Choose another eligible job to start a private CV match check. Your CV has not been changed.",
    chooseAnotherJob: "Choose another job",
    cvUnavailableTitle:
      "This CV version is no longer available for a private check.",
    cvUnavailableDescription:
      "Choose another CV from your CV library and return when it is ready. Your CV has not been changed.",
    chooseAnotherCv: "Choose another CV",
    emptyTitle: "Check how well your CV fits a job",
    emptyDescription:
      "Add a confirmed CV and return when an eligible job is available.",
    newAssessment: "New assessment",
    heading: "Check how well your CV fits a job",
    subtitle: "Get a private, explainable match preview before you apply.",
    targetJob: "Target job description",
    currentJob: "Current job",
    findJob: "Find a job by keyword or company",
    findJobPlaceholder: "e.g. React, Product Designer, Acme",
    matchingJobs: "Matching jobs",
    searchingJobs: "Searching eligible jobs…",
    noMatchingJobs: "No eligible jobs match that keyword or company.",
    jobSearchErrorTitle: "We could not search jobs right now",
    jobSearchErrorDescription:
      "Your selected job has not changed. Please try the search again.",
    retryJobSearch: "Try again",
    source: "Source: SmartHire job post",
    keyRequirements: "Key requirements found",
    cvToAssess: "CV to assess",
    currentCv: "Current CV",
    pages: (value: number) => `${value} pages`,
    pageCountUnavailable: "Page count unavailable",
    parsedSuccessfully: "Parsed successfully",
    parsingInProgress: "Parsing in progress",
    notReady: "Not ready",
    noCvTitle: "No CV selected yet",
    noCvDescription: "Choose a profile CV or import one from your device.",
    chooseProfileCv: "Choose a CV from your profile",
    noProfileCvs:
      "No profile CVs are available yet. You can import a local CV below without updating your profile.",
    importTitle: "Import a CV from your device",
    importDescription:
      "PDF, DOC, or DOCX, up to 5 MB. No skills or headline update is required; the file is kept for this application.",
    invalidFile: "Choose a PDF, DOC, or DOCX file up to 5 MB.",
    chooseLocalFile: "Choose local file",
    uploading: "Uploading…",
    importCv: "Import CV",
    uploadingSecurely: "Uploading your CV securely…",
    resumingUpload: "Resuming the CV safety check…",
    safetyRetryable:
      "The safety check could not finish. Retry it without uploading the file again.",
    safetyInfected:
      "This CV was blocked because the safety scan detected a threat.",
    safetyStatusError: "The CV could not pass the safety check.",
    retrySafetyCheck: "Retry safety check",
    importFailure:
      "The CV could not be imported. Check the file and try again.",
    unsupportedFile: "Only PDF, DOC, or DOCX files can be assessed here.",
    cvReady:
      "Your CV is ready and selected for this check. It will be included for the recruiter when you submit the application.",
    cvVersionOnly:
      "The assessment uses this CV version only. Your profile data is not changed.",
    compareTitle: "What the assessment will compare",
    comparisonAreas: "Assessment comparison areas",
    comparisons: [
      "Required skills and tools",
      "Evidence quality in the CV",
      "Years and level of experience",
      "Preferred skills and context",
    ],
    privacyDescription:
      "This private result uses the approved 40/60 method. It is not sent to recruiters and does not affect your application.",
    privacyNote:
      "Sensitive personal attributes are excluded. Delete saved previews anytime from CV Match Check.",
    reportIncludes: "Your report will include",
    reportItems: [
      "Overall CV-to-job match score",
      "Skill and experience breakdown",
      "Evidence linked to CV sections",
      "Practical improvement suggestions",
    ],
    howItWorks: "How it works",
    steps: [
      "Read the job requirements",
      "Find supporting evidence in your CV",
      "Calculate an explainable match score",
    ],
    limitationTitle: "Important limitation",
    limitationDescription:
      "The score estimates document fit only. It cannot measure teamwork, motivation, interview performance, or final hiring potential.",
    limitationNote: "Recruiters may use different criteria and weights.",
    analyzing: "Analyzing…",
    analyzeCv: "Analyze my CV",
  },
  errors: {
    CV_NOT_PARSED:
      "This CV is still being prepared. Return when parsing is complete.",
    JOB_UNAVAILABLE: "This job is no longer available for a private check.",
    CV_UNAVAILABLE: "This CV version is no longer available.",
    AUTH_REQUIRED:
      "Your session has expired. Refresh the page and sign in again.",
    FORBIDDEN: "Refresh the page and try again.",
    INVALID_REQUEST: "Choose an available job and a ready CV before analyzing.",
    CONFLICT: "This private check is already being processed.",
    UNAVAILABLE: "This report is no longer available.",
    CV_NOT_RECOGNIZED_AS_CV:
      "This file does not appear to be a CV or resume. Upload a CV and try again.",
    CV_CONTENT_UNREADABLE:
      "We couldn't read any content from this file. Please make sure it's a text-based CV, not a scanned image.",
    SCORING_TIMEOUT:
      "Scoring took too long and was stopped safely. Upload the CV again or try again.",
    SCORING_UNAVAILABLE:
      "Scoring is temporarily unavailable. Please try again shortly.",
    default:
      "We could not complete the private CV match check. Please try again.",
  },
} as const;

const vietnamese = {
  common: {
    breadcrumb: "Điều hướng phân cấp",
    candidatePortal: "Cổng thông tin ứng viên",
    cvMatchCheck: "Đối chiếu CV",
    analysis: "Phân tích",
    matchReport: "Báo cáo đối chiếu",
    report: "Báo cáo",
    backToCheck: "Quay lại Đối chiếu CV",
    tryAgain: "Thử lại",
    ready: "Sẵn sàng",
    selected: "Đã chọn",
    required: "Bắt buộc",
    notSpecified: "Chưa xác định",
    processing: "Đang xử lý",
    complete: "Hoàn tất",
    inProgress: "Đang thực hiện",
    next: "Tiếp theo",
    step: (value: number) => `Bước ${value}`,
    currentJd: "JD hiện tại",
  },
  job: {
    selected: "CÔNG VIỆC ĐÃ CHỌN",
    source: (version: number) =>
      `Tin tuyển dụng SmartHire · Phiên bản ${version}`,
    sourceShort: "Nguồn: Tin tuyển dụng SmartHire",
    employment: {
      CONTRACT: "Hợp đồng",
      FULL_TIME: "Toàn thời gian",
      INTERNSHIP: "Thực tập",
      PART_TIME: "Bán thời gian",
      TEMPORARY: "Tạm thời",
    },
    arrangement: {
      HYBRID: "Kết hợp",
      ON_SITE: "Tại văn phòng",
      ONSITE: "Tại văn phòng",
      REMOTE: "Từ xa",
    },
    flexibleExperience: "Kinh nghiệm linh hoạt",
    entryLevel: "Mới bắt đầu",
    experience: (years: number) => `${years}+ năm`,
  },
  privacy: {
    title: "Riêng tư và công bằng theo thiết kế",
    onlyYou: "Chỉ bạn mới xem được báo cáo này.",
    sensitiveExcluded: "Các thuộc tính cá nhân nhạy cảm được loại trừ.",
    notSent: "Báo cáo không được gửi cho nhà tuyển dụng.",
    privateSelfAssessment: "Tự đánh giá riêng tư",
  },
  stepper: {
    aria: "Các bước đánh giá",
    labels: ["Chọn việc làm và CV", "Phân tích bằng chứng", "Xem báo cáo"],
  },
  analysisSteps: [
    ["Đọc CV của bạn", "Trích xuất kỹ năng, kinh nghiệm và bằng chứng dự án."],
    ["Tìm hiểu công việc", "Đối chiếu các yêu cầu bắt buộc và ưu tiên."],
    ["So sánh bằng chứng", "Kiểm tra từng yêu cầu với bằng chứng trong CV."],
    ["Chuẩn bị gợi ý", "Tạo điểm giải thích được và kế hoạch cải thiện."],
  ],
  status: { analyzing: "Đang phân tích", completed: "Vừa hoàn tất" },
  readyView: {
    heading: "Báo cáo đối chiếu của bạn đã sẵn sàng",
    finishedPrefix: "Phân tích hoàn tất trong",
    secondsUnit: "giây",
    finished: (seconds: number) => `Phân tích hoàn tất trong ${seconds} giây.`,
    reviewBeforeApply: "Hãy xem kết quả trước khi ứng tuyển.",
    limitedStatus: "Bản xem trước rút gọn",
    completedStatus: "Đã hoàn tất phân tích",
    limitedHeadline: "Bản xem trước đối chiếu theo quy tắc đã sẵn sàng",
    highHeadline:
      "Xem bằng chứng có tín hiệu phù hợp cao hơn trước khi ứng tuyển",
    mediumHeadline: "Xem các bằng chứng còn đan xen trước khi ứng tuyển",
    lowHeadline: "Xem các khoảng thiếu bằng chứng trước khi ứng tuyển",
    limitedDescription:
      "Đối chiếu tự động đã hoàn tất. Đánh giá AI không thành công nên chưa thể tính điểm tổng hợp cuối cùng.",
    description:
      "SmartHire đã so sánh bằng chứng trong CV với yêu cầu công việc. Mở báo cáo để xem kỹ năng phù hợp, khoảng thiếu và gợi ý cải thiện thực tế.",
    privatePreview: "Bản xem trước riêng tư · Không chia sẻ với nhà tuyển dụng",
    deterministicMatch: "ĐỐI CHIẾU THEO QUY TẮC",
    previewScore: "ĐIỂM ĐỐI CHIẾU XEM TRƯỚC",
    aiUnavailable: "Chưa có đánh giá AI",
    strongPotential: "Tín hiệu bằng chứng phù hợp cao hơn",
    goodPotential: "Tín hiệu bằng chứng đan xen",
    moreEvidence: "Cần xem thêm bằng chứng",
    progressTitle: "Tiến trình phân tích",
    progressDescription: "Mỗi giai đoạn đã hoàn tất thành công.",
    sourcesTitle: "Nguồn dùng cho báo cáo này",
    parsedUpdated: (date: string) => `Đã trích xuất · Cập nhật ${date}`,
    jobDescriptionVersion: (version: number) =>
      `Mô tả công việc phiên bản ${version}`,
    guidanceTitle: "Đây là gợi ý, không phải quyết định tuyển dụng",
    guidanceDescription:
      "Bản xem trước riêng tư này dùng phương pháp 40/60 đã được phê duyệt: 40% đối chiếu tự động và 60% đánh giá AI. Kết quả phía nhà tuyển dụng chỉ thay đổi khi CV đã nộp hoặc phiên bản công việc thay đổi.",
    insideTitle: "Bên trong báo cáo của bạn",
    requirementEvidence: "Bằng chứng theo yêu cầu",
    requirementEvidenceDescription:
      "Xem nội dung phù hợp và nội dung còn thiếu.",
    explainableScore: "Điểm có thể giải thích",
    explainableScoreDescription: "Xem nhóm tiêu chí, trọng số và công thức.",
    improvementPlan: "Kế hoạch cải thiện",
    improvementPlanDescription:
      "Nhận các hành động trọng tâm trước khi ứng tuyển.",
    openReport: "Xem báo cáo đối chiếu đầy đủ",
    limitedOpenNote: "Báo cáo sẽ mở ở chế độ rút gọn.",
  },
  report: {
    limitedTitle: "Báo cáo đối chiếu CV riêng tư — chế độ rút gọn",
    title: "Báo cáo đối chiếu CV riêng tư",
    role: "Vị trí:",
    company: "Công ty:",
    aiTemporarilyUnavailable: "AI tạm thời chưa khả dụng",
    rerun: "Chạy lại đánh giá AI",
    rerunning: "Đang chạy lại...",
    retryAi: "Thử lại AI",
    retrying: "Đang thử lại...",
    apply: "Ứng tuyển ngay",
    closedApplication: "Công việc này không còn nhận hồ sơ.",
    deterministic: "ĐỐI CHIẾU THEO QUY TẮC",
    sourceLabel: "Nguồn bằng chứng",
    sourceCv: "CV của ứng viên",
    completeEvidence: "Bằng chứng đã đầy đủ cho báo cáo này.",
    incompleteEvidence:
      "Một phần bằng chứng trong CV chưa đầy đủ. Hãy xem điểm như gợi ý giới hạn và kiểm tra phần nội dung còn thiếu.",
    privateScore: "ĐIỂM RIÊNG TƯ",
    auditMethod: "Phương pháp đánh giá:",
    hybridMethod: "Kết hợp 40/60",
    deterministicMethod: "Chỉ đối chiếu theo quy tắc",
    strongMatch: "Tín hiệu bằng chứng phù hợp cao hơn",
    goodMatch: "Tín hiệu bằng chứng đan xen",
    lowMatch: "Khoảng thiếu bằng chứng cần xem",
    unavailable: "Chưa có đánh giá AI",
    highHeadline: "Xem bằng chứng trước khi ứng tuyển",
    mediumHeadline: "Xem các bằng chứng còn đan xen trước khi ứng tuyển",
    limitedHeadline: "Bạn vẫn có thể xem các kết quả đối chiếu theo quy tắc",
    independentPreview: "Bản xem trước độc lập cho ứng viên",
    reducedPreview: "Bản xem trước rút gọn",
    limitedSummary:
      "Đối chiếu tự động đã hoàn tất. Đánh giá AI không thành công nên chưa thể tính điểm tổng hợp cuối cùng.",
    limitedGap: "Hãy thử lại AI để tạo điểm tổng hợp 40/60 đã được phê duyệt.",
    deterministicNote:
      "Cùng CV + cùng phiên bản công việc + cùng phương pháp = cùng điểm nền tảng.",
    privateToYou: "100% riêng tư cho bạn",
    automaticMatching: "Đối chiếu tự động",
    aiEvaluation: "Đánh giá AI",
    weight: (value: number) => `Trọng số ${value}%`,
    qualitySignal: "Tín hiệu chất lượng",
    weightedContribution: (value: number | string) =>
      `Đóng góp có trọng số: ${value}`,
    deterministicAvailable: "Có sẵn từ đối chiếu theo quy tắc",
    aiContributionUnavailable: "Chưa có đóng góp từ AI",
    evidenceCoverage: "Độ bao phủ bằng chứng",
    clearEvidence: (matched: number, total: number) =>
      `Có bằng chứng rõ ràng cho ${matched}/${total} tiêu chí`,
    evidenceConfidence: "Độ tin cậy của bằng chứng",
    confidenceNotScored: "Độ tin cậy không thuộc điểm số",
    high: "Cao",
    medium: "Trung bình",
    low: "Thấp",
    matchedRequirements: "Yêu cầu phù hợp",
    matchedRequirementsDescription:
      "Đã tìm thấy bằng chứng rõ ràng cho các yêu cầu công việc này.",
    noMatchedRequirements:
      "Chưa tìm thấy bằng chứng rõ ràng cho các yêu cầu công việc đã liệt kê.",
    preferred: "ưu tiên",
    missing: "còn thiếu",
    requiredExperience: "Yêu cầu:",
    detectedExperience: "Đã phát hiện:",
    years: (value: number) => `${value} năm`,
    exceedsBy: (value: number) => `Vượt ${value} năm`,
    gapsTitle: "Khoảng thiếu cần bổ sung hoặc xác minh",
    items: (value: number) => `${value} mục`,
    noGaps:
      "Không xác định được khoảng thiếu trong phần đối chiếu theo quy tắc.",
    evidenceTitle: "Bằng chứng tìm thấy trong CV của bạn",
    parsedFrom: (kind: "PDF" | "DOC" | "DOCX") =>
      `Trích xuất từ tệp ${kind} đính kèm`,
    noEvidence: "Không có trích dẫn bằng chứng giới hạn nào.",
    evidenceTypes: {
      PROJECT: "Dự án",
      IMPACT: "Tác động",
      SKILL: "Kỹ năng",
      EXPERIENCE: "Kinh nghiệm",
      EDUCATION: "Học vấn",
      OTHER: "Bằng chứng",
    },
    beforeApply: "Trước khi ứng tuyển",
    focusedActions: (value: number) => `${value} hành động trọng tâm`,
    actionsDescription: "Ba hành động trọng tâm có thể củng cố CV của bạn:",
    guidanceUnavailable:
      "Chưa có gợi ý cải thiện từ AI. Hãy thử lại AI để nhận các hành động ưu tiên, có thể giải thích.",
    recommendedAction: "Bước tiếp theo được đề xuất",
    uploadRecheck: "Tải CV đã chỉnh sửa và kiểm tra lại",
    hybridUnavailable: "Chưa có điểm tổng hợp",
    howCalculated: (score: number | string) => `Cách tính ${score}`,
    finalNotCalculated: "Chưa tính điểm cuối cùng",
    deterministicEvidenceAvailable: "Bằng chứng theo quy tắc vẫn có sẵn.",
    limitedPrivacy:
      "Báo cáo rút gọn này chỉ hiển thị cho bạn. Thử lại AI không gửi hồ sơ ứng tuyển hoặc ảnh hưởng đến xếp hạng của nhà tuyển dụng.",
    fullPrivacy:
      "Báo cáo này chỉ hiển thị cho bạn. Báo cáo không nằm trong hồ sơ ứng tuyển và không thay đổi xếp hạng của nhà tuyển dụng.",
  },
  delete: {
    short: "Xóa",
    trigger: "Xóa bản xem trước này",
    title: "Xóa bản xem trước riêng tư này?",
    description:
      "Quyền truy cập sẽ bị thu hồi ngay. Dữ liệu riêng tư sẽ được xóa vật lý trong vòng 30 ngày. Dữ liệu hồ sơ ứng tuyển và dữ liệu nhà tuyển dụng không bị ảnh hưởng.",
    close: "Đóng xác nhận xóa",
    privacy: "Hành động này chỉ xóa báo cáo Đối chiếu CV riêng tư của bạn.",
    keep: "Giữ bản xem trước",
    deleting: "Đang xóa…",
    confirm: "Xóa bản xem trước",
  },
  pageStates: {
    analyzingTitle: "Đang phân tích CV của bạn",
    analyzingDescription:
      "SmartHire đang so sánh CV đã chọn với các yêu cầu công việc.",
    processing: "ĐANG XỬ LÝ",
    processingTitle: "SmartHire đang kiểm tra bằng chứng trong CV",
    processingDescription:
      "Phân tích riêng tư này so sánh kỹ năng, kinh nghiệm và bằng chứng với công việc đã chọn. Phân tích không thay đổi hồ sơ hoặc đơn ứng tuyển của bạn.",
    processingNote:
      "Bạn có thể rời trang này — chúng tôi sẽ lưu kết quả khi hoàn tất.",
    progressTitle: "Tiến trình phân tích",
    progressDescription:
      "Mỗi giai đoạn được hoàn tất an toàn trước khi báo cáo được xuất bản.",
    nextTitle: "Điều gì xảy ra tiếp theo",
    nextDescription:
      "Khi phân tích hoàn tất, bạn có thể xem bản xem trước trước khi quyết định ứng tuyển.",
    failedTitle: "Không thể hoàn tất kiểm tra riêng tư này",
    failedDescription:
      "Báo cáo chưa được xuất bản vì không thể phân tích an toàn bằng chứng nguồn.",
    unavailableTitle: "Lần kiểm tra đối chiếu này không còn khả dụng.",
    unavailableDescription: "Không thể mở bản xem trước riêng tư này nữa.",
    startNew: "Bắt đầu kiểm tra mới",
    loadErrorTitle: "Không thể tải báo cáo này",
    loadErrorDescription:
      "Hãy thử lại. Bản xem trước riêng tư của bạn chưa thay đổi.",
    retryUnavailable:
      "Đánh giá AI vẫn chưa khả dụng. Báo cáo theo quy tắc của bạn vẫn có sẵn; hãy thử lại sau.",
  },
  errors: {
    CV_NOT_PARSED:
      "CV này vẫn đang được chuẩn bị. Hãy quay lại khi trích xuất hoàn tất.",
    JOB_UNAVAILABLE: "Công việc này không còn khả dụng cho kiểm tra riêng tư.",
    CV_UNAVAILABLE: "Phiên bản CV này không còn khả dụng.",
    AUTH_REQUIRED:
      "Phiên đăng nhập đã hết hạn. Hãy làm mới trang và đăng nhập lại.",
    FORBIDDEN: "Hãy làm mới trang và thử lại.",
    INVALID_REQUEST:
      "Chọn một công việc khả dụng và CV đã sẵn sàng trước khi phân tích.",
    CONFLICT: "Lần kiểm tra riêng tư này đang được xử lý.",
    UNAVAILABLE: "Báo cáo này không còn khả dụng.",
    CV_NOT_RECOGNIZED_AS_CV:
      "Tệp này không giống CV hoặc sơ yếu lý lịch. Hãy tải lên một CV và thử lại.",
    CV_CONTENT_UNREADABLE:
      "Không thể đọc đủ nội dung từ tệp này. Hãy tải lên CV có văn bản và thử lại.",
    SCORING_TIMEOUT:
      "Việc chấm điểm mất quá nhiều thời gian và đã được dừng an toàn. Hãy tải lại CV hoặc thử lại.",
    SCORING_UNAVAILABLE:
      "Dịch vụ chấm điểm tạm thời không khả dụng. Hãy thử lại sau ít phút.",
    default: "Không thể hoàn tất kiểm tra đối chiếu CV riêng tư. Hãy thử lại.",
  },
} as const;

const vietnameseList = {
  loading: "Đang tải các lần đối chiếu CV đã lưu",
  states: {
    READY: "Sẵn sàng",
    LIMITED: "Rút gọn",
    FAILED: "Thất bại",
    ANALYZING: "Đang phân tích",
    QUEUED: "Đang chờ",
  },
  created: (date: string) => `Tạo ngày ${date}`,
  expiresIn: (days: number) => `Hết hạn sau ${days} ngày`,
  viewPreview: "Xem trước",
  eyebrow: "Không gian ứng viên",
  title: "Đối chiếu CV",
  subtitle:
    "Xem lại các bản đối chiếu CV với công việc riêng tư trước khi ứng tuyển.",
  newCheck: "Tạo lần kiểm tra riêng tư",
  privatePreviews: "Các bản xem trước riêng tư của bạn",
  privateBadge: "Riêng tư 100%",
  privateDescription:
    "Chỉ bạn mới xem được các báo cáo này. Chúng không thay đổi thứ hạng của nhà tuyển dụng hoặc hồ sơ ứng tuyển của bạn.",
  loadFailed: "Không thể tải các bản xem trước đã lưu",
  firstTitle: "Kiểm tra lần đối chiếu CV đầu tiên",
  firstDescription:
    "Nhận bản xem trước riêng tư, có thể giải thích cho một công việc trước khi ứng tuyển.",
  startNew: "Bắt đầu lần kiểm tra mới",
  savedTitle: "Các lần đối chiếu CV đã lưu",
  savedDescription:
    "Các bản xem trước CV với công việc riêng tư của bạn được lưu tại đây.",
  storage: "Dung lượng",
  benefits: [
    ["Xem trước ngay", "Phân tích chi tiết chỉ trong vài giây"],
    ["Độ chính xác cao", "Đánh giá từng kỹ năng"],
    ["Hoàn toàn riêng tư", "Không chia sẻ dữ liệu với nhà tuyển dụng"],
  ],
} as const;

const vietnameseSetup = {
  jobUnavailableTitle:
    "Công việc này không còn khả dụng cho lần kiểm tra riêng tư.",
  jobUnavailableDescription:
    "Hãy chọn công việc phù hợp khác để bắt đầu đối chiếu CV riêng tư. CV của bạn không thay đổi.",
  chooseAnotherJob: "Chọn công việc khác",
  cvUnavailableTitle:
    "Phiên bản CV này không còn khả dụng cho lần kiểm tra riêng tư.",
  cvUnavailableDescription:
    "Hãy chọn CV khác trong thư viện CV và quay lại khi CV đã sẵn sàng. CV của bạn không thay đổi.",
  chooseAnotherCv: "Chọn CV khác",
  emptyTitle: "Kiểm tra mức độ phù hợp của CV với công việc",
  emptyDescription:
    "Thêm một CV đã xác nhận và quay lại khi có công việc phù hợp.",
  newAssessment: "Đánh giá mới",
  heading: "Kiểm tra mức độ phù hợp của CV với công việc",
  subtitle:
    "Nhận bản xem trước riêng tư, có thể giải thích trước khi ứng tuyển.",
  targetJob: "Mô tả công việc mục tiêu",
  currentJob: "Công việc hiện tại",
  findJob: "Tìm công việc theo từ khóa hoặc công ty",
  findJobPlaceholder: "Ví dụ: React, Product Designer, Acme",
  matchingJobs: "Các công việc phù hợp",
  searchingJobs: "Đang tìm công việc phù hợp…",
  noMatchingJobs: "Không có công việc phù hợp với từ khóa hoặc công ty này.",
  jobSearchErrorTitle: "Chưa thể tìm công việc lúc này",
  jobSearchErrorDescription:
    "Công việc bạn đã chọn không thay đổi. Hãy thử tìm lại.",
  retryJobSearch: "Thử lại",
  source: "Nguồn: Tin tuyển dụng SmartHire",
  keyRequirements: "Các yêu cầu chính được tìm thấy",
  cvToAssess: "CV cần đánh giá",
  currentCv: "CV hiện tại",
  pages: (value: number) => `${value} trang`,
  pageCountUnavailable: "Chưa có số trang",
  parsedSuccessfully: "Đã trích xuất thành công",
  parsingInProgress: "Đang trích xuất",
  notReady: "Chưa sẵn sàng",
  noCvTitle: "Chưa chọn CV",
  noCvDescription: "Chọn CV trên hồ sơ hoặc nhập CV từ thiết bị của bạn.",
  chooseProfileCv: "Chọn CV từ hồ sơ của bạn",
  noProfileCvs:
    "Chưa có CV nào trong hồ sơ. Bạn có thể nhập CV từ thiết bị bên dưới mà không cập nhật hồ sơ.",
  importTitle: "Nhập CV từ thiết bị của bạn",
  importDescription:
    "PDF, DOC hoặc DOCX, tối đa 5 MB. Không cần cập nhật kỹ năng hoặc tiêu đề hồ sơ; tệp được lưu cho hồ sơ ứng tuyển này.",
  invalidFile: "Chọn tệp PDF, DOC hoặc DOCX có dung lượng tối đa 5 MB.",
  chooseLocalFile: "Chọn tệp trên thiết bị",
  uploading: "Đang tải lên…",
  importCv: "Nhập CV",
  uploadingSecurely: "Đang tải CV lên an toàn…",
  resumingUpload: "Đang tiếp tục kiểm tra an toàn CV…",
  safetyRetryable:
    "Kiểm tra an toàn chưa hoàn tất. Bạn có thể thử lại mà không cần tải lại tệp.",
  safetyInfected: "CV bị chặn vì quá trình quét an toàn phát hiện mối đe dọa.",
  safetyStatusError: "CV không vượt qua kiểm tra an toàn.",
  retrySafetyCheck: "Thử lại kiểm tra an toàn",
  importFailure: "Không thể nhập CV. Hãy kiểm tra tệp và thử lại.",
  unsupportedFile: "Chỉ có thể đánh giá tệp PDF, DOC hoặc DOCX tại đây.",
  cvReady:
    "CV của bạn đã sẵn sàng và được chọn cho lần kiểm tra này. CV sẽ được dùng khi bạn nộp hồ sơ ứng tuyển.",
  cvVersionOnly:
    "Đánh giá chỉ dùng phiên bản CV này. Dữ liệu hồ sơ của bạn không thay đổi.",
  compareTitle: "Nội dung sẽ được đối chiếu",
  comparisonAreas: "Các hạng mục đối chiếu",
  comparisons: [
    "Kỹ năng và công cụ bắt buộc",
    "Chất lượng bằng chứng trong CV",
    "Số năm và cấp độ kinh nghiệm",
    "Kỹ năng ưu tiên và ngữ cảnh",
  ],
  privacyDescription:
    "Kết quả riêng tư này sử dụng phương pháp 40/60 đã được phê duyệt. Kết quả không gửi cho nhà tuyển dụng và không ảnh hưởng đến hồ sơ ứng tuyển của bạn.",
  privacyNote:
    "Các thuộc tính cá nhân nhạy cảm được loại trừ. Bạn có thể xóa bản xem trước đã lưu bất kỳ lúc nào từ Đối chiếu CV.",
  reportIncludes: "Báo cáo của bạn sẽ bao gồm",
  reportItems: [
    "Điểm phù hợp tổng thể giữa CV và công việc",
    "Phân tích kỹ năng và kinh nghiệm",
    "Bằng chứng được liên kết tới các phần trong CV",
    "Gợi ý cải thiện thiết thực",
  ],
  howItWorks: "Cách hoạt động",
  steps: [
    "Đọc các yêu cầu công việc",
    "Tìm bằng chứng hỗ trợ trong CV của bạn",
    "Tính điểm phù hợp có thể giải thích",
  ],
  limitationTitle: "Lưu ý quan trọng",
  limitationDescription:
    "Điểm số chỉ ước tính mức độ phù hợp của tài liệu. Điểm số không thể đo lường tinh thần làm việc nhóm, động lực, kết quả phỏng vấn hoặc tiềm năng tuyển dụng cuối cùng.",
  limitationNote: "Nhà tuyển dụng có thể dùng tiêu chí và trọng số khác.",
  analyzing: "Đang phân tích…",
  analyzeCv: "Phân tích CV của tôi",
} as const;

export function privateMatchCopy(locale: PrivateMatchLocale) {
  return locale === "vi"
    ? { ...vietnamese, list: vietnameseList, setup: vietnameseSetup }
    : english;
}
