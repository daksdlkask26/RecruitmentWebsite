import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock(
  "@/backend/security/account-request-boundary",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/backend/security/account-request-boundary")
      >();
    return {
      ...actual,
      requireAccountRequest: vi.fn().mockResolvedValue({
        userId: "candidate-123",
        sessionId: "session-123",
      }),
    };
  },
);

vi.mock("@/backend/services/cv-admission/cv-admission-service", async () => {
  return {
    CvAdmissionService: class {
      admit = vi.fn().mockResolvedValue({
        uploadId: "test-upload-id-999",
        status: "SCAN_QUEUED",
        replayed: false,
        sha256: "fake-sha256-hex",
        retryAfterSeconds: 2,
      });
    },
    CvAdmissionError: class extends Error {
      readonly code = "ERROR";
    },
  };
});

import { POST } from "@/app/api/account/cv-admissions/route";

describe("POST /api/account/cv-admissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects request without Content-Length header before parsing body", async () => {
    const request = new Request("http://localhost/api/account/cv-admissions", {
      method: "POST",
      headers: {
        "x-cv-purpose": "PROFILE_DIRECT",
        "idempotency-key": "idempotency-key-0001",
      },
      body: new Uint8Array(10),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects oversized request with 413 before reading body", async () => {
    const request = new Request("http://localhost/api/account/cv-admissions", {
      method: "POST",
      headers: {
        "content-length": String(10 * 1024 * 1024),
        "x-cv-purpose": "PROFILE_DIRECT",
        "idempotency-key": "idempotency-key-0002",
      },
      body: new Uint8Array(10),
    });

    const response = await POST(request);
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("returns 202 Accepted on valid admission request", async () => {
    const pdfBytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\n%%EOF");
    const request = new Request("http://localhost/api/account/cv-admissions", {
      method: "POST",
      headers: {
        "content-length": String(pdfBytes.byteLength),
        "content-type": "application/pdf",
        "x-cv-purpose": "TEAM_APPLICATION_DIRECT",
        "x-cv-filename": "my-resume.pdf",
        "idempotency-key": "idempotency-key-0003",
      },
      body: pdfBytes,
    });

    const response = await POST(request);
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.uploadId).toBe("test-upload-id-999");
    expect(body.status).toBe("SCAN_QUEUED");
    expect(body.retryAfterSeconds).toBe(2);
  });
});
