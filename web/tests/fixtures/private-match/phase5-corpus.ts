import type { ScoringInput } from "@/backend/scoring-engine/scoring-contracts";

export type Phase5CorpusExpected = Readonly<{
  experienceMonths: number;
  incomplete: boolean;
  required: Readonly<Record<string, boolean>>;
  preferred: Readonly<Record<string, boolean>>;
  scoreMayBeShown: boolean;
  allowedEvidence: readonly string[];
}>;

export type Phase5CorpusCase = Readonly<{
  id: string;
  pairId: string;
  locale: "en" | "vi";
  format: "TEXT" | "PDF_FLATTENED" | "DOCX_STRUCTURED";
  input: ScoringInput;
  expected: Phase5CorpusExpected;
}>;

const required = (code: string, label: string) => ({
  code,
  label,
  kind: "REQUIRED" as const,
});
const preferred = (code: string, label: string) => ({
  code,
  label,
  kind: "PREFERRED" as const,
});

function input(
  id: string,
  cvText: string,
  jdText: string,
  requiredSkills: ScoringInput["requiredSkills"],
  preferredSkills: ScoringInput["preferredSkills"],
  minimumExperienceYears: number | null,
  extras: Partial<Pick<ScoringInput, "cvParseFailed" | "jdParseFailed">> = {},
): ScoringInput {
  return {
    inputId: id,
    cvText,
    cvVersion: `cv-${id}`,
    cvDigest: "0".repeat(64),
    jdText,
    jdVersion: `jd-${id}`,
    jdDigest: "1".repeat(64),
    configVersion: "phase5-corpus-v1",
    parserVersion: "private-cv-match-parser-v1",
    jobTitle: "Deterministic corpus role",
    requiredSkills,
    preferredSkills,
    keyRequirements: [...requiredSkills, ...preferredSkills].map(
      (item) => item.label,
    ),
    minimumExperienceYears,
    requiredLanguages: [],
    ...extras,
  };
}

function pair(
  pairId: string,
  values: {
    enCv: string;
    viCv: string;
    enJd?: string;
    viJd?: string;
    format?: Phase5CorpusCase["format"];
    requiredSkills?: ScoringInput["requiredSkills"];
    preferredSkills?: ScoringInput["preferredSkills"];
    minimumExperienceYears?: number | null;
    experienceMonths: number;
    incomplete?: boolean;
    required: Readonly<Record<string, boolean>>;
    preferred: Readonly<Record<string, boolean>>;
    scoreMayBeShown?: boolean;
    allowedEvidence?: readonly string[];
    allowedEvidenceByLocale?: Readonly<Record<"en" | "vi", readonly string[]>>;
    extras?: Partial<Pick<ScoringInput, "cvParseFailed" | "jdParseFailed">>;
  },
): Phase5CorpusCase[] {
  const requiredSkills = values.requiredSkills ?? [
    required("communication", "Communication"),
  ];
  const preferredSkills = values.preferredSkills ?? [];
  const build = (locale: "en" | "vi", cvText: string, jdText: string) => {
    const id = `${pairId}-${locale}`;
    return {
      id,
      pairId,
      locale,
      format: values.format ?? "TEXT",
      input: input(
        id,
        cvText,
        jdText,
        requiredSkills,
        preferredSkills,
        values.minimumExperienceYears === undefined
          ? 1
          : values.minimumExperienceYears,
        values.extras,
      ),
      expected: {
        experienceMonths: values.experienceMonths,
        incomplete: values.incomplete ?? false,
        required: values.required,
        preferred: values.preferred,
        scoreMayBeShown:
          values.scoreMayBeShown ?? !(values.incomplete ?? false),
        allowedEvidence:
          values.allowedEvidenceByLocale?.[locale] ??
          values.allowedEvidence ??
          [],
      },
    } satisfies Phase5CorpusCase;
  };
  return [
    build("en", values.enCv, values.enJd ?? "Communication role requirements."),
    build("vi", values.viCv, values.viJd ?? "Yeu cau cong viec giao tiep."),
  ];
}

