import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { jobSearchCatalogIndex } from "../src/backend/services/search/catalogs/job-search-catalog-index";
import { occupationSearchCatalog } from "../src/backend/services/search/catalogs/occupation-search-catalog";
import {
  searchMappingReviewBatchManifestSchema,
  type SearchMappingReviewBatchManifest,
} from "../src/shared/contracts/admin/search-mapping-review-batch";

config({ path: new URL("../.env.local", import.meta.url), quiet: true });

type Definition = NonNullable<
  typeof jobSearchCatalogIndex.catalog.titleDefinitions
>[number];

const phraseTranslations: readonly [string, string][] = [
  ["b2b sales executive", "chuyên viên kinh doanh B2B"],
  ["b2b sales manager", "quản lý kinh doanh B2B"],
  [
    "building materials sales executive",
    "chuyên viên kinh doanh vật liệu xây dựng",
  ],
  ["document processing executive", "chuyên viên xử lý tài liệu"],
  ["field sales executive", "chuyên viên kinh doanh thị trường"],
  ["it solutions sales executive", "chuyên viên kinh doanh giải pháp CNTT"],
  ["import-export sales executive", "chuyên viên kinh doanh xuất nhập khẩu"],
  ["logistics sales executive", "chuyên viên kinh doanh logistics"],
  ["market development executive", "chuyên viên phát triển thị trường"],
  ["market development manager", "quản lý phát triển thị trường"],
  ["post office manager", "quản lý bưu cục"],
  ["post office staff", "nhân viên bưu điện"],
  ["project planning specialist", "chuyên viên hoạch định dự án"],
  ["sales admin team lead", "trưởng nhóm hành chính kinh doanh"],
  ["sales administrator", "nhân viên hành chính kinh doanh"],
  ["sales engineer", "kỹ sư bán hàng"],
  ["paid ads specialist", "chuyên viên quảng cáo trả phí"],
  [
    "e-commerce operations specialist",
    "chuyên viên vận hành thương mại điện tử",
  ],
  ["facebook ads", "quảng cáo Facebook"],
  ["google ads", "quảng cáo Google"],
  ["tour sales executive", "chuyên viên kinh doanh du lịch"],
  ["advertising production specialist", "chuyên viên sản xuất quảng cáo"],
  ["community moderator", "kiểm duyệt viên cộng đồng"],
  ["content creator", "nhà sáng tạo nội dung"],
  ["content moderator", "kiểm duyệt viên nội dung"],
  ["event model", "người mẫu sự kiện"],
  ["event organizer", "nhân viên tổ chức sự kiện"],
  ["internal communications specialist", "chuyên viên truyền thông nội bộ"],
  ["creator manager", "quản lý nhà sáng tạo nội dung"],
  ["product marketing executive", "chuyên viên marketing sản phẩm"],
  ["retail cashier", "thu ngân bán lẻ"],
  ["retail operations manager", "quản lý vận hành bán lẻ"],
  ["document controller", "chuyên viên kiểm soát tài liệu"],
  ["hr generalist", "chuyên viên nhân sự tổng hợp"],
  ["industrial electrician", "thợ điện công nghiệp"],
  ["interior project manager", "quản lý dự án nội thất"],
  ["real estate development manager", "quản lý phát triển bất động sản"],
  ["real estate project manager", "quản lý dự án bất động sản"],
  ["machinist", "thợ gia công cơ khí"],
  ["turner", "thợ tiện"],
  ["videographer", "quay phim"],
  ["stockbroker", "môi giới chứng khoán"],
  ["qa/qc specialist", "chuyên viên đảm bảo và kiểm soát chất lượng"],
  ["delivery shipper", "nhân viên giao hàng"],
  ["tv producer", "nhà sản xuất truyền hình"],
  ["telecom sales executive", "chuyên viên kinh doanh viễn thông"],
  ["telesales representative", "nhân viên bán hàng qua điện thoại"],
  ["kol booking specialist", "chuyên viên đặt lịch KOL"],
  [
    "paid ads specialist (facebook ads)",
    "chuyên viên quảng cáo trả phí (quảng cáo Facebook)",
  ],
  [
    "paid ads specialist (google ads)",
    "chuyên viên quảng cáo trả phí (quảng cáo Google)",
  ],
  ["photographer", "nhiếp ảnh gia"],
  ["videographer", "quay phim"],
  ["merchandiser", "nhân viên trưng bày hàng hóa"],
  ["pattern maker", "nhân viên thiết kế rập"],
  ["penetration tester", "chuyên viên kiểm thử xâm nhập"],
  ["security analyst", "chuyên viên phân tích an ninh mạng"],
  ["customer service representative", "nhân viên chăm sóc khách hàng"],
  ["medical assistant", "trợ lý y khoa"],
  ["underwriter", "chuyên viên thẩm định bảo hiểm"],
  ["building manager", "quản lý tòa nhà"],
  ["assistant doctor", "trợ lý bác sĩ"],
  ["research scientist", "nhà nghiên cứu khoa học"],
  ["loader", "nhân viên bốc xếp"],
  ["livestream assistant", "trợ lý livestream"],
  ["livestream host", "người dẫn livestream"],
  ["e-commerce livestream assistant", "trợ lý livestream thương mại điện tử"],
  ["e-commerce livestream host", "người dẫn livestream thương mại điện tử"],
  [
    "e-commerce operations specialist (lazada)",
    "chuyên viên vận hành thương mại điện tử (Lazada)",
  ],
  [
    "e-commerce operations specialist (shopee)",
    "chuyên viên vận hành thương mại điện tử (Shopee)",
  ],
  [
    "e-commerce operations specialist (tiktok shop)",
    "chuyên viên vận hành thương mại điện tử (TikTok Shop)",
  ],
  ["chief executive officer", "giám đốc điều hành"],
  ["chief operating officer", "giám đốc vận hành"],
  ["chief financial officer", "giám đốc tài chính"],
  ["chief marketing officer", "giám đốc marketing"],
  ["chief technology officer", "giám đốc công nghệ"],
  ["chief commercial officer", "giám đốc thương mại"],
  ["chief human resources officer", "giám đốc nhân sự"],
  ["cost controller", "chuyên viên kiểm soát chi phí"],
  ["product owner", "chủ sản phẩm"],
  ["it helpdesk", "nhân viên hỗ trợ CNTT"],
  ["product marketing", "marketing sản phẩm"],
  ["import-export", "xuất nhập khẩu"],
  ["debt collection", "thu hồi công nợ"],
  ["it support", "hỗ trợ CNTT"],
  ["residential electrician", "thợ điện dân dụng"],
  ["water supply & drainage", "cấp thoát nước"],
  ["assistant doctor", "bác sĩ trợ lý"],
  ["retail sales associate", "nhân viên kinh doanh bán lẻ"],
  ["insurance sales", "kinh doanh bảo hiểm"],
  ["makeup artist", "chuyên viên trang điểm"],
  ["automotive engineer", "kỹ sư ô tô"],
  ["interior fit-out engineer", "kỹ sư hoàn thiện nội thất"],
  ["container driver", "tài xế xe container"],
  ["penetration tester", "kiểm thử xâm nhập"],
  ["human resources", "nhân sự"],
  ["information technology", "công nghệ thông tin"],
  ["research and development", "nghiên cứu và phát triển"],
  ["accounts payable", "công nợ phải trả"],
  ["accounts receivable", "công nợ phải thu"],
  ["accounting and finance", "kế toán và tài chính"],
  ["business development", "phát triển kinh doanh"],
  ["customer service", "chăm sóc khách hàng"],
  ["customer experience", "trải nghiệm khách hàng"],
  ["supply chain", "chuỗi cung ứng"],
  ["quality assurance", "đảm bảo chất lượng"],
  ["quality control", "kiểm soát chất lượng"],
  ["internal control", "kiểm soát nội bộ"],
  ["project management", "quản lý dự án"],
  ["product management", "quản lý sản phẩm"],
  ["product development", "phát triển sản phẩm"],
  ["social media", "truyền thông xã hội"],
  ["digital marketing", "marketing kỹ thuật số"],
  ["content marketing", "marketing nội dung"],
  ["performance marketing", "marketing hiệu suất"],
  ["trade marketing", "marketing thương mại"],
  ["market research", "nghiên cứu thị trường"],
  ["public relations", "quan hệ công chúng"],
  ["paid ads", "quảng cáo trả phí"],
  ["sales operations", "vận hành kinh doanh"],
  ["sales support", "hỗ trợ kinh doanh"],
  ["key account", "khách hàng trọng điểm"],
  ["account management", "quản lý khách hàng"],
  ["media buyer", "chuyên viên mua quảng cáo"],
  ["call center", "trung tâm cuộc gọi"],
  ["contact center", "trung tâm liên hệ"],
  ["complaint handling", "xử lý khiếu nại"],
  ["data entry", "nhập liệu"],
  ["data processing", "xử lý dữ liệu"],
  ["front desk", "lễ tân"],
  ["management trainee", "nhân viên tập sự quản lý"],
  ["technical lead", "trưởng nhóm kỹ thuật"],
  ["test lead", "trưởng nhóm kiểm thử"],
  ["site reliability", "độ tin cậy hệ thống"],
  ["big data", "dữ liệu lớn"],
  ["water supply and drainage", "cấp thoát nước"],
  ["land acquisition", "thu hồi đất"],
  ["claims adjustment", "giám định bồi thường"],
  ["relationship manager", "quản lý quan hệ khách hàng"],
  ["order fulfillment", "xử lý đơn hàng"],
  ["ride-hailing", "xe công nghệ"],
  ["teaching assistant", "trợ giảng"],
  ["digital content", "nội dung số"],
  ["motion graphics", "đồ họa chuyển động"],
  ["wastewater treatment", "xử lý nước thải"],
  ["renewable energy", "năng lượng tái tạo"],
  ["solar energy", "năng lượng mặt trời"],
  ["aesthetic clinic", "phòng khám thẩm mỹ"],
  ["beauty consultant", "chuyên viên tư vấn làm đẹp"],
  ["nail technician", "kỹ thuật viên làm móng"],
  ["skincare specialist", "chuyên viên chăm sóc da"],
  ["spa therapist", "kỹ thuật viên trị liệu spa"],
  ["fashion designer", "nhà thiết kế thời trang"],
  ["graphic designer", "nhà thiết kế đồ họa"],
  ["interior designer", "nhà thiết kế nội thất"],
  ["exterior designer", "nhà thiết kế ngoại thất"],
  ["mechanical design", "thiết kế cơ khí"],
  ["automotive maintenance", "bảo trì ô tô"],
  ["automotive repair", "sửa chữa ô tô"],
  ["construction site", "công trường xây dựng"],
  ["quantity surveyor", "kỹ sư dự toán"],
  ["architectural drafter", "họa viên kiến trúc"],
  ["laboratory technician", "kỹ thuật viên phòng thí nghiệm"],
  ["medical representative", "trình dược viên"],
  ["pharmaceutical R&D", "nghiên cứu và phát triển dược phẩm"],
  ["biotechnology R&D", "nghiên cứu và phát triển công nghệ sinh học"],
  ["retail sales", "kinh doanh bán lẻ"],
  ["assistant store manager", "trợ lý quản lý cửa hàng"],
  ["hotel receptionist", "nhân viên lễ tân khách sạn"],
  ["travel sales", "kinh doanh du lịch"],
  ["tour guide", "hướng dẫn viên du lịch"],
  ["tour operator", "điều hành tour"],
  ["admissions consultant", "chuyên viên tư vấn tuyển sinh"],
  ["education consultant", "chuyên viên tư vấn giáo dục"],
  ["curriculum developer", "chuyên viên phát triển chương trình học"],
  ["affiliate marketing", "tiếp thị liên kết"],
  ["garment QA/QC", "kiểm soát chất lượng may mặc"],
  ["research scientist", "nhà khoa học nghiên cứu"],
  ["import export", "xuất nhập khẩu"],
  ["e commerce", "thương mại điện tử"],
  ["e-commerce", "thương mại điện tử"],
  ["real estate", "bất động sản"],
  ["corporate finance", "tài chính doanh nghiệp"],
  ["financial planning", "hoạch định tài chính"],
  ["investment banking", "ngân hàng đầu tư"],
  ["data science", "khoa học dữ liệu"],
  ["machine learning", "học máy"],
  ["artificial intelligence", "trí tuệ nhân tạo"],
  ["software development", "phát triển phần mềm"],
  ["software engineering", "kỹ thuật phần mềm"],
  ["cyber security", "an ninh mạng"],
  ["cybersecurity", "an ninh mạng"],
  ["information security", "an toàn thông tin"],
  ["technical support", "hỗ trợ kỹ thuật"],
  ["customer success", "thành công khách hàng"],
  ["talent acquisition", "thu hút nhân tài"],
  ["employer branding", "thương hiệu tuyển dụng"],
  ["training and development", "đào tạo và phát triển"],
  ["learning and development", "đào tạo và phát triển"],
  ["public policy", "chính sách công"],
  ["legal compliance", "tuân thủ pháp lý"],
  ["construction project", "dự án xây dựng"],
  ["hotel operations", "vận hành khách sạn"],
  ["food and beverage", "ẩm thực và đồ uống"],
  ["health and safety", "an toàn và sức khỏe"],
  ["warehouse operations", "vận hành kho"],
  ["retail operations", "vận hành bán lẻ"],
  ["property management", "quản lý bất động sản"],
  ["medical representative", "trình dược viên"],
  ["foreign trade", "ngoại thương"],
  ["sourcing and procurement", "tìm nguồn cung và mua hàng"],
  ["research and development", "nghiên cứu và phát triển"],
];

