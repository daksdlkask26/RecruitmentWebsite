import { beforeEach, describe, expect, it, vi } from "vitest";

const { openSafeCvArtifactMock, safetyEvidenceMock } = vi.hoisted(() => ({
  openSafeCvArtifactMock: vi.fn(),
  safetyEvidenceMock: vi.fn(),
}));

vi.mock(
  "@/backend/services/cv-admission/open-safe-cv-artifact-service",
  () => ({
    OpenSafeCvArtifactService: class {
      open = openSafeCvArtifactMock;
    },
  }),
);

vi.mock("@/backend/services/cv-admission/cv-safety-evidence-service", () => ({
  CvSafetyEvidenceService: class {
    assertCvArtifactSafeForUse = safetyEvidenceMock;
  },
}));

import { OpenApplicationDocumentService } from "@/backend/applications/services/open-application-document";
import { PrismaApplicationRepository } from "@/backend/repositories/applications/prisma-application-repository";
import type { ApplicationRepositoryPort } from "@/backend/repositories/applications/application-repository";

type TestDocument = {
  applicationId: string;
  jobId: string;
  stage: "APPLIED" | "VIEWED";
  stageVersion: number;
  kind: "cv";
  fileName: string;
  mediaType: string;
  byteLength: number;
  storageKey: string | null;
  text: string | null;
  previewSupported: boolean;
  sourceArtifactId: string;
  scanAssessmentId: string;
  uploadId: string;
  candidateUserId: string;
  scanStatus: "CLEAN";
};

function document(stage: "APPLIED" | "VIEWED"): TestDocument {
  return {
    applicationId: "application-1",
    jobId: "job-1",
    stage,
    stageVersion: stage === "APPLIED" ? 1 : 2,
    kind: "cv" as const,
    fileName: "candidate-cv.pdf",
    mediaType: "application/pdf",
    byteLength: 100,
    storageKey: null,
    text: "Candidate CV text",
    previewSupported: true,
    sourceArtifactId: "artifact-1",
    scanAssessmentId: "assessment-1",
    uploadId: "upload-1",
    candidateUserId: "candidate-1",
    scanStatus: "CLEAN",
  };
}

function repository(result: ReturnType<typeof document>) {
  return {
    findDocument: vi.fn().mockResolvedValue(result),
  } as unknown as ApplicationRepositoryPort;
}

describe("recruiter document review tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openSafeCvArtifactMock.mockResolvedValue({
      openStream: () =>
        (async function* () {
          yield new Uint8Array([1]);
        })(),
      dispose: vi.fn().mockResolvedValue(undefined),
    });
    safetyEvidenceMock.mockResolvedValue({});
  });

  it("records APPLIED -> VIEWED when an authorized recruiter opens a document", async () => {
    const repo = repository(document("APPLIED"));
    const authorization = {
      authorizeApplication: vi.fn().mockResolvedValue({ authorized: true }),
    };
    const stageService = { transition: vi.fn().mockResolvedValue(undefined) };
    const service = new OpenApplicationDocumentService(
      repo,
      authorization as never,
      undefined,
      stageService as never,
    );
    const now = new Date("2026-08-18T10:00:00.000Z");

    await service.execute({
      userId: "recruiter-1",
      sessionId: "session-1",
      jobId: "job-1",
      applicationId: "application-1",
      kind: "cv",
      preview: true,
      now,
    });

    expect(stageService.transition).toHaveBeenCalledWith(
      { userId: "recruiter-1", sessionId: "session-1" },
      "application-1",
      { targetStage: "VIEWED", expectedVersion: 1 },
      now,
    );
  });

  it("does not create a duplicate stage transition for an already viewed document", async () => {
    const repo = repository(document("VIEWED"));
    const stageService = { transition: vi.fn() };
    const service = new OpenApplicationDocumentService(
      repo,
      {
        authorizeApplication: vi.fn().mockResolvedValue({ authorized: true }),
      } as never,
      undefined,
      stageService as never,
    );

    await service.execute({
      userId: "recruiter-1",
      sessionId: "session-1",
      jobId: "job-1",
      applicationId: "application-1",
      kind: "cv",
      preview: true,
    });

    expect(stageService.transition).not.toHaveBeenCalled();
  });

  it("does not open PDF storage when only structured-preview metadata is needed", async () => {
    const repo = repository({
      ...document("VIEWED"),
      storageKey: "applications/application-1/cv.pdf",
      text: null,
    });
    const storage = {
      assertReady: vi.fn(),
      open: vi.fn(),
    };
    const service = new OpenApplicationDocumentService(
      repo,
      {
        authorizeApplication: vi.fn().mockResolvedValue({ authorized: true }),
      } as never,
      storage as never,
      { transition: vi.fn() } as never,
    );

    const result = await service.execute({
      userId: "recruiter-1",
      sessionId: "session-1",
      jobId: "job-1",
      applicationId: "application-1",
      kind: "cv",
      preview: false,
      streamPolicy: "SKIP_PDF",
    });

    expect(result.stream).toBeNull();
    expect(storage.assertReady).not.toHaveBeenCalled();
    expect(storage.open).not.toHaveBeenCalled();
  });

  it("still opens an authorized document when view acknowledgement fails", async () => {
    class PrismaRepositoryDouble extends PrismaApplicationRepository {
      override findDocument() {
        return Promise.resolve(document("APPLIED"));
      }
    }

    const stageService = {
      transition: vi
        .fn()
        .mockRejectedValue(new Error("database temporarily unavailable")),
    };
    const service = new OpenApplicationDocumentService(
      new PrismaRepositoryDouble({} as never),
      {
        authorizeApplication: vi.fn().mockResolvedValue({
          authorized: true,
          jobPostingId: "job-1",
        }),
      } as never,
      undefined,
      stageService as never,
    );

    await expect(
      service.execute({
        userId: "recruiter-1",
        sessionId: "session-1",
        jobId: "job-1",
        applicationId: "application-1",
        kind: "cv",
        preview: true,
      }),
    ).resolves.toMatchObject({ document: { applicationId: "application-1" } });

    expect(stageService.transition).toHaveBeenCalledOnce();
  });
});
