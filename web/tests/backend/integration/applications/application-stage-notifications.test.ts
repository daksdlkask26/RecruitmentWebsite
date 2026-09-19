import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("application stage communication intents", () => {
  const source = readFileSync(
    "src/backend/services/jobs/application-stage-service.ts",
    "utf8",
  );
  it("creates one in-app intent inside the authoritative transaction", () => {
    expect(source).toContain("createInAppNotification(tx");
    expect(source).toContain(
      "application:${application.id}:stage:${nextVersion}:candidate",
    );
  });
  it("honors ordinary preferences but always queues the Hired confirmation", () => {
    expect(source).toMatch(
      /command\.targetStage === "HIRED"\s*\|\|\s*emailUpdatesEnabled/u,
    );
    expect(source).toContain("application-stage-changed.v1");
    expect(source).not.toContain("application-hired-confirmation.v1");
  });
  it("deduplicates by committed application version", () =>
    expect(source).toContain(
      "application:${application.id}:stage:${nextVersion}:email",
    ));
});