const tokenTranslations: Readonly<Record<string, string>> = {
  account: "khách hàng",
  accounting: "kế toán",
  accountant: "kế toán",
  admin: "hành chính",
  administration: "hành chính",
  administrative: "hành chính",
  advertising: "quảng cáo",
  agency: "đại lý",
  analyst: "phân tích",
  analytics: "phân tích dữ liệu",
  architect: "kiến trúc",
  archival: "lưu trữ",
  area: "khu vực",
  asset: "tài sản",
  audit: "kiểm toán",
  auditor: "kiểm toán viên",
  automation: "tự động hóa",
  art: "nghệ thuật",
  banking: "ngân hàng",
  bank: "ngân hàng",
  brand: "thương hiệu",
  building: "xây dựng",
  branch: "chi nhánh",
  buyer: "thu mua",
  agent: "nhân viên",
  cashier: "thu ngân",
  chef: "bếp",
  cloud: "đám mây",
  commercial: "thương mại",
  communications: "truyền thông",
  community: "cộng đồng",
  compliance: "tuân thủ",
  content: "nội dung",
  controller: "kiểm soát",
  corporate: "doanh nghiệp",
  cost: "chi phí",
  creative: "sáng tạo",
  cyber: "an ninh mạng",
  data: "dữ liệu",
  database: "cơ sở dữ liệu",
  debt: "công nợ",
  document: "tài liệu",
  drafter: "họa viên",
  drainage: "thoát nước",
  development: "phát triển",
  digital: "kỹ thuật số",
  doctor: "bác sĩ",
  education: "giáo dục",
  electrical: "điện",
  electrician: "thợ điện",
  embedded: "nhúng",
  engineer: "kỹ thuật",
  engineering: "kỹ thuật",
  event: "sự kiện",
  executive: "điều hành",
  external: "bên ngoài",
  fashion: "thời trang",
  facility: "cơ sở vật chất",
  field: "thị trường",
  finance: "tài chính",
  financial: "tài chính",
  food: "ẩm thực",
  foreign: "nước ngoài",
  frontend: "frontend",
  general: "tổng hợp",
  game: "trò chơi",
  generalist: "tổng quát",
  health: "sức khỏe",
  healthcare: "chăm sóc sức khỏe",
  human: "nhân sự",
  hr: "nhân sự",
  hrbp: "đối tác nhân sự",
  it: "CNTT",
  import: "nhập khẩu",
  insurance: "bảo hiểm",
  post: "bưu chính",
  processing: "xử lý",
  materials: "vật liệu",
  partnership: "đối tác",
  planning: "hoạch định",
  regional: "khu vực",
  telecommunications: "viễn thông",
  telecom: "viễn thông",
  solutions: "giải pháp",
  entry: "nhập liệu",
  helpdesk: "hỗ trợ CNTT",
  penetration: "xâm nhập",
  reliability: "độ tin cậy",
  blockchain: "chuỗi khối",
  flutter: "Flutter",
  fullstack: "Full-stack",
  firmware: "firmware",
  hardware: "phần cứng",
  webmaster: "quản trị website",
  scrum: "Scrum",
  master: "Master",
  creator: "sáng tạo nội dung",
  moderator: "kiểm duyệt nội dung",
  organizer: "tổ chức sự kiện",
  idol: "nghệ sĩ",
  booking: "đặt lịch",
  seeding: "phát triển cộng đồng",
  paid: "trả phí",
  ads: "quảng cáo",
  copywriter: "biên tập nội dung quảng cáo",
  model: "người mẫu",
  pg: "PG",
  pb: "PB",
  influencer: "người ảnh hưởng",
  employee: "nhân viên",
  trainee: "nhân viên tập sự",
  calibration: "hiệu chuẩn",
  electronics: "điện tử",
  hvac: "điều hòa và thông gió",
  mep: "cơ điện công trình",
  plc: "điều khiển PLC",
  plumber: "thợ ống nước",
  solar: "mặt trời",
  semiconductor: "bán dẫn",
  industrial: "công nghiệp",
  industry: "ngành công nghiệp",
  internal: "nội bộ",
  inventory: "hàng tồn kho",
  investment: "đầu tư",
  java: "Java",
  legal: "pháp lý",
  logistics: "logistics",
  laboratory: "phòng thí nghiệm",
  lab: "phòng thí nghiệm",
  lecturer: "giảng viên",
  librarian: "thủ thư",
  loader: "bốc xếp",
  machine: "máy",
  maintenance: "bảo trì",
  management: "quản lý",
  manager: "quản lý",
  marketing: "marketing",
  market: "thị trường",
  media: "truyền thông",
  medical: "y tế",
  merchandising: "trưng bày hàng hóa",
  mobile: "di động",
  network: "mạng",
  office: "văn phòng",
  operations: "vận hành",
  operator: "vận hành",
  product: "sản phẩm",
  production: "sản xuất",
  procurement: "mua hàng",
  policy: "chính sách",
  project: "dự án",
  quality: "chất lượng",
  real: "bất động sản",
  recruitment: "tuyển dụng",
  research: "nghiên cứu",
  retail: "bán lẻ",
  sales: "kinh doanh",
  collection: "thu hồi",
  security: "an ninh",
  service: "dịch vụ",
  software: "phần mềm",
  solution: "giải pháp",
  safety: "an toàn",
  scientist: "nhà khoa học",
  site: "công trường",
  statistical: "thống kê",
  sustainability: "bền vững",
  wastewater: "nước thải",
  underwriter: "thẩm định bảo hiểm",
  underwriting: "thẩm định bảo hiểm",
  portfolio: "danh mục đầu tư",
  credit: "tín dụng",
  fund: "quỹ",
  proprietary: "tự doanh",
  relationship: "quan hệ",
  personal: "cá nhân",
  property: "bất động sản",
  land: "đất đai",
  repair: "sửa chữa",
  mechanical: "cơ khí",
  mechatronics: "cơ điện tử",
  civil: "dân dụng",
  highway: "đường cao tốc",
  exterior: "ngoại thất",
  interior: "nội thất",
  construction: "xây dựng",
  assembly: "lắp ráp",
  plant: "nhà máy",
  process: "quy trình",
  workshop: "xưởng",
  complaint: "khiếu nại",
  handling: "xử lý",
  graphics: "đồ họa",
  graphic: "đồ họa",
  photographer: "nhiếp ảnh",
  videographer: "quay phim",
  environmental: "môi trường",
  energy: "năng lượng",
  agricultural: "nông nghiệp",
  agronomy: "nông học",
  forestry: "lâm nghiệp",
  garment: "may mặc",
  footwear: "giày dép",
  pattern: "mẫu rập",
  maker: "thợ chế tác",
  bus: "xe buýt",
  coach: "xe khách",
  container: "xe container",
  delivery: "giao hàng",
  shipper: "nhân viên giao hàng",
  cleaner: "nhân viên vệ sinh",
  janitor: "nhân viên tạp vụ",
  packer: "nhân viên đóng gói",
  unloader: "nhân viên dỡ hàng",
  barista: "nhân viên pha chế",
  bartender: "nhân viên pha chế",
  cook: "đầu bếp",
  hotel: "khách sạn",
  restaurant: "nhà hàng",
  kitchen: "bếp",
  beauty: "làm đẹp",
  cosmetics: "mỹ phẩm",
  makeup: "trang điểm",
  salon: "salon",
  spa: "spa",
  editor: "biên tập",
  books: "sách",
  magazines: "tạp chí",
  journalist: "nhà báo",
  reporter: "phóng viên",
  television: "truyền hình",
  tv: "truyền hình",
  producer: "nhà sản xuất",
  admissions: "tuyển sinh",
  curriculum: "chương trình học",
  teaching: "giảng dạy",
  affiliate: "liên kết",
  livestream: "livestream",
  order: "đơn hàng",
  fulfillment: "hoàn tất",
  aesthetic: "thẩm mỹ",
  nail: "móng",
  skincare: "chăm sóc da",
  therapist: "kỹ thuật viên trị liệu",
  proofreader: "biên tập viên kiểm lỗi",
  documentation: "tài liệu",
  sourcing: "tìm nguồn cung",
  purchaser: "nhân viên thu mua",
  manufacturing: "sản xuất",
  renewable: "tái tạo",
  quantity: "khối lượng",
  surveyor: "trắc địa",
  architectural: "kiến trúc",
  publishing: "xuất bản",
  waiter: "nhân viên phục vụ",
  waitress: "nhân viên phục vụ",
  store: "cửa hàng",
  specialist: "chuyên môn",
  supply: "cung ứng",
  system: "hệ thống",
  systems: "hệ thống",
  tax: "thuế",
  teacher: "giáo viên",
  technical: "kỹ thuật",
  technician: "kỹ thuật viên",
  technology: "công nghệ",
  telesales: "bán hàng qua điện thoại",
  trade: "thương mại",
  training: "đào tạo",
  translator: "biên dịch",
  tour: "du lịch",
  travel: "du lịch",
  warehouse: "kho",
  web: "web",
};

