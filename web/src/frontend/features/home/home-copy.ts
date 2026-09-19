import type { HomeLocale } from "./home-page-model";
import type { CareerPathSlug } from "@/shared/contracts/jobs/career-paths";

type CuratedCard = { title: string; body: string };
type CareerPathCard = CuratedCard & { slug: CareerPathSlug };
type HomeAccentTone = "indigo" | "violet" | "green" | "amber" | "rose" | "cyan";
type HomeProcessStep = CuratedCard & {
  key: "profile" | "analysis" | "review" | "feedback";
  label: string;
  tone: Exclude<HomeAccentTone, "rose" | "cyan">;
};
type HomeTrustItem = CuratedCard & {
  key: "transparency" | "speed" | "relevance" | "privacy";
  tone: HomeAccentTone;
};

export type HomeCopy = {
  navigation: {
    label: string;
    exploreJobs: string;
    careerPaths: string;
    opportunities: string;
    smartMatch: string;
    howItWorks: string;
    candidateTrust: string;
    companies: string;
    mobileMenu: string;
    language: string;
    vietnameseCode: string;
    englishCode: string;
  };
  account: {
    login: string;
    signup: string;
    logout: string;
    loggingOut: string;
    logoutSuccess: string;
    logoutError: string;
    profileLabel: string;
    memberFallback: string;
    shortcutsLabel: string;
    dashboard: string;
    applications: string;
    savedJobs: string;
    notificationLabel: string;
    notificationPromptTitle: string;
    notificationPromptDescription: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    description: string;
    keyword: string;
    keywordPlaceholder: string;
    location: string;
    locationPlaceholder: string;
    search: string;
    invalidSearch: string;
    findJobsNow: string;
    forEmployers: string;
    cvLabel: string;
    aiLabel: string;
    cvScanLabel: string;
    cvScoreLabel: string;
    createProfile: string;
    postJob: string;
    postJobPending: string;
    postJobChangesRequested: string;
    postJobUnavailable: string;
  };
  filters: Record<string, string>;
  common: {
    displayOnly: string;
    loading: string;
    reloadHome: string;
    viewAllJobs: string;
    viewRole: string;
    accountRequired: string;
  };
  whatsNew: {
    eyebrow: string;
    title: string;
    cards: readonly (CuratedCard & { label: string; type: string })[];
  };
  howItWorks: {
    eyebrow: string;
    title: string;
    description: string;
    steps: readonly HomeProcessStep[];
  };
  candidateTrust: {
    eyebrow: string;
    title: string;
    description: string;
    cards: readonly HomeTrustItem[];
  };
  smartMatch: {
    eyebrow: string;
    title: string;
    personal: string;
    illustrative: string;
    personalScore: string;
    profileEstimate: string;
    profileSignalsCompared: string;
    cvScore: string;
    sampleScore: string;
    matchingSkills: string;
    improvementAreas: string;
    limitations: string;
    profileLimitation: string;
    illustrativeLimitation: string;
    estimateLimitation: string;
    decisionNotice: string;
    illustrativeSkills: readonly string[];
    illustrativeAreas: readonly string[];
    badge: string;
    candidateToken: string;
    roleToken: string;
    candidateLabel: string;
    roleLabel: string;
    illustrativeCandidateName: string;
    illustrativeJobTitle: string;
    compositionTitle: string;
    skillsContribution: string;
    roleAndSkillsContribution: string;
    preferencesContribution: string;
    experienceContribution: string;
    educationContribution: string;
    unmatchedContribution: string;
    insufficientData: string;
    scoreSuffix: string;
    scoreLabel: string;
    illustrativeCaption: string;
    estimateDetailsLabel: string;
    cvMatchLimitation: string;
    cvMatchIncompleteLimitation: string;
  };
  careerPaths: {
    eyebrow: string;
    title: string;
    openJobs: string;
    noJobs: string;
    countPending: string;
    cards: readonly CareerPathCard[];
  };
  spotlight: {
    eyebrow: string;
    title: string;
    summaryLabel: string;
    openPositions: string;
    empty: string;
    error: string;
  };
  companyHiring: {
    eyebrow: string;
    title: string;
    summary: string;
    summaryUnavailable: string;
    openPosition: string;
    openPositions: string;
    moreCompanies: string;
    viewAll: string;
    empty: string;
    error: string;
  };
  jobs: {
    eyebrow: string;
    title: string;
    matchEstimate: string;
    bestMatch: string;
    topSuggestion: string;
    lowMatchNotice: string;
    featured: string;
    postedRecently: string;
    negotiableSalary: string;
    monthlySalaryUnit: string;
    hourlySalaryUnit: string;
    yearlySalaryUnit: string;
    profileMatch: string;
    profileMatchEstimate: string;
    cvMatchScore: string;
    cvMatchPrivate: string;
    cvMatchContext: string;
    cvMatchSourceLabel: string;
    cvMatchIncomplete: string;
    reviewCvMatch: string;
    matchSignals: string;
    viewJobDetails: string;
    loginForMatch: string;
    loginForMatchDescription: string;
    completeProfileForMatch: string;
    completeProfileDescription: string;
    completeProfileAction: string;
    completeProfileNote: string;
    lockedMatchLabel: string;
    noPersonalMatches: string;
    noPersonalMatchesDescription: string;
    matchUnavailable: string;
    matchUnavailableDescription: string;
    matchUnavailableLabel: string;
    browseOpportunities: string;
    save: string;
    saved: string;
    saving: string;
    saveSuccess: string;
    removeSuccess: string;
    saveError: string;
    empty: string;
    error: string;
  };
  growth: {
    eyebrow: string;
    title: string;
    cards: readonly CuratedCard[];
  };
  events: {
    eyebrow: string;
    title: string;
    cards: readonly CuratedCard[];
  };
  finalCta: {
    seekerEyebrow: string;
    seekerTitle: string;
    employerEyebrow: string;
    employerTitle: string;
  };
  aiCvPolicy: {
    backToHome: string;
    effective: string;
    policyVersion: string;
    eyebrow: string;
    title: string;
    description: string;
    principles: readonly (CuratedCard & {
      key: "optional" | "human" | "integrity";
    })[];
    sections: readonly {
      title: string;
      paragraphs: readonly string[];
    }[];
    importantNoticeLabel: string;
    importantNotice: string;
    dataHighlights: readonly string[];
    supportAction: string;
    copyright: string;
  };
  footer: {
    description: string;
    label: string;
    explore: string;
    information: string;
    informationLabel: string;
    jobs: string;
    companies: string;
    support: string;
    privacy: string;
    terms: string;
    cookies: string;
    aiCvPolicy: string;
    establishedYear: number;
    copyright: string;
    aiNotice: string;
  };
};

