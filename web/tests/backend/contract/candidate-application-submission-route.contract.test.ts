import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateApplicationError } from "@/backend/candidate-applications/candidate-application-errors";
import { AccountRequestError } from "@/backend/security/account-request-boundary";

const mocks = vi.hoisted(() => ({
  requireJobActor: vi.fn(),
  trackingGet: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("@/backend/security/job-request-boundary", async () => {
  const actual = await vi.importActual<
    typeof import("@/backend/security/job-request-boundary")
  >("@/backend/security/job-request-boundary");
  return { ...actual, requireJobActor: mocks.requireJobActor };
});

vi.mock(
  "@/backend/candidate-applications/candidate-application-tracking-service",
  () => ({
    CandidateApplicationTrackingService: class {
      get = mocks.trackingGet;
    },
  }),
);

vi.mock(
  "@/backend/candidate-applications/candidate-application-submission-service",
  () => ({
    CandidateApplicationSubmissionService: class {
      submit = mocks.submit;
    },
  }),
);

import { GET as getApplication } from "@/app/api/candidate/applications/[applicationId]/route";
import { POST as submitApplication } from "@/app/api/candidate/applications/route";

const actor = {
  kind: "user" as const,
  userId: "candidate-1",
  sessionId: "session-1",
};
const command = {
  draftId: "draft-1",
  expectedRevision: 1,
  informationConfirmed: true as const,
  shareContactWithRecruiter: true,
};
const receipt = {
  applicationId: "application-1",
  submittedAt: "2026-09-09T12:00:00.000Z",
  publicStage: "APPLICATION_SUBMITTED" as const,
  intake: {
    state: "RECEIVED" as const,
    progressPercent: 0,
    steps: [
      {
        code: "APPLICATION_RECEIVED" as const,
        status: "COMPLETE" as const,
        timestamp: "2026-09-09T12:00:00.000Z",
      },
      {
        code: "CHECKING_FILES" as const,
        status: "PENDING" as const,
        timestamp: null,
      },
      {
        code: "SENT_TO_RECRUITER" as const,
        status: "PENDING" as const,
        timestamp: null,
      },
    ],
    failureCode: null,
    updatedAt: "2026-09-09T12:00:00.000Z",
  },
  files: [],
};

describe("Candidate application submission and receipt routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireJobActor.mockResolvedValue(actor);
  });

  it("returns the owned receipt through the durable application URL", async () => {
    mocks.trackingGet.mockResolvedValue(receipt);
    const response = await getApplication(
      new Request(
        "https://nextgen.test/api/candidate/applications/application-1",
      ),
      { params: Promise.resolve({ applicationId: "application-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(receipt);
    expect(mocks.trackingGet).toHaveBeenCalledWith(actor, "application-1");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("keeps foreign and missing receipt responses content-free", async () => {
    mocks.trackingGet.mockRejectedValue(
      new CandidateApplicationError(
        404,
        "APPLICATION_UNAVAILABLE",
        "This application is unavailable.",
      ),
    );
    const response = await getApplication(
      new Request("https://nextgen.test/api/candidate/applications/foreign"),
      { params: Promise.resolve({ applicationId: "foreign" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      code: "APPLICATION_UNAVAILABLE",
      message: "This application is unavailable.",
    });
    expect(JSON.stringify(body)).not.toMatch(
      /candidate-1|foreign|storage|idempotency|command|owner/iu,
    );
  });

  it("honors unauthenticated or wrong-role denial before reading the receipt", async () => {
    mocks.requireJobActor.mockRejectedValue(
      new AccountRequestError(401, {
        code: "AUTHENTICATION_REQUIRED",
        message: "Sign in to continue.",
      }),
    );
    const response = await getApplication(
      new Request(
        "https://nextgen.test/api/candidate/applications/application-1",
      ),
      { params: Promise.resolve({ applicationId: "application-1" }) },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(mocks.trackingGet).not.toHaveBeenCalled();

    mocks.requireJobActor.mockRejectedValue(
      new AccountRequestError(403, {
        code: "REQUEST_FORBIDDEN",
        message: "Refresh the page and try again.",
      }),
    );
    const forbidden = await getApplication(
      new Request(
        "https://nextgen.test/api/candidate/applications/application-1",
      ),
      { params: Promise.resolve({ applicationId: "application-1" }) },
    );
    expect(forbidden.status).toBe(403);
    expect(mocks.trackingGet).not.toHaveBeenCalled();
  });

  it("returns the canonical receipt on a successful submit and a safe 409 on key reuse", async () => {
    mocks.submit.mockResolvedValue(receipt);
    const makeRequest = () =>
      new Request("https://nextgen.test/api/candidate/applications", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "application-key-00000001",
        },
        body: JSON.stringify(command),
      });
    const request = makeRequest();
    const response = await submitApplication(request);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(receipt);
    expect(mocks.submit).toHaveBeenCalledWith(
      actor,
      "application-key-00000001",
      command,
    );

    mocks.submit.mockRejectedValue(
      new CandidateApplicationError(
        409,
        "APPLICATION_IDEMPOTENCY_KEY_REUSED",
        "This submission key belongs to a different application request. Refresh the review page and try again.",
      ),
    );
    const conflict = await submitApplication(makeRequest());
    const body = await conflict.json();
    expect(conflict.status).toBe(409);
    expect(body.code).toBe("APPLICATION_IDEMPOTENCY_KEY_REUSED");
    expect(JSON.stringify(body)).not.toMatch(
      /draft-1|candidate-1|foreign|storage|command/iu,
    );
  });
});