const roleTranslations: readonly [string, string][] = [
  ["team lead", "trưởng nhóm"],
  ["vice president", "phó chủ tịch"],
  ["architect", "kiến trúc sư"],
  ["scientist", "nhà khoa học"],
  ["director", "giám đốc"],
  ["manager", "quản lý"],
  ["supervisor", "giám sát"],
  ["specialist", "chuyên viên"],
  ["executive", "chuyên viên"],
  ["engineer", "kỹ sư"],
  ["developer", "lập trình viên"],
  ["designer", "nhà thiết kế"],
  ["analyst", "chuyên viên phân tích"],
  ["accountant", "kế toán viên"],
  ["auditor", "kiểm toán viên"],
  ["consultant", "chuyên viên tư vấn"],
  ["coordinator", "điều phối viên"],
  ["administrator", "quản trị viên"],
  ["technician", "kỹ thuật viên"],
  ["representative", "đại diện"],
  ["agent", "nhân viên"],
  ["teller", "giao dịch viên"],
  ["trader", "chuyên viên giao dịch"],
  ["artist", "nghệ sĩ"],
  ["assistant", "trợ lý"],
  ["intern", "thực tập sinh"],
  ["officer", "chuyên viên"],
  ["planner", "chuyên viên hoạch định"],
  ["buyer", "nhân viên thu mua"],
  ["associate", "nhân viên"],
  ["operator", "nhân viên vận hành"],
  ["secretary", "thư ký"],
  ["recruiter", "nhà tuyển dụng"],
  ["teacher", "giáo viên"],
  ["nurse", "y tá"],
  ["doctor", "bác sĩ"],
  ["chef", "đầu bếp"],
  ["driver", "tài xế"],
  ["guard", "bảo vệ"],
  ["clerk", "nhân viên"],
  ["staff", "nhân viên"],
  ["worker", "công nhân"],
  ["host", "người dẫn"],
  ["editor", "biên tập viên"],
  ["writer", "biên tập viên"],
  ["tester", "kiểm thử viên"],
  ["owner", "chủ sản phẩm"],
  ["lead", "trưởng nhóm"],
];

