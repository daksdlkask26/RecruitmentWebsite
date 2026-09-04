import { config } from "dotenv";
import { resolve } from "node:path";
import type { NormalizedJobSearch } from "../src/backend/services/jobs/job-types";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const matrix = [
  "kế toán",
  "ke tona",
  "accountnat",
  "kế toán kho",
  "kế toán trưởng",
  "lập trình viên frontend",
  "chuyên viên SEO",
  "trưởng phòng nhân sự",
  "nhân viên bán hàng",
  "giáo viên",
  "y tá",
  "dược sĩ",
  "tài xế xe tải",
  "manager",
  "developer",
  "sales",
  "IT",
  "nhân viên",
  "qwertyuiop",
] as const;
const companyMatrix = ["Alpha", "IT", "danang", "Can Tho", "ketoan"] as const;
const suggestionMatrix = ["seo", "ketoan", "Alpha", "danang"] as const;
const iterations = Number.parseInt(
  process.env.PERF_SEARCH_ITERATIONS ?? "5",
  10,
);
const warmups = Number.parseInt(process.env.PERF_SEARCH_WARMUPS ?? "1", 10);
const budgetMs = 2_000;
const suggestionBudgetMs = 200;
const heapGrowthBudgetMb = Number.parseFloat(
  process.env.PERF_SEARCH_HEAP_GROWTH_MB ?? "768",
);

if (!Number.isInteger(iterations) || iterations < 3) {
  throw new Error("PERF_SEARCH_ITERATIONS must be an integer of at least 3");
}

function percentile(values: readonly number[], fraction: number) {
  const ordered = [...values].sort((left, right) => left - right);
  return (
    ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? Infinity
  );
}

function criteria(
  query: string,
  resolveSearchQuery: typeof import("../src/backend/services/search/search-query-resolver").resolveSearchQuery,
): NormalizedJobSearch {
  const resolved = resolveSearchQuery(query, "JOBS", "vi");
  return {
    normalizedQuery: resolved.normalizedQuery,
    searchVariants: resolved.variants,
    searchInterpretation: resolved.interpretation,
    searchIntent: resolved.intent,
    resolverVersion: resolved.resolverVersion,
    searchMode: "SMART",
    searchBy: "BOTH",
    normalizedLocation: "",
    normalizedSkills: [],
    employmentType: [],
    experienceLevel: [],
    workArrangement: [],
    salaryCurrency: "VND",
    salaryPeriod: "MONTH",
    sort: "RELEVANCE",
    page: 1,
    limit: 20,
  };
}

