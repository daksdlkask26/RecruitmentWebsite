export type JobApplicationLocale = "vi" | "en";

export type JobApplicationCopy = {
  applyKicker: string;
  applyFor: (jobTitle: string) => string;
  completeApplication: string;
  closeApplicationForm: string;
  closeWait: string;
  preparing: string;
  tryAgain: string;
  requiredFields: string;
  profileIncomplete: (fields: string) => string;
  profileFields: Record<string, string>;
  cvSection: string;
  cvHelp: string;
  selectCv: string;
  savedCvPlaceholder: string;
  noConfirmedCvs: string;
  fileSelected: string;
  chooseFile: string;
  fileTypes: string;
  changeFile: string;
  removeFile: string;
  savingCv: string;
  importCv: string;
  cvScanning: string;
  cvResuming: string;
  cvRetryable: string;
  cvInfected: string;
  cvStatusError: string;
  cvReady: string;
  retryCv: string;
  contactInformation: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  location: string;
  selectJobLocation: string;
  savingLocation: string;
  chooseAnswer: string;
  yes: string;
  no: string;
  coverLetterOptional: string;
  transparencyAria: string;
  transparencyTitle: string;
  transparencyDescription: string;
  privateCvNote: string;
  consentAria: string;
  consentText: string;
  aiConsentAria: string;
  aiConsentText: string;
  learnMore: string;
  aiConsentHint: string;
  submitting: string;
  submitApplication: string;
  successTitle: (jobTitle: string) => string;
  successDescription: string;
  alreadyApplied: string;
  submitted: string;
  errors: {
    phoneRequired: string;
    phoneInvalid: string;
    fullNameRequired: string;
    emailRequired: string;
    emailInvalid: string;
    unsupportedFile: string;
    fileTooLarge: string;
    emptyFile: string;
    invalidFile: string;
    saveCv: string;
    selectImportedCv: string;
    selectSavedCv: string;
    saveLocation: string;
    selectLocation: string;
    acceptConsent: string;
    submit: string;
    submitTryAgain: string;
    loadForm: string;
  };
};

const englishCopy: JobApplicationCopy = {
  applyKicker: "Apply",
  applyFor: (jobTitle) => `Apply for ${jobTitle}`,
  completeApplication: "Complete your application on SmartHire.",
  closeApplicationForm: "Close application form",
  closeWait: "Please wait for the current application action to finish before closing.",
  preparing: "Preparing the application form...",
  tryAgain: "Try again",
  requiredFields: "Required fields",
  profileIncomplete: (fields) => `Complete these profile fields first: ${fields}.`,
  profileFields: {
    fullName: "Full name",
    email: "Email",
    phone: "Phone number",
    location: "Location",
  },
  cvSection: "Application CV",
  cvHelp:
    "Select exactly one confirmed CV from your Profile, or import one new PDF, DOC, or DOCX file.",
  selectCv: "Select a CV from Profile",
  savedCvPlaceholder: "Select one saved CV",
  noConfirmedCvs: "No confirmed CVs in Profile",
  fileSelected: "CV file selected",
  chooseFile: "Drag a CV here or click to choose",
  fileTypes: "PDF, DOC, DOCX · up to 5 MB",
  changeFile: "Change file",
  removeFile: "Remove",
  savingCv: "Saving CV...",
  importCv: "Import CV",
  cvScanning: "CV uploaded. We are checking it for safety...",
  cvResuming: "Resuming the CV safety check...",
  cvRetryable:
    "The safety check could not finish. Retry it without uploading the file again.",
  cvInfected: "This CV was blocked because the safety scan detected a threat.",
  cvStatusError: "The CV could not pass the safety check.",
  cvReady: "CV safety check passed.",
  retryCv: "Retry safety check",
  contactInformation: "Contact information",
  fullName: "Full name",
  email: "Email",
  phoneNumber: "Phone number",
  location: "Location",
  selectJobLocation: "Select the job location",
  savingLocation: "Saving location...",
  chooseAnswer: "Choose an answer",
  yes: "Yes",
  no: "No",
  coverLetterOptional: "Cover letter (optional)",
  transparencyAria: "Transparency about automated support",
  transparencyTitle: "Transparency about automated support",
  transparencyDescription:
    "Recruiters may use automated tools to compare an application with job requirements. Scores, rankings, and internal notes are not shown to candidates and do not make the final hiring decision.",
  privateCvNote:
    "Your private CV Match Check is separate. It is visible only to you, is not included in this application, and does not change recruiter ranking.",
  consentAria:
    "I consent to SmartHire sharing this application with the hiring company.",
  consentText:
    "I consent to SmartHire sharing this application with the hiring company.",
  aiConsentAria:
    "I agree to let SmartHire use AI to analyze how well my CV matches this role.",
  aiConsentText:
    "I agree to let SmartHire use AI to analyze how well my CV matches this role.",
  learnMore: "Learn more",
  aiConsentHint:
    "Optional. If you do not select this, your CV will be submitted without an AI match score.",
  submitting: "Submitting...",
  submitApplication: "Submit application",
  successTitle: (jobTitle) => `Application submitted successfully for ${jobTitle}.`,
  successDescription:
    "The employer will contact you if there is a match. You can follow the application status from Applications.",
  alreadyApplied: "You have already applied for this role.",
  submitted: "Application submitted.",
  errors: {
    phoneRequired: "Enter your phone number.",
    phoneInvalid: "Enter a valid Vietnamese phone number.",
    fullNameRequired: "Enter your full name.",
    emailRequired: "Enter your email address.",
    emailInvalid: "Enter a valid email address.",
    unsupportedFile: "Only PDF, DOC, or DOCX files are supported.",
    fileTooLarge: "File size must not exceed 5MB.",
    emptyFile: "The uploaded file is empty.",
    invalidFile: "Only valid PDF, DOC, or DOCX files are supported.",
    saveCv: "Unable to save this CV to your Profile.",
    selectImportedCv: "Select Import CV before applying this new CV.",
    selectSavedCv: "Select a saved CV or attach a valid PDF, DOC, or DOCX file.",
    saveLocation: "Unable to save your location.",
    selectLocation: "Select the job location.",
    acceptConsent: "Accept the application consent before applying.",
    submit: "Unable to submit your application.",
    submitTryAgain: "Unable to submit your application. Please try again.",
    loadForm: "Unable to load the application form.",
  },
};