const intentPreserve = new Set([
  "mc",
  "kol",
  "it comtor",
  "webmaster",
  "scrum master",
  "streamer",
  "tiktoker",
]);

const allowedIndustryLoanwords = new Set([
  "ai",
  "b2b",
  "api",
  "ads",
  "android",
  "c++",
  "cad",
  "cco",
  "cfo",
  "chro",
  "cmo",
  "coo",
  "container",
  "cpp",
  "dba",
  "devops",
  "erp",
  "facebook",
  "flutter",
  "firmware",
  "frontend",
  "fullstack",
  "golang",
  "google",
  "hse",
  "hvac",
  "ios",
  "iot",
  "java",
  "javascript",
  "kam",
  "kol",
  "lazada",
  "livestream",
  "logistics",
  "marketing",
  "mc",
  "mep",
  "nodejs",
  "otc",
  "etc",
  "php",
  "pg",
  "pb",
  "plc",
  "pm",
  "python",
  "qa",
  "qc",
  "rpa",
  "react",
  "native",
  "ruby",
  "salesforce",
  "shopee",
  "sre",
  "spa",
  "salon",
  "tour",
  "tiktok",
  "tiktokshop",
  "ui",
  "ux",
  "web",
]);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[đĐ]/gu, "d")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function noDiacritics(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[đĐ]/gu, (character) => (character === "Đ" ? "D" : "d"));
}

