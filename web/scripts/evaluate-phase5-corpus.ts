import "server-only";

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { Feature012AutomaticMatchingAdapter } from "@/backend/scoring-engine/scoring-engine-adapter";
import { extractDocx } from "@/backend/cv/extraction/docx";
import { extractPdf } from "@/backend/cv/extraction/pdf";
import { CV_EXTRACTION_LIMITS } from "@/backend/cv/extraction/document-extractor";
import {
  phase5Corpus,
  type Phase5CorpusCase,
} from "../tests/fixtures/private-match/phase5-corpus";

const fixedNow = new Date("2026-09-14T00:00:00.000Z");
const adapter = new Feature012AutomaticMatchingAdapter(
  undefined,
  undefined,
  () => fixedNow,
);
const execFileAsync = promisify(execFile);

const provenancePaths = {
  corpus: "tests/fixtures/private-match/phase5-corpus.ts",
  evaluator: "scripts/evaluate-phase5-corpus.ts",
  adapter: "src/backend/scoring-engine/scoring-engine-adapter.ts",
  skillEvidence: "src/backend/scoring/domain/skill-evidence-extractor.ts",
  experienceDuration: "src/backend/scoring/domain/experience-duration.ts",
  pdfExtraction: "src/backend/cv/extraction/pdf.ts",
  docxExtraction: "src/backend/cv/extraction/docx.ts",
} as const;

type CaseResult = Readonly<{
  id: string;
  pairId: string;
  locale: Phase5CorpusCase["locale"];
  format: Phase5CorpusCase["format"];
  pass: boolean;
  score: number;
  expectedScoreMayBeShown: boolean;
  actualScoreMayBeShown: boolean;
  experienceMonths: number | null;
  expectedExperienceMonths: number;
  incomplete: boolean;
  expectedIncomplete: boolean;
  evidenceAnchorsValid: boolean;
  requiredPrecision: number;
  requiredRecall: number;
  preferredPrecision: number;
  preferredRecall: number;
  diagnostics: readonly string[];
  requiredCounts: Readonly<{
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
  }>;
  preferredCounts: Readonly<{
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
  }>;
  requiredSkillIds: readonly string[];
  preferredSkillIds: readonly string[];
  requiredMatchedIds: readonly string[];
  preferredMatchedIds: readonly string[];
  presentationState: "AVAILABLE" | "INCOMPLETE" | "UNAVAILABLE";
  evidenceSemantics: readonly string[];
  evidenceTraceValid: boolean;
  formatExtractionValid: boolean;
  piiFree: boolean;
}>;

function rounded(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value))
    return "[" + value.map((item) => canonicalize(item)).join(",") + "]";
  if (value && typeof value === "object") {
    return (
      "{" +
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => JSON.stringify(key) + ":" + canonicalize(item))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

async function sha256File(relativePath: string) {
  return sha256(await readFile(resolve(process.cwd(), relativePath)));
}

async function sourceCommit() {
  const explicit = process.env.PHASE5_SOURCE_COMMIT?.trim() ?? "";
  if (
    process.env.PHASE5_RUN_ROLE === "pre-change" &&
    /^[0-9a-f]{40}$/u.test(explicit)
  )
    return { value: explicit, source: "declared-snapshot" as const };
  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      windowsHide: true,
    });
    const value = result.stdout.trim();
    if (/^[0-9a-f]{40}$/u.test(value))
      return { value, source: "git-rev-parse" as const };
  } catch {
    // A reconstructed pre-change snapshot may intentionally not contain .git.
  }
  return {
    value: /^[0-9a-f]{40}$/u.test(explicit) ? explicit : null,
    source: explicit
      ? ("declared-snapshot" as const)
      : ("unavailable" as const),
  };
}

async function collectProvenance(
  corpus: readonly Phase5CorpusCase[],
  role: "final" | "pre-change",
) {
  const sourceFiles = Object.fromEntries(
    await Promise.all(
      Object.entries(provenancePaths).map(async ([name, relativePath]) => [
        name,
        await sha256File(relativePath),
      ]),
    ),
  ) as Record<keyof typeof provenancePaths, string>;
  const productionSourceFingerprint = sha256(
    canonicalize({
      adapter: sourceFiles.adapter,
      skillEvidence: sourceFiles.skillEvidence,
      experienceDuration: sourceFiles.experienceDuration,
      pdfExtraction: sourceFiles.pdfExtraction,
      docxExtraction: sourceFiles.docxExtraction,
    }),
  );
  const commit = await sourceCommit();
  return {
    role,
    sourceCommit: commit.value,
    sourceCommitSource: commit.source,
    corpusIdentitySha256: sha256(canonicalize(corpus)),
    corpusSourceSha256: sourceFiles.corpus,
    evaluatorSourceSha256: sourceFiles.evaluator,
    adapterSourceSha256: sourceFiles.adapter,
    productionSourceFingerprint,
    sourceFiles,
    command: process.env.PHASE5_EXECUTION_COMMAND?.trim() ?? null,
  };
}

