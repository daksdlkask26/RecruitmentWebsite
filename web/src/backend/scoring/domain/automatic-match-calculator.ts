import type {
  AutomaticMatch,
  DetectedExperience,
  ParseStatus,
} from "@/shared/contracts/scoring";
import {
  extractSkillEvidence,
  type SkillCriterion,
} from "./skill-evidence-extractor";
import {
  calculateExperienceDuration,
  type ExperienceMonthInterval,
} from "./experience-duration";

export type AutomaticMatchInput = Readonly<{
  applicationId: string;
  cvText: string;
  cvVersion: string;
  jdVersion: string;
  configVersion: string;
  parserVersion: string;
  cvParse: ParseStatus;
  jdParse: ParseStatus;
  requiredSkills: readonly SkillCriterion[];
  preferredSkills: readonly SkillCriterion[];
  minimumExperienceYears: number | null;
  /** Injected scoring clock used for Present/Current/Now ranges. */
  now: Date;
}>;

export type AutomaticMatchCalculation = Readonly<{
  result: AutomaticMatch;
  requiredSkillPoints: number;
  experiencePoints: number;
  preferredSkillBonus: number;
}>;

type ParsedDateToken = Readonly<{
  year: number;
  month: number;
  precision: "year" | "month";
  openEnded?: boolean;
}>;

function parseDateToken(value: string, now: Date): ParsedDateToken | null {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (
    /^(?:present|current|now|ongoing|hiện tại|hien tai)$/iu.test(normalized)
  ) {
    return {
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      precision: "month",
      openEnded: true,
    };
  }
  const yearMonth = normalized.match(
    /^(\d{4})[./-](\d{1,2})(?:[./-]\d{1,2})?$/u,
  );
  if (yearMonth) {
    const year = Number(yearMonth[1]);
    const month = Number(yearMonth[2]);
    return year >= 1900 &&
      year <= now.getUTCFullYear() + 1 &&
      month >= 1 &&
      month <= 12
      ? { year, month, precision: "month" }
      : null;
  }
  const monthYear = normalized.match(/^(\d{1,2})[./-](\d{4})$/u);
  if (monthYear) {
    const month = Number(monthYear[1]);
    const year = Number(monthYear[2]);
    return year >= 1900 &&
      year <= now.getUTCFullYear() + 1 &&
      month >= 1 &&
      month <= 12
      ? { year, month, precision: "month" }
      : null;
  }
  const yearOnly = normalized.match(/^(\d{4})$/u);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    return year >= 1900 && year <= now.getUTCFullYear() + 1
      ? { year, month: 1, precision: "year" }
      : null;
  }
  return null;
}

function monthIndex(value: Pick<ParsedDateToken, "year" | "month">) {
  return value.year * 12 + value.month - 1;
}

function endMonthExclusive(value: ParsedDateToken) {
  const month = monthIndex(value);
  // A year-only end token is the boundary at the start of that year:
  // `2020–2022` therefore means [2020-01, 2022-01), or 24 months.
  return month + (value.precision === "year" ? 0 : 1);
}

type ParsedExperienceRanges = Readonly<{
  intervals: readonly ExperienceMonthInterval[];
  invalidRangeCount: number;
}>;

function dateRangeValues(text: string, now: Date): ParsedExperienceRanges {
  const intervals: ExperienceMonthInterval[] = [];
  let invalidRangeCount = 0;
  const add = (
    startValue: string,
    endValue: string,
    source: "structured" | "work-history",
  ) => {
    const start = parseDateToken(startValue, now);
    const end = parseDateToken(endValue, now);
    if (!start || !end || start.openEnded) {
      invalidRangeCount += 1;
      return;
    }
    const startMonth = monthIndex(start);
    const endMonth = endMonthExclusive(end);
    if (endMonth <= startMonth) {
      invalidRangeCount += 1;
      return;
    }
    intervals.push({
      startMonth,
      endMonthExclusive: endMonth,
      source,
      startToken: startValue.trim(),
      endToken: endValue.trim(),
    });
  };

  // Structured profile snapshots use these exact keys.  Supporting them is
  // important when a committed application document is temporarily
  // unavailable: the worker can still score the immutable profile snapshot
  // without treating the candidate's experience as zero.
  const structured =
    /"startDate"\s*:\s*"([^"]+)"\s*,\s*"endDate"\s*:\s*(?:"([^"]+)"|null)/giu;
  for (const match of text.matchAll(structured)) {
    add(match[1] ?? "", match[2] ?? "Present", "structured");
  }

  // Plain CV text commonly uses `06/2024 – Present`, `03/2023 - 05/2024`,
  // or an equivalent `to` separator.  The parser intentionally rejects
  // impossible years (for example `0634-06-01`) rather than inventing a
  // duration from malformed extraction output.
  const workHeading =
    /(?:work\s+experience|professional\s+experience|employment\s+history|kinh\s+nghiệm\s+việc\s+làm|kinh\s+nghiem\s+viec\s+lam)/iu.exec(
      text,
    );
  if (!workHeading) return { intervals, invalidRangeCount };
  const afterHeading = text.slice(workHeading.index + workHeading[0].length);
  // Native PDF extraction often flattens every page into one paragraph, so
  // section headings are not guaranteed to start after a newline. Stop at
  // the first heading token anywhere in the remaining text; otherwise an
  // education range such as `2019 – 2023` is incorrectly counted as work
  // experience.
  const nextSection =
    /\b(?:education|academic|certifications?|languages?|skills?|projects?|học\s+vấn|hoc\s+van|chứng\s+chỉ|chung\s+chi|kỹ\s+năng|ky\s+nang)\b/iu.exec(
      afterHeading,
    );
  const workText = nextSection
    ? afterHeading.slice(0, nextSection.index)
    : afterHeading;
  const ranges =
    /((?:\d{1,2}[./-]\d{4}|\d{4}[./-]\d{1,2}(?:[./-]\d{1,2})?|\d{4}))\s*(?:[-–—]|\bto\b|\buntil\b)\s*((?:present|current|now|ongoing|hiện tại|hien tai)|(?:\d{1,2}[./-]\d{4}|\d{4}[./-]\d{1,2}(?:[./-]\d{1,2})?|\d{4}))/giu;
  for (const match of workText.matchAll(ranges)) {
    add(match[1] ?? "", match[2] ?? "", "work-history");
  }
  return { intervals, invalidRangeCount };
}

