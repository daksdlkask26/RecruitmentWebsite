import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIRECT_APPLICATION_CV_ID } from "@/shared/contracts/jobs/actions";

const { prepareDirectApplicationCvMock, recordApplicationMock } = vi.hoisted(
  () => ({
    prepareDirectApplicationCvMock: vi.fn(),
    recordApplicationMock: vi.fn(),
  }),
);

vi.mock("@/backend/services/jobs/prepare-direct-application-cv", () => ({
  prepareDirectApplicationCv: prepareDirectApplicationCvMock,
}));
vi.mock("@/backend/services/jobs/recruiter-job-posting-data", () => ({
  recordApplication: recordApplicationMock,
}));

import { JobApplicationService } from "@/backend/services/jobs/job-application-service";

function prepared(storageKey: string, checksumSha256 = "a".repeat(64)) {
  return {
    id: `application-cv-${storageKey}`,
    displayName: "resume.pdf",
    fileName: "resume.pdf",
    mimeType: "application/pdf" as const,
    byteSize: 64,
    storageKey,
    checksumSha256,
    claimOwnership: vi.fn(),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

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

describe("JobApplicationService direct CV ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordApplicationMock.mockResolvedValue(undefined);
  });

  it("claims the CV before a post-commit projection failure can clean it up", async () => {
    const direct = prepared("direct-cv-post-commit");
    prepareDirectApplicationCvMock.mockResolvedValue(direct);
    recordApplicationMock.mockRejectedValue(
      new Error("CATALOGUE_PROJECTION_FAILED"),
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
        directSource,
      ),
    ).resolves.toMatchObject({ created: true });

    expect(direct.claimOwnership).toHaveBeenCalledOnce();
    expect(direct.cleanup).not.toHaveBeenCalled();
  });

  it("cleans the retry artifact when the repository replays an active key", async () => {
    const first = prepared("direct-cv-first");
    const retry = prepared("direct-cv-retry");
    prepareDirectApplicationCvMock
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(retry);
    const repository = {
      submit: vi
        .fn()
        .mockResolvedValueOnce({
          application: application(true),
          created: true,
        })
        .mockResolvedValueOnce({
          application: application(false),
          created: false,
        }),
    };
    const service = new JobApplicationService(repository as never);
    const actor = { userId: "candidate-1", sessionId: "session-1" };

    await expect(
      service.submit(
        actor,
        "job-1",
        "application-key-00000001",
        command,
        new Date("2026-08-01T00:00:00.000Z"),
        directSource,
      ),
    ).resolves.toMatchObject({ created: true });
    await expect(
      service.submit(
        actor,
        "job-1",
        "application-key-00000001",
        command,
        new Date("2026-08-01T00:00:01.000Z"),
        directSource,
      ),
    ).resolves.toMatchObject({ created: false });

    expect(repository.submit).toHaveBeenCalledTimes(2);
    expect(first.claimOwnership).toHaveBeenCalledOnce();
    expect(first.cleanup).not.toHaveBeenCalled();
    expect(retry.claimOwnership).not.toHaveBeenCalled();
    expect(retry.cleanup).toHaveBeenCalledOnce();
    expect(recordApplicationMock).toHaveBeenCalledOnce();
  });
});