export const homeCopy = {
  en: {
    navigation: {
      label: "Primary navigation",
      exploreJobs: "Explore Jobs",
      careerPaths: "Career paths",
      opportunities: "Opportunities",
      smartMatch: "Smart Match",
      howItWorks: "How it works",
      candidateTrust: "Our commitment",
      companies: "Hiring companies",
      mobileMenu: "Open navigation menu",
      language: "Home language",
      vietnameseCode: "VI",
      englishCode: "EN",
    },
    account: {
      login: "Log in",
      signup: "Sign up",
      logout: "Log out",
      loggingOut: "Logging out…",
      logoutSuccess: "You have been logged out.",
      logoutError: "Could not log out. Please try again.",
      profileLabel: "Open your profile",
      memberFallback: "Smart Hire member",
      shortcutsLabel: "Personal shortcuts",
      dashboard: "My Dashboard",
      applications: "My Applications",
      savedJobs: "Saved Jobs",
      notificationLabel: "Notifications",
      notificationPromptTitle: "Stay informed",
      notificationPromptDescription:
        "Sign in or create an account to receive system notifications.",
    },
    hero: {
      eyebrow: "SMART HIRE — AI-POWERED HIRING",
      title: "AI understands your CV. You choose what’s next.",
      description:
        "AI reads CV signals so candidates can show their strengths and teams can discover relevant talent faster.",
      keyword: "Keyword",
      keywordPlaceholder: "Role, skill, or company",
      location: "Location",
      locationPlaceholder: "City or province",
      search: "Search jobs",
      invalidSearch: "Review the search filters and try again.",
      findJobsNow: "Find jobs now",
      forEmployers: "For employers →",
      cvLabel: "CV",
      aiLabel: "AI",
      cvScanLabel: "CV analysis in progress",
      cvScoreLabel: "Evidence signal",
      createProfile: "Create Profile",
      postJob: "Post a Job",
      postJobPending: "Under review",
      postJobChangesRequested: "Update application",
      postJobUnavailable: "Status unavailable",
    },
    filters: {
      ONSITE: "On-site",
      HYBRID: "Hybrid",
      REMOTE: "Remote",
      FULL_TIME: "Full-time",
      PART_TIME: "Part-time",
      CONTRACT: "Contract",
      INTERNSHIP: "Internship",
      TEMPORARY: "Temporary",
      ENTRY: "Entry level",
      JUNIOR: "Junior",
      MID: "Mid-level",
      SENIOR: "Senior",
      LEAD: "Lead",
      MANAGER: "Manager",
    },
    common: {
      displayOnly: "Illustrative content",
      loading: "Loading…",
      reloadHome: "Reload Home",
      viewAllJobs: "View all jobs",
      viewRole: "View role",
      accountRequired: "Log in to save this job",
    },
    whatsNew: {
      eyebrow: "COMMUNITY",
      title: "What's New Today?",
      cards: [
        {
          type: "career",
          label: "Career post",
          title: "Turn a class project into a clear portfolio story",
          body: "Show the problem, your role, the decisions you made, and the outcome.",
        },
        {
          type: "hiring",
          label: "Company hiring post",
          title: "Vietnam product teams are welcoming new graduates",
          body: "Explore entry-level roles with clear skills, location, and work-arrangement details.",
        },
        {
          type: "guidance",
          label: "Career guidance",
          title: "Prepare useful questions for your first interview",
          body: "Ask about mentoring, team collaboration, and how success is measured in the first months.",
        },
      ],
    },
    howItWorks: {
      eyebrow: "PROCESS",
      title: "How Smart Hire works",
      description:
        "Four steps from creating a profile to receiving feedback — without waiting in silence.",
      steps: [
        {
          key: "profile",
          label: "STEP 01",
          tone: "indigo",
          title: "Create your profile",
          body: "Upload your CV or complete your profile directly in a few minutes.",
        },
        {
          key: "analysis",
          label: "STEP 02",
          tone: "violet",
          title: "AI analysis and guidance",
          body: "The system analyses your profile and estimates fit for each job.",
        },
        {
          key: "review",
          label: "STEP 03",
          tone: "green",
          title: "Recruiter review",
          body: "Your profile and fit estimate are shared with the recruiter for review and a decision.",
        },
        {
          key: "feedback",
          label: "STEP 04",
          tone: "amber",
          title: "Receive feedback",
          body: "Track each application and receive feedback directly in Smart Hire.",
        },
      ],
    },
    candidateTrust: {
      eyebrow: "COMMITMENT",
      title: "Why candidates trust Smart Hire",
      description:
        "Principles we uphold in every feature — not just marketing promises.",
      cards: [
        {
          key: "transparency",
          tone: "indigo",
          title: "Transparent AI guidance",
          body: "Every fit estimate includes clear reasons, not an opaque black box.",
        },
        {
          key: "speed",
          tone: "rose",
          title: "Faster than the old way",
          body: "You do not have to wait weeks to know whether your profile has been reviewed.",
        },
        {
          key: "relevance",
          tone: "green",
          title: "Relevant job guidance",
          body: "We prioritise jobs that align with your skills and experience.",
        },
        {
          key: "privacy",
          tone: "cyan",
          title: "You control your data",
          body: "Your profile information is used transparently and shared according to the privacy choices you set.",
        },
      ],
    },
    smartMatch: {
      eyebrow: "TRANSPARENT GUIDANCE",
      title: "Smart Match",
      personal: "Personal job-fit recommendation",
      illustrative: "Illustrative Smart Match example",
      personalScore: "Personal match estimate",
      profileEstimate: "Profile estimate",
      profileSignalsCompared: "Profile signals compared",
      cvScore: "CV Match Check score: {score}%",
      sampleScore: "Illustrative match estimate",
      matchingSkills: "Matching skills",
      improvementAreas: "Improvement areas",
      limitations: "Limitations",
      profileLimitation:
        "This recommendation uses only the existing structured profile signals available to Smart Hire.",
      illustrativeLimitation:
        "This example does not use your profile or a live job.",
      estimateLimitation:
        "The estimate supports job discovery and may not reflect every requirement or team preference.",
      decisionNotice:
        "This is a recommendation, not applicant screening or a hiring decision.",
      illustrativeSkills: ["TypeScript", "Teamwork", "Problem solving"],
      illustrativeAreas: ["Portfolio evidence", "Project experience"],
      badge: "AI Smart Match",
      candidateToken: "CV",
      roleToken: "JD",
      candidateLabel: "Candidate",
      roleLabel: "Open role",
      illustrativeCandidateName: "Minh Anh",
      illustrativeJobTitle: "Frontend Developer",
      compositionTitle: "Fit-score composition",
      skillsContribution: "Skills",
      roleAndSkillsContribution: "Role & skills",
      preferencesContribution: "Location & pay",
      experienceContribution: "Experience",
      educationContribution: "Education",
      unmatchedContribution: "Requirements not yet matched",
      insufficientData: "Insufficient data",
      scoreSuffix: "fit",
      scoreLabel: "Fit estimate: {score}%",
      illustrativeCaption:
        "An illustration of how AI can compare a candidate profile with job signals — no real data is used.",
      estimateDetailsLabel: "About this fit estimate",
      cvMatchLimitation:
        "This is the latest completed CV Match Check for this role, based on the CV and job description used when you ran the check.",
      cvMatchIncompleteLimitation:
        "This CV Match Check contains incomplete parser evidence. Review the private report before relying on the score.",
    },
    careerPaths: {
      eyebrow: "DIRECTIONS",
      title: "Career Paths",
      openJobs: "{count} open jobs",
      noJobs: "No open jobs yet",
      countPending: "Updating open jobs",
      cards: [
        {
          slug: "software-engineering",
          title: "Software Engineering",
          body: "Build dependable digital products.",
        },
        {
          slug: "ui-ux-design",
          title: "UI/UX Design",
          body: "Design useful and inclusive experiences.",
        },
        {
          slug: "data-ai",
          title: "Data & AI",
          body: "Turn data into responsible decisions.",
        },
        {
          slug: "digital-marketing",
          title: "Digital Marketing",
          body: "Connect brands with the right audiences.",
        },
        {
          slug: "business-sales",
          title: "Business & Sales",
          body: "Create trusted, sustainable growth.",
        },
        {
          slug: "product-management",
          title: "Product Management",
          body: "Guide products toward real user needs.",
        },
      ],
    },
    spotlight: {
      eyebrow: "EMPLOYERS",
      title: "Employer Spotlight",
      summaryLabel: "Public company summary",
      openPositions: "open positions",
      empty: "No verified public companies are available yet.",
      error: "Company information is temporarily unavailable.",
    },
    companyHiring: {
      eyebrow: "CONNECT",
      title: "Companies hiring now",
      summary: "{count} companies are hiring through Smart Hire.",
      summaryUnavailable: "Browse companies with open roles on Smart Hire.",
      openPosition: "1 open position",
      openPositions: "{count} open positions",
      moreCompanies: "More companies",
      viewAll: "View all →",
      empty: "No companies have open roles right now.",
      error: "Company information is temporarily unavailable.",
    },
    jobs: {
      eyebrow: "DISCOVER",
      title: "Trending Opportunities",
      matchEstimate: "match estimate",
      bestMatch: "BEST MATCH FOR YOU",
      topSuggestion: "TOP SUGGESTION",
      lowMatchNotice:
        "This is a low-confidence estimate because your current profile has limited evidence; review the role requirements before deciding.",
      featured: "FEATURED",
      postedRecently: "Recently posted",
      negotiableSalary: "Negotiable",
      monthlySalaryUnit: "m / month",
      hourlySalaryUnit: "m / hour",
      yearlySalaryUnit: "m / year",
      profileMatch: "Fit with your profile",
      profileMatchEstimate: "Profile fit estimate",
      cvMatchScore: "CV Match Check score",
      cvMatchPrivate: "Private result for this exact role",
      cvMatchContext:
        "Checked against your latest CV and the current job description.",
      cvMatchSourceLabel: "Source: CV Match Check",
      cvMatchIncomplete:
        "Some CV evidence is incomplete; review the private report.",
      reviewCvMatch: "Review match report",
      matchSignals: "Profile signals compared",
      viewJobDetails: "View job details",
      loginForMatch: "Log in to view your fit",
      loginForMatchDescription:
        "Log in, then add your skills and experience to view job-fit estimates.",
      completeProfileForMatch: "Complete your profile to view your fit",
      completeProfileDescription:
        "Add your skills and experience so AI can estimate your fit for each role.",
      completeProfileAction: "Complete your profile now →",
      completeProfileNote: "Usually takes about two minutes",
      lockedMatchLabel: "Profile match is locked",
      noPersonalMatches: "No personalized matches are available yet",
      noPersonalMatchesDescription:
        "Your profile is ready. We will show a match when a suitable opportunity is available.",
      matchUnavailable: "We can't calculate your fit right now",
      matchUnavailableDescription:
        "Your profile may be ready, but matching data is temporarily unavailable. You can still explore all opportunities.",
      matchUnavailableLabel: "Personalized match unavailable",
      browseOpportunities: "Browse opportunities",
      save: "Save job",
      saved: "Saved",
      saving: "Saving…",
      saveSuccess: "Job saved.",
      removeSuccess: "Job removed from saved jobs.",
      saveError: "Could not update saved jobs. Please try again.",
      empty: "No public opportunities are available yet.",
      error: "Jobs are temporarily unavailable.",
    },
    growth: {
      eyebrow: "GROW",
      title: "Career Growth Hub",
      cards: [
        {
          title: "Clear CV",
          body: "Present relevant strengths in one readable page.",
        },
        {
          title: "Confident interviews",
          body: "Practice STAR with specific examples.",
        },
        {
          title: "Story-led portfolio",
          body: "Explain the problem, role, decisions, and outcome.",
        },
        {
          title: "Skills roadmap",
          body: "Choose the next skill for your career direction.",
        },
      ],
    },
    events: {
      eyebrow: "CONNECT",
      title: "Career Events",
      cards: [
        { title: "CV workshop", body: "Illustrative online workshop" },
        {
          title: "Portfolio review",
          body: "Illustrative review in Ho Chi Minh City",
        },
        {
          title: "Career day",
          body: "Illustrative university career day in Hanoi",
        },
        {
          title: "HR Q&A",
          body: "Illustrative online question-and-answer session",
        },
      ],
    },
    finalCta: {
      seekerEyebrow: "YOUR NEXT STEP",
      seekerTitle: "Build a profile so the right opportunities can find you.",
      employerEyebrow: "FOR EMPLOYERS",
      employerTitle: "Find the right candidates for your open roles.",
    },
    aiCvPolicy: {
      backToHome: "Back to Home",
      effective: "Effective",
      policyVersion: "Policy version",
      eyebrow: "SMART HIRE POLICY & TRANSPARENCY",
      title: "AI & CV analysis policy",
      description:
        "Smart Hire may use AI to provide a reference assessment of how well your CV fits the role you apply for. This policy is published independently by Smart Hire on this platform.",
      principles: [
        {
          key: "optional",
          title: "Always optional",
          body: "AI analysis is never required to submit an application.",
        },
        {
          key: "human",
          title: "No automatic rejection",
          body: "AI results are a reference for you and recruiters, never a hiring decision.",
        },
        {
          key: "integrity",
          title: "Your CV stays intact",
          body: "AI analysis does not alter the content of your original CV.",
        },
      ],
      sections: [
        {
          title: "How AI is used",
          paragraphs: [
            "When you actively choose to give consent, Smart Hire analyzes skills, experience, and professional information in your CV to provide a fit estimate and a short explanation.",
          ],
        },
        {
          title: "Your choice",
          paragraphs: [
            "AI analysis is optional and is not required to apply.",
            "If you do not consent, your application is still sent to the recruiter as usual. Smart Hire simply does not generate an AI fit score or recommendation for that application.",
          ],
        },
        {
          title: "Data and transparency",
          paragraphs: [
            "Smart Hire uses your CV and the role you apply for only to the extent needed for the stated purpose. The result remains connected to that specific application.",
            "You can contact Smart Hire to ask about an analysis result or request human support.",
          ],
        },
        {
          title: "Contact and concerns",
          paragraphs: [
            "If you have questions about this policy or want to share feedback about how AI is used, contact the Smart Hire support team from your account.",
          ],
        },
      ],
      importantNoticeLabel: "Important",
      importantNotice:
        "AI assessments are informational only and are never the final hiring decision.",
      dataHighlights: [
        "Your original CV is not changed",
        "Candidates are not rejected automatically",
      ],
      supportAction: "Open account support",
      copyright: "© {year} Smart Hire. All rights reserved.",
    },
    footer: {
      description:
        "An intelligent recruitment platform and professional career community.",
      label: "Footer navigation",
      explore: "Explore",
      information: "Information",
      informationLabel: "Company information",
      jobs: "Jobs",
      companies: "Hiring companies",
      support: "Help & support",
      privacy: "Privacy",
      terms: "Terms",
      cookies: "Cookies",
      aiCvPolicy: "AI & CV policy",
      establishedYear: 2026,
      copyright: "© {year} Smart Hire. All rights reserved.",
      aiNotice: "AI supports recommendations and never makes hiring decisions.",
    },
  },
  vi: {
    navigation: {
      label: "Điều hướng chính",
      exploreJobs: "Khám phá việc làm",
      careerPaths: "Lộ trình",
      opportunities: "Cơ hội",
      smartMatch: "Smart Match",
      howItWorks: "Cách hoạt động",
      candidateTrust: "Cam kết",
      companies: "Doanh nghiệp tuyển dụng",
      mobileMenu: "Mở menu điều hướng",
      language: "Ngôn ngữ trang chủ",
      vietnameseCode: "VI",
      englishCode: "EN",
    },
    account: {
      login: "Đăng nhập",
      signup: "Đăng ký",
      logout: "Đăng xuất",
      loggingOut: "Đang đăng xuất…",
      logoutSuccess: "Bạn đã đăng xuất.",
      logoutError: "Không thể đăng xuất. Vui lòng thử lại.",
      profileLabel: "Mở hồ sơ của bạn",
      memberFallback: "Thành viên Smart Hire",
      shortcutsLabel: "Lối tắt cá nhân",
      dashboard: "Trang tổng quan",
      applications: "Đơn ứng tuyển của tôi",
      savedJobs: "Việc làm đã lưu",
      notificationLabel: "Thông báo",
      notificationPromptTitle: "Không bỏ lỡ thông tin mới",
      notificationPromptDescription:
        "Đăng nhập hoặc tạo tài khoản để nhận thông báo từ hệ thống.",
    },
    hero: {
      eyebrow: "SMART HIRE — TUYỂN DỤNG THÔNG MINH BẰNG AI",
      title: "AI hiểu CV. Bạn chọn bước tiếp theo.",
      description:
        "AI đọc các tín hiệu trong CV để ứng viên làm rõ thế mạnh và doanh nghiệp xem hồ sơ phù hợp nhanh hơn.",
      keyword: "Từ khóa",
      keywordPlaceholder: "Vị trí, kỹ năng hoặc công ty",
      location: "Địa điểm",
      locationPlaceholder: "Tỉnh hoặc thành phố",
      search: "Tìm việc",
      invalidSearch: "Hãy kiểm tra bộ lọc và thử lại.",
      findJobsNow: "Tìm việc ngay",
      forEmployers: "Dành cho nhà tuyển dụng →",
      cvLabel: "CV",
      aiLabel: "AI",
      cvScanLabel: "AI đang đọc CV",
      cvScoreLabel: "Tín hiệu bằng chứng",
      createProfile: "Tạo hồ sơ",
      postJob: "Đăng tin tuyển dụng",
      postJobPending: "Đang xét duyệt",
      postJobChangesRequested: "Cập nhật hồ sơ",
      postJobUnavailable: "Chưa thể kiểm tra trạng thái",
    },
    filters: {
      ONSITE: "Tại văn phòng",
      HYBRID: "Kết hợp",
      REMOTE: "Từ xa",
      FULL_TIME: "Toàn thời gian",
      PART_TIME: "Bán thời gian",
      CONTRACT: "Hợp đồng",
      INTERNSHIP: "Thực tập",
      TEMPORARY: "Tạm thời",
      ENTRY: "Mới bắt đầu",
      JUNIOR: "Junior",
      MID: "Trung cấp",
      SENIOR: "Cao cấp",
      LEAD: "Trưởng nhóm",
      MANAGER: "Quản lý",
    },
    common: {
      displayOnly: "Nội dung minh hoạ",
      loading: "Đang tải…",
      reloadHome: "Tải lại trang chủ",
      viewAllJobs: "Xem tất cả việc làm",
      viewRole: "Xem vị trí",
      accountRequired: "Đăng nhập để lưu việc làm này",
    },
    whatsNew: {
      eyebrow: "CỘNG ĐỒNG",
      title: "Hôm nay có gì mới?",
      cards: [
        {
          type: "career",
          label: "Bài viết nghề nghiệp",
          title: "Biến đồ án thành câu chuyện portfolio rõ ràng",
          body: "Trình bày vấn đề, vai trò, quyết định của bạn và kết quả đạt được.",
        },
        {
          type: "hiring",
          label: "Doanh nghiệp tuyển dụng",
          title:
            "Các đội ngũ sản phẩm Việt Nam chào đón sinh viên mới tốt nghiệp",
          body: "Khám phá vị trí đầu vào với kỹ năng, địa điểm và hình thức làm việc rõ ràng.",
        },
        {
          type: "guidance",
          label: "Hướng dẫn nghề nghiệp",
          title: "Chuẩn bị câu hỏi hữu ích cho buổi phỏng vấn đầu tiên",
          body: "Hỏi về cố vấn, cách phối hợp trong đội và kỳ vọng trong những tháng đầu.",
        },
      ],
    },
    howItWorks: {
      eyebrow: "QUY TRÌNH",
      title: "Cách Smart Hire hoạt động",
      description:
        "4 bước từ lúc tạo hồ sơ đến khi nhận phản hồi — không cần chờ đợi trong im lặng.",
      steps: [
        {
          key: "profile",
          label: "BƯỚC 01",
          tone: "indigo",
          title: "Tạo hồ sơ",
          body: "Tải CV lên hoặc điền hồ sơ trực tiếp trong vài phút.",
        },
        {
          key: "analysis",
          label: "BƯỚC 02",
          tone: "violet",
          title: "AI phân tích & gợi ý",
          body: "Hệ thống phân tích và tính độ phù hợp với từng việc làm.",
        },
        {
          key: "review",
          label: "BƯỚC 03",
          tone: "green",
          title: "Nhà tuyển dụng xem xét",
          body: "Hồ sơ cùng mức độ phù hợp được gửi đến nhà tuyển dụng để xem xét và đưa ra quyết định.",
        },
        {
          key: "feedback",
          label: "BƯỚC 04",
          tone: "amber",
          title: "Nhận phản hồi",
          body: "Theo dõi trạng thái ứng tuyển và nhận phản hồi ngay trên hệ thống.",
        },
      ],
    },
    candidateTrust: {
      eyebrow: "CAM KẾT",
      title: "Vì sao ứng viên tin dùng Smart Hire",
      description:
        "Những nguyên tắc chúng tôi giữ đúng ở mọi tính năng — không chỉ là lời hứa marketing.",
      cards: [
        {
          key: "transparency",
          tone: "indigo",
          title: "Minh bạch từ AI",
          body: "Mỗi mức độ phù hợp đều có lý do cụ thể — không phải một hộp đen khó hiểu.",
        },
        {
          key: "speed",
          tone: "rose",
          title: "Nhanh hơn cách cũ",
          body: "Không cần chờ hàng tuần để biết hồ sơ của bạn có được xem hay không.",
        },
        {
          key: "relevance",
          tone: "green",
          title: "Gợi ý đúng việc",
          body: "Ưu tiên những việc làm phù hợp với kỹ năng và kinh nghiệm của bạn.",
        },
        {
          key: "privacy",
          tone: "cyan",
          title: "Bạn kiểm soát dữ liệu",
          body: "Thông tin hồ sơ được sử dụng minh bạch và chia sẻ theo quyền riêng tư mà bạn thiết lập.",
        },
      ],
    },
    smartMatch: {
      eyebrow: "GỢI Ý MINH BẠCH",
      title: "Smart Match",
      personal: "Gợi ý việc làm phù hợp với bạn",
      illustrative: "Ví dụ Smart Match minh họa",
      personalScore: "Ước tính phù hợp cá nhân",
      profileEstimate: "Ước tính từ hồ sơ",
      profileSignalsCompared: "Tín hiệu hồ sơ được đối chiếu",
      cvScore: "Điểm CV Match Check: {score}%",
      sampleScore: "Ước tính phù hợp minh họa",
      matchingSkills: "Kỹ năng phù hợp",
      improvementAreas: "Điểm có thể cải thiện",
      limitations: "Giới hạn",
      profileLimitation:
        "Gợi ý chỉ sử dụng các tín hiệu hồ sơ có cấu trúc hiện có trên Smart Hire.",
      illustrativeLimitation:
        "Ví dụ này không sử dụng hồ sơ của bạn hoặc một việc làm đang tuyển.",
      estimateLimitation:
        "Ước tính hỗ trợ khám phá việc làm và có thể chưa phản ánh mọi yêu cầu hoặc ưu tiên của đội ngũ.",
      decisionNotice:
        "Đây là gợi ý, không phải sàng lọc ứng viên hay quyết định tuyển dụng.",
      illustrativeSkills: ["TypeScript", "Làm việc nhóm", "Giải quyết vấn đề"],
      illustrativeAreas: ["Minh chứng portfolio", "Kinh nghiệm dự án"],
      badge: "AI Smart Match",
      candidateToken: "CV",
      roleToken: "JD",
      candidateLabel: "Ứng viên",
      roleLabel: "Vị trí tuyển",
      illustrativeCandidateName: "Minh Anh",
      illustrativeJobTitle: "Frontend Developer",
      compositionTitle: "Cấu thành điểm phù hợp",
      skillsContribution: "Kỹ năng",
      roleAndSkillsContribution: "Vai trò & kỹ năng",
      preferencesContribution: "Địa điểm & lương",
      experienceContribution: "Kinh nghiệm",
      educationContribution: "Học vấn",
      unmatchedContribution: "Yêu cầu chưa phù hợp",
      insufficientData: "Chưa đủ dữ liệu",
      scoreSuffix: "phù hợp",
      scoreLabel: "Ước tính phù hợp: {score}%",
      illustrativeCaption:
        "Ví dụ minh hoạ cách AI ghép hồ sơ ứng viên với yêu cầu công việc — không dùng dữ liệu thật.",
      estimateDetailsLabel: "Thông tin về ước tính phù hợp",
      cvMatchLimitation:
        "Đây là kết quả CV Match Check hoàn tất gần nhất cho vị trí này, dựa trên CV và mô tả công việc bạn đã dùng khi chấm.",
      cvMatchIncompleteLimitation:
        "Kết quả CV Match Check này còn thiếu một phần dữ liệu phân tích. Hãy xem báo cáo riêng trước khi dựa vào điểm.",
    },
    careerPaths: {
      eyebrow: "ĐỊNH HƯỚNG",
      title: "Lộ trình nghề nghiệp",
      openJobs: "{count} việc làm đang mở",
      noJobs: "Chưa có việc làm",
      countPending: "Đang cập nhật số việc làm",
      cards: [
        {
          slug: "software-engineering",
          title: "Kỹ thuật phần mềm",
          body: "Xây dựng sản phẩm số đáng tin cậy.",
        },
        {
          slug: "ui-ux-design",
          title: "Thiết kế UI/UX",
          body: "Thiết kế trải nghiệm hữu ích và hòa nhập.",
        },
        {
          slug: "data-ai",
          title: "Dữ liệu & AI",
          body: "Biến dữ liệu thành quyết định có trách nhiệm.",
        },
        {
          slug: "digital-marketing",
          title: "Digital Marketing",
          body: "Kết nối thương hiệu với đúng khách hàng.",
        },
        {
          slug: "business-sales",
          title: "Kinh doanh & Bán hàng",
          body: "Tạo tăng trưởng bền vững dựa trên niềm tin.",
        },
        {
          slug: "product-management",
          title: "Quản lý sản phẩm",
          body: "Dẫn dắt sản phẩm theo nhu cầu thực tế.",
        },
      ],
    },
    spotlight: {
      eyebrow: "NHÀ TUYỂN DỤNG",
      title: "Doanh nghiệp nổi bật",
      summaryLabel: "Giới thiệu công khai của công ty",
      openPositions: "vị trí đang mở",
      empty: "Chưa có doanh nghiệp công khai đã xác minh.",
      error: "Thông tin doanh nghiệp tạm thời chưa khả dụng.",
    },
    companyHiring: {
      eyebrow: "KẾT NỐI",
      title: "Doanh nghiệp đang tuyển dụng",
      summary: "{count} doanh nghiệp đang tuyển dụng trên Smart Hire.",
      summaryUnavailable: "Khám phá doanh nghiệp đang có vị trí tuyển dụng.",
      openPosition: "1 vị trí đang tuyển",
      openPositions: "{count} vị trí đang tuyển",
      moreCompanies: "Doanh nghiệp khác",
      viewAll: "Xem tất cả →",
      empty: "Chưa có doanh nghiệp đang tuyển dụng.",
      error: "Thông tin doanh nghiệp tạm thời chưa khả dụng.",
    },
    jobs: {
      eyebrow: "KHÁM PHÁ",
      title: "Cơ hội đang nổi bật",
      matchEstimate: "ước tính phù hợp",
      bestMatch: "PHÙ HỢP NHẤT VỚI BẠN",
      topSuggestion: "GỢI Ý HÀNG ĐẦU",
      lowMatchNotice:
        "Ước tính này có độ tin cậy thấp vì hồ sơ hiện tại còn ít bằng chứng; hãy xem yêu cầu vị trí trước khi quyết định.",
      featured: "NỔI BẬT",
      postedRecently: "Đăng gần đây",
      negotiableSalary: "Thỏa thuận",
      monthlySalaryUnit: "triệu / tháng",
      hourlySalaryUnit: "triệu / giờ",
      yearlySalaryUnit: "triệu / năm",
      profileMatch: "Độ phù hợp với hồ sơ",
      profileMatchEstimate: "Ước tính phù hợp từ hồ sơ",
      cvMatchScore: "Điểm CV Match Check",
      cvMatchPrivate: "Kết quả riêng tư cho đúng vị trí này",
      cvMatchContext:
        "Đã chấm bằng CV mới nhất của bạn và mô tả công việc hiện tại.",
      cvMatchSourceLabel: "Nguồn: CV Match Check",
      cvMatchIncomplete:
        "Một phần dữ liệu CV chưa đầy đủ; hãy xem báo cáo riêng.",
      reviewCvMatch: "Xem lại báo cáo đối chiếu",
      matchSignals: "Tín hiệu hồ sơ được đối chiếu",
      viewJobDetails: "Xem chi tiết vị trí",
      loginForMatch: "Đăng nhập để xem điểm phù hợp",
      loginForMatchDescription:
        "Đăng nhập, sau đó thêm kỹ năng và kinh nghiệm để xem điểm phù hợp với từng việc làm.",
      completeProfileForMatch: "Hoàn thiện hồ sơ để xem điểm phù hợp",
      completeProfileDescription:
        "AI cần biết kỹ năng và kinh nghiệm của bạn để tính độ phù hợp với từng việc làm.",
      completeProfileAction: "Hoàn thiện hồ sơ ngay →",
      completeProfileNote: "Chỉ mất khoảng 2 phút",
      lockedMatchLabel: "Điểm phù hợp đang bị khóa",
      noPersonalMatches: "Chưa có gợi ý phù hợp được cá nhân hóa",
      noPersonalMatchesDescription:
        "Hồ sơ của bạn đã sẵn sàng. Chúng tôi sẽ hiển thị điểm phù hợp khi có cơ hội phù hợp.",
      matchUnavailable: "Chưa thể tính độ phù hợp lúc này",
      matchUnavailableDescription:
        "Hồ sơ của bạn có thể đã sẵn sàng, nhưng dữ liệu đối chiếu đang tạm thời không khả dụng. Bạn vẫn có thể xem tất cả cơ hội việc làm.",
      matchUnavailableLabel: "Chưa có điểm phù hợp cá nhân hóa",
      browseOpportunities: "Xem cơ hội việc làm",
      save: "Lưu việc làm",
      saved: "Đã lưu",
      saving: "Đang lưu…",
      saveSuccess: "Đã lưu việc làm.",
      removeSuccess: "Đã bỏ lưu việc làm.",
      saveError: "Không thể cập nhật việc đã lưu. Vui lòng thử lại.",
      empty: "Chưa có cơ hội công khai.",
      error: "Việc làm tạm thời chưa khả dụng.",
    },
    growth: {
      eyebrow: "PHÁT TRIỂN",
      title: "Trung tâm phát\u00a0triển nghề nghiệp",
      cards: [
        {
          title: "CV rõ ràng",
          body: "Trình bày điểm mạnh liên quan trong một trang dễ đọc.",
        },
        {
          title: "Phỏng vấn tự tin",
          body: "Luyện STAR bằng các ví dụ cụ thể.",
        },
        {
          title: "Portfolio có câu chuyện",
          body: "Nêu vấn đề, vai trò, quyết định và kết quả.",
        },
        {
          title: "Lộ trình kỹ năng",
          body: "Chọn kỹ năng tiếp theo theo định hướng nghề nghiệp.",
        },
      ],
    },
    events: {
      eyebrow: "KẾT NỐI",
      title: "Sự kiện nghề nghiệp",
      cards: [
        { title: "Workshop CV", body: "Workshop trực tuyến minh họa" },
        {
          title: "Đánh giá portfolio",
          body: "Buổi đánh giá minh họa tại TP. Hồ Chí Minh",
        },
        {
          title: "Ngày hội việc làm",
          body: "Ngày hội đại học minh họa tại Hà Nội",
        },
        { title: "Hỏi đáp cùng HR", body: "Buổi hỏi đáp trực tuyến minh họa" },
      ],
    },
    finalCta: {
      seekerEyebrow: "BƯỚC TIẾP THEO",
      seekerTitle: "Xây dựng hồ sơ để cơ hội phù hợp tìm thấy bạn.",
      employerEyebrow: "DÀNH CHO DOANH NGHIỆP",
      employerTitle: "Tìm ứng viên phù hợp cho vị trí đang tuyển.",
    },
    aiCvPolicy: {
      backToHome: "Quay lại trang chủ",
      effective: "Hiệu lực",
      policyVersion: "Phiên bản chính sách",
      eyebrow: "CHÍNH SÁCH & MINH BẠCH SMART HIRE",
      title: "Chính sách phân tích CV bằng AI",
      description:
        "Smart Hire có thể dùng AI để tạo một nhận định tham khảo về mức độ phù hợp giữa CV của bạn và vị trí bạn đang ứng tuyển. Đây là nội dung độc lập của Smart Hire và được công bố riêng trên nền tảng này.",
      principles: [
        {
          key: "optional",
          title: "Tùy chọn tự nguyện",
          body: "Không bắt buộc phải bật AI để nộp hồ sơ ứng tuyển.",
        },
        {
          key: "human",
          title: "Không tự động loại",
          body: "Điểm AI chỉ mang tính tham khảo cho bạn và nhà tuyển dụng.",
        },
        {
          key: "integrity",
          title: "Bảo mật nguyên vẹn",
          body: "Không làm thay đổi hay chỉnh sửa nội dung file CV gốc.",
        },
      ],
      sections: [
        {
          title: "AI được dùng để làm gì?",
          paragraphs: [
            "Khi bạn chủ động bật lựa chọn đồng ý, Smart Hire phân tích các kỹ năng, kinh nghiệm và thông tin nghề nghiệp có trong CV để đưa ra điểm phù hợp và phần giải thích ngắn.",
          ],
        },
        {
          title: "Quyền lựa chọn của bạn",
          paragraphs: [
            "Đồng ý phân tích AI là tùy chọn và không phải điều kiện bắt buộc để ứng tuyển.",
            "Nếu không đồng ý, hồ sơ của bạn vẫn được chuyển tới nhà tuyển dụng bình thường; Smart Hire chỉ không tạo điểm số hoặc gợi ý phù hợp bằng AI cho lần ứng tuyển đó.",
          ],
        },
        {
          title: "Dữ liệu và tính minh bạch",
          paragraphs: [
            "Smart Hire chỉ sử dụng CV và vị trí ứng tuyển trong phạm vi cần thiết cho mục đích đã thông báo. Kết quả được gắn liền với lần ứng tuyển tương ứng.",
            "Bạn luôn có quyền liên hệ với Smart Hire để giải đáp về kết quả phân tích hoặc yêu cầu hỗ trợ đối soát thủ công từ chuyên viên.",
          ],
        },
        {
          title: "Liên hệ & Khiếu nại",
          paragraphs: [
            "Nếu bạn có bất kỳ câu hỏi nào về chính sách này hoặc muốn phản hồi về cơ chế AI, hãy liên hệ trực tiếp với đội ngũ hỗ trợ Smart Hire từ trang tài khoản của bạn.",
          ],
        },
      ],
      importantNoticeLabel: "Lưu ý quan trọng",
      importantNotice:
        "Kết quả đánh giá chỉ mang tính tham khảo, không phải quyết định tuyển dụng cuối cùng.",
      dataHighlights: [
        "Không thay đổi nội dung CV",
        "Không tự động loại ứng viên",
      ],
      supportAction: "Mở trung tâm hỗ trợ tài khoản",
      copyright: "© {year} Smart Hire. Bảo lưu mọi quyền.",
    },
    footer: {
      description:
        "Nền tảng tuyển dụng thông minh và cộng đồng nghề nghiệp chuyên nghiệp.",
      label: "Điều hướng cuối trang",
      explore: "Khám phá",
      information: "Thông tin",
      informationLabel: "Thông tin doanh nghiệp",
      jobs: "Việc làm",
      companies: "Doanh nghiệp tuyển dụng",
      support: "Trợ giúp & hỗ trợ",
      privacy: "Quyền riêng tư",
      terms: "Điều khoản sử dụng",
      cookies: "Cookie",
      aiCvPolicy: "Chính sách AI & CV",
      establishedYear: 2026,
      copyright: "© {year} Smart Hire. Bảo lưu mọi quyền.",
      aiNotice: "AI hỗ trợ gợi ý, không thay thế quyết định tuyển dụng.",
    },
  },
} as const satisfies Record<HomeLocale, HomeCopy>;
