import type {
  CvImportStage,
  CvParserClass,
  CvReviewAction,
  CvUploadStatus,
} from "@/shared/contracts/cv-import/common";

export type CvLocale = "vi" | "en";

type Bilingual = Readonly<{ en: string; vi: string }>;

const statuses: Record<CvUploadStatus, Bilingual> = {
  AWAITING_CONTENT: { en: "Awaiting file", vi: "Đang chờ tệp" },
  VALIDATION_QUEUED: {
    en: "Queued for validation",
    vi: "Đã xếp hàng kiểm tra",
  },
  SCAN_QUEUED: {
    en: "Queued for security scan",
    vi: "Đã xếp hàng quét bảo mật",
  },
  SCANNING: { en: "Scanning", vi: "Đang quét" },
  EXTRACTION_QUEUED: {
    en: "Queued for text extraction",
    vi: "Đã xếp hàng trích xuất văn bản",
  },
  EXTRACTING: { en: "Extracting text", vi: "Đang trích xuất văn bản" },
  AWAITING_CONSENT: { en: "Consent required", vi: "Cần cấp quyền đồng ý" },
  PARSE_QUEUED: { en: "Queued for parsing", vi: "Đã xếp hàng phân tích" },
  PARSING: { en: "Parsing", vi: "Đang phân tích" },
  REVIEW_READY: { en: "Ready for review", vi: "Sẵn sàng xem xét" },
  VALIDATION_FAILED: {
    en: "Validation failed",
    vi: "Kiểm tra không thành công",
  },
  INFECTED: {
    en: "Security threat detected",
    vi: "Phát hiện mối đe dọa bảo mật",
  },
  SCAN_FAILED: {
    en: "Security scan failed",
    vi: "Quét bảo mật không thành công",
  },
  EXTRACTION_FAILED: {
    en: "Text extraction failed",
    vi: "Trích xuất văn bản không thành công",
  },
  PARSE_FAILED: { en: "Parsing failed", vi: "Phân tích không thành công" },
  CONFIRMED: { en: "Changes confirmed", vi: "Đã xác nhận thay đổi" },
  CANCELLED: { en: "Cancelled", vi: "Đã hủy" },
  DELETED: { en: "Deleted", vi: "Đã xóa" },
  EXPIRED: { en: "Expired", vi: "Đã hết hạn" },
};

const stages: Record<CvImportStage, Bilingual> = {
  OCR: { en: "OCR", vi: "OCR" },
  UPLOAD: { en: "Upload", vi: "Tải lên" },
  VALIDATE: { en: "Validate", vi: "Kiểm tra" },
  SCAN: { en: "Security scan", vi: "Quét bảo mật" },
  EXTRACT: { en: "Extract text", vi: "Trích xuất văn bản" },
  CONSENT: { en: "Consent", vi: "Đồng ý" },
  PARSE: { en: "Parse", vi: "Phân tích" },
  REVIEW: { en: "Review", vi: "Xem xét" },
  COMPLETE: { en: "Complete", vi: "Hoàn tất" },
  TERMINAL: { en: "Complete", vi: "Hoàn tất" },
};

const actions: Record<CvReviewAction, Bilingual> = {
  ADD: { en: "Add", vi: "Thêm" },
  REPLACE: { en: "Replace", vi: "Thay thế" },
  SKIP: { en: "Skip", vi: "Bỏ qua" },
};

const fields: Record<string, Bilingual> = {
  company: { en: "Company", vi: "Công ty" },
  degree: { en: "Degree", vi: "Bằng cấp" },
  description: { en: "Description", vi: "Mô tả" },
  endDate: { en: "End date", vi: "Ngày kết thúc" },
  field: { en: "Field of study", vi: "Chuyên ngành" },
  headline: { en: "Headline", vi: "Tiêu đề nghề nghiệp" },
  institution: { en: "Institution", vi: "Cơ sở đào tạo" },
  location: { en: "Location", vi: "Địa điểm" },
  phone: { en: "Phone number", vi: "Số điện thoại" },
  startDate: { en: "Start date", vi: "Ngày bắt đầu" },
  summary: { en: "Summary", vi: "Tóm tắt" },
  title: { en: "Job title", vi: "Chức danh" },
  url: { en: "Social link", vi: "Liên kết mạng xã hội" },
  value: { en: "Value", vi: "Giá trị" },
};

