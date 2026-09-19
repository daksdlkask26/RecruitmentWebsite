import { AutomaticMatchService } from "@/backend/scoring/services/automatic-match-service";
import { ApprovedAiAssessmentAdapter } from "@/backend/scoring/providers/approved-ai-assessment-adapter";
import {
  AiAssessmentProviderError,
  type AiAssessmentProviderPort,
} from "@/backend/scoring/providers/ai-assessment-provider-port";
import { inspectCvForAiPreflight } from "@/backend/scoring/domain/cv-preflight";
import {
  AI_WEIGHT,
  AUTOMATIC_WEIGHT,
} from "@/backend/scoring/domain/hybrid-score-calculator";
import { DocumentParsingService } from "@/backend/scoring/services/document-parsing-service";
import type { AiEvaluationPort } from "./ai-evaluation-port";
import type { AutomaticMatchingPort } from "./automatic-matching-port";
import {
  roundContribution,
  type AiEvaluationResult,
  type AutomaticMatchingResult,
  type MatchEvidence,
  type RequirementGap,
  type ScoringInput,
} from "./scoring-contracts";

function evidenceClassification(
  kind: "REQUIRED" | "PREFERRED",
): MatchEvidence["classification"] {
  return kind === "REQUIRED" ? "SKILL" : "OTHER";
}

function requiredExperienceLabel(years: number | null) {
  return years === null
    ? "No stated experience requirement"
    : `${years} years required`;
}

