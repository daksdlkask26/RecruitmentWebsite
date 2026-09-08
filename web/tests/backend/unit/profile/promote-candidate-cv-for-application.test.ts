import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openSafeCvArtifact: vi.fn(),
}));

vi.mock(
  "@/backend/services/cv-admission/open-safe-cv-artifact-service",
  () => ({
    OpenSafeCvArtifactService: class {
      open = mocks.openSafeCvArtifact;
    },
  }),
);

import { promoteCandidateCvForApplication } from "@/backend/services/profile/promote-candidate-cv-for-application";

function destination() {
  return {
    assertReady: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue({
      locator: "application-cv-locator",
      bytes: 64,
      storagePurposeVersion: "application-document-v1",
    }),
    open: vi.fn(),
    delete: vi.fn(),
  };
}

function sourceCv(id = "candidate-cv-upload-1") {
  return {
    id,
    candidateUserId: "candidate-1",
    byteSize: 64,
    checksumSha256: "a".repeat(64),
    sourceArtifactId: "artifact-1",
    scanAssessmentId: "assessment-1",
    uploadId: "upload-1",
  };
}

describe("promoteCandidateCvForApplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies and reuses the encrypted source without writing a plaintext copy", async () => {
    const target = destination();
    const opened = {
      byteLength: 64,
      evidence: {
        artifactId: "artifact-1",
        assessmentId: "assessment-1",
        storageLocator: "encrypted-source-locator",
        checksumSha256: "a".repeat(64),
      },
      openStream: vi.fn(() =>
        (async function* () {
          yield new Uint8Array(64);
        })(),
      ),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    mocks.openSafeCvArtifact.mockResolvedValue(opened);
    const db = {};

    const result = await promoteCandidateCvForApplication(
      sourceCv(),
      target as never,
      db as never,
    );

    expect(result).toMatchObject({
      artifactId: "artifact-1",
      assessmentId: "assessment-1",
      storageLocator: "encrypted-source-locator",
      byteLength: 64,
    });
    expect(mocks.openSafeCvArtifact).toHaveBeenCalledWith({
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
    expect(target.assertReady).not.toHaveBeenCalled();
    expect(target.put).not.toHaveBeenCalled();
    expect(opened.dispose).toHaveBeenCalledOnce();
  });

  it("fails closed when the CandidateCv has no scan evidence", async () => {
    const target = destination();
    target.open.mockReturnValue(
      (async function* () {
        yield new Uint8Array(64);
      })(),
    );
    const db = {};

    const result = await promoteCandidateCvForApplication(
      {
        ...sourceCv("legacy-cv-1"),
        sourceArtifactId: null,
        scanAssessmentId: null,
        uploadId: null,
      },
      target as never,
      db as never,
    );

    expect(result).toBeNull();
    expect(target.put).not.toHaveBeenCalled();
  });
});
