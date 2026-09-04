import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

void (async () => {
  const { evaluateRuntimeJobSearchRelevance } =
    await import("../src/backend/services/search/search-relevance-evaluation");
  const result = await evaluateRuntimeJobSearchRelevance();
  console.log(
    `JOB_SEARCH_RELEVANCE_RESULT\n${JSON.stringify(result, null, 2)}`,
  );

  if (!result.passed) {
    console.error("JOB_SEARCH_RELEVANCE_BUDGET_FAILED");
    process.exitCode = 1;
  }
})();