function applyPhrases(value: string) {
  let result = value;
  for (const [source, target] of [...phraseTranslations].sort(
    (left, right) => right[0].length - left[0].length,
  )) {
    result = result.replace(
      new RegExp(`\\b${escapeRegExp(source)}\\b`, "giu"),
      target,
    );
  }
  return result;
}

function translateWords(value: string) {
  const phrased = applyPhrases(value)
    .replace(/C&B/giu, "lương thưởng và phúc lợi")
    .replace(/QA\/QC/giu, "đảm bảo và kiểm soát chất lượng")
    .replace(/R&D/giu, "nghiên cứu và phát triển")
    .replace(/L&D/giu, "đào tạo và phát triển");
  return phrased.replace(/[A-Za-z][A-Za-z+#.-]*/gu, (word) => {
    const translated = tokenTranslations[word.toLocaleLowerCase()];
    return translated ?? word;
  });
}

function translateTitle(title: string, ownerLabel: string | undefined) {
  const parenthetical: string[] = [];
  const withoutParenthetical = title.replace(/\([^)]*\)/gu, (value) => {
    parenthetical.push(value);
    return "";
  });
  const core = withoutParenthetical.trim().replace(/\s+/gu, " ");
  const coreLower = core.toLocaleLowerCase();
  if (intentPreserve.has(coreLower)) return title;

  const exactPhrase = phraseTranslations.some(
    ([source]) => source.toLocaleLowerCase() === coreLower,
  );
  let translatedCore: string | undefined = exactPhrase
    ? applyPhrases(core)
    : undefined;
  for (const [role, roleVi] of roleTranslations) {
    if (translatedCore) break;
    const match = new RegExp(`(?:^|\\s)${escapeRegExp(role)}$`, "iu").exec(
      core,
    );
    if (!match) continue;
    const prefix = core.slice(0, match.index).trim();
    const translatedPrefix = prefix ? translateWords(prefix) : "";
    translatedCore = [roleVi, translatedPrefix].filter(Boolean).join(" ");
    break;
  }
  translatedCore ??= translateWords(core);
  const hasVietnamese = /[À-ỹ]/u.test(translatedCore);
  const hasMeaningfulTranslation =
    hasVietnamese || exactPhrase || translatedCore !== core;
  if (!hasMeaningfulTranslation && ownerLabel) {
    translatedCore = `Chuyên viên ${ownerLabel}`;
  }
  const translatedParenthetical = parenthetical.map((value) => {
    const inner = value.slice(1, -1).trim();
    const translated = translateWords(inner);
    return `(${translated})`;
  });
  const result = [translatedCore, ...translatedParenthetical]
    .filter(Boolean)
    .join(" ");
  return result.slice(0, 160);
}