const vietnameseCopy: JobApplicationCopy = {
  applyKicker: "Ứng tuyển",
  applyFor: (jobTitle) => `Ứng tuyển vị trí ${jobTitle}`,
  completeApplication: "Hoàn tất hồ sơ ứng tuyển trên SmartHire.",
  closeApplicationForm: "Đóng biểu mẫu ứng tuyển",
  closeWait: "Vui lòng chờ thao tác ứng tuyển hiện tại hoàn tất trước khi đóng.",
  preparing: "Đang chuẩn bị biểu mẫu ứng tuyển...",
  tryAgain: "Thử lại",
  requiredFields: "Trường bắt buộc",
  profileIncomplete: (fields) => `Hãy hoàn thiện các trường hồ sơ trước: ${fields}.`,
  profileFields: {
    fullName: "Họ và tên",
    email: "Email",
    phone: "Số điện thoại",
    location: "Địa điểm",
  },
  cvSection: "CV ứng tuyển",
  cvHelp:
    "Chọn đúng một CV đã xác nhận trong Hồ sơ hoặc nhập một tệp PDF, DOC hay DOCX mới.",
  selectCv: "Chọn CV từ Hồ sơ",
  savedCvPlaceholder: "Chọn một CV đã lưu",
  noConfirmedCvs: "Hồ sơ chưa có CV đã xác nhận",
  fileSelected: "Đã chọn tệp CV",
  chooseFile: "Kéo CV vào đây hoặc nhấp để chọn",
  fileTypes: "PDF, DOC, DOCX · tối đa 5 MB",
  changeFile: "Đổi tệp",
  removeFile: "Xóa",
  savingCv: "Đang lưu CV...",
  importCv: "Nhập CV",
  cvScanning: "CV đã được tải lên. Đang kiểm tra an toàn...",
  cvResuming: "Đang tiếp tục kiểm tra an toàn CV...",
  cvRetryable:
    "Kiểm tra an toàn chưa hoàn tất. Bạn có thể thử lại mà không cần tải lại tệp.",
  cvInfected: "CV bị chặn vì quá trình quét an toàn phát hiện mối đe dọa.",
  cvStatusError: "CV không vượt qua kiểm tra an toàn.",
  cvReady: "CV đã vượt qua kiểm tra an toàn.",
  retryCv: "Thử lại kiểm tra an toàn",
  contactInformation: "Thông tin liên hệ",
  fullName: "Họ và tên",
  email: "Email",
  phoneNumber: "Số điện thoại",
  location: "Địa điểm",
  selectJobLocation: "Chọn địa điểm làm việc",
  savingLocation: "Đang lưu địa điểm...",
  chooseAnswer: "Chọn câu trả lời",
  yes: "Có",
  no: "Không",
  coverLetterOptional: "Thư xin việc (không bắt buộc)",
  transparencyAria: "Minh bạch về hỗ trợ tự động",
  transparencyTitle: "Minh bạch về hỗ trợ tự động",
  transparencyDescription:
    "Nhà tuyển dụng có thể sử dụng công cụ tự động để đối chiếu hồ sơ với yêu cầu công việc. Điểm số, thứ hạng và ghi chú nội bộ không hiển thị với ứng viên và không quyết định kết quả tuyển dụng cuối cùng.",
  privateCvNote:
    "Tính năng Kiểm tra độ phù hợp CV riêng tư của bạn là một quy trình độc lập. Kết quả chỉ hiển thị với bạn, không được đưa vào đơn ứng tuyển và không thay đổi thứ hạng của nhà tuyển dụng.",
  consentAria:
    "Tôi đồng ý để SmartHire chia sẻ đơn ứng tuyển này với công ty tuyển dụng.",
  consentText:
    "Tôi đồng ý để SmartHire chia sẻ đơn ứng tuyển này với công ty tuyển dụng.",
  aiConsentAria:
    "Tôi đồng ý cho SmartHire sử dụng AI để phân tích mức độ phù hợp của CV với vai trò này.",
  aiConsentText:
    "Tôi đồng ý cho SmartHire sử dụng AI để phân tích mức độ phù hợp của CV với vai trò này.",
  learnMore: "Tìm hiểu thêm",
  aiConsentHint:
    "Không bắt buộc. Nếu không chọn, CV của bạn vẫn được gửi nhưng không có điểm phù hợp do AI tạo.",
  submitting: "Đang gửi...",
  submitApplication: "Gửi đơn ứng tuyển",
  successTitle: (jobTitle) => `Đã gửi đơn ứng tuyển thành công cho ${jobTitle}.`,
  successDescription:
    "Nhà tuyển dụng sẽ liên hệ nếu hồ sơ phù hợp. Bạn có thể theo dõi trạng thái đơn trong mục Đơn ứng tuyển.",
  alreadyApplied: "Bạn đã ứng tuyển vị trí này.",
  submitted: "Đã gửi đơn ứng tuyển.",
  errors: {
    phoneRequired: "Hãy nhập số điện thoại.",
    phoneInvalid: "Hãy nhập số điện thoại Việt Nam hợp lệ.",
    fullNameRequired: "Hãy nhập họ và tên.",
    emailRequired: "Hãy nhập địa chỉ email.",
    emailInvalid: "Hãy nhập địa chỉ email hợp lệ.",
    unsupportedFile: "Chỉ hỗ trợ tệp PDF, DOC hoặc DOCX.",
    fileTooLarge: "Dung lượng tệp không được vượt quá 5 MB.",
    emptyFile: "Tệp được tải lên đang trống.",
    invalidFile: "Chỉ hỗ trợ CV hợp lệ ở định dạng PDF, DOC hoặc DOCX.",
    saveCv: "Không thể lưu CV này vào Hồ sơ.",
    selectImportedCv: "Hãy chọn Nhập CV trước khi dùng CV mới này để ứng tuyển.",
    selectSavedCv: "Hãy chọn CV đã lưu hoặc đính kèm tệp PDF, DOC hay DOCX hợp lệ.",
    saveLocation: "Không thể lưu địa điểm của bạn.",
    selectLocation: "Hãy chọn địa điểm làm việc.",
    acceptConsent: "Hãy đồng ý với nội dung chia sẻ đơn ứng tuyển trước khi gửi.",
    submit: "Không thể gửi đơn ứng tuyển.",
    submitTryAgain: "Không thể gửi đơn ứng tuyển. Vui lòng thử lại.",
    loadForm: "Không thể tải biểu mẫu ứng tuyển.",
  },
};

export function jobApplicationCopy(
  locale: JobApplicationLocale,
): JobApplicationCopy {
  return locale === "vi" ? vietnameseCopy : englishCopy;
}
