import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  executeForCandidate: vi.fn(),
}));

vi.mock("@/backend/auth/session/require-session", () => ({
  requireSession: mocks.requireSession,
}));
vi.mock("@/backend/applications/services/open-application-document", () => ({
  OpenApplicationDocumentError: class OpenApplicationDocumentError extends Error {
    constructor(readonly code: "UNAVAILABLE" | "PREVIEW_UNAVAILABLE") {
      super(code);
    }
  },
  OpenApplicationDocumentService: class {
    executeForCandidate = mocks.executeForCandidate;
  },
}));

import { GET } from "@/app/api/candidate/applications/[applicationId]/documents/[kind]/route";

const session = { userId: "candidate-1", sessionId: "session-1" };

function request(path = "cv") {
  return new Request(
    `https://nextgen.test/api/candidate/applications/application-1/documents/${path}`,
  );
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    document: {
      kind: "cv",
      fileName: "submitted.pdf",
      mediaType: "application/pdf",
      byteLength: 3,
      text: null,
      previewSupported: true,
      ...overrides,
    },
    stream: (async function* () {
      yield new Uint8Array([1, 2, 3]);
    })(),
  };
}

describe("Candidate application document route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue(session);
  });

  it("returns the same content-free 404 for unauthenticated, invalid, and unavailable requests", async () => {
    mocks.requireSession.mockResolvedValue(null);
    const unauthenticated = await GET(request(), {
      params: Promise.resolve({ applicationId: "application-1", kind: "cv" }),
    });

    mocks.requireSession.mockResolvedValue(session);
    mocks.executeForCandidate.mockResolvedValue(null);
    const unavailable = await GET(request(), {
      params: Promise.resolve({ applicationId: "foreign", kind: "cv" }),
    });
    const invalid = await GET(request("other"), {
      params: Promise.resolve({
        applicationId: "application-1",
        kind: "other",
      }),
    });

    expect(unauthenticated.status).toBe(404);
    expect(unavailable.status).toBe(404);
    expect(invalid.status).toBe(404);
    expect((await unauthenticated.arrayBuffer()).byteLength).toBe(0);
    expect((await unavailable.arrayBuffer()).byteLength).toBe(0);
    expect((await invalid.arrayBuffer()).byteLength).toBe(0);
    expect(unavailable.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.executeForCandidate).toHaveBeenCalledWith({
      candidateUserId: "candidate-1",
      applicationId: "foreign",
      kind: "cv",
      preview: true,
    });
  });

  it("streams an authorized document and switches to attachment only for download", async () => {
    mocks.executeForCandidate.mockResolvedValue(result());
    const inline = await GET(request(), {
      params: Promise.resolve({ applicationId: "application-1", kind: "cv" }),
    });
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-disposition")).toBe(
      'inline; filename="submitted.pdf"',
    );
    expect(new Uint8Array(await inline.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    const download = await GET(new Request(`${request().url}?download=1`), {
      params: Promise.resolve({ applicationId: "application-1", kind: "cv" }),
    });
    expect(download.headers.get("content-disposition")).toBe(
      'attachment; filename="submitted.pdf"',
    );
  });

  it("returns text cover letters without exposing storage metadata", async () => {
    mocks.executeForCandidate.mockResolvedValue(
      result({
        kind: "cover-letter",
        fileName: null,
        mediaType: "text/plain",
        byteLength: 17,
        text: "Submitted letter",
      }),
    );
    const response = await GET(request("cover-letter"), {
      params: Promise.resolve({
        applicationId: "application-1",
        kind: "cover-letter",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Submitted letter");
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="cover-letter.pdf"',
    );
  });
});