const parserNames: Record<CvParserClass, Bilingual> = {
  DETERMINISTIC_INTERNAL: {
    en: "SmartHire parser",
    vi: "Bộ phân tích SmartHire",
  },
  EXTERNAL_OPENAI: {
    en: "OpenAI parser",
    vi: "Bộ phân tích OpenAI",
  },
};

const processingNotices: Record<CvParserClass, Bilingual> = {
  DETERMINISTIC_INTERNAL: {
    en: "SmartHire processes this CV only to create a private draft for your review. The draft never changes your Candidate Profile until you explicitly confirm selected changes. The selected deterministic parser runs inside SmartHire without sending CV content to an external AI provider.",
    vi: "SmartHire chỉ xử lý CV này để tạo bản nháp riêng cho bạn xem xét. Bản nháp không thay đổi Hồ sơ ứng viên cho đến khi bạn xác nhận các thay đổi đã chọn. Bộ phân tích nội bộ chạy trong SmartHire và không gửi nội dung CV đến nhà cung cấp AI bên ngoài.",
  },
  EXTERNAL_OPENAI: {
    en: "SmartHire processes this CV only to create a private draft for your review. The draft never changes your Candidate Profile until you explicitly confirm selected changes. The external parser remains blocked until you separately consent to send this CV to the approved OpenAI deployment.",
    vi: "SmartHire chỉ xử lý CV này để tạo bản nháp riêng cho bạn xem xét. Bản nháp không thay đổi Hồ sơ ứng viên cho đến khi bạn xác nhận các thay đổi đã chọn. Bộ phân tích bên ngoài sẽ bị chặn cho đến khi bạn đồng ý riêng việc gửi CV này đến hệ thống OpenAI được phê duyệt.",
  },
};

