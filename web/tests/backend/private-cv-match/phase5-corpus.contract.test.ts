import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { phase5Corpus } from "../../fixtures/private-match/phase5-corpus";
import { validatePreChangeBaseline } from "../../../scripts/evaluate-phase5-corpus";

describe("Phase 5 deterministic corpus", () => {
  it("is versioned, bilingual, paired, and PII-free", () => {
    expect(phase5Corpus.length).toBeGreaterThanOrEqual(24);
    expect(new Set(phase5Corpus.map((item) => item.locale))).toEqual(
      new Set(["en", "vi"]),
    );
    const pairs = new Map<string, typeof phase5Corpus>();
    for (const item of phase5Corpus)
      pairs.set(item.pairId, [...(pairs.get(item.pairId) ?? []), item]);
    expect(pairs.size).toBeGreaterThanOrEqual(8);
    for (const pair of pairs.values()) {
      expect(pair).toHaveLength(2);
      expect(new Set(pair.map((item) => item.locale))).toEqual(
        new Set(["en", "vi"]),
      );
      const [first, second] = pair;
      expect(first.expected.experienceMonths).toBe(
        second.expected.experienceMonths,
      );
      expect(first.expected.incomplete).toBe(second.expected.incomplete);
      expect(first.expected.scoreMayBeShown).toBe(
        second.expected.scoreMayBeShown,
      );
      expect(first.expected.required).toEqual(second.expected.required);
      expect(first.expected.preferred).toEqual(second.expected.preferred);
      expect(first.format).toBe(second.format);
      expect(first.expected.allowedEvidence.length).toBeGreaterThanOrEqual(0);
      expect(second.expected.allowedEvidence.length).toBeGreaterThanOrEqual(0);
    }
    const requiredSupport = phase5Corpus.reduce(
      (total, item) =>
        total + Object.values(item.expected.required).filter(Boolean).length,
      0,
    );
    const preferredSupport = phase5Corpus.reduce(
      (total, item) =>
        total + Object.values(item.expected.preferred).filter(Boolean).length,
      0,
    );
    const preferredNegativeCases = phase5Corpus.filter((item) =>
      Object.values(item.expected.preferred).some((value) => !value),
    );
    expect(requiredSupport).toBeGreaterThan(0);
    expect(preferredSupport).toBeGreaterThan(0);
    expect(preferredNegativeCases.length).toBeGreaterThan(0);
    expect(
      new Set(phase5Corpus.map((item) => item.format)).size,
    ).toBeGreaterThanOrEqual(3);
    for (const item of phase5Corpus) {
      if (item.locale === "vi") {
        expect(item.input.cvText).not.toMatch(
          /\b(?:No experience with Python|Limited leadership exposure|Built communication)\b/iu,
        );
        expect(item.input.jdText).not.toMatch(
          /\b(?:No experience with Python|Limited leadership exposure|Built communication)\b/iu,
        );
      }
      expect(item.input.cvText).not.toMatch(
        /@|\b(?:phone|address|ssn|cccd)\b/iu,
      );
      expect(item.input.cvDigest).toMatch(/^[a-f0-9]{64}$/u);
      expect(
        item.expected.allowedEvidence.every((anchor) => anchor.length > 0),
      ).toBe(true);
    }
  });

  it("protects evaluator support, aggregate metrics, pair semantics, and exit behavior", async () => {
    const source = await readFile("scripts/evaluate-phase5-corpus.ts", "utf8");
    expect(source).toContain("minimumPreferredSupport");
    expect(source).toContain("minimumRequiredSupport");
    expect(source).toContain("f1");
    expect(source).toContain("evidenceSemanticsEqual");
    expect(source).toContain("productionSourceFingerprint");
    expect(source).toContain("corpusIdentitySha256");
    expect(source).toContain("integrity");
    expect(source).toContain("validatePreChangeBaseline");
    expect(source).toContain("loadPreChangeBaseline");
    expect(source).toContain("baselineComparisonPassed");
    expect(source).toContain("process.exitCode = 1");

    const tempRoot = await mkdtemp(join(tmpdir(), "phase5-corpus-contract-"));
    const fixturePath = join(tempRoot, "failing-corpus.json");
    const reportPath = join(tempRoot, "report.json");
    const failingCorpus = phase5Corpus.map((item, index) =>
      index === 0
        ? {
            ...item,
            expected: {
              ...item.expected,
              experienceMonths: item.expected.experienceMonths + 1,
            },
          }
        : item,
    );
    try {
      await writeFile(fixturePath, JSON.stringify(failingCorpus), "utf8");
      const result = spawnSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "scripts/evaluate-phase5-corpus.ts",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PHASE5_CORPUS_FILE: fixturePath,
            PHASE5_REPORT_FILE: reportPath,
          },
          encoding: "utf8",
          timeout: 120_000,
        },
      );
      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain('"passed": false');
      const report = JSON.parse(await readFile(reportPath, "utf8")) as {
        passed: boolean;
        preChangeBaseline: { status: string };
      };
      expect(report.passed).toBe(false);
      expect(report.preChangeBaseline.status).toBe("UNVERIFIED");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for missing, mismatched, or invalid baseline provenance", () => {
    const hash = "A".repeat(64);
    const currentProvenance = {
      role: "final",
      sourceCommit: "B".repeat(40),
      sourceCommitSource: "git-rev-parse",
      corpusIdentitySha256: hash,
      corpusSourceSha256: hash,
      evaluatorSourceSha256: hash,
      adapterSourceSha256: hash,
      productionSourceFingerprint: hash,
      sourceFiles: {
        corpus: hash,
        evaluator: hash,
        adapter: hash,
        skillEvidence: hash,
        experienceDuration: hash,
        pdfExtraction: hash,
        docxExtraction: hash,
      },
      command: "final",
    } as const;
    const input = {
      corpusCases: phase5Corpus.length,
      equivalentPairs: new Set(phase5Corpus.map((item) => item.pairId)).size,
      currentProvenance,
      expectedSourceCommit: "B".repeat(40),
      expectedCommand: "baseline",
      artifact: "baseline.json",
    };
    expect(
      validatePreChangeBaseline({
        ...input,
        parsed: {},
      }).status,
    ).toBe("UNVERIFIED");
    expect(
      validatePreChangeBaseline({
        ...input,
        parsed: {
          corpusCases: phase5Corpus.length,
          equivalentPairs: 17,
          provenance: {
            role: "pre-change",
            sourceCommit: "B".repeat(40),
            command: "baseline",
            corpusIdentitySha256: "C".repeat(64),
            corpusSourceSha256: hash,
            evaluatorSourceSha256: hash,
            adapterSourceSha256: hash,
            productionSourceFingerprint: "D".repeat(64),
          },
          integrity: {
            algorithm: "SHA-256",
            payloadSha256: "E".repeat(64),
          },
          metrics: {
            requiredPrecision: 1,
            requiredRecall: 1,
            preferredPrecision: 1,
            preferredRecall: 1,
          },
          aggregateConfusion: {
            required: { support: 1 },
            preferred: { support: 1 },
          },
        },
      }).status,
    ).toBe("UNVERIFIED");
  });
});