async function main() {
  if (!Number.isInteger(warmups) || warmups < 0) {
    throw new Error("PERF_SEARCH_WARMUPS must be a non-negative integer");
  }
  if (!Number.isFinite(heapGrowthBudgetMb) || heapGrowthBudgetMb <= 0) {
    throw new Error("PERF_SEARCH_HEAP_GROWTH_MB must be positive");
  }
  const heapStartMb = process.memoryUsage().heapUsed / 1_000_000;
  const [{ PrismaPublicJobRepository }, { resolveSearchQuery }] =
    await Promise.all([
      import("../src/backend/repositories/jobs/prisma-public-job-repository"),
      import("../src/backend/services/search/search-query-resolver"),
    ]);
  const [{ PrismaCompanyDiscoveryRepository }, { listSearchSuggestions }] =
    await Promise.all([
      import("../src/backend/repositories/companies/prisma-company-discovery-repository"),
      import("../src/backend/services/search/search-suggestions"),
    ]);
  const repository = new PrismaPublicJobRepository();
  const results = [];
  for (const query of matrix) {
    const input = criteria(query, resolveSearchQuery);
    for (let index = 0; index < warmups; index += 1) {
      await repository.searchOrderedIds(input, new Date(), {
        includeTotal: true,
      });
    }
    const durations: number[] = [];
    let candidateRows = 0;
    let resultCount = 0;
    for (let index = 0; index < iterations; index += 1) {
      const started = performance.now();
      const result = await repository.searchOrderedIds(input, new Date(), {
        includeTotal: true,
      });
      durations.push(performance.now() - started);
      candidateRows = Math.max(
        candidateRows,
        result.candidateCount ?? result.total ?? result.orderedJobIds.length,
      );
      resultCount = result.total ?? 0;
    }
    const p50Ms = Number(percentile(durations, 0.5).toFixed(2));
    const p95Ms = Number(percentile(durations, 0.95).toFixed(2));
    const p99Ms = Number(percentile(durations, 0.99).toFixed(2));
    const coldMs = Number((durations[0] ?? Infinity).toFixed(2));
    const maxMs = Number(Math.max(...durations).toFixed(2));
    results.push({
      query,
      variants: input.searchVariants?.length ?? 0,
      candidateRows,
      resultCount,
      p50Ms,
      p95Ms,
      p99Ms,
      coldMs,
      maxMs,
      budgetMs,
      passed: p95Ms <= budgetMs && maxMs <= 5_000,
    });
  }
  const companyRepository = new PrismaCompanyDiscoveryRepository();
  const companyResults = [];
  for (const query of companyMatrix) {
    for (let index = 0; index < warmups; index += 1) {
      await companyRepository.list({
        q: query,
        searchMode: "SMART",
        page: 1,
        limit: 20,
      });
    }
    const durations: number[] = [];
    let resultCount = 0;
    for (let index = 0; index < iterations; index += 1) {
      const started = performance.now();
      const result = await companyRepository.list({
        q: query,
        searchMode: "SMART",
        page: 1,
        limit: 20,
      });
      durations.push(performance.now() - started);
      resultCount = result.total;
    }
    const p50Ms = Number(percentile(durations, 0.5).toFixed(2));
    const p95Ms = Number(percentile(durations, 0.95).toFixed(2));
    const p99Ms = Number(percentile(durations, 0.99).toFixed(2));
    companyResults.push({
      query,
      resultCount,
      p50Ms,
      p95Ms,
      p99Ms,
      maxMs: Number(Math.max(...durations).toFixed(2)),
      budgetMs,
      passed: p95Ms <= budgetMs && Math.max(...durations) <= 5_000,
    });
  }
  const suggestionResults = [];
  for (const query of suggestionMatrix) {
    for (let index = 0; index < warmups; index += 1) {
      await listSearchSuggestions({
        scope: query === "Alpha" || query === "danang" ? "COMPANIES" : "JOBS",
        q: query,
        limit: 8,
      });
    }
    const durations: number[] = [];
    let suggestionCount = 0;
    for (let index = 0; index < iterations; index += 1) {
      const started = performance.now();
      const result = await listSearchSuggestions({
        scope: query === "Alpha" || query === "danang" ? "COMPANIES" : "JOBS",
        q: query,
        limit: 8,
      });
      durations.push(performance.now() - started);
      suggestionCount = result.suggestions.length;
    }
    const p50Ms = Number(percentile(durations, 0.5).toFixed(2));
    const p95Ms = Number(percentile(durations, 0.95).toFixed(2));
    const p99Ms = Number(percentile(durations, 0.99).toFixed(2));
    suggestionResults.push({
      query,
      suggestionCount,
      p50Ms,
      p95Ms,
      p99Ms,
      maxMs: Number(Math.max(...durations).toFixed(2)),
      budgetMs: suggestionBudgetMs,
      passed: p95Ms <= suggestionBudgetMs && Math.max(...durations) <= 5_000,
    });
  }

  const filterInput = criteria("developer", resolveSearchQuery);
  const filteredScenario = {
    ...filterInput,
    normalizedLocation: "ho chi minh city",
    experienceLevel: ["ENTRY"] as NormalizedJobSearch["experienceLevel"],
    workArrangement: ["REMOTE"] as NormalizedJobSearch["workArrangement"],
    sort: "NEWEST" as const,
    page: 2,
    limit: 10,
  };
  const concurrencyInput = criteria("manager", resolveSearchQuery);
  const concurrencyDurations: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await Promise.all(
      Array.from({ length: 4 }, () =>
        repository.searchOrderedIds(concurrencyInput, new Date(), {
          includeTotal: true,
        }),
      ),
    );
    concurrencyDurations.push(performance.now() - started);
  }
  const filteredDurations: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await repository.searchOrderedIds(filteredScenario, new Date(), {
      includeTotal: true,
    });
    filteredDurations.push(performance.now() - started);
  }
  const additionalScenarios = [
    {
      name: "filter-sort-pagination",
      durations: filteredDurations,
      budgetMs,
    },
    {
      name: "concurrency-4",
      durations: concurrencyDurations,
      budgetMs: 5_000,
    },
  ].map((scenario) => ({
    name: scenario.name,
    p50Ms: Number(percentile(scenario.durations, 0.5).toFixed(2)),
    p95Ms: Number(percentile(scenario.durations, 0.95).toFixed(2)),
    p99Ms: Number(percentile(scenario.durations, 0.99).toFixed(2)),
    maxMs: Number(Math.max(...scenario.durations).toFixed(2)),
    budgetMs: scenario.budgetMs,
    passed:
      percentile(scenario.durations, 0.95) <= scenario.budgetMs &&
      Math.max(...scenario.durations) <= 5_000,
  }));
  const heapEndMb = process.memoryUsage().heapUsed / 1_000_000;
  const heapGrowthMb = Math.max(0, heapEndMb - heapStartMb);
  const memoryPassed = heapGrowthMb <= heapGrowthBudgetMb;
  const output = {
    recordedAt: new Date().toISOString(),
    method: "warmup then sequential read-only Prisma repository samples",
    matrix,
    iterations,
    warmups,
    results,
    companyResults,
    suggestionResults,
    additionalScenarios,
    memory: {
      heapStartMb: Number(heapStartMb.toFixed(2)),
      heapEndMb: Number(heapEndMb.toFixed(2)),
      heapGrowthMb: Number(heapGrowthMb.toFixed(2)),
      heapGrowthBudgetMb,
      passed: memoryPassed,
    },
    passed:
      results.every((result) => result.passed) &&
      companyResults.every((result) => result.passed) &&
      suggestionResults.every((result) => result.passed) &&
      additionalScenarios.every((result) => result.passed) &&
      memoryPassed,
  };
  console.log(
    `JOB_SEARCH_PERFORMANCE_RESULT\n${JSON.stringify(output, null, 2)}`,
  );
  if (!output.passed) throw new Error("JOB_SEARCH_PERFORMANCE_BUDGET_FAILED");
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/backend/database/prisma");
    await prisma.$disconnect();
  });