export const cvCopy = (locale: CvLocale) =>
  locale === "vi"
    ? {
        common: {
          unavailable: "Không khả dụng",
          candidateProfile: "Hồ sơ ứng viên",
          manualProfile: "Nhập hồ sơ thủ công",
          openProfile: "Mở Hồ sơ ứng viên",
          importHistory: "Lịch sử nhập CV",
          currentProfile: "Hồ sơ hiện tại",
          proposed: "Đề xuất",
          current: "Hiện tại",
          failed: "Thất bại",
          processingTimeline: "Tiến trình xử lý",
          savedCvs: "CV đã lưu",
          applicationCvs: "CV ỨNG TUYỂN",
          cvFilename: "Tên tệp CV",
          save: "Lưu",
          cancel: "Hủy",
          rename: "Đổi tên",
          delete: "Xóa",
          noConfirmedCvs: "Chưa có CV đã xác nhận trong hồ sơ.",
          renameError: "Không thể đổi tên CV.",
          deleteError: "Không thể xóa CV.",
          genericError: "Không thể hoàn tất thao tác CV. Hãy thử lại.",
        },
        upload: {
          ready: "Sẵn sàng tải CV lên.",
          file: "Tệp CV",
          fileGuidance: "PDF, DOC hoặc DOCX, tối đa 5 MB (5.000.000 byte).",
          chooseParser: "Bộ phân tích cho lần nhập này",
          parserGuidance:
            "CV sẽ được xử lý bằng OpenAI sau khi quét bảo mật, trích xuất văn bản và bạn cấp quyền.",
          deterministic: "SmartHire nội bộ",
          deterministicHint:
            "Chạy cục bộ mà không gửi văn bản đến nhà cung cấp AI.",
          external: "OpenAI bên ngoài",
          externalHint:
            "Phân tích có hỗ trợ AI sau khi quét, trích xuất và cấp quyền.",
          required: "Bắt buộc",
          local: "Cục bộ",
          unavailable: "Không khả dụng",
          aiReady: "AI sẵn sàng",
          notConfigured: "Chưa cấu hình",
          upload: "Tải CV lên",
          uploading: "Đang tải lên…",
          manual: "Nhập hồ sơ thủ công",
        },
        status: {
          heading: "Trạng thái xử lý CV",
          stage: "giai đoạn",
          contentUnavailable: "Nội dung không khả dụng.",
          openaiExternal: "BỘ PHÂN TÍCH OPENAI BÊN NGOÀI",
          consentNeeded: "Cần cấp quyền",
          openaiWaiting: "OpenAI đang chờ bạn cho phép",
          queued: "Đã xếp hàng",
          openaiQueued: "Yêu cầu OpenAI đã được xếp hàng",
          apiInProgress: "API đang xử lý",
          openaiExtracting: "OpenAI đang trích xuất các trường hồ sơ",
          openaiRunning:
            "Yêu cầu API đang chạy. SmartHire chỉ đánh dấu thành công sau khi xác thực và lưu kết quả có cấu trúc.",
          success: "Thành công",
          openaiCompleted: "Đã hoàn tất phân tích bằng OpenAI",
          draftReady:
            "Bản nháp riêng đã sẵn sàng. Hãy xem xét từng trường được đề xuất trước khi áp dụng vào hồ sơ.",
          apiError: "Lỗi API",
          openaiFailed: "Không thể hoàn tất phân tích bằng OpenAI",
          providerFailed:
            "Yêu cầu đến nhà cung cấp đã thất bại an toàn. Hãy thử lại hoặc cập nhật hồ sơ thủ công.",
          preparing: "Đang chuẩn bị",
          preparingOpenai: "SmartHire đang chuẩn bị CV cho OpenAI",
          preparingMessage:
            "Quét virus và trích xuất văn bản cục bộ được thực hiện trước. OpenAI chưa được gọi ở giai đoạn này.",
          current: "Hiện tại: ",
          failed: "Thất bại: ",
          retry: "Thử lại",
          reviewDraft: "Xem xét bản nháp",
        },
        consent: {
          heading: "Đồng ý xử lý bên ngoài",
          provider: "Nhà cung cấp",
          purpose: "Mục đích",
          versions: "Phiên bản",
          grantedActive: "Quyền đồng ý xử lý bên ngoài đang hoạt động.",
          blocked:
            "Xử lý bên ngoài vẫn bị chặn cho đến khi bạn chủ động cấp quyền.",
          granting: "Đang cấp quyền xử lý bên ngoài…",
          granted:
            "Đã cấp quyền. Xử lý bên ngoài được phê duyệt có thể tiếp tục.",
          revoking: "Đang thu hồi quyền xử lý trong tương lai…",
          revoked:
            "Đã thu hồi quyền. Xử lý bên ngoài trong tương lai đã bị chặn.",
          grantError: "Không thể cấp quyền. Xử lý bên ngoài vẫn bị chặn.",
          revokeError:
            "Không thể thu hồi quyền. Hãy làm mới trạng thái trước khi tiếp tục.",
          expired:
            "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại trước khi thay đổi quyền.",
          unavailable:
            "Quyền đồng ý không khả dụng ở trạng thái nhập hiện tại. Xử lý bên ngoài vẫn bị chặn.",
          noRevocation:
            "Hiện không có lần truyền dữ liệu bên ngoài nào đủ điều kiện để thu hồi.",
          caveat:
            "Thu hồi sẽ chặn các yêu cầu trong tương lai nhưng không thể thu hồi dữ liệu đã gửi đến nhà cung cấp được phê duyệt.",
          agree:
            "Tôi đồng ý để SmartHire chỉ gửi văn bản đã trích xuất của CV này đến hệ thống OpenAI được phê duyệt nhằm tạo bản nháp riêng. Bản nháp không thay đổi Hồ sơ ứng viên cho đến khi tôi xác nhận các thay đổi đã chọn. Tôi có thể thu hồi quyền cho các yêu cầu sau, nhưng không thể thu hồi dữ liệu đã được gửi đến OpenAI.",
        },
        failure: {
          heading: "Không thể hoàn tất xử lý CV",
          safeCode: "Mã kết quả an toàn",
          actions: "Hành động khôi phục CV",
          replacement: "Tải CV thay thế",
          manual: "Nhập Hồ sơ ứng viên thủ công",
          delete: "Xóa lần nhập",
          retryQueued: "Đã xếp hàng yêu cầu thử lại.",
          retryRequesting: "Đang yêu cầu thử lại…",
          deleteRequesting: "Đang yêu cầu xóa lần nhập…",
          deleteCancelled: "Đã hủy yêu cầu xóa lần nhập.",
          deleteRequested: "Đã yêu cầu xóa lần nhập.",
          deleteFailed:
            "Không thể xóa lần nhập. Lần nhập vẫn được giữ nguyên trong lịch sử.",
          chooseAction: "Chọn một hành động khôi phục bên dưới.",
          retryAvailable: "Có thể thử lại.",
          retryIn: "Có thể thử lại sau",
          second: "giây",
          seconds: "giây",
          noRetries: "Không còn lượt thử lại",
          retryRemaining: "lượt thử lại còn lại",
          guidance:
            "Bạn có thể tự khôi phục mà không cần chờ người khác. Nhập thủ công sẽ giữ lần nhập thất bại trong lịch sử và không tạo bản nháp rỗng.",
        },
        consentRequiredRecovery: {
          heading: "Không thể tiếp tục xử lý CV",
          badge: "Cần đồng ý",
          description:
            "Tài liệu này chưa thể tiếp tục được xử lý. Theo Chính sách quyền riêng tư của SmartHire, việc phân tích bằng AI cần có sự đồng ý rõ ràng của bạn trước khi trích xuất dữ kiện nghề nghiệp.",
          technicalDetails: "Chi tiết kỹ thuật",
          safeCode: "Mã kết quả an toàn",
          reason:
            "OpenAI chưa được gọi và chưa có nội dung CV nào được gửi đến nhà cung cấp.",
          chooseAction: "Chọn cách khôi phục",
          fastest: "Nhanh nhất",
          grantTitle: "Cấp quyền và tiếp tục",
          grantDescription:
            "Xác nhận cho phép phân tích AI để xử lý ngay tệp CV hiện tại.",
          grantAction: "Cấp quyền và tiếp tục",
          granting: "Đang cấp quyền…",
          granted: "Đã cấp quyền. Yêu cầu xử lý CV đang tiếp tục.",
          grantError: "Không thể cấp quyền. Xử lý bên ngoài vẫn đang bị chặn.",
          sessionExpired:
            "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại trước khi cấp quyền.",
          replacementTitle: "Tải CV thay thế",
          replacementDescription:
            "Chọn tệp PDF, DOC hoặc DOCX khác để bắt đầu một lần nhập mới.",
          replacementAction: "Chọn tệp",
          manualTitle: "Nhập hồ sơ thủ công",
          manualDescription:
            "Bỏ qua phân tích tự động và tự cập nhật kỹ năng, kinh nghiệm của bạn.",
          manualAction: "Nhập thủ công",
          guidance:
            "Bạn có thể tự khôi phục mà không cần chờ người khác. Nhập thủ công vẫn giữ lần nhập thất bại trong lịch sử và không tạo bản nháp trống.",
          delete: "Xóa lần nhập",
          deleting: "Đang xóa lần nhập…",
          deleteRequested: "Đã yêu cầu xóa lần nhập.",
          deleteCancelled: "Đã hủy yêu cầu xóa lần nhập.",
          deleteError:
            "Không thể xóa lần nhập. Lần nhập vẫn được giữ trong lịch sử.",
        },
        retention: {
          heading: "Lưu giữ và xóa dữ liệu",
          expiry: "Thời hạn lần nhập",
          cleanup: "Hạn chót dọn dẹp nội dung",
          temporary:
            "Nội dung CV tạm thời vẫn được bảo vệ và tuân theo các hạn đã hiển thị bên dưới.",
          cancelled:
            "Đã chấp nhận xóa. Quyền truy cập nội dung bị vô hiệu hóa ngay; quá trình dọn dẹp được bảo vệ đang chờ và phải hoàn tất trước",
          deleted:
            "Đã xóa hoàn tất. Nội dung nhập tạm thời đã được xóa; bằng chứng tối thiểu không chứa nội dung có thể được giữ lại.",
          expired:
            "Lần nhập đã hết hạn. Quyền truy cập nội dung và thử lại bị vô hiệu hóa; quá trình dọn dẹp theo hạn vẫn tiếp tục đến",
          cancelDelete: "Hủy và xóa lần nhập CV này",
          deleteDialog: "Xóa vĩnh viễn dữ liệu CV tạm thời?",
          deleteDescription:
            "Quyền truy cập sẽ kết thúc ngay. SmartHire hủy xử lý đang xếp hàng và xóa nội dung nguồn, nội dung đã trích xuất, bản nháp và nguồn gốc trong vòng 24 giờ. Hồ sơ ứng viên của bạn vẫn được giữ nguyên và không bị thay đổi bởi thao tác này.",
          confirmDelete: "Xác nhận hủy và xóa",
          keep: "Giữ lần nhập",
        },
        review: {
          details: "Chi tiết hồ sơ",
          collections: "Kinh nghiệm, học vấn và liên kết",
          experience: "Kinh nghiệm",
          education: "Học vấn",
          skills: "Kỹ năng",
          experienceGroup: "kinh nghiệm",
          educationGroup: "học vấn",
          skillsGroup: "kỹ năng",
          socialLinks: "Liên kết mạng xã hội",
          links: "liên kết",
          addAll: "Thêm tất cả đề xuất",
          skipAll: "Bỏ qua tất cả đề xuất",
          replaceCurrent: "Thay thế mục hiện tại",
          chooseOwned: "Chọn mục hồ sơ thuộc về bạn",
          currentRole: "Công việc hiện tại",
          currentStudy: "Đang học",
          matchingSkill: "Một kỹ năng tương ứng đã có trong hồ sơ.",
          replacementUnavailable:
            "Chưa có mục nào trong Hồ sơ để thay thế. Bạn có thể thêm đề xuất này hoặc bỏ qua.",
          currentProfile: "Hồ sơ hiện tại",
          proposed: "Đề xuất",
          decisionFor: "Quyết định cho",
          alreadyValue:
            "Trường này đã có giá trị trong Hồ sơ. Hãy thay thế hoặc giữ giá trị hiện tại.",
          emptyValue:
            "Trường này đang trống trong Hồ sơ. Hãy thêm hoặc bỏ qua đề xuất.",
          notSet: "Chưa thiết lập",
          evidence: "Bằng chứng của bộ phân tích",
          provenanceUnavailable: "Nguồn gốc không khả dụng.",
          confidence: "Độ tin cậy",
          verifiedLocation: "Vị trí đã xác minh",
          sourceContextUnavailable: "Ngữ cảnh nguồn không khả dụng.",
          sourceDetails: "Chi tiết nguồn dữ liệu",
          source: "Nguồn",
          extractionMethod: "Phương thức trích xuất",
          warningLabels: {
            LOW_CONFIDENCE: "Độ tin cậy thấp",
            MATERIAL_NATIVE_OCR_CONFLICT: "Xung đột giữa văn bản gốc và OCR",
            APPROXIMATE_ANCHOR: "Vị trí tham chiếu gần đúng",
            PARTIAL_UNIT_TEXT: "Văn bản đơn vị chưa đầy đủ",
            DEDUPLICATED_WITH_NATIVE: "Đã loại trùng với văn bản gốc",
          },
          sourceMethodLabels: {
            NATIVE: "Văn bản gốc",
            OCR: "OCR",
            NATIVE_AND_OCR: "Văn bản gốc và OCR",
          },
          unknownWarning: "Cảnh báo cần xem xét",
          conflict: "Xung đột xem xét cần bạn lựa chọn",
          unsavedKept:
            "Các giá trị chưa lưu được giữ trong bộ nhớ trình duyệt này",
          compare: "So sánh với bản xem xét mới nhất đã lưu",
          reapply: "Áp dụng lại chỉnh sửa vào bản mới nhất",
          discard: "Bỏ chỉnh sửa và tải lại bản mới nhất",
          reviewSaved: "Bản xem xét đã được lưu.",
          unsaved: "Có thay đổi xem xét chưa lưu.",
          actionFailed: "Thao tác xem xét không thành công",
          receipt: "Đã xác nhận nhập CV",
          applied:
            "Các thay đổi đã chọn được áp dụng vào phiên bản Hồ sơ ứng viên",
          appliedCounts: "Số lượng thay đổi đã áp dụng",
          openCandidateProfile: "Mở Hồ sơ ứng viên",
        },
      }
    : {
        common: {
          unavailable: "Unavailable",
          candidateProfile: "Candidate Profile",
          manualProfile: "Manual profile",
          openProfile: "Open Candidate Profile",
          importHistory: "Import history",
          currentProfile: "Current profile",
          proposed: "Proposed",
          current: "Current",
          failed: "Failed",
          processingTimeline: "Processing timeline",
          savedCvs: "Saved CVs",
          applicationCvs: "APPLICATION CVs",
          cvFilename: "CV filename",
          save: "Save",
          cancel: "Cancel",
          rename: "Rename",
          delete: "Delete",
          noConfirmedCvs: "No confirmed CVs are available in your Profile yet.",
          renameError: "Unable to rename this CV.",
          deleteError: "Unable to delete this CV.",
          genericError:
            "The CV action could not be completed. Please try again.",
        },
        upload: {
          ready: "Ready to upload a CV.",
          file: "CV file",
          fileGuidance: "PDF, DOC, or DOCX, maximum 5 MB (5,000,000 bytes).",
          chooseParser: "Choose a parser for this upload",
          parserGuidance:
            "Every CV is processed by OpenAI after security scanning, text extraction, and your consent.",
          deterministic: "SmartHire deterministic",
          deterministicHint:
            "Runs locally without sending text to an AI provider.",
          external: "External OpenAI",
          externalHint:
            "AI-assisted parsing after scanning, extraction, and consent.",
          required: "Required",
          local: "Local",
          unavailable: "Unavailable",
          aiReady: "AI ready",
          notConfigured: "Not configured",
          upload: "Upload CV",
          uploading: "Uploading…",
          manual: "Enter profile manually",
        },
        status: {
          heading: "CV processing status",
          stage: "stage",
          contentUnavailable: "Content is unavailable.",
          openaiExternal: "EXTERNAL OPENAI PARSER",
          consentNeeded: "Consent needed",
          openaiWaiting: "OpenAI is waiting for your permission",
          queued: "Queued",
          openaiQueued: "OpenAI request is queued",
          apiInProgress: "API in progress",
          openaiExtracting: "OpenAI is extracting profile fields",
          openaiRunning:
            "The API request is running. SmartHire will only mark it successful after validating and saving the structured result.",
          success: "Success",
          openaiCompleted: "OpenAI parsing completed",
          draftReady:
            "A private draft is ready. Review every suggested field before applying it to your profile.",
          apiError: "API error",
          openaiFailed: "OpenAI parsing could not finish",
          providerFailed:
            "The provider request failed safely. Retry or update your profile manually.",
          preparing: "Preparing",
          preparingOpenai: "SmartHire is preparing the CV for OpenAI",
          preparingMessage:
            "Virus scanning and local text extraction happen first. OpenAI has not been called at this stage.",
          current: "Current: ",
          failed: "Failed: ",
          retry: "Retry",
          reviewDraft: "Review draft",
        },
        consent: {
          heading: "External processing consent",
          provider: "Provider",
          purpose: "Purpose",
          versions: "Versions",
          grantedActive: "External processing consent is active.",
          blocked:
            "External processing remains blocked until you explicitly grant consent.",
          granting: "Granting external processing consent…",
          granted:
            "Consent granted. Approved external processing may now continue.",
          revoking: "Revoking consent for future processing…",
          revoked: "Consent revoked. Future external processing is blocked.",
          grantError:
            "Consent could not be granted. External processing remains blocked.",
          revokeError:
            "Consent could not be revoked. Refresh the status before continuing.",
          expired:
            "Your session expired. Sign in again before changing consent.",
          unavailable:
            "Consent is unavailable in the current import state. External processing stays blocked.",
          noRevocation:
            "No future external transmission is currently eligible for revocation.",
          caveat:
            "Revocation blocks future requests, but it cannot recall processing already transmitted to the approved provider.",
          agree:
            "I agree that SmartHire may send only this CV's extracted text to the approved OpenAI deployment solely to create a private review draft. The draft will not change my Candidate Profile until I explicitly confirm selected changes. I can revoke consent for future requests, but revocation cannot recall processing already transmitted to OpenAI.",
        },
        failure: {
          heading: "CV processing could not finish",
          safeCode: "Safe result code",
          actions: "CV failure recovery actions",
          replacement: "Upload a replacement CV",
          manual: "Enter Candidate Profile manually",
          delete: "Delete import",
          retryQueued: "Retry queued.",
          retryRequesting: "Requesting retry…",
          deleteRequesting: "Requesting import deletion…",
          deleteCancelled: "Import deletion cancelled.",
          deleteRequested: "Import deletion requested.",
          deleteFailed:
            "The import could not be deleted. It remains available in your history.",
          chooseAction: "Choose a recovery action below.",
          retryAvailable: "Retry is available.",
          retryIn: "Retry available in",
          second: "second",
          seconds: "seconds",
          noRetries: "No retries remaining.",
          retryRemaining: "retries remaining.",
          guidance:
            "You can recover without waiting for another person. Manual entry keeps this failed import in your history and does not create an empty draft.",
        },
        consentRequiredRecovery: {
          heading: "CV processing could not finish",
          badge: "Consent required",
          description:
            "This document could not continue through CV processing. Under SmartHire's Privacy Policy, AI analysis needs your explicit consent before career data can be extracted.",
          technicalDetails: "Technical details",
          safeCode: "Safe result code",
          reason:
            "OpenAI has not been called and no CV content has been sent to the provider.",
          chooseAction: "Choose a recovery action",
          fastest: "Fastest",
          grantTitle: "Grant consent and retry",
          grantDescription:
            "Approve AI analysis so the current CV can continue processing immediately.",
          grantAction: "Grant and resume",
          granting: "Granting consent…",
          granted: "Consent granted. CV processing is continuing.",
          grantError:
            "Consent could not be granted. External processing remains blocked.",
          sessionExpired:
            "Your session expired. Sign in again before granting consent.",
          replacementTitle: "Upload replacement CV",
          replacementDescription:
            "Select a different PDF, DOC, or DOCX file to start a fresh import.",
          replacementAction: "Choose file",
          manualTitle: "Enter profile manually",
          manualDescription:
            "Skip automated parsing and fill in your skills and history by hand.",
          manualAction: "Manual entry",
          guidance:
            "You can recover without waiting for another person. Manual entry keeps this failed import in your history and does not create an empty draft.",
          delete: "Delete import",
          deleting: "Deleting import…",
          deleteRequested: "Import deletion requested.",
          deleteCancelled: "Import deletion cancelled.",
          deleteError:
            "The import could not be deleted. It remains available in your history.",
        },
        retention: {
          heading: "Retention and deletion",
          expiry: "Import expiry",
          cleanup: "Content cleanup deadline",
          temporary:
            "Temporary CV content remains protected and subject to the deadlines shown below.",
          cancelled:
            "Deletion accepted. Content access is disabled immediately; protected cleanup is pending and must finish by",
          deleted:
            "Deletion complete. Temporary import content has been removed; minimized non-content evidence may be retained.",
          expired:
            "This import expired. Content and retry access are disabled; deadline-driven cleanup continues through",
          cancelDelete: "Cancel and delete this CV import",
          deleteDialog: "Permanently delete temporary CV data?",
          deleteDescription:
            "Access ends immediately. SmartHire cancels queued processing and removes source, extracted, draft, and provenance content within 24 hours. Your Candidate Profile remains available and is not changed by this deletion.",
          confirmDelete: "Confirm cancel and delete",
          keep: "Keep import",
        },
        review: {
          details: "Profile details",
          collections: "Experience, education, and links",
          experience: "Experience",
          education: "Education",
          skills: "Skills",
          experienceGroup: "experience",
          educationGroup: "education",
          skillsGroup: "skills",
          socialLinks: "Social links",
          links: "links",
          addAll: "Add all proposed",
          skipAll: "Skip all proposed",
          replaceCurrent: "Replace current item",
          chooseOwned: "Choose an owned profile item",
          currentRole: "Current role",
          currentStudy: "Current study",
          matchingSkill: "A matching skill is already on the profile.",
          replacementUnavailable:
            "There are no Profile items to replace. Add this proposal or skip it.",
          currentProfile: "Current profile",
          proposed: "Proposed",
          decisionFor: "Decision for",
          alreadyValue:
            "This field already has a Profile value. Replace it or keep the current value.",
          emptyValue:
            "This field is empty on the Profile. Add it or skip the proposal.",
          notSet: "Not set",
          evidence: "Parser evidence",
          provenanceUnavailable: "Provenance unavailable.",
          confidence: "Confidence",
          verifiedLocation: "Verified location",
          sourceContextUnavailable: "Source context unavailable.",
          sourceDetails: "Data source details",
          source: "Source",
          extractionMethod: "Extraction method",
          warningLabels: {
            LOW_CONFIDENCE: "Low confidence",
            MATERIAL_NATIVE_OCR_CONFLICT: "Native/OCR text conflict",
            APPROXIMATE_ANCHOR: "Approximate source anchor",
            PARTIAL_UNIT_TEXT: "Partial unit text",
            DEDUPLICATED_WITH_NATIVE: "Deduplicated with native text",
          },
          sourceMethodLabels: {
            NATIVE: "Native text",
            OCR: "OCR",
            NATIVE_AND_OCR: "Native and OCR",
          },
          unknownWarning: "Review warning",
          conflict: "Review conflict needs your choice",
          unsavedKept: "Unsaved values kept in this browser memory",
          compare: "Compare with latest saved review",
          reapply: "Reapply my edits to latest",
          discard: "Discard my edits and reload latest",
          reviewSaved: "Review is saved.",
          unsaved: "Unsaved review changes.",
          actionFailed: "Review action failed",
          receipt: "CV import confirmed",
          applied:
            "Selected changes were applied to Candidate Profile revision",
          appliedCounts: "Applied change counts",
          openCandidateProfile: "Open Candidate Profile",
        },
      };

