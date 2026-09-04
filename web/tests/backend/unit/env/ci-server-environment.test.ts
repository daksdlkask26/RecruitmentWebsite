import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseServerEnvironment } from "@/backend/env/server";

function readCiEnvironment(): Record<string, string> {
  const workflow = readFileSync(
    resolve(process.cwd(), "../.github/workflows/ci.yml"),
    "utf8",
  );
  const environmentBlock = workflow.match(
    /^    env:\r?\n([\s\S]*?)^    steps:/mu,
  )?.[1];
  if (!environmentBlock) throw new Error("CI job environment block not found.");

  return Object.fromEntries(
    environmentBlock
      .split(/\r?\n/u)
      .map((line) => line.match(/^      ([A-Z0-9_]+):\s*(.*)$/u))
      .filter((match) => match)
      .map((match) => {
        const key = match?.[1] ?? "";
        const rawValue = match?.[2] ?? "";
        const value =
          rawValue.startsWith('"') && rawValue.endsWith('"')
            ? rawValue.slice(1, -1)
            : rawValue;
        return [key, value];
      }),
  );
}

describe("CI server environment", () => {
  it("satisfies the runtime environment contract without local env files", () => {
    const environment = readCiEnvironment();

    expect(environment.NODE_OPTIONS).toBe("--max-old-space-size=4096");
    expect(parseServerEnvironment(environment)).toMatchObject({
      APP_ENV: "test",
      CV_PARSER_ADAPTER: "deterministic",
      CV_OPENAI_ENABLED: false,
      EMAIL_ADAPTER: "capture",
    });
  });
});