export class Feature012AutomaticMatchingAdapter implements AutomaticMatchingPort {
  constructor(
    private readonly matcher = new AutomaticMatchService(),
    private readonly parser = new DocumentParsingService(
      "private-cv-match-parser-v1",
    ),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async match(input: ScoringInput): Promise<AutomaticMatchingResult> {
    const cvParsed = this.parser.parse({
      text: input.cvText,
      snapshotVersion: input.cvVersion,
      failed: input.cvParseFailed,
    });
    const jdParsed = this.parser.parse({
      text: input.jdText,
      snapshotVersion: input.jdVersion,
      failed: input.jdParseFailed,
    });
    const calculation = this.matcher.calculate({
      applicationId: input.inputId,
      cvText: cvParsed.text,
      cvVersion: input.cvVersion,
      jdVersion: input.jdVersion,
      configVersion: input.configVersion,
      parserVersion: cvParsed.status.parserVersion,
      cvParse: cvParsed.status,
      jdParse: jdParsed.status,
      requiredSkills: input.requiredSkills,
      preferredSkills: input.preferredSkills,
      minimumExperienceYears: input.minimumExperienceYears,
      now: this.clock(),
    });
    const automatic = calculation.result;
    const allSkills = [
      ...automatic.foundRequiredSkills,
      ...automatic.missingRequiredSkills,
      ...automatic.preferredSkills,
    ];
    const evidence: MatchEvidence[] = allSkills.flatMap((skill) =>
      skill.evidence.map((item) => ({
        criterionId: skill.skillCode,
        criterionVersion: "skill-normalization-v3",
        classification: evidenceClassification(skill.requirementKind),
        quote: item.excerpt.slice(0, 1_000),
        location: {
          section: item.sectionLabel ?? "CV body",
          page: item.pageNumber ?? null,
        },
        confidence: skill.matchState === "FOUND" ? 0.9 : 0.5,
        exclusionFlags: [],
      })),
    );
    const matchedRequirements = allSkills.map((skill) => ({
      id: skill.skillCode,
      label: skill.label,
      kind: skill.requirementKind,
      matched:
        skill.matchState === "FOUND" ||
        (skill.matchState === "NEUTRAL_PREFERRED" && skill.evidence.length > 0),
    }));
    const gaps: RequirementGap[] = [
      ...automatic.missingRequiredSkills.map((skill) => ({
        code: `REQUIRED_SKILL_MISSING:${skill.skillCode}`,
        title: `${skill.label} — missing`,
        description: `No direct ${skill.label} evidence was found in the CV.`,
        kind: "REQUIRED" as const,
      })),
      ...automatic.preferredSkills
        .filter((skill) => skill.evidence.length === 0)
        .map((skill) => ({
          code: `PREFERRED_SKILL_UNCLEAR:${skill.skillCode}`,
          title: `${skill.label} — preferred`,
          description: `This preferred skill was not clearly evidenced in the CV.`,
          kind: "PREFERRED" as const,
        })),
    ];
    const requiredCount = input.requiredSkills.length;
    const foundCount = automatic.foundRequiredSkills.length;
    const coverage = requiredCount
      ? Math.round((foundCount / requiredCount) * 100)
      : 100;
    const mergedIntervals =
      automatic.detectedExperience.kind === "DETECTED"
        ? (automatic.detectedExperience.mergedIntervals ?? [])
        : [];
    const detectedExperienceMonths = mergedIntervals.reduce(
      (total, interval) =>
        total + interval.endMonthExclusive - interval.startMonth,
      0,
    );
    return {
      resultId: automatic.resultId,
      score: automatic.score,
      weight: AUTOMATIC_WEIGHT,
      weightedContribution: roundContribution(
        automatic.score,
        AUTOMATIC_WEIGHT,
      ),
      matchedRequirements,
      gaps,
      requiredExperience: automatic.minimumExperienceYears,
      detectedExperience:
        automatic.detectedExperience.kind === "DETECTED"
          ? automatic.detectedExperience.years
          : null,
      detectedExperienceMonths:
        automatic.detectedExperience.kind === "DETECTED"
          ? detectedExperienceMonths
          : null,
      experienceIntervals: mergedIntervals,
      evidenceCoverage: coverage,
      evidenceConfidence: Math.min(
        100,
        Math.max(0, Math.round(coverage * 0.95)),
      ),
      evidence,
      parserProvenance: {
        parserVersion: cvParsed.status.parserVersion,
        cvStatus: cvParsed.status.label,
        jdStatus: jdParsed.status.label,
      },
      mayBeIncomplete: automatic.mayBeIncomplete,
      cvVersion: automatic.cvVersion,
      jdVersion: automatic.jdVersion,
      configVersion: automatic.configVersion,
    };
  }
}

function mapAiResult(
  result: Awaited<ReturnType<AiAssessmentProviderPort["assess"]>>,
  input: ScoringInput,
  durationMs: number,
): AiEvaluationResult {
  const confidenceLevel =
    result.confidenceLevel === "LOW"
      ? "LOW"
      : result.confidenceLevel === "MEDIUM"
        ? "MEDIUM"
        : "HIGH";
  return {
    resultId: result.assessmentId,
    score: result.score,
    weight: AI_WEIGHT,
    weightedContribution: roundContribution(result.score, AI_WEIGHT),
    summary: result.overallSummary.slice(0, 1_000),
    strengths: result.strengths.map((item) => ({
      title: item.title.slice(0, 160),
      evidence: item.evidence.slice(0, 1_000),
    })),
    mainGap: result.pointsToVerify[0]?.reason?.slice(0, 1_000) ?? null,
    actions: result.pointsToVerify.map((item) =>
      `${item.title}: ${item.reason}`.slice(0, 500),
    ),
    evidenceConfidence: result.confidencePercent,
    evidenceLevel: confidenceLevel,
    provider: result.provider,
    model: result.modelVersion,
    promptVersion: result.promptVersion,
    policyVersion: result.policyVersion,
    durationMs,
    completedAt: new Date(),
    cvVersion: input.cvVersion,
    jdVersion: input.jdVersion,
    configVersion: input.configVersion,
  };
}

export class Feature012AiEvaluationAdapter implements AiEvaluationPort {
  constructor(
    private readonly provider: AiAssessmentProviderPort = new ApprovedAiAssessmentAdapter(),
  ) {}

  async evaluate(input: ScoringInput): Promise<AiEvaluationResult> {
    const startedAt = Date.now();
    const preflightIssues = inspectCvForAiPreflight({
      cvText: input.cvText,
      jobTitle: input.jobTitle,
      requiredSkills: input.requiredSkills.map((item) => item.label),
    });
    const result = await this.provider.assess({
      applicationId: input.inputId,
      cvVersion: input.cvVersion,
      jdVersion: input.jdVersion,
      configVersion: input.configVersion,
      automaticScore: input.automaticScore ?? 0,
      evidence: input.automaticEvidence ?? [],
      jobTitle: input.jobTitle,
      requiredSkills: input.requiredSkills.map((item) => item.label),
      preferredSkills: input.preferredSkills.map((item) => item.label),
      keyRequirements: input.keyRequirements,
      minimumExperienceYears: input.minimumExperienceYears,
      requiredLanguages: input.requiredLanguages,
      cvText: input.cvText,
      preflightIssues,
    });
    return mapAiResult(result, input, Math.max(0, Date.now() - startedAt));
  }
}

export function isAiProviderError(
  error: unknown,
): error is AiAssessmentProviderError {
  return error instanceof AiAssessmentProviderError;
}

export { requiredExperienceLabel };