export function cvStatusLabel(locale: CvLocale, status: CvUploadStatus) {
  return statuses[status][locale];
}

export function cvStageLabel(locale: CvLocale, stage: CvImportStage) {
  return stages[stage][locale];
}

export function cvActionLabel(locale: CvLocale, action: CvReviewAction) {
  return actions[action][locale];
}

export function cvParserLabel(locale: CvLocale, parserClass: CvParserClass) {
  return parserNames[parserClass][locale];
}

export function cvProcessingNoticeText(
  locale: CvLocale,
  parserClass: CvParserClass,
) {
  return processingNotices[parserClass][locale];
}

export function cvFieldLabel(locale: CvLocale, path: string) {
  if (path.includes(".skills."))
    return fields.value[locale] === "Value" ? "Skill" : "Kỹ năng";
  if (path.includes(".socialLinks.")) return fields.url[locale];
  const segment = path.split(".").at(-1) ?? "value";
  const label = fields[segment] ?? fields.value;
  return label[locale];
}

export function cvFormatDate(
  locale: CvLocale,
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {},
) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(
    locale === "vi" ? "vi-VN" : "en-US",
    options,
  ).format(parsed);
}

export function cvFormatDateTime(
  locale: CvLocale,
  value: string | null | undefined,
) {
  return cvFormatDate(locale, value, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function cvImportStatusPageCopy(locale: CvLocale) {
  return locale === "vi"
    ? {
        backLink: "Quay lại Nhập CV",
        eyebrow: "Xử lý CV riêng tư",
        title: "Trạng thái nhập CV",
        subtitle:
          "Theo dõi từng giai đoạn xử lý, thực hiện hành động cần thiết và mở phần xem xét khi bản nháp riêng tư đã sẵn sàng.",
        privacyBadge: "Riêng tư · tạm thời",
        statusPrefix: "Trạng thái hiện tại: ",
      }
    : {
        backLink: "Back to CV imports",
        eyebrow: "Private CV processing",
        title: "CV import status",
        subtitle:
          "Follow each processing stage, handle any required action, and open the review when your private draft is ready.",
        privacyBadge: "Private · temporary",
        statusPrefix: "Current status: ",
      };
}

export function cvRetentionDaysLeft(locale: CvLocale, days: number) {
  return locale === "vi" ? `Còn ${days} ngày` : `${days} days left`;
}

export function cvKnownError(locale: CvLocale, message: string, code?: string) {
  if (locale === "en") return message;
  const byCode: Record<string, string> = {
    FILE_REQUIRED: "Hãy đính kèm tệp CV.",
    FILE_EMPTY: "Tệp CV đang trống.",
    FILE_SIZE_EXCEEDED: "Tệp CV không được vượt quá 5 MB.",
    UNSUPPORTED_FILE_TYPE: "Chỉ hỗ trợ tệp PDF, DOC hoặc DOCX.",
    INVALID_FILE_SIGNATURE:
      "Nội dung tệp không khớp với tài liệu PDF, DOC hoặc DOCX được hỗ trợ.",
    AUTHENTICATION_REQUIRED: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.",
    FORBIDDEN: "Tài khoản không được phép thực hiện thao tác này.",
    CSRF_REJECTED: "Phiên bảo mật đã hết hạn. Hãy tải lại trang và thử lại.",
    CV_PROCESSING_UNAVAILABLE: "Xử lý CV hiện không khả dụng. Hãy thử lại sau.",
    CV_QUOTA_EXCEEDED: "Bạn đã đạt giới hạn số lần nhập CV.",
    UPLOAD_RATE_LIMITED:
      "Bạn đã đạt giới hạn 5 lượt tải CV trong một giờ. Hãy thử lại sau.",
    CONSENT_REQUIRED:
      "Cần cấp quyền đồng ý trước khi tiếp tục xử lý bên ngoài.",
    RETRY_LIMIT_REACHED: "Đã hết số lượt thử lại cho lần nhập này.",
    DRAFT_REVISION_CONFLICT: "Bản xem xét đã thay đổi trong một phiên khác.",
    PROFILE_REVISION_CONFLICT: "Hồ sơ đã thay đổi trong một phiên khác.",
  };
  return byCode[code ?? ""] ?? cvCopy(locale).common.genericError;
}