function reportPayloadHash(report: Record<string, unknown>) {
  const { integrity: _integrity, ...payload } = report;
  return sha256(canonicalize(payload));
}

function binaryMetrics(
  expected: Readonly<Record<string, boolean>>,
  actual: Readonly<Record<string, boolean>>,
) {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    const expectedValue = expected[key] === true;
    const actualValue = actual[key] === true;
    if (expectedValue && actualValue) truePositive += 1;
    if (!expectedValue && actualValue) falsePositive += 1;
    if (expectedValue && !actualValue) falseNegative += 1;
  }
  const precision =
    truePositive + falsePositive === 0
      ? 1
      : truePositive / (truePositive + falsePositive);
  const recall =
    truePositive + falseNegative === 0
      ? 1
      : truePositive / (truePositive + falseNegative);
  return {
    precision,
    recall,
    support: truePositive + falseNegative,
    truePositive,
    falsePositive,
    falseNegative,
  };
}

function normalized(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function traceable(quote: string, source: string) {
  const value = normalized(quote);
  return Boolean(value) && normalized(source).includes(value);
}

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function makePdf(text: string) {
  const lines = text.split(/\r?\n/gu).slice(0, 80);
  const commands = ["BT", "/F1 4 Tf", "72 740 Td"];
  const codePoints = new Set<number>();
  const unicodeHex = (value: string) => {
    let encoded = "";
    for (const character of value) {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint > 0xffff)
        throw new Error("PHASE5_PDF_FIXTURE_NON_BMP_TEXT_UNSUPPORTED");
      codePoints.add(codePoint);
      encoded += codePoint.toString(16).padStart(4, "0");
    }
    return "<" + encoded + ">";
  };
  for (const [index, line] of lines.entries()) {
    if (index > 0) commands.push("0 -14 Td");
    commands.push(unicodeHex(line.slice(0, 180)) + " Tj");
  }
  commands.push("ET");
  const stream = commands.join("\n") + "\n";
  const toUnicodeEntries = [...codePoints]
    .sort((left, right) => left - right)
    .map(
      (codePoint) =>
        "<" +
        codePoint.toString(16).padStart(4, "0") +
        "> <" +
        codePoint.toString(16).padStart(4, "0") +
        ">",
    );
  const toUnicode = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000><FFFF>",
    "endcodespacerange",
    String(toUnicodeEntries.length) + " beginbfchar",
    ...toUnicodeEntries,
    "endbfchar",
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
    "",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length " +
      Buffer.byteLength(stream, "latin1") +
      " >>\nstream\n" +
      stream +
      "endstream",
    "<< /Type /Font /Subtype /Type0 /BaseFont /Phase5Unicode /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>",
    "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Phase5Unicode /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /CIDToGIDMap /Identity >>",
    "<< /Length " +
      Buffer.byteLength(toUnicode, "latin1") +
      " >>\nstream\n" +
      toUnicode +
      "endstream",
    "<< /Type /FontDescriptor /FontName /Phase5Unicode /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>",
  ];
  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(chunks.join("").length);
    chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  }
  const xrefOffset = chunks.join("").length;
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1))
    chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  chunks.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
  return new Uint8Array(Buffer.from(chunks.join(""), "latin1"));
}

