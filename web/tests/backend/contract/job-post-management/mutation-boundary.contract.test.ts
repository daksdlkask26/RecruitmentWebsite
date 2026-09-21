import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountRequestError } from "@/backend/security/account-request-boundary";

const mocks = vi.hoisted(() => ({
  requireJobActor: vi.fn(),
  requireSession: vi.fn(),
  createRecruiterJob: vi.fn(),
  updateRecruiterJob: vi.fn(),
  closeRecruiterJob: vi.fn(),
  deleteRecruiterJob: vi.fn(),
  readRecruiterJobManagementData: vi.fn(),
}));

vi.mock("@/backend/security/job-request-boundary", async () => {
  const actual = await vi.importActual<
    typeof import("@/backend/security/job-request-boundary")
  >("@/backend/security/job-request-boundary");
  return { ...actual, requireJobActor: mocks.requireJobActor };
});

vi.mock("@/backend/auth/session/require-session", () => ({
  requireSession: mocks.requireSession,
}));

vi.mock("@/backend/services/jobs/recruiter-job-posting-data", () => ({
  closeRecruiterJob: mocks.closeRecruiterJob,
  createRecruiterJob: mocks.createRecruiterJob,
  deleteRecruiterJob: mocks.deleteRecruiterJob,
  readRecruiterJobManagementData: mocks.readRecruiterJobManagementData,
  updateRecruiterJob: mocks.updateRecruiterJob,
}));

import {
  DELETE as deleteJobPosting,
  PATCH as updateJobPosting,
  POST as createJobPosting,
} from "@/app/api/recruiter/job-postings/route";

const actor = { userId: "recruiter-1", sessionId: "session-1" };
const origin = "http://localhost:3001";

function request(
  method: "POST" | "PATCH",
  body: string,
  headers: Record<string, string | undefined> = {},
) {
  const suppliedHeaders = Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value !== undefined),
  );
  const requestHeaders: Record<string, string> = {
    origin,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
    "x-csrf-token": "valid-proof",
    ...suppliedHeaders,
  };
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) delete requestHeaders[name];
  }
  return new Request(`${origin}/api/recruiter/job-postings`, {
    method,
    headers: requestHeaders,
    body,
  });
}

function forbidden(code: "REQUEST_FORBIDDEN" | "AUTHENTICATION_REQUIRED") {
  return new AccountRequestError(code === "REQUEST_FORBIDDEN" ? 403 : 401, {
    code,
    message:
      code === "REQUEST_FORBIDDEN"
        ? "Refresh the page and try again."
        : "Sign in to continue.",
  });
}

describe("recruiter job-posting mutation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireJobActor.mockResolvedValue(actor);
    mocks.requireSession.mockResolvedValue(actor);
    mocks.createRecruiterJob.mockResolvedValue({
      id: "job-1",
      status: "draft",
    });
    mocks.updateRecruiterJob.mockResolvedValue({
      id: "job-1",
      status: "draft",
    });
  });

  it.each([
    ["missing origin", { origin: undefined }],
    ["foreign origin", { origin: "https://attacker.example" }],
    ["missing proof", { "x-csrf-token": undefined }],
    ["wrong proof", { "x-csrf-token": "wrong-proof" }],
  ])(
    "does not parse or write when the mutation boundary rejects %s",
    async (_label, headers) => {
      mocks.requireJobActor.mockRejectedValue(forbidden("REQUEST_FORBIDDEN"));

      const response = await createJobPosting(
        request("POST", "not-json", headers),
      );

      expect(response.status).toBe(403);
      expect(mocks.createRecruiterJob).not.toHaveBeenCalled();
    },
  );

  it("rejects unauthenticated mutations before parsing the body", async () => {
    mocks.requireJobActor.mockRejectedValue(
      forbidden("AUTHENTICATION_REQUIRED"),
    );

    const response = await updateJobPosting(request("PATCH", "not-json"));

    expect(response.status).toBe(401);
    expect(mocks.updateRecruiterJob).not.toHaveBeenCalled();
  });

  it.each([
    ["missing content type", { "content-type": undefined }],
    ["simple-request content type", { "content-type": "text/plain" }],
  ])("rejects %s without calling the service", async (_label, headers) => {
    const response = await createJobPosting(
      request("POST", JSON.stringify({ status: "draft", job: {} }), headers),
    );

    expect(response.status).toBe(400);
    expect(mocks.createRecruiterJob).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON without a service write", async () => {
    const response = await createJobPosting(request("POST", "{broken"));

    expect(response.status).toBe(400);
    expect(mocks.createRecruiterJob).not.toHaveBeenCalled();
  });

  it("runs a valid create after the real route boundary and body checks", async () => {
    const job = { title: "Platform Engineer" };
    const response = await createJobPosting(
      request("POST", JSON.stringify({ status: "draft", job })),
    );

    expect(response.status).toBe(201);
    expect(mocks.createRecruiterJob).toHaveBeenCalledWith(
      actor.userId,
      job,
      "draft",
    );
  });

  it("runs a valid edit and keeps tenant authorization in the service", async () => {
    const job = { id: "job-1", companyId: "foreign-company", title: "Edited" };
    mocks.updateRecruiterJob.mockRejectedValue(
      new Error("A recruiter-owned company is required."),
    );

    const response = await updateJobPosting(
      request("PATCH", JSON.stringify({ ...job, status: "draft" })),
    );

    expect(response.status).toBe(409);
    expect(mocks.updateRecruiterJob).toHaveBeenCalledWith(actor.userId, {
      ...job,
      status: "draft",
    });
  });

  it("runs a valid delete through the mutation boundary", async () => {
    mocks.deleteRecruiterJob.mockResolvedValue({ deleted: true });

    const response = await deleteJobPosting(
      new Request(
        `${origin}/api/recruiter/job-postings?jobId=job-1&action=delete&industryCode=software`,
        {
          method: "DELETE",
          headers: {
            origin,
            "sec-fetch-site": "same-origin",
            "x-csrf-token": "valid-proof",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.deleteRecruiterJob).toHaveBeenCalledWith(
      actor.userId,
      actor.sessionId,
      "job-1",
      "software",
    );
  });
});