function inferredAbbreviations(title: string, existing: readonly string[]) {
  const fromParenthetical = [...title.matchAll(/\(([^)]{2,12})\)/gu)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => /^[A-Z0-9+#.-]{2,12}$/u.test(value));
  const allCaps = title
    .split(/\s+/u)
    .map((part) => part.replace(/[^A-Z0-9+#.-]/gu, ""))
    .filter((part) => /^[A-Z][A-Z0-9+#.-]{1,11}$/u.test(part));
  return [...new Set([...existing, ...fromParenthetical, ...allCaps])].slice(
    0,
    32,
  );
}

function ownerLabelFor(
  definition: Definition,
  ownerById: ReadonlyMap<string, (typeof occupationSearchCatalog)[number]>,
) {
  return definition.occupationId
    ? ownerById.get(definition.occupationId)?.labels.vi
    : undefined;
}

function classify(
  definition: Definition,
  candidate: string,
  allDefinitions: readonly Definition[],
) {
  if (!definition.occupationId) return { decision: "REJECT" as const };
  const sameEnglish = allDefinitions.find(
    (other) =>
      other.titleId !== definition.titleId &&
      fold(other.canonical.en) === fold(definition.canonical.en),
  );
  if (sameEnglish) {
    return {
      decision: "MERGE" as const,
      mergeTargetTitleId: sameEnglish.titleId,
    };
  }
  if (intentPreserve.has(fold(definition.canonical.en))) {
    return { decision: "INTENTIONAL_UNTRANSLATED" as const };
  }
  const originalTokens = fold(definition.canonical.en).split(" ");
  const candidateTokens = new Set(fold(candidate).split(" "));
  const parentheticalTokens = new Set(
    [...definition.canonical.en.matchAll(/\(([^)]*)\)/gu)]
      .flatMap((match) => fold(match[1] ?? "").split(" "))
      .filter(Boolean),
  );
  const unresolved = originalTokens.filter(
    (token) =>
      token.length >= 3 &&
      candidateTokens.has(token) &&
      !allowedIndustryLoanwords.has(token) &&
      !parentheticalTokens.has(token),
  );
  if (
    unresolved.length > 0 ||
    fold(candidate) === fold(definition.canonical.en)
  ) {
    return { decision: "REJECT" as const };
  }
  return { decision: "APPROVE" as const };
}

function itemFor(
  definition: Definition,
  allDefinitions: readonly Definition[],
  ownerById: ReadonlyMap<string, (typeof occupationSearchCatalog)[number]>,
) {
  const ownerLabel = ownerLabelFor(definition, ownerById);
  const canonicalVi = translateTitle(definition.canonical.en, ownerLabel);
  const classification = classify(definition, canonicalVi, allDefinitions);
  const decision = classification.decision;
  const aliasesVi =
    decision === "INTENTIONAL_UNTRANSLATED"
      ? []
      : [
          canonicalVi,
          noDiacritics(canonicalVi),
          noDiacritics(canonicalVi).replace(/\s+/gu, ""),
        ].filter(
          (value, index, values) => value && values.indexOf(value) === index,
        );
  const confidence =
    decision === "APPROVE"
      ? 0.72
      : decision === "INTENTIONAL_UNTRANSLATED"
        ? 0.6
        : 0.4;
  return {
    titleId: definition.titleId,
    originalTitle: definition.canonical.en,
    canonicalEn: definition.canonical.en,
    canonicalVi,
    aliasesVi,
    aliasesEn: [definition.canonical.en],
    abbreviations: inferredAbbreviations(
      definition.canonical.en,
      definition.abbreviations,
    ),
    occupationId: definition.occupationId,
    facetIds: definition.facetIds,
    proposedDecision: decision,
    ...(classification.decision === "MERGE"
      ? { mergeTargetTitleId: classification.mergeTargetTitleId }
      : {}),
    confidence,
    rationale:
      decision === "APPROVE"
        ? `Draft generated from the ${ownerLabel ?? "active occupation"} taxonomy using phrase-lexicon-v1. A human reviewer must verify occupational meaning, Vietnamese wording and aliases before approval.`
        : decision === "INTENTIONAL_UNTRANSLATED"
          ? "Draft keeps the title literal because it is an acronym or a commonly used industry loanword. A human reviewer must explicitly confirm INTENTIONAL_UNTRANSLATED and its scope."
          : decision === "MERGE"
            ? "Draft detected an equivalent canonical English title and proposes a merge. A human reviewer must verify that the two records are semantically identical."
            : "Draft has no safe taxonomy owner and must be rejected or mapped by a human reviewer.",
    humanApproved: false,
    reviewer: null,
  };
}

async function main() {
  const outputArgument = process.argv
    .slice(2)
    .find((argument) => argument.startsWith("--output="));
  const output = outputArgument
    ? resolve(process.cwd(), outputArgument.slice("--output=".length))
    : resolve(
        process.cwd(),
        "..",
        "docs",
        "search-v3",
        `search-title-translation-draft-${jobSearchCatalogIndex.catalog.version}.json`,
      );
  const catalog = jobSearchCatalogIndex.catalog;
  const definitions = catalog.titleDefinitions ?? [];
  const targetDefinitions = definitions.filter(
    (definition) => definition.translationStatus === "REQUIRES_REVIEW",
  );
  const ownerById = new Map(
    occupationSearchCatalog.map((occupation) => [
      occupation.occupationId,
      occupation,
    ]),
  );
  const items = targetDefinitions.map((definition) =>
    itemFor(definition, definitions, ownerById),
  );
  const manifest: SearchMappingReviewBatchManifest =
    searchMappingReviewBatchManifestSchema.parse({
      schemaVersion: "search-mapping-review-batch-v1",
      generatedAt: new Date().toISOString(),
      catalogVersion: catalog.version,
      source: "TAXONOMY_CONTEXT_RULES",
      humanApprovalRequired: true,
      humanReviewConfirmed: false,
      reviewer: null,
      counts: {
        total: items.length,
        approve: items.filter((item) => item.proposedDecision === "APPROVE")
          .length,
        intentionalUntranslated: items.filter(
          (item) => item.proposedDecision === "INTENTIONAL_UNTRANSLATED",
        ).length,
        merge: items.filter((item) => item.proposedDecision === "MERGE").length,
        reject: items.filter((item) => item.proposedDecision === "REJECT")
          .length,
      },
      items,
    });
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(
    `SEARCH_TITLE_TRANSLATION_MANIFEST\n${JSON.stringify(
      {
        output,
        catalogVersion: manifest.catalogVersion,
        counts: manifest.counts,
        humanReviewConfirmed: manifest.humanReviewConfirmed,
      },
      null,
      2,
    )}`,
  );
}

main().catch((error) => {
  console.error(
    `SEARCH_TITLE_TRANSLATION_MANIFEST_FAILED\n${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
