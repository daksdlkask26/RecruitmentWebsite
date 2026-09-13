import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIRECT_APPLICATION_CV_ID } from "@/shared/contracts/jobs/actions";

const {
  prepareDirectApplicationCvMock,
  finalizeCandidateCvFromUploadMock,
  recordApplicationMock,
} = vi.hoisted(() => ({
  prepareDirectApplicationCvMock: vi.fn(),
  finalizeCandidateCvFromUploadMock: vi.fn(),
  recordApplicationMock: vi.fn(),
}));

vi.mock("@/backend/services/jobs/prepare-direct-application-cv", () => ({
  prepareDirectApplicationCv: prepareDirectApplicationCvMock,
}));
vi.mock("@/backend/services/jobs/recruiter-job-posting-data", () => ({
  recordApplication: recordApplicationMock,
}));
vi.mock("@/backend/services/cv-admission/finalize-candidate-cv", () => ({
  finalizeCandidateCvFromUpload: finalizeCandidateCvFromUploadMock,
}));

import { JobApplicationService } from "@/backend/services/jobs/job-application-service";

const command = {
  cvId: DIRECT_APPLICATION_CV_ID,
  answers: [],
  coverLetter: null,
  consentVersion: "2026-08-01",
  consentAccepted: true,
};

const directSource = {
  fileName: "resume.pdf",
  mimeType: "application/pdf",
  byteSize: 64,
  source: (async function* () {
    yield new Uint8Array(64);
  })(),
};

function application(created: boolean) {
  return {
    applicationId: "application-1",
    jobId: "job-1",
    stage: "APPLIED" as const,
    submittedAt: "2026-08-01T00:00:00.000Z",
    created,
    message: created
      ? "Application submitted."
      : "Your application was already submitted.",
  };
}

describe("JobApplicationService CV security boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordApplicationMock.mockResolvedValue(undefined);
  });

  it("rejects a legacy raw direct-CV source before repository submission", async () => {
    const repository = {
      submit: vi.fn(),
    };
    const audit = { append: vi.fn().mockResolvedValue("audit-1") };
    await expect(
      new JobApplicationService(
        repository as never,
        undefined,
        audit as never,
      ).submit(
        { userId: "candidate-1", sessionId: "session-1" },
        "job-1",
        "application-key-00000001",
        command,
        new Date("2026-08-01T00:00:00.000Z"),
        directSource,
      ),
    ).rejects.toMatchObject({
      status: 400,
      body: { code: "APPLICATION_CV_INELIGIBLE" },
    });

    expect(prepareDirectApplicationCvMock).not.toHaveBeenCalled();
    expect(repository.submit).not.toHaveBeenCalled();
  });

  it("finalizes an admitted upload before submitting the application", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    finalizeCandidateCvFromUploadMock.mockResolvedValue({
      id: "candidate-cv-clean-upload",
    });
    const repository = {
      submit: vi.fn().mockResolvedValue({
        application: application(true),
        created: true,
      }),
    };
    const service = new JobApplicationService(repository as never);
    const actor = { userId: "candidate-1", sessionId: "session-1" };

    await expect(
      service.submit(
        actor,
        "job-1",
        "application-key-00000001",
        { ...command, cvUploadId: "upload-clean" },
        now,
      ),
    ).resolves.toMatchObject({ created: true });

    expect(finalizeCandidateCvFromUploadMock).toHaveBeenCalledWith({
      candidateUserId: actor.userId,
      uploadId: "upload-clean",
      expectedPurpose: "JOB_APPLICATION_DIRECT",
      archive: true,
      now,
    });
    expect(repository.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({
          cvId: "candidate-cv-clean-upload",
          cvUploadId: "upload-clean",
        }),
        directCv: undefined,
      }),
    );
    expect(recordApplicationMock).toHaveBeenCalledOnce();
  });

  it("keeps the committed application outcome when the post-commit projection fails", async () => {
    recordApplicationMock.mockRejectedValueOnce(
      new Error("catalog unavailable"),
    );
    const repository = {
      submit: vi.fn().mockResolvedValue({
        application: application(true),
        created: true,
      }),
    };

    await expect(
      new JobApplicationService(repository as never).submit(
        { userId: "candidate-1", sessionId: "session-1" },
        "job-1",
        "application-key-00000001",
        command,
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      applicationId: "application-1",
      created: true,
    });
    expect(recordApplicationMock).toHaveBeenCalledOnce();
  });
});