export const phase5Corpus: readonly Phase5CorpusCase[] = [
  ...pair("pair-01-overlap", {
    enCv: "WORK EXPERIENCE 2020-01 - 2021-12 Analyst. 2021-01 - 2022-06 Analyst. Built communication reports.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2020-01 - 2021-12 Phân tích. 2021-01 - 2022-06 Phân tích. Đã xây dựng các báo cáo về giao tiếp.",
    requiredSkills: [required("communication", "Communication")],
    experienceMonths: 30,
    required: { communication: true },
    preferred: {},
    allowedEvidenceByLocale: { en: ["communication"], vi: ["giao tiếp"] },
  }),
  ...pair("pair-02-adjacent", {
    enCv: "WORK EXPERIENCE 2020-01 - 2020-06 Coordinator. 2020-07 - 2021-01 Coordinator. Built communication plans.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2020-01 - 2020-06 Điều phối. 2020-07 - 2021-01 Điều phối. Đã xây dựng các kế hoạch giao tiếp.",
    experienceMonths: 13,
    required: { communication: true },
    preferred: {},
    allowedEvidenceByLocale: { en: ["communication"], vi: ["giao tiếp"] },
  }),
  ...pair("pair-03-gap", {
    enCv: "WORK EXPERIENCE 2019-01 - 2019-12 Specialist. 2020-03 - 2020-08 Specialist. Built communication reports.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2019-01 - 2019-12 Chuyên viên. 2020-03 - 2020-08 Chuyên viên. Đã xây dựng các báo cáo giao tiếp.",
    experienceMonths: 18,
    required: { communication: true },
    preferred: {},
    allowedEvidenceByLocale: { en: ["communication"], vi: ["giao tiếp"] },
  }),
  ...pair("pair-04-reversed", {
    enCv: "WORK EXPERIENCE 2022-01 - 2021-01 Specialist. Built communication reports.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2022-01 - 2021-01 Chuyên viên. Đã xây dựng các báo cáo giao tiếp.",
    experienceMonths: 0,
    incomplete: true,
    required: { communication: true },
    preferred: {},
    scoreMayBeShown: false,
    allowedEvidenceByLocale: { en: ["communication"], vi: ["giao tiếp"] },
  }),
  ...pair("pair-05-year-only", {
    enCv: "WORK EXPERIENCE 2020 - 2022 Specialist. Built communication reports.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2020 - 2022 Chuyên viên. Đã xây dựng các báo cáo giao tiếp.",
    experienceMonths: 24,
    required: { communication: true },
    preferred: {},
    allowedEvidenceByLocale: { en: ["communication"], vi: ["giao tiếp"] },
  }),
  ...pair("pair-06-open-ended", {
    enCv: "WORK EXPERIENCE 2023-01 - Present Specialist. Built communication reports.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2023-01 - Hiện tại Chuyên viên. Đã xây dựng các báo cáo giao tiếp.",
    experienceMonths: 45,
    required: { communication: true },
    preferred: {},
    allowedEvidenceByLocale: { en: ["communication"], vi: ["giao tiếp"] },
  }),
  ...pair("pair-07-nested", {
    enCv: "WORK EXPERIENCE 2020-01 - 2022-12 Lead. 2021-01 - 2021-06 Project. Built communication reports.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2020-01 - 2022-12 Trưởng nhóm. 2021-01 - 2021-06 Dự án. Đã xây dựng các báo cáo giao tiếp.",
    experienceMonths: 36,
    required: { communication: true },
    preferred: {},
    allowedEvidenceByLocale: { en: ["communication"], vi: ["giao tiếp"] },
  }),
  ...pair("pair-08-flattened-pdf", {
    enCv: "WORK EXPERIENCE Analyst 06/2024 - Present Built communication dashboards. EDUCATION Bachelor 2019 - 2023.",
    viCv: "KINH NGHIỆM VIỆC LÀM Chuyên viên 06/2024 - Hiện tại Đã xây dựng các bảng điều khiển giao tiếp. HỌC VẤN Cử nhân 2019 - 2023.",
    format: "PDF_FLATTENED",
    experienceMonths: 28,
    required: { communication: true },
    preferred: {},
    allowedEvidenceByLocale: { en: ["communication"], vi: ["giao tiếp"] },
  }),
  ...pair("pair-09-structured-docx", {
    enCv: '{"startDate":"2021-01","endDate":"2022-12","role":"Analyst"} Built communication reports.',
    viCv: '{"startDate":"2021-01","endDate":"2022-12","role":"Phân tích"} Đã xây dựng các báo cáo giao tiếp.',
    format: "DOCX_STRUCTURED",
    experienceMonths: 24,
    required: { communication: true },
    preferred: {},
    allowedEvidenceByLocale: { en: ["communication"], vi: ["giao tiếp"] },
  }),
  ...pair("pair-10-punctuation", {
    enCv: "WORK EXPERIENCE 2021-01 - 2022-12 Engineer. Built C++ .NET Node.js services.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2021-01 - 2022-12 Kỹ sư. Đã phát triển các dịch vụ C++ .NET Node.js.",
    requiredSkills: [
      required("cpp", "C++"),
      required("dotnet", ".NET"),
      required("node", "Node.js"),
    ],
    experienceMonths: 24,
    required: { cpp: true, dotnet: true, node: true },
    preferred: {},
    allowedEvidence: ["C++", ".NET", "Node.js"],
  }),
  ...pair("pair-11-negation", {
    enCv: "WORK EXPERIENCE 2021-01 - 2022-12 Engineer. No experience with Python. Built communication reports.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2021-01 - 2022-12 Kỹ sư. Chưa có kinh nghiệm với Python. Đã xây dựng các báo cáo giao tiếp.",
    requiredSkills: [
      required("python", "Python"),
      required("communication", "Communication"),
    ],
    experienceMonths: 24,
    required: { python: false, communication: true },
    preferred: {},
    allowedEvidenceByLocale: { en: ["communication"], vi: ["giao tiếp"] },
  }),
  ...pair("pair-12-preferred-and-missing", {
    enCv: "WORK EXPERIENCE 2021-01 - 2022-12 Engineer. Built communication reports. Limited leadership exposure.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2021-01 - 2022-12 Kỹ sư. Đã xây dựng các báo cáo giao tiếp. Kinh nghiệm lãnh đạo còn hạn chế.",
    preferredSkills: [preferred("leadership", "Leadership")],
    experienceMonths: 24,
    required: { communication: true },
    preferred: { leadership: false },
    allowedEvidenceByLocale: { en: ["communication"], vi: ["giao tiếp"] },
  }),
  ...pair("pair-13-partial-parse", {
    enCv: "WORK EXPERIENCE 2021-01 - 2022-12 Engineer. Built communication reports.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2021-01 - 2022-12 Kỹ sư. Đã xây dựng các báo cáo giao tiếp.",
    experienceMonths: 0,
    incomplete: true,
    extras: { cvParseFailed: true },
    required: { communication: false },
    preferred: {},
    scoreMayBeShown: false,
    allowedEvidence: [],
  }),
  ...pair("pair-14-failed-job-parse", {
    enCv: "WORK EXPERIENCE 2021-01 - 2022-12 Engineer. Built communication reports.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2021-01 - 2022-12 Kỹ sư. Đã xây dựng các báo cáo giao tiếp.",
    experienceMonths: 24,
    incomplete: true,
    extras: { jdParseFailed: true },
    required: { communication: true },
    preferred: {},
    scoreMayBeShown: false,
    allowedEvidenceByLocale: { en: ["communication"], vi: ["giao tiếp"] },
  }),
  ...pair("pair-15-missing-job-criteria", {
    enCv: "WORK EXPERIENCE 2021-01 - 2022-12 Engineer. Built communication reports.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2021-01 - 2022-12 Kỹ sư. Đã xây dựng các báo cáo giao tiếp.",
    enJd: "Role description without explicit requirements.",
    viJd: "Mo ta cong viec khong co yeu cau ro rang.",
    requiredSkills: [],
    preferredSkills: [],
    minimumExperienceYears: null,
    experienceMonths: 24,
    incomplete: true,
    required: {},
    preferred: {},
    scoreMayBeShown: false,
    allowedEvidence: [],
  }),
  ...pair("pair-16-skill-formatting", {
    enCv: "WORK EXPERIENCE 2021-01 - 2022-12 Engineer. Built communication, data-analysis, and problem solving tools.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2021-01 - 2022-12 Kỹ sư. Đã xây dựng các công cụ về giao tiếp, phân tích dữ liệu và giải quyết vấn đề.",
    requiredSkills: [
      required("communication", "Communication"),
      required("data-analysis", "Data Analysis"),
      required("problem-solving", "Problem Solving"),
    ],
    experienceMonths: 24,
    required: {
      communication: true,
      "data-analysis": true,
      "problem-solving": true,
    },
    preferred: {},
    allowedEvidenceByLocale: {
      en: ["communication", "data-analysis", "problem solving"],
      vi: ["giao tiếp", "phân tích dữ liệu", "giải quyết vấn đề"],
    },
  }),
  ...pair("pair-17-preferred-positive", {
    enCv: "WORK EXPERIENCE 2021-01 - 2022-12 Engineer. Demonstrated communication and led a team on delivery projects.",
    viCv: "KINH NGHIỆM VIỆC LÀM 2021-01 - 2022-12 Kỹ sư. Đã thể hiện giao tiếp và lãnh đạo nhóm trong các dự án bàn giao.",
    enJd: "The role requires communication; leadership is preferred.",
    viJd: "Công việc yêu cầu giao tiếp; lãnh đạo là kỹ năng ưu tiên.",
    requiredSkills: [required("communication", "Communication")],
    preferredSkills: [preferred("leadership", "Leadership")],
    experienceMonths: 24,
    required: { communication: true },
    preferred: { leadership: true },
    allowedEvidenceByLocale: {
      en: ["communication", "led a team"],
      vi: ["giao tiếp", "lãnh đạo"],
    },
  }),
];

if (phase5Corpus.length < 24) {
  throw new Error("PHASE5_CORPUS_TOO_SMALL");
}
