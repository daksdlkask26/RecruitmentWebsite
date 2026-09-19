import type {
  EvidenceExcerpt,
  SkillEvidence,
} from "@/shared/contracts/scoring";
import skillAliases from "./skill-aliases.json" with { type: "json" };

export type SkillCriterion = Readonly<{ code: string; label: string }>;

export const SKILL_NORMALIZATION_VERSION = "skill-normalization-v3";

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/gu, "d")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const normalizedSkillAliases = Object.fromEntries(
  Object.entries(skillAliases as Record<string, readonly string[]>).map(
    ([label, aliases]) => [normalize(label), aliases],
  ),
) as Record<string, readonly string[]>;

type SearchText = Readonly<{
  value: string;
  originalIndexByOffset: readonly number[];
}>;

function normalizeForSearch(value: string): SearchText {
  let normalizedText = "";
  const originalIndexByOffset: number[] = [];
  let originalIndex = 0;
  for (const character of value) {
    const decomposed = character
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[đĐ]/gu, "d")
      .toLocaleLowerCase("en-US");
    const safe = [...decomposed]
      .map((part) => (/[\p{L}\p{N}+#.]/u.test(part) ? part : " "))
      .join("");
    normalizedText += safe;
    for (let offset = 0; offset < safe.length; offset += 1)
      originalIndexByOffset.push(originalIndex);
    originalIndex += character.length;
  }
  return { value: normalizedText, originalIndexByOffset };
}

function sentenceContext(
  text: string,
  index: number,
  term: string,
): { sentence: string; termIndex: number } {
  const previousBoundary = Math.max(
    text.lastIndexOf(".", index - 1),
    text.lastIndexOf("!", index - 1),
    text.lastIndexOf("?", index - 1),
    text.lastIndexOf("\n", index - 1),
  );
  const nextCandidates = [
    text.indexOf(".", index + term.length),
    text.indexOf("!", index + term.length),
    text.indexOf("?", index + term.length),
    text.indexOf("\n", index + term.length),
  ].filter((candidate) => candidate >= 0);
  const start = previousBoundary + 1;
  const end = nextCandidates.length
    ? Math.min(...nextCandidates) + 1
    : text.length;
  const sentence = text.slice(start, end).trim();
  const termIndex = Math.max(
    0,
    sentence
      .toLocaleLowerCase("en-US")
      .indexOf(term.toLocaleLowerCase("en-US")),
  );
  return { sentence, termIndex };
}

function shouldIgnoreEvidence(
  text: string,
  index: number,
  term: string,
  label: string,
): boolean {
  const context = sentenceContext(text, index, term);
  const beforeTerm = context.sentence.slice(0, context.termIndex);
  const normalizedLabel = normalize(label);

  // A statement that explicitly denies experience must not become positive
  // evidence just because the skill name appears later in the same sentence.
  const negativeExperience =
    /\b(?:no|without|never|did not|does not|do not|don't|not yet|lack(?:ed)?|lacking)\b[^.!?\n]{0,120}\b(?:experience|background|exposure|skills?|knowledge)\b|(?:^|[^\p{L}\p{N}])(?:không|chưa)\s+(?:có\s+)?(?:kinh\s+nghiệm|nền\s+tảng|tiếp\s+xúc|kỹ\s+năng)(?=$|[^\p{L}\p{N}])/iu;
  if (negativeExperience.test(beforeTerm)) return true;

  // Keep weak language statements out of a binary skill match. The original
  // text is still preserved for human review elsewhere in the CV evidence.
  if (
    normalizedLabel === "english proficiency" &&
    /\b(?:elementary|very limited|limited|self-study|no certificate|basic)\b/iu.test(
      context.sentence,
    )
  ) {
    return true;
  }

  // Do not count a skill stated as limited/incomplete evidence (for example,
  // "limited laboratory experience") as a confirmed match.
  if (
    /\b(?:very limited|limited|no formal|no professional|not yet)\b/iu.test(
      context.sentence,
    ) ||
    /(?:^|[^\p{L}\p{N}])(?:hạn\s+chế|giới\s+hạn|chưa\s+đủ|chưa\s+vững)(?=$|[^\p{L}\p{N}])/iu.test(
      context.sentence,
    )
  ) {
    return true;
  }

  return false;
}

function findSkillEvidence(
  text: string,
  searchText: SearchText,
  label: string,
): { index: number; term: string } | null {
  const normalizedLabel = normalize(label);
  const aliases = normalizedSkillAliases[normalizedLabel] ?? [];
  const terms = [...new Set([label, ...aliases])]
    .map((term) => ({ original: term, normalized: normalize(term) }))
    .filter((term) => term.normalized.length > 0)
    .sort((left, right) => right.normalized.length - left.normalized.length);
  for (const term of terms) {
    const parts = term.normalized.split(" ").map(escapeRegExp);
    const expression = new RegExp(
      `(?:^|[^\\p{L}\\p{N}+#.])${parts.join("[^\\p{L}\\p{N}+#.]+")}(?=$|[^\\p{L}\\p{N}+#])`,
      "giu",
    );
    let match: RegExpExecArray | null;
    let best: { index: number; term: string; score: number } | null = null;
    while ((match = expression.exec(searchText.value)) !== null) {
      if (match.index === undefined) continue;
      const leadingOffset = match[0].search(/[\p{L}\p{N}+#.]/u);
      const normalizedIndex = match.index + Math.max(leadingOffset, 0);
      const index =
        searchText.originalIndexByOffset[normalizedIndex] ?? normalizedIndex;
      if (shouldIgnoreEvidence(text, index, term.original, label)) continue;
      const context = sentenceContext(text, index, term.original).sentence;
      // A skill can occur first in a compact SKILLS line and again in a
      // responsibility bullet. Prefer the latter because it demonstrates
      // applied experience and produces a useful, bounded verbatim excerpt.
      const appliedEvidence =
        /\b(?:built|created|contributed|debugged|developed|designed|implemented|improved|integrated|performed|practiced|used|worked|analy[sz]ed|đã\s+xây\s+dựng|đã\s+phát\s+triển|đã\s+thiết\s+kế|đã\s+triển\s+khai|đã\s+phân\s+tích|đã\s+sử\s+dụng|đã\s+thực\s+hiện|đã\s+thể\s+hiện)\b/iu.test(
          context,
        );
      const score = (appliedEvidence ? 10_000 : 0) - context.length;
      if (!best || score > best.score)
        best = { index, term: term.original, score };
    }
    if (best) return { index: best.index, term: best.term };
  }
  return null;
}

function excerptFor(
  text: string,
  index: number,
  skill: string,
): EvidenceExcerpt {
  const start = Math.max(0, text.lastIndexOf(".", index - 1) + 1);
  const endCandidate = text.indexOf(".", index + skill.length);
  const end =
    endCandidate < 0 ? Math.min(text.length, start + 320) : endCandidate + 1;
  const excerpt = text.slice(start, end).trim().slice(0, 320) || skill;
  const pageMatch = text
    .slice(Math.max(0, index - 80), index + 80)
    .match(/\[page\s+(\d+)\]/iu);
  return {
    excerpt,
    ...(pageMatch
      ? { pageNumber: Number(pageMatch[1]) }
      : { sectionLabel: "CV body" }),
    cvSnapshotVersion: "cv-snapshot",
    parserVersion: "parser-v1",
  };
}

export function extractSkillEvidence(
  text: string,
  required: readonly SkillCriterion[],
  preferred: readonly SkillCriterion[],
  provenance: { cvSnapshotVersion: string; parserVersion: string },
): Readonly<{
  foundRequiredSkills: SkillEvidence[];
  missingRequiredSkills: SkillEvidence[];
  preferredSkills: SkillEvidence[];
}> {
  const searchText = normalizeForSearch(text);
  const evidence = (
    criterion: SkillCriterion,
    state: SkillEvidence["matchState"],
    requirementKind: SkillEvidence["requirementKind"],
  ): SkillEvidence => {
    const match = findSkillEvidence(text, searchText, criterion.label);
    const excerpts = match
      ? [
          {
            ...excerptFor(text, match.index, match.term),
            cvSnapshotVersion: provenance.cvSnapshotVersion,
            parserVersion: provenance.parserVersion,
          },
        ]
      : [];
    return {
      skillCode: criterion.code,
      label: criterion.label,
      requirementKind,
      matchState: state,
      evidence: excerpts,
    };
  };
  const foundRequiredSkills: SkillEvidence[] = [];
  const missingRequiredSkills: SkillEvidence[] = [];
  for (const criterion of required) {
    const item = evidence(criterion, "FOUND", "REQUIRED");
    (item.evidence.length ? foundRequiredSkills : missingRequiredSkills).push(
      item.evidence.length ? item : { ...item, matchState: "MISSING" },
    );
  }
  const preferredSkills = preferred.map((criterion) =>
    evidence(criterion, "NEUTRAL_PREFERRED", "PREFERRED"),
  );
  return { foundRequiredSkills, missingRequiredSkills, preferredSkills };
}
