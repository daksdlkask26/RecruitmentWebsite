import { z } from "zod";

const skillCriterionSchema = z
  .object({
    code: z.string().trim().min(1).max(128),
    label: z.string().trim().min(1).max(200),
    kind: z.enum(["REQUIRED", "PREFERRED"]),
  })
  .strict();

export const scoringInputSchema = z
  .object({
    inputId: z.string().min(1).max(128),
    cvText: z.string().min(1).max(1_000_000),
    cvVersion: z.string().min(1).max(128),
    cvDigest: z.string().regex(/^[a-f0-9]{64}$/iu),
    jdText: z.string().min(1).max(500_000),
    jdVersion: z.string().min(1).max(128),
    jdDigest: z.string().regex(/^[a-f0-9]{64}$/iu),
    configVersion: z.string().min(1).max(64),
    parserVersion: z.string().min(1).max(80),
    jobTitle: z.string().max(200),
    requiredSkills: z.array(skillCriterionSchema).max(100),
    preferredSkills: z.array(skillCriterionSchema).max(100),
    keyRequirements: z.array(z.string().trim().min(1).max(300)).max(100),
    minimumExperienceYears: z.number().nonnegative().nullable(),
    requiredLanguages: z.array(z.string().trim().min(1).max(100)).max(20),
    automaticScore: z.number().min(0).max(100).optional(),
    automaticEvidence: z
      .array(
        z
          .object({
            title: z.string().min(1).max(200),
            excerpt: z.string().min(1).max(1_000),
          })
          .strict(),
      )
      .max(30)
      .optional(),
    cvParseFailed: z.boolean().optional(),
    jdParseFailed: z.boolean().optional(),
  })
  .strict();

export type SkillCriterion = z.infer<typeof skillCriterionSchema>;
export type ScoringInput = z.infer<typeof scoringInputSchema>;

export type MatchLocation = Readonly<{
  section: string;
  page: number | null;
}>;

export type MatchEvidence = Readonly<{
  criterionId: string;
  criterionVersion: string;
  classification:
    | "SKILL"
    | "PROJECT"
    | "IMPACT"
    | "EXPERIENCE"
    | "EDUCATION"
    | "OTHER";
  quote: string;
  location: MatchLocation;
  confidence: number;
  exclusionFlags: readonly string[];
}>;

export type RequirementMatch = Readonly<{
  id: string;
  label: string;
  kind: "REQUIRED" | "PREFERRED";
  matched: boolean;
}>;

export type RequirementGap = Readonly<{
  code: string;
  title: string;
  description: string;
  kind: "REQUIRED" | "PREFERRED" | "EXPERIENCE";
}>;

export type AutomaticMatchingResult = Readonly<{
  resultId: string;
  score: number;
  weight: 0.4;
  weightedContribution: number;
  matchedRequirements: readonly RequirementMatch[];
  gaps: readonly RequirementGap[];
  requiredExperience: number | null;
  detectedExperience: number | null;
  /** Calendar-month union exposed for deterministic audit/evaluation only. */
  detectedExperienceMonths?: number | null;
  experienceIntervals?: readonly Readonly<{
    startMonth: number;
    endMonthExclusive: number;
  }>[];
  evidenceCoverage: number;
  evidenceConfidence: number;
  evidence: readonly MatchEvidence[];
  parserProvenance: Readonly<{
    parserVersion: string;
    cvStatus: string;
    jdStatus: string;
  }>;
  mayBeIncomplete: boolean;
  cvVersion: string;
  jdVersion: string;
  configVersion: string;
}>;

export type AiEvaluationResult = Readonly<{
  resultId: string;
  score: number;
  weight: 0.6;
  weightedContribution: number;
  summary: string;
  strengths: readonly Readonly<{ title: string; evidence: string }>[];
  mainGap: string | null;
  actions: readonly string[];
  evidenceConfidence: number;
  evidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  provider: string;
  model: string;
  promptVersion: string;
  policyVersion: string;
  durationMs: number;
  completedAt: Date;
  cvVersion: string;
  jdVersion: string;
  configVersion: string;
}>;

export function sanitizeCvText(value: string): string {
  const normalizedValue = Array.from(value.normalize("NFKC"), (character) => {
    const code = character.charCodeAt(0);
    return code === 10 || code === 13
      ? character
      : code < 32 || code === 127
        ? " "
        : character;
  }).join("");
  return normalizedValue
    .split(/\r?\n/gu)
    .filter((line) => {
      const normalized = line.toLocaleLowerCase("en-US");
      return !/\b(?:gender|sex|male|female|age|date of birth|dob|marital|nationality|religion|ethnicity|pregnan|citizenship|identity card|national id|căn cước|cccd)\b/iu.test(
        normalized,
      );
    })
    .join("\n")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[email redacted]")
    .replace(/(?:\+?\d[\d ()-]{7,}\d)/gu, "[phone redacted]")
    .trim();
}

export function roundContribution(value: number, weight: number): number {
  return Math.round((value * weight + Number.EPSILON) * 10) / 10;
}
