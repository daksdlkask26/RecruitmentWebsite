import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("CV import status route identity", () => {
  it("uses the persisted uploadId for pending and completed imports", async () => {
    const route = await readFile(
      resolve(
        process.cwd(),
        "src/app/(workspace)/profile/cv-imports/[uploadId]/page.tsx",
      ),
      "utf8",
    );
    const review = await readFile(
      resolve(
        process.cwd(),
        "src/app/(workspace)/profile/cv-imports/[uploadId]/review/page.tsx",
      ),
      "utf8",
    );
    const list = await readFile(
      resolve(
        process.cwd(),
        "src/frontend/features/cv-import/components/cv-import-list.tsx",
      ),
      "utf8",
    );
    const status = await readFile(
      resolve(
        process.cwd(),
        "src/frontend/features/cv-import/components/cv-import-status.tsx",
      ),
      "utf8",
    );

    expect(route).toContain("cvUploadIdSchema.safeParse(uploadId)");
    expect(route).toContain("getCvImportResource(context.userId, parsed.data)");
    expect(route).toContain("<CvImportStatus");
    expect(route).toContain("<CvConfirmationReceipt");
    expect(review).toContain(
      "href={`/profile/cv-imports/${resource.uploadId}`}",
    );
    expect(route).toContain('export const dynamic = "force-dynamic"');
    expect(list).toContain("/profile/cv-imports/${item.uploadId}");
    expect(status).toContain('availableActions.includes("REVIEW")');
    expect(status).toContain(
      "/profile/cv-imports/${current.uploadId}/review",
    );
  });
});