async function makeDocx(text: string) {
  const zipModule = await import("jszip");
  const Zip = zipModule.default ?? zipModule;
  const zip = new Zip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const paragraphs = text
    .split(/\r?\n/gu)
    .map(
      (line) =>
        `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`,
    )
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`,
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

async function productionExtractedText(item: Phase5CorpusCase) {
  if (item.format === "TEXT")
    return { text: item.input.cvText, bytes: null, pageCount: null };
  const source =
    item.format === "PDF_FLATTENED"
      ? makePdf(item.input.cvText)
      : await makeDocx(item.input.cvText);
  const extracted =
    item.format === "PDF_FLATTENED"
      ? await extractPdf(source, CV_EXTRACTION_LIMITS)
      : await extractDocx(source, CV_EXTRACTION_LIMITS);
  return {
    text: extracted.segments
      .map((segment) => segment.text)
      .join("\n")
      .trim(),
    bytes: source.byteLength,
    pageCount: extracted.pageCount,
  };
}

function evidenceTrace(
  item: Phase5CorpusCase,
  actual: Awaited<ReturnType<Feature012AutomaticMatchingAdapter["match"]>>,
  sourceText: string,
) {
  const anchors = item.expected.allowedEvidence.map(normalized);
  const actualEvidence = actual.evidence;
  const everyActualTraceable = actualEvidence.every(
    (evidence) =>
      traceable(evidence.quote, sourceText) &&
      evidence.location.section.trim().length > 0 &&
      (evidence.location.page === null ||
        (Number.isInteger(evidence.location.page) &&
          evidence.location.page > 0)),
  );
  const everyExpectedFound = anchors.every((anchor) =>
    actualEvidence.some((evidence) =>
      normalized(evidence.quote).includes(anchor),
    ),
  );
  const everyActualAllowed = anchors.length
    ? actualEvidence.every((evidence) =>
        anchors.some((anchor) => normalized(evidence.quote).includes(anchor)),
      )
    : actualEvidence.length === 0;
  return everyActualTraceable && everyExpectedFound && everyActualAllowed;
}

function piiFree(value: string) {
  return ![
    /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/iu,
    /\b(?:phone|telephone|mobile|address|ssn|cccd)\b/iu,
    /\+\d[\d ()-]{7,}\d/iu,
    /\b\d{10,15}\b/u,
  ].some((pattern) => pattern.test(value));
}

function sameBooleanMap(
  left: Readonly<Record<string, boolean>>,
  right: Readonly<Record<string, boolean>>,
) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
}

function sortedIds(values: Readonly<Record<string, boolean>>) {
  return Object.keys(values).sort();
}

function matchedIds(values: Readonly<Record<string, boolean>>) {
  return Object.entries(values)
    .filter(([, matched]) => matched)
    .map(([id]) => id)
    .sort();
}

function presentationState(
  item: Phase5CorpusCase,
  incomplete: boolean,
): CaseResult["presentationState"] {
  if (item.input.cvParseFailed || item.input.jdParseFailed)
    return "UNAVAILABLE";
  return incomplete ? "INCOMPLETE" : "AVAILABLE";
}

function evidenceSemantics(
  actual: Awaited<ReturnType<Feature012AutomaticMatchingAdapter["match"]>>,
) {
  return actual.evidence
    .map(
      (evidence) =>
        `${evidence.criterionId}|${evidence.classification}|${evidence.location.page === null ? "unpaged" : "paged"}`,
    )
    .sort();
}

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function evaluateCase(item: Phase5CorpusCase): Promise<CaseResult> {
  const extracted = await productionExtractedText(item);
  const result = await adapter.match({
    ...item.input,
    cvText: extracted.text,
  });
  const actualRequired = Object.fromEntries(
    result.matchedRequirements
      .filter((requirement) => requirement.kind === "REQUIRED")
      .map((requirement) => [requirement.id, requirement.matched]),
  );
  const actualPreferred = Object.fromEntries(
    result.matchedRequirements
      .filter((requirement) => requirement.kind === "PREFERRED")
      .map((requirement) => [requirement.id, requirement.matched]),
  );
  const requiredMetrics = binaryMetrics(item.expected.required, actualRequired);
  const preferredMetrics = binaryMetrics(
    item.expected.preferred,
    actualPreferred,
  );
  const experienceMonths = result.detectedExperienceMonths ?? 0;
  const evidenceAnchorsValid = evidenceTrace(item, result, extracted.text);
  const formatExtractionValid =
    item.format === "TEXT"
      ? extracted.text === item.input.cvText
      : extracted.bytes !== null && extracted.text.length > 0;
  const outputText = result.evidence
    .map((evidence) => evidence.quote)
    .join(" ");
  const piiFreeOutput = piiFree(outputText) && piiFree(extracted.text);
  const requiredSkillIds = sortedIds(item.expected.required);
  const preferredSkillIds = sortedIds(item.expected.preferred);
  const requiredMatchedIds = matchedIds(actualRequired);
  const preferredMatchedIds = matchedIds(actualPreferred);
  const actualPresentationState = presentationState(
    item,
    result.mayBeIncomplete,
  );
  const diagnostics: string[] = [];
  if (experienceMonths !== item.expected.experienceMonths)
    diagnostics.push(
      `experienceMonths expected=${item.expected.experienceMonths} actual=${experienceMonths}`,
    );
  if (result.mayBeIncomplete !== item.expected.incomplete)
    diagnostics.push(
      `incomplete expected=${item.expected.incomplete} actual=${result.mayBeIncomplete}`,
    );
  if (!evidenceAnchorsValid) diagnostics.push("evidence-anchor-invalid");
  if (!formatExtractionValid) diagnostics.push("format-extraction-invalid");
  if (!piiFreeOutput) diagnostics.push("pii-detected");
  if (!sameBooleanMap(actualRequired, item.expected.required))
    diagnostics.push("required-skill-set-drift");
  if (!sameBooleanMap(actualPreferred, item.expected.preferred))
    diagnostics.push("preferred-skill-set-drift");
  if (!item.expected.incomplete && result.mayBeIncomplete)
    diagnostics.push("unexpected-incomplete");
  const actualScoreMayBeShown = !result.mayBeIncomplete;
  if (actualScoreMayBeShown !== item.expected.scoreMayBeShown)
    diagnostics.push(
      `score-eligibility expected=${item.expected.scoreMayBeShown} actual=${actualScoreMayBeShown}`,
    );
  if (item.format === "PDF_FLATTENED" && extracted.pageCount === null)
    diagnostics.push("format-page-count-missing");
  return {
    id: item.id,
    pairId: item.pairId,
    locale: item.locale,
    format: item.format,
    pass: diagnostics.length === 0,
    score: result.score,
    expectedScoreMayBeShown: item.expected.scoreMayBeShown,
    actualScoreMayBeShown,
    experienceMonths: result.detectedExperienceMonths ?? null,
    expectedExperienceMonths: item.expected.experienceMonths,
    incomplete: result.mayBeIncomplete,
    expectedIncomplete: item.expected.incomplete,
    evidenceAnchorsValid,
    requiredPrecision: rounded(requiredMetrics.precision),
    requiredRecall: rounded(requiredMetrics.recall),
    preferredPrecision: rounded(preferredMetrics.precision),
    preferredRecall: rounded(preferredMetrics.recall),
    diagnostics,
    requiredCounts: {
      truePositive: requiredMetrics.truePositive,
      falsePositive: requiredMetrics.falsePositive,
      falseNegative: requiredMetrics.falseNegative,
    },
    preferredCounts: {
      truePositive: preferredMetrics.truePositive,
      falsePositive: preferredMetrics.falsePositive,
      falseNegative: preferredMetrics.falseNegative,
    },
    requiredSkillIds,
    preferredSkillIds,
    requiredMatchedIds,
    preferredMatchedIds,
    presentationState: actualPresentationState,
    evidenceSemantics: evidenceSemantics(result),
    evidenceTraceValid: evidenceAnchorsValid,
    formatExtractionValid,
    piiFree: piiFreeOutput,
  };
}

function aggregateCounts(
  cases: readonly CaseResult[],
  key: "requiredCounts" | "preferredCounts",
) {
  return cases.reduce(
    (total, item) => ({
      truePositive: total.truePositive + item[key].truePositive,
      falsePositive: total.falsePositive + item[key].falsePositive,
      falseNegative: total.falseNegative + item[key].falseNegative,
    }),
    { truePositive: 0, falsePositive: 0, falseNegative: 0 },
  );
}

function aggregateMetrics(counts: ReturnType<typeof aggregateCounts>) {
  const precision =
    counts.truePositive + counts.falsePositive === 0
      ? 1
      : counts.truePositive / (counts.truePositive + counts.falsePositive);
  const recall =
    counts.truePositive + counts.falseNegative === 0
      ? 1
      : counts.truePositive / (counts.truePositive + counts.falseNegative);
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return {
    ...counts,
    support: counts.truePositive + counts.falseNegative,
    precision: rounded(precision),
    recall: rounded(recall),
    f1: rounded(f1),
  };
}

type PreChangeBaseline = Readonly<{
  status: "UNVERIFIED" | "VERIFIED";
  reason: string;
  artifact?: string;
  sourceCommit?: string;
  command?: string;
  corpusCases?: number;
  equivalentPairs?: number;
  provenance?: Readonly<{
    corpusIdentitySha256: string;
    corpusSourceSha256: string;
    evaluatorSourceSha256: string;
    adapterSourceSha256: string;
    productionSourceFingerprint: string;
  }>;
  metrics?: Readonly<{
    requiredPrecision: number;
    requiredRecall: number;
    preferredPrecision: number;
    preferredRecall: number;
  }>;
}>;

function finiteMetric(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : null;
}

type BaselineValidationInput = Readonly<{
  parsed: Record<string, unknown>;
  corpusCases: number;
  equivalentPairs: number;
  currentProvenance: Awaited<ReturnType<typeof collectProvenance>>;
  expectedSourceCommit: string | undefined;
  expectedCommand: string | undefined;
  artifact: string;
}>;

function validHash(value: unknown) {
  return typeof value === "string" && /^[0-9A-F]{64}$/u.test(value);
}

export function validatePreChangeBaseline({
  parsed,
  corpusCases,
  equivalentPairs,
  currentProvenance,
  expectedSourceCommit,
  expectedCommand,
  artifact,
}: BaselineValidationInput): PreChangeBaseline {
  const provenance = parsed.provenance;
  const integrity = parsed.integrity;
  const metrics = parsed.metrics;
  const aggregate = parsed.aggregateConfusion;
  if (
    !provenance ||
    typeof provenance !== "object" ||
    Array.isArray(provenance)
  )
    return {
      status: "UNVERIFIED",
      reason:
        "Baseline provenance is missing; environment metadata alone is not evidence.",
    };
  if (!integrity || typeof integrity !== "object" || Array.isArray(integrity))
    return {
      status: "UNVERIFIED",
      reason: "Baseline integrity payload is missing.",
    };
  const baselineProvenance = provenance as Record<string, unknown>;
  const baselineIntegrity = integrity as Record<string, unknown>;
  if (
    baselineProvenance.role !== "pre-change" ||
    parsed.corpusCases !== corpusCases ||
    parsed.equivalentPairs !== equivalentPairs
  )
    return {
      status: "UNVERIFIED",
      reason:
        "Baseline role or corpus cardinality does not match the final labelled corpus.",
    };
  if (
    !expectedSourceCommit ||
    !/^[0-9a-f]{40}$/u.test(expectedSourceCommit) ||
    baselineProvenance.sourceCommit !== expectedSourceCommit
  )
    return {
      status: "UNVERIFIED",
      reason:
        "Baseline source commit is missing or does not match the declared pre-change snapshot.",
    };
  if (
    !expectedCommand ||
    baselineProvenance.command !== expectedCommand ||
    typeof baselineProvenance.command !== "string"
  )
    return {
      status: "UNVERIFIED",
      reason: "Baseline exact execution command is missing or mismatched.",
    };
  const sameCorpus =
    baselineProvenance.corpusIdentitySha256 ===
      currentProvenance.corpusIdentitySha256 &&
    baselineProvenance.corpusSourceSha256 ===
      currentProvenance.corpusSourceSha256;
  const sameEvaluator =
    baselineProvenance.evaluatorSourceSha256 ===
    currentProvenance.evaluatorSourceSha256;
  const changedProduction =
    validHash(baselineProvenance.productionSourceFingerprint) &&
    baselineProvenance.productionSourceFingerprint !==
      currentProvenance.productionSourceFingerprint;
  if (
    !sameCorpus ||
    !sameEvaluator ||
    !changedProduction ||
    !validHash(baselineProvenance.corpusIdentitySha256) ||
    !validHash(baselineProvenance.corpusSourceSha256) ||
    !validHash(baselineProvenance.evaluatorSourceSha256) ||
    !validHash(baselineProvenance.adapterSourceSha256) ||
    !validHash(baselineProvenance.productionSourceFingerprint)
  )
    return {
      status: "UNVERIFIED",
      reason:
        "Baseline corpus/evaluator identity does not match or no production-source change is proven.",
    };
  if (
    baselineIntegrity.algorithm !== "SHA-256" ||
    baselineIntegrity.payloadSha256 !== reportPayloadHash(parsed) ||
    !validHash(baselineIntegrity.payloadSha256)
  )
    return {
      status: "UNVERIFIED",
      reason: "Baseline report integrity hash does not verify.",
    };
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics))
    return {
      status: "UNVERIFIED",
      reason: "Baseline metrics are missing.",
    };
  const baselineMetrics = metrics as Record<string, unknown>;
  const requiredPrecision = finiteMetric(baselineMetrics.requiredPrecision);
  const requiredRecall = finiteMetric(baselineMetrics.requiredRecall);
  const preferredPrecision = finiteMetric(baselineMetrics.preferredPrecision);
  const preferredRecall = finiteMetric(baselineMetrics.preferredRecall);
  const requiredSupport =
    aggregate &&
    typeof aggregate === "object" &&
    !Array.isArray(aggregate) &&
    "required" in aggregate &&
    typeof aggregate.required === "object" &&
    aggregate.required &&
    "support" in aggregate.required
      ? aggregate.required.support
      : null;
  const preferredSupport =
    aggregate &&
    typeof aggregate === "object" &&
    !Array.isArray(aggregate) &&
    "preferred" in aggregate &&
    typeof aggregate.preferred === "object" &&
    aggregate.preferred &&
    "support" in aggregate.preferred
      ? aggregate.preferred.support
      : null;
  if (
    requiredPrecision === null ||
    requiredRecall === null ||
    preferredPrecision === null ||
    preferredRecall === null ||
    typeof requiredSupport !== "number" ||
    requiredSupport < 1 ||
    typeof preferredSupport !== "number" ||
    preferredSupport < 1
  )
    return {
      status: "UNVERIFIED",
      reason:
        "Baseline metrics are missing, out of range, or have zero required/preferred support.",
    };
  return {
    status: "VERIFIED",
    reason:
      "Captured by running the final labelled corpus against a different production-source fingerprint at the recorded pre-change source commit.",
    artifact,
    sourceCommit: expectedSourceCommit,
    command: expectedCommand,
    corpusCases,
    equivalentPairs,
    provenance: {
      corpusIdentitySha256: baselineProvenance.corpusIdentitySha256 as string,
      corpusSourceSha256: baselineProvenance.corpusSourceSha256 as string,
      evaluatorSourceSha256: baselineProvenance.evaluatorSourceSha256 as string,
      adapterSourceSha256: baselineProvenance.adapterSourceSha256 as string,
      productionSourceFingerprint:
        baselineProvenance.productionSourceFingerprint as string,
    },
    metrics: {
      requiredPrecision,
      requiredRecall,
      preferredPrecision,
      preferredRecall,
    },
  };
}

async function loadPreChangeBaseline(
  corpusCases: number,
  equivalentPairs: number,
  currentProvenance: Awaited<ReturnType<typeof collectProvenance>>,
): Promise<PreChangeBaseline> {
  const baselineFile = process.env.PHASE5_BASELINE_FILE;
  const sourceCommit = process.env.PHASE5_BASELINE_SOURCE_COMMIT;
  const command = process.env.PHASE5_BASELINE_COMMAND;
  const artifact =
    process.env.PHASE5_BASELINE_ARTIFACT ?? "cf503-pre-change-baseline.json";
  if (!baselineFile)
    return {
      status: "UNVERIFIED",
      reason:
        "No reproducible pre-change corpus/evaluator report is available in the current repository state; the retained historical report cannot be used as a before baseline.",
    };
  try {
    const parsed = JSON.parse(await readFile(baselineFile, "utf8")) as Record<
      string,
      unknown
    >;
    return validatePreChangeBaseline({
      parsed,
      corpusCases,
      equivalentPairs,
      currentProvenance,
      expectedSourceCommit: sourceCommit,
      expectedCommand: command,
      artifact,
    });
  } catch {
    return {
      status: "UNVERIFIED",
      reason: "The pre-change report could not be parsed as a valid baseline.",
    };
  }
}

async function main() {
  const corpus = process.env.PHASE5_CORPUS_FILE
    ? (JSON.parse(
        await readFile(process.env.PHASE5_CORPUS_FILE, "utf8"),
      ) as readonly Phase5CorpusCase[])
    : phase5Corpus;
  const cases = await Promise.all(corpus.map(evaluateCase));
  const byPair = new Map<string, CaseResult[]>();
  for (const item of cases)
    byPair.set(item.pairId, [...(byPair.get(item.pairId) ?? []), item]);
  const pairChecks = [...byPair.entries()].map(([pairId, pairCases]) => {
    const [first, second] = pairCases;
    const scoreDifference =
      first && second
        ? Math.abs(first.score - second.score)
        : Number.POSITIVE_INFINITY;
    const experienceDifference =
      first && second
        ? Math.abs(
            (first.experienceMonths ?? 0) - (second.experienceMonths ?? 0),
          )
        : Number.POSITIVE_INFINITY;
    const requiredSetEqual = Boolean(
      first &&
      second &&
      sameStringArray(first.requiredSkillIds, second.requiredSkillIds) &&
      sameStringArray(first.requiredMatchedIds, second.requiredMatchedIds),
    );
    const preferredSetEqual = Boolean(
      first &&
      second &&
      sameStringArray(first.preferredSkillIds, second.preferredSkillIds) &&
      sameStringArray(first.preferredMatchedIds, second.preferredMatchedIds),
    );
    const presentationStateEqual = Boolean(
      first && second && first.presentationState === second.presentationState,
    );
    const scoreEligibilityEqual = Boolean(
      first &&
      second &&
      first.actualScoreMayBeShown === second.actualScoreMayBeShown,
    );
    const evidenceSemanticsEqual = Boolean(
      first &&
      second &&
      sameStringArray(first.evidenceSemantics, second.evidenceSemantics),
    );
    const diagnostics = [
      ...(pairCases.length === 2
        ? []
        : [`pair-cardinality=${pairCases.length}`]),
      ...(experienceDifference === 0 ? [] : ["experience-months-differ"]),
      ...(requiredSetEqual ? [] : ["required-set-differs"]),
      ...(preferredSetEqual ? [] : ["preferred-set-differs"]),
      ...(presentationStateEqual ? [] : ["presentation-state-differs"]),
      ...(scoreEligibilityEqual ? [] : ["score-eligibility-differs"]),
      ...(evidenceSemanticsEqual ? [] : ["evidence-semantics-differs"]),
      ...(scoreDifference <= 1 ? [] : ["deterministic-score-differs"]),
    ];
    const pass =
      pairCases.length === 2 &&
      diagnostics.length === 0 &&
      Boolean(first && second);
    return {
      pairId,
      cardinality: pairCases.length,
      pass,
      scoreDifference,
      experienceDifference,
      requiredSetEqual,
      preferredSetEqual,
      presentationStateEqual,
      scoreEligibilityEqual,
      evidenceSemanticsEqual,
      diagnostics,
    };
  });
  const requiredAggregate = aggregateMetrics(
    aggregateCounts(cases, "requiredCounts"),
  );
  const preferredAggregate = aggregateMetrics(
    aggregateCounts(cases, "preferredCounts"),
  );
  const experienceErrors = cases.map((item) =>
    Math.abs((item.experienceMonths ?? 0) - item.expectedExperienceMonths),
  );
  const thresholds = {
    maxExperienceAbsoluteErrorMonths: 0,
    maxEquivalentScoreAbsoluteDifference: 1,
    minimumRequiredPrecision: 0.95,
    minimumRequiredRecall: 0.95,
    minimumPreferredPrecision: 0.95,
    minimumPreferredRecall: 0.95,
    minimumRequiredSupport: 1,
    minimumPreferredSupport: 1,
    evidenceTraceValidity: 1,
    incompleteClassificationAccuracy: 1,
    scoreEligibilityAccuracy: 1,
    formatExtractionValidity: 1,
    piiFree: 1,
  } as const;
  const experienceMaxAbsoluteErrorMonths = Math.max(...experienceErrors);
  const evidenceTraceValidity =
    cases.filter((item) => item.evidenceTraceValid).length / cases.length;
  const formatExtractionValidity =
    cases.filter((item) => item.formatExtractionValid).length / cases.length;
  const piiFreeRate =
    cases.filter((item) => item.piiFree).length / cases.length;
  const incompleteClassificationAccuracy =
    cases.filter((item) => item.incomplete === item.expectedIncomplete).length /
    cases.length;
  const scoreEligibilityAccuracy =
    cases.filter(
      (item) => item.actualScoreMayBeShown === item.expectedScoreMayBeShown,
    ).length / cases.length;
  const equivalentScoreMaxAbsoluteDifference = Math.max(
    ...pairChecks.map((item) => item.scoreDifference),
  );
  const provenance = await collectProvenance(
    corpus,
    process.env.PHASE5_RUN_ROLE === "pre-change" ? "pre-change" : "final",
  );
  const preChangeBaseline = await loadPreChangeBaseline(
    cases.length,
    pairChecks.length,
    provenance,
  );
  const baselineMetrics = preChangeBaseline.metrics;
  const baselineComparison = {
    requiredPrecision:
      baselineMetrics !== undefined &&
      requiredAggregate.precision >= baselineMetrics.requiredPrecision,
    requiredRecall:
      baselineMetrics !== undefined &&
      requiredAggregate.recall >= baselineMetrics.requiredRecall,
    preferredPrecision:
      baselineMetrics !== undefined &&
      preferredAggregate.precision >= baselineMetrics.preferredPrecision,
    preferredRecall:
      baselineMetrics !== undefined &&
      preferredAggregate.recall >= baselineMetrics.preferredRecall,
  };
  const baselineComparisonPassed =
    preChangeBaseline.status === "VERIFIED" &&
    Object.values(baselineComparison).every(Boolean);
  const passedThresholds = {
    experience:
      experienceMaxAbsoluteErrorMonths <=
      thresholds.maxExperienceAbsoluteErrorMonths,
    pairs: pairChecks.every((item) => item.pass),
    pairCardinality: pairChecks.every((item) => item.cardinality === 2),
    requiredPrecision:
      requiredAggregate.precision >= thresholds.minimumRequiredPrecision,
    requiredRecall:
      requiredAggregate.recall >= thresholds.minimumRequiredRecall,
    preferredPrecision:
      preferredAggregate.precision >= thresholds.minimumPreferredPrecision,
    preferredRecall:
      preferredAggregate.recall >= thresholds.minimumPreferredRecall,
    requiredSupport:
      requiredAggregate.support >= thresholds.minimumRequiredSupport,
    preferredSupport:
      preferredAggregate.support >= thresholds.minimumPreferredSupport,
    evidence: evidenceTraceValidity >= thresholds.evidenceTraceValidity,
    incomplete:
      incompleteClassificationAccuracy >=
      thresholds.incompleteClassificationAccuracy,
    scoreEligibility:
      scoreEligibilityAccuracy >= thresholds.scoreEligibilityAccuracy,
    formatExtraction:
      formatExtractionValidity >= thresholds.formatExtractionValidity,
    piiFree: piiFreeRate >= thresholds.piiFree,
  };
  const deterministicChecksPassed =
    cases.every((item) => item.pass) &&
    pairChecks.every((item) => item.pass) &&
    Object.values(passedThresholds).every(Boolean);
  const reportWithoutIntegrity = {
    generatedAt: new Date().toISOString(),
    fixedClock: fixedNow.toISOString(),
    corpusCases: cases.length,
    locales: [...new Set(cases.map((item) => item.locale))],
    formats: [...new Set(cases.map((item) => item.format))],
    equivalentPairs: pairChecks.length,
    provenance,
    preChangeBaseline,
    deterministicChecksPassed,
    thresholds,
    aggregateConfusion: {
      required: requiredAggregate,
      preferred: preferredAggregate,
    },
    metrics: {
      experienceMaxAbsoluteErrorMonths,
      requiredPrecision: requiredAggregate.precision,
      requiredRecall: requiredAggregate.recall,
      preferredPrecision: preferredAggregate.precision,
      preferredRecall: preferredAggregate.recall,
      requiredF1: requiredAggregate.f1,
      preferredF1: preferredAggregate.f1,
      requiredSupport: requiredAggregate.support,
      preferredSupport: preferredAggregate.support,
      evidenceTraceValidity,
      incompleteClassificationAccuracy,
      scoreEligibilityAccuracy,
      formatExtractionValidity,
      piiFreeRate,
      equivalentScoreMaxAbsoluteDifference,
    },
    baselineComparison,
    cases,
    pairChecks,
    passed: deterministicChecksPassed && baselineComparisonPassed,
    passedThresholds,
  };
  const report = {
    ...reportWithoutIntegrity,
    integrity: {
      algorithm: "SHA-256",
      payloadSha256: reportPayloadHash(reportWithoutIntegrity),
    },
  };
  const reportPath = resolve(
    process.env.PHASE5_REPORT_FILE ??
      resolve(
        process.cwd(),
        "../docs/audits/candidate-first/phase-5/evidence/cf503-private-match-corpus.json",
      ),
  );
  const markdownPath = reportPath.replace(/\.json$/u, ".md");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const failed = cases.filter((item) => !item.pass);
  const markdown = [
    "# CF-503 deterministic private-match corpus",
    "",
    `- Cases: ${cases.length}; equivalent pairs: ${pairChecks.length}`,
    `- Locales: ${report.locales.join(", ")}; formats: ${report.formats.join(", ")}`,
    `- Required aggregate TP/FP/FN/support: ${requiredAggregate.truePositive}/${requiredAggregate.falsePositive}/${requiredAggregate.falseNegative}/${requiredAggregate.support}`,
    `- Preferred aggregate TP/FP/FN/support: ${preferredAggregate.truePositive}/${preferredAggregate.falsePositive}/${preferredAggregate.falseNegative}/${preferredAggregate.support}`,
    `- Experience maximum absolute error: ${report.metrics.experienceMaxAbsoluteErrorMonths} months`,
    `- Required precision/recall: ${report.metrics.requiredPrecision}/${report.metrics.requiredRecall}`,
    `- Preferred precision/recall: ${report.metrics.preferredPrecision}/${report.metrics.preferredRecall}`,
    `- Required/preferred F1: ${report.metrics.requiredF1}/${report.metrics.preferredF1}`,
    `- Bidirectional evidence trace: ${report.metrics.evidenceTraceValidity * 100}% valid`,
    `- Incomplete classification: ${report.metrics.incompleteClassificationAccuracy * 100}%`,
    `- Score eligibility: ${report.metrics.scoreEligibilityAccuracy * 100}%`,
    `- Format extraction: ${report.metrics.formatExtractionValidity * 100}% valid; PII-free: ${report.metrics.piiFreeRate * 100}%`,
    `- Deterministic checks: ${report.deterministicChecksPassed ? "PASS" : "FAIL"}`,
    `- Provenance role: ${report.provenance.role}; source commit: ${report.provenance.sourceCommit ?? "UNVERIFIED"} (${report.provenance.sourceCommitSource})`,
    `- Corpus identity SHA-256: ${report.provenance.corpusIdentitySha256}`,
    `- Production source fingerprint SHA-256: ${report.provenance.productionSourceFingerprint}`,
    `- Report payload integrity SHA-256: ${report.integrity.payloadSha256}`,
    `- Pre-change baseline: ${report.preChangeBaseline.status} (${report.preChangeBaseline.reason})`,
    `- Baseline comparison: ${baselineComparisonPassed ? "PASS" : "FAIL/UNVERIFIED"}`,
    `- Verdict: ${report.passed ? "PASS" : "UNVERIFIED"}`,
    "",
    ...(failed.length
      ? [
          "## Failing case IDs",
          "",
          ...failed.map(
            (item) => `- ${item.id}: ${item.diagnostics.join(", ")}`,
          ),
        ]
      : ["All labelled cases passed."]),
    "",
  ].join("\n");
  await writeFile(markdownPath, markdown, "utf8");
  console.log(
    JSON.stringify(
      {
        reportPath,
        markdownPath,
        passed: report.passed,
        cases: cases.length,
        failed: failed.map((item) => item.id),
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
