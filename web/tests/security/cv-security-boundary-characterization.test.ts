/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/backend/services/company-members/team-application-authorization", () => ({
  requireTeamApplicationOwner: vi.fn().mockResolvedValue(undefined),
  TeamApplicationAuthorizationError: class extends Error {},
}));

vi.mock("@/backend/security/account-request-boundary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/backend/security/account-request-boundary")>();
  return {
    ...actual,
    requireAccountRequest: vi.fn().mockResolvedValue({
      userId: "candidate-user-123",
      sessionId: "session-123",
    }),
  };
});

import { prepareTeamApplicationCv, openTeamApplicationCv } from "@/backend/services/company-members/team-application-cv-service";
import { validateCvUploadContent } from "@/backend/cv/preflight-cv-upload";
import { OpenApplicationDocumentService } from "@/backend/applications/services/open-application-document";
import { IsolatedDocumentExtractor } from "@/backend/cv/extraction/document-extractor";
import { POST as teamApplicationsPost } from "@/app/api/candidate/team-applications/route";
import { POST as candidateCvsPost } from "@/app/api/account/candidate-cvs/route";
import { prisma } from "@/backend/database/prisma";

const EICAR_TEST_MARKER = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

function createPdfWithEicar(): Uint8Array {
  const header = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nstream\n";
  const trailer = "\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(header);
  const eicarBytes = encoder.encode(EICAR_TEST_MARKER);
  const trailerBytes = encoder.encode(trailer);
  const result = new Uint8Array(headerBytes.length + eicarBytes.length + trailerBytes.length);
  result.set(headerBytes, 0);
  result.set(eicarBytes, headerBytes.length);
  result.set(trailerBytes, headerBytes.length + eicarBytes.length);
  return result;
}

