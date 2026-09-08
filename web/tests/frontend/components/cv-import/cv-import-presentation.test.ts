import { describe, expect, it } from "vitest";

import { CV_SAFE_FAILURE_CODES } from "@/shared/contracts/cv-import/upload";
import {
  CV_IMPORT_PRESENTATION_STEPS,
  cvImportFailureCategoryLabel,
  cvImportStepLabel,
  mapCvImportPresentation,
} from "@/frontend/features/cv-import/client/cv-import-presentation";
import { CV_UPLOAD_STATUSES } from "@/shared/contracts/cv-import/common";

describe("CV import presentation mapping", () => {
  it("maps every persisted status to exactly five deterministic steps", () => {
    for (const status of CV_UPLOAD_STATUSES) {
      const presentation = mapCvImportPresentation({
        status,
        stage: "REVIEW",
        availableActions: [],
      });

      expect(presentation.steps).toHaveLength(5);
      expect(presentation.steps.map((step) => step.key)).toEqual(
        CV_IMPORT_PRESENTATION_STEPS,
      );
      expect(
        presentation.steps.filter(
          (step) =>
            step.state === "current" ||
            step.state === "error" ||
            step.state === "action-required",
        ),
      ).toHaveLength(status === "CONFIRMED" ? 0 : 1);
    }
  });

  it("keeps security clean between scan and extract for profile imports", () => {
    const profileImport = mapCvImportPresentation({
      status: "SECURITY_CLEAN",
      processingMode: "IMPORT_AND_PARSE",
      stage: "EXTRACT",
      availableActions: [],
    });
    const scanOnly = mapCvImportPresentation({
      status: "SECURITY_CLEAN",
      processingMode: "SCAN_ONLY",
      stage: "COMPLETE",
      availableActions: [],
    });

    expect(profileImport.currentStep).toBe("EXTRACT");
    expect(profileImport.state).toBe("active");
    expect(
      profileImport.steps
        .slice(0, 2)
        .every((step) => step.state === "complete"),
    ).toBe(true);
    expect(profileImport.steps[2]?.state).toBe("current");
    expect(scanOnly.currentStep).toBe("SCAN");
    expect(scanOnly.terminal).toBe(true);
    expect(scanOnly.steps[0]?.state).toBe("complete");
    expect(scanOnly.steps[1]?.state).toBe("complete");
    expect(scanOnly.steps[2]?.state).toBe("upcoming");
  });

  it.each([
    ["VALIDATION_FAILED", "MALFORMED_DOCUMENT", "FILE", "UPLOAD"],
    ["INFECTED", "MALWARE_DETECTED", "MALWARE", "SCAN"],
    ["SCAN_FAILED", "SCANNER_UNAVAILABLE", "SCANNER", "SCAN"],
    ["EXTRACTION_FAILED", "OCR_TIMEOUT", "EXTRACTION", "EXTRACT"],
    ["PARSE_FAILED", "PARSER_TIMEOUT", "EXTRACTION", "EXTRACT"],
    ["AWAITING_CONSENT", "CONSENT_REQUIRED", "CONSENT", "EXTRACT"],
    ["REVIEW_READY", "DRAFT_REVISION_CONFLICT", "CONFLICT", "REVIEW"],
    ["EXPIRED", "IMPORT_EXPIRED", "RETENTION", "REVIEW"],
    ["PARSE_FAILED", "CV_PROCESSING_FAILED", "SYSTEM", "EXTRACT"],
  ] as const)(
    "maps %s/%s to the safe %s category at %s",
    (status, failureCode, category, step) => {
      const presentation = mapCvImportPresentation({
        status,
        stage: "TERMINAL",
        failureCode,
        availableActions: ["RETRY", "UNTRUSTED_ACTION"],
      });

      expect(presentation.failureCategory).toBe(category);
      expect(presentation.currentStep).toBe(step);
      expect(presentation.steps.find((item) => item.key === step)?.state).toBe(
        status === "REVIEW_READY" || status === "AWAITING_CONSENT"
          ? "action-required"
          : "error",
      );
      expect(presentation.availableActions).toEqual(["RETRY"]);
    },
  );

  it("covers every safe failure code without exposing raw messages in the mapping", () => {
    for (const failureCode of CV_SAFE_FAILURE_CODES) {
      const presentation = mapCvImportPresentation({
        status: "PARSE_FAILED",
        stage: "PARSE",
        failureCode,
        availableActions: [],
      });

      expect(presentation.failureCategory).not.toBeNull();
      expect(presentation.steps).toHaveLength(
        CV_IMPORT_PRESENTATION_STEPS.length,
      );
      expect(presentation).not.toHaveProperty("message");
    }
  });

  it("provides bilingual labels for every step and failure category", () => {
    for (const step of CV_IMPORT_PRESENTATION_STEPS) {
      expect(cvImportStepLabel("en", step)).toBeTruthy();
      expect(cvImportStepLabel("vi", step)).toBeTruthy();
    }
    for (const category of [
      "FILE",
      "MALWARE",
      "SCANNER",
      "EXTRACTION",
      "CONSENT",
      "CONFLICT",
      "RETENTION",
      "SYSTEM",
    ] as const) {
      expect(cvImportFailureCategoryLabel("en", category)).toBeTruthy();
      expect(cvImportFailureCategoryLabel("vi", category)).toBeTruthy();
    }
  });
});
