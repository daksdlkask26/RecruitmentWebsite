import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateHomePageModel } from "@/frontend/features/home/home-page-model";
import {
  employerViewer,
  homeJob,
  homeModel,
} from "../../helpers/home/home-fixtures";

describe("Home job recommendation privacy", () => {
  it("rejects non-personal card scores and Employer candidate output", () => {
    expect(() =>
      validateHomePageModel(homeModel({ jobs: [homeJob({ matchScore: 82 })] })),
    ).toThrow();
    expect(() =>
      validateHomePageModel({
        ...homeModel({ viewer: employerViewer }),
        smartMatch: {
          kind: "personal",
          jobSlug: "frontend-intern",
          jobTitle: "Frontend Intern",
          score: 75,
          presentationState: "AVAILABLE",
          scoreEligible: true,
          quality: "meaningful",
          scoreSource: "profile",
          matchBreakdown: {
            roleAndSkills: 50,
            preferences: 15,
            experience: 10,
            unmatched: 25,
          },
          matchingSkills: [],
          improvementAreas: [],
          limitations: ["estimate"],
          completeness: "AVAILABLE",
        },
      }),
    ).toThrow();
  });

  it("adds no Home score persistence, API, or applicant-screening formula", async () => {
    const [context, helper, schema] = await Promise.all([
      readFile(
        resolve(
          process.cwd(),
          "src/backend/services/home/get-home-page-context.ts",
        ),
        "utf8",
      ),
      readFile(
        resolve(
          process.cwd(),
          "src/backend/services/jobs/candidate-job-match.ts",
        ),
        "utf8",
      ),
      readFile(resolve(process.cwd(), "prisma/schema.prisma"), "utf8"),
    ]);
    expect(context).not.toMatch(/\.create\(|\.update\(|\.upsert\(/u);
    expect(helper).not.toMatch(/screening|applicant|60\s*\/\s*40/iu);
    expect(schema).not.toMatch(
      /model\s+(?:HomeMatch|SmartMatch|HomeRecommendation)/u,
    );
  });
});
