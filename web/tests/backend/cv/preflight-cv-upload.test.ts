import { describe, expect, it, vi } from "vitest";
import { validateCvUploadContent } from "@/backend/cv/preflight-cv-upload";

function legacyDocBytes(text: string) {
  return Uint8Array.from([
    0xd0,
    0xcf,
    0x11,
    0xe0,
    0xa1,
    0xb1,
    0x1a,
    0xe1,
    ...new TextEncoder().encode(`WordDocument\n${text}`),
  ]);
}

describe("direct CV upload content preflight", () => {
  it("stops before classification when extraction is empty or unreadable", async () => {
    const classifier = { classify: vi.fn() };
    await expect(
      validateCvUploadContent({
        bytes: Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1),
        kind: "DOC",
        scanStatus: "CLEAN",
        classifier,
      }),
    ).rejects.toMatchObject({
      code: "CV_TEXT_TOO_SHORT",
    });
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it("rejects a readable document that the classifier says is not a CV", async () => {
    await expect(
      validateCvUploadContent({
        bytes: legacyDocBytes(
          "This is a contract describing payment terms and legal obligations.",
        ),
        kind: "DOC",
        scanStatus: "CLEAN",
        classifier: {
          classify: vi.fn().mockResolvedValue({
            isCv: false,
            confidence: 0.99,
            source: "AI" as const,
          }),
        },
      }),
    ).rejects.toMatchObject({ code: "CV_NOT_RECOGNIZED_AS_CV" });
  });

  it("allows a genuine CV only at or above the confidence threshold", async () => {
    await expect(
      validateCvUploadContent({
        bytes: legacyDocBytes(
          "Jane Doe\nWork Experience\nEducation\nSkills\n2024",
        ),
        kind: "DOC",
        scanStatus: "CLEAN",
        classifier: {
          classify: vi.fn().mockResolvedValue({
            isCv: true,
            confidence: 0.7,
            source: "AI" as const,
          }),
        },
      }),
    ).resolves.toMatchObject({
      classification: { isCv: true, confidence: 0.7 },
    });
  });

  it("does not reject a structurally clear CV because of one AI false-negative", async () => {
    await expect(
      validateCvUploadContent({
        bytes: legacyDocBytes(
          "Nguyen Van An\nEmail: an@example.com\nKinh nghiem lam viec\n2021 - nay: Backend Developer\nHoc van\nDai hoc Cong nghe Thong tin\nKy nang\nNode.js PostgreSQL Docker",
        ),
        kind: "DOC",
        scanStatus: "CLEAN",
        classifier: {
          classify: vi.fn().mockResolvedValue({
            isCv: false,
            confidence: 0.82,
            source: "AI" as const,
          }),
        },
      }),
    ).resolves.toMatchObject({
      classification: { isCv: false, confidence: 0.82 },
      decision: { accepted: true, basis: "STRONG_STRUCTURAL_EVIDENCE" },
    });
  });

  it("fails closed before parsing any document that is not CLEAN", async () => {
    const classifier = { classify: vi.fn() };
    await expect(
      validateCvUploadContent({
        bytes: legacyDocBytes("Jane Doe\nWork Experience\nSkills"),
        kind: "DOC",
        scanStatus: "QUEUED",
        classifier,
      }),
    ).rejects.toMatchObject({ code: "CV_TEXT_UNAVAILABLE" });
    expect(classifier.classify).not.toHaveBeenCalled();
  });
});