function detectExperience(text: string, now: Date): DetectedExperience {
  const yearValues = [
    ...text.matchAll(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/giu),
  ]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  const monthValues = [
    ...text.matchAll(/(\d+(?:\.\d+)?)\s*\+?\s*(?:months?|mos?)/giu),
  ]
    .map((match) => Number(match[1]) / 12)
    .filter((value) => Number.isFinite(value));
  const ranges = dateRangeValues(text, now);
  const duration = calculateExperienceDuration(ranges.intervals);
  const candidateYears = [
    ...yearValues,
    ...monthValues,
    ...(duration.evidenceIntervals.length ? [duration.years] : []),
  ];
  const years = candidateYears.length
    ? candidateYears.reduce((maximum, value) => Math.max(maximum, value), 0)
    : null;
  const incomplete =
    ranges.invalidRangeCount > 0 || duration.discardedIntervalCount > 0;
  if (years === null || years === 0) {
    return incomplete
      ? { kind: "NOT_DETECTED", label: "Not detected", incomplete: true }
      : { kind: "NOT_DETECTED", label: "Not detected" };
  }
  return {
    kind: "DETECTED",
    years,
    label: `${years} years detected`,
    ...(duration.evidenceIntervals.length
      ? { intervals: [...duration.evidenceIntervals] }
      : {}),
    ...(duration.unionIntervals.length
      ? {
          mergedIntervals: duration.unionIntervals.map((interval) => ({
            startMonth: interval.startMonth,
            endMonthExclusive: interval.endMonthExclusive,
          })),
        }
      : {}),
    ...(incomplete ? { incomplete: true } : {}),
  };
}

export function calculateAutomaticMatch(
  input: AutomaticMatchInput,
): AutomaticMatchCalculation {
  const extracted = extractSkillEvidence(
    input.cvText,
    input.requiredSkills,
    input.preferredSkills,
    { cvSnapshotVersion: input.cvVersion, parserVersion: input.parserVersion },
  );
  const requiredSkillPoints =
    input.requiredSkills.length === 0
      ? 75
      : (extracted.foundRequiredSkills.length / input.requiredSkills.length) *
        75;
  const detectedExperience = detectExperience(input.cvText, input.now);
  const experiencePoints =
    input.minimumExperienceYears === null || input.minimumExperienceYears <= 0
      ? 25
      : detectedExperience.kind === "DETECTED"
        ? Math.min(
            25,
            (detectedExperience.years /
              Math.max(input.minimumExperienceYears, 1)) *
              25,
          )
        : 0;
  const score =
    Math.round(Math.min(100, requiredSkillPoints + experiencePoints) * 10) / 10;
  const incomplete =
    input.cvParse.code !== "PARSED_SUCCESSFULLY" ||
    input.jdParse.code !== "PARSED_SUCCESSFULLY" ||
    detectedExperience.incomplete === true ||
    (input.requiredSkills.length === 0 &&
      input.preferredSkills.length === 0 &&
      input.minimumExperienceYears === null);
  const incompletenessLabel =
    input.cvParse.code !== "PARSED_SUCCESSFULLY" ||
    input.jdParse.code !== "PARSED_SUCCESSFULLY"
      ? "This score may be incomplete because document parsing reported an issue."
      : detectedExperience.incomplete === true
        ? "This score may be incomplete because some employment dates need review."
        : input.requiredSkills.length === 0 &&
            input.preferredSkills.length === 0 &&
            input.minimumExperienceYears === null
          ? "This score may be incomplete because the job has no stated criteria."
          : null;
  return {
    result: {
      resultId: `automatic-${input.applicationId}-${input.cvVersion}-${input.jdVersion}`,
      score,
      cvVersion: input.cvVersion,
      jdVersion: input.jdVersion,
      configVersion: input.configVersion,
      parserVersion: input.parserVersion,
      cvParse: input.cvParse,
      jdParse: input.jdParse,
      mayBeIncomplete: incomplete,
      incompletenessLabel,
      foundRequiredSkills: extracted.foundRequiredSkills,
      missingRequiredSkills: extracted.missingRequiredSkills,
      preferredSkills: extracted.preferredSkills,
      minimumExperienceYears: input.minimumExperienceYears,
      detectedExperience,
    },
    requiredSkillPoints,
    experiencePoints,
    preferredSkillBonus: 0,
  };
}