describe("Slice 0 Characterization — Direct CV Security Boundary Vulnerabilities", () => {
  it("VULN 1: PDF with valid magic bytes containing EICAR marker must NOT become downloadable Team Application CV", async () => {
    const maliciousBytes = createPdfWithEicar();
    const file = new File([Buffer.from(maliciousBytes)], "infected.pdf", { type: "application/pdf" });

    // In secure system, an unassessed/infected file MUST NOT be admitted directly as safe downloadable CV
    let preparationFailed = false;
    try {
      const prepared = await prepareTeamApplicationCv(file);
      if (prepared) {
        preparationFailed = false;
      }
    } catch {
      preparationFailed = true;
    }

    expect(preparationFailed, "Vulnerable: prepareTeamApplicationCv admitted EICAR payload without quarantine/scan").toBe(true);
  });

  it("VULN 2: openTeamApplicationCv must reject access when scan assessment is missing or not CLEAN", async () => {
    const fakeApplicationId = "non-existent-or-unscanned-app";
    vi.spyOn(prisma.teamApplication, "findUnique").mockResolvedValueOnce({
      id: fakeApplicationId,
      cvFileName: "resume.pdf",
      cvMimeType: "application/pdf",
      cvByteSize: 1024,
      cvStorageKey: "application-cv-unscanned-key",
      cvDeleteAfter: null,
      cvDeletedAt: null,
    } as any);

    await expect(
      openTeamApplicationCv("owner-user-id", fakeApplicationId),
      "Vulnerable: openTeamApplicationCv opened storage without verifying CvScanAssessment(CLEAN)",
    ).rejects.toThrow();
  });

  it("VULN 3: OpenApplicationDocumentService must reject opening document when scan assessment is not CLEAN", async () => {
    const mockRepo = {
      findDocument: vi.fn().mockResolvedValue({
        id: "doc-1",
        jobId: "job-1",
        jobApplicationId: "app-1",
        kind: "cv",
        mediaType: "application/pdf",
        byteLength: 500,
        storageKey: "raw-storage-key",
        text: null,
        previewSupported: true,
        stage: "APPLIED",
        stageVersion: 1,
      }),
    };

    const mockAuth = {
      authorizeApplication: vi.fn().mockResolvedValue({
        authorized: true,
        jobPostingId: "job-1",
      }),
    };

    const mockStorage = {
      assertReady: vi.fn().mockResolvedValue(undefined),
      open: vi.fn().mockReturnValue((async function* () { yield new Uint8Array(10); })()),
      delete: vi.fn(),
      put: vi.fn(),
    };

    const service = new OpenApplicationDocumentService(
      mockRepo as any,
      mockAuth as any,
      mockStorage as any,
      { attemptStageTransition: vi.fn(), transition: vi.fn() } as any,
    );

    await expect(
      service.execute({
        userId: "recruiter-1",
        jobId: "job-1",
        applicationId: "app-1",
        kind: "cv",
        preview: false,
      }),
      "Vulnerable: OpenApplicationDocumentService returned a document without verifying scan status",
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("VULN 4: validateCvUploadContent must NOT hardcode scanStatus: 'CLEAN' or extract before scan", async () => {
    const extractSpy = vi.spyOn(IsolatedDocumentExtractor.prototype, "extract");

    const validBytes = createPdfWithEicar();
    try {
      await validateCvUploadContent({
        bytes: validBytes,
        kind: "PDF",
      });
    } catch {
      // ignore
    }

    if (extractSpy.mock.calls.length > 0) {
      const callArg = extractSpy.mock.calls[0][0];
      expect(
        callArg.scanStatus,
        "Vulnerable: validateCvUploadContent spoofed scanStatus: 'CLEAN' before malware scan",
      ).not.toBe("CLEAN");
    }
  });

  it("VULN 5: Team Application submission before scan must return 202/processing or require clean uploadId, not immediately create SUBMITTED", async () => {
    vi.spyOn(prisma.candidateProfile, "findFirst").mockResolvedValueOnce({
      id: "profile-1",
      candidateUserId: "candidate-user-123",
    } as any);
    vi.spyOn(prisma.cvUpload, "findFirst").mockResolvedValueOnce(null);
    vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (callback: any) =>
      callback({
        $queryRaw: vi.fn().mockResolvedValue([{ accountId: "candidate-user-123" }]),
        cvAccountQuota: {
          upsert: vi.fn().mockResolvedValue({}),
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            reservedBytes: 0,
            retainedBytes: 0,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        cvUpload: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockResolvedValue({ id: "upload-1" }),
        },
        cvStoredArtifact: { create: vi.fn().mockResolvedValue({ id: "artifact-1" }) },
        cvScanAssessment: { create: vi.fn().mockResolvedValue({ id: "assessment-1" }) },
      }),
    );

    const mockBytes = new TextEncoder().encode(
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
    );
    const boundary = "----NextGenBoundary";
    const encodedBody = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="companyId"\r\n\r\ncomp-1\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="role"\r\n\r\nRECRUITER\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="cv"; filename="resume.pdf"\r\nContent-Type: application/pdf\r\n\r\n${Buffer.from(mockBytes).toString("latin1")}\r\n` +
        `--${boundary}--\r\n`,
      "latin1",
    );
    const request = new Request("http://localhost/api/candidate/team-applications", {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(encodedBody.byteLength),
        "idempotency-key": "team-admission-key-0001",
      },
      body: encodedBody,
    });

    const response = await teamApplicationsPost(request);
    expect(
      response.status,
      "Vulnerable: teamApplicationsPost synchronously created application instead of 2-step admission/finalize",
    ).toBe(202);
  });

  it("VULN 6: Multipart requests must NOT parse unbounded body with request.formData() before size/part checks", async () => {
    const oversizedLength = 50 * 1024 * 1024;
    const request = new Request("http://localhost/api/account/candidate-cvs", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=----WebKitFormBoundaryX",
        "content-length": String(oversizedLength),
      },
      body: new Uint8Array(10),
    });

    const response = await candidateCvsPost(request);
    expect(
      response.status,
      "Vulnerable: candidateCvsPost did not reject oversized request before formData parsing",
    ).toBe(413);
  });
});
