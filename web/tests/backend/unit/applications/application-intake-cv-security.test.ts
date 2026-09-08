import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openSafe: vi.fn(),
  storage: {
    assertReady: vi.fn().mockResolvedValue(undefined),
    open: vi.fn(),
  },
}));

vi.mock(
  "@/backend/services/cv-admission/open-safe-cv-artifact-service",
  () => ({
    OpenSafeCvArtifactService: class {
      open = mocks.openSafe;
    },
  }),
);
vi.mock("@/backend/applications/storage/factory", () => ({
  createApplicationDocumentStorage: () => mocks.storage,
}));

import { prisma } from "@/backend/database/prisma";
import { ApplicationIntakeService } from "@/backend/candidate-applications/application-intake-service";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("checks an application CV through safe-open instead of raw storage", async () => {
  const dispose = vi.fn().mockResolvedValue(undefined);
  mocks.openSafe.mockResolvedValue({
    byteLength: 4,
    evidence: { checksumSha256: "a".repeat(64) },
    openStream: () =>
      (async function* () {
        yield new Uint8Array(4);
      })(),
    dispose,
  });
  vi.spyOn(prisma.applicationDocument, "findMany").mockResolvedValue([
    {
      kind: "CV",
      storageKeyEncrypted: "encrypted-source",
      byteLength: 4,
      mediaType: "application/pdf",
      contentDigestHmac: "a".repeat(64),
      sourceArtifactId: "artifact-1",
      scanAssessmentId: "assessment-1",
      sourceArtifact: { uploadId: "upload-1" },
      application: { candidateUserId: "candidate-1" },
    },
  ] as never);

  const service = new ApplicationIntakeService();
  vi.spyOn(service, "claim").mockResolvedValue({
    intakeId: "intake-1",
    applicationId: "application-1",
    workerId: "00000000-0000-4000-8000-000000000001",
    version: 1,
  });
  vi.spyOn(service, "advance").mockResolvedValue(undefined);
  vi.spyOn(service, "complete").mockResolvedValue("SENT_TO_RECRUITER");

  await expect(
    service.processOne("00000000-0000-4000-8000-000000000001"),
  ).resolves.toBe("SENT_TO_RECRUITER");
  expect(mocks.openSafe).toHaveBeenCalledWith({
    candidateUserId: "candidate-1",
    uploadId: "upload-1",
    artifactId: "artifact-1",
    assessmentId: "assessment-1",
    allowedPurposes: [
      "PROFILE_IMPORT",
      "PROFILE_DIRECT",
      "JOB_APPLICATION_DIRECT",
    ],
  });
  expect(mocks.storage.assertReady).not.toHaveBeenCalled();
  expect(mocks.storage.open).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledOnce();
});
