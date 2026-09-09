import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CvImportServiceError,
  cvHttpErrorResponse,
} from "@/backend/services/cv-import/cv-http-errors";
import { cvApiErrorSchema } from "@/shared/contracts/cv-import/common";
import {
  cvRetryTerminalActions,
  cvRetryAcceptedSchema,
  cvRetryHeadersSchema,
  cvRetryRequestSchema,
  isCvCandidateRetryAvailable,
} from "@/shared/contracts/cv-import/retry";
import {
  CV_PROCESSING_NOTICES,
  cvImportResourceSchema,
} from "@/shared/contracts/cv-import/upload";

const openApiPath = resolve(
  process.cwd(),
  "../spec-kit/specs/004-cv-upload-parse-review/contracts/openapi.yaml",
);

function section(source: string, marker: string, nextMarker: string): string {
  const start = source.indexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(nextMarker, start + marker.length);
  expect(end, nextMarker).toBeGreaterThan(start);
  return source.slice(start, end);
}

const acceptedRetry = {
  uploadId: "upload_fixture_1234",
  status: "SCAN_QUEUED",
  scanRetriesRemaining: 1,
  parseRetriesRemaining: 2,
} as const;

describe("CV import retry HTTP contract", () => {
  it("accepts only an empty retry document and an exact purpose-bound idempotency header", () => {
    expect(cvRetryRequestSchema.parse({})).toEqual({});
    for (const forged of [
      { accountId: "account_fixture_1234" },
      { stage: "PARSE" },
      { priorAttemptId: "parse_fixture_1234" },
      { provider: "external-provider" },
      { idempotencyKey: "browser-body-key" },
    ]) {
      expect(cvRetryRequestSchema.safeParse(forged).success).toBe(false);
    }
    expect(cvRetryRequestSchema.safeParse(null).success).toBe(false);

    expect(
      cvRetryHeadersSchema.parse({
        idempotencyKey: "retry-key_123456",
      }),
    ).toEqual({ idempotencyKey: "retry-key_123456" });
    expect(
      cvRetryHeadersSchema.safeParse({ idempotencyKey: "x".repeat(15) })
        .success,
    ).toBe(false);
    expect(
      cvRetryHeadersSchema.safeParse({ idempotencyKey: "x".repeat(200) })
        .success,
    ).toBe(true);
    expect(
      cvRetryHeadersSchema.safeParse({ idempotencyKey: "x".repeat(201) })
        .success,
    ).toBe(false);
    expect(
      cvRetryHeadersSchema.safeParse({
        idempotencyKey: "retry-key_123456",
        stage: "SCAN",
      }).success,
    ).toBe(false);
  });

  it("keeps queued retry outcomes strict, bounded, and free of internal attempt details", () => {
    expect(cvRetryAcceptedSchema.parse(acceptedRetry)).toEqual(acceptedRetry);
    expect(
      cvRetryAcceptedSchema.parse({
        ...acceptedRetry,
        status: "PARSE_QUEUED",
        scanRetriesRemaining: 0,
        parseRetriesRemaining: 0,
      }),
    ).toMatchObject({ status: "PARSE_QUEUED" });
    expect(
      cvRetryAcceptedSchema.parse({
        ...acceptedRetry,
        status: "EXTRACTION_QUEUED",
        scanRetriesRemaining: 2,
        extractionRetriesRemaining: 1,
      }),
    ).toMatchObject({
      status: "EXTRACTION_QUEUED",
      extractionRetriesRemaining: 1,
    });

    for (const invalid of [
      { ...acceptedRetry, status: "PARSE_FAILED" },
      { ...acceptedRetry, status: "AWAITING_CONSENT" },
      { ...acceptedRetry, scanRetriesRemaining: -1 },
      { ...acceptedRetry, scanRetriesRemaining: 3 },
      { ...acceptedRetry, parseRetriesRemaining: 0.5 },
      { ...acceptedRetry, replayed: false },
      { ...acceptedRetry, priorAttemptId: "scan_fixture_1234" },
      { ...acceptedRetry, newAttemptId: "scan_fixture_5678" },
      { ...acceptedRetry, provider: "external-provider" },
      { ...acceptedRetry, deadLetterQueue: "cv-import-retries" },
      { ...acceptedRetry, adminRetryUrl: "/admin/retry" },
    ]) {
      expect(cvRetryAcceptedSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("offers retry only for allowlisted terminal failures with remaining capacity", () => {
    const base = {
      scanRetriesRemaining: 2,
      parseRetriesRemaining: 2,
    } as const;
    expect(
      isCvCandidateRetryAvailable({
        ...base,
        status: "SCAN_FAILED",
        failureCode: "SCANNER_DEFINITIONS_STALE",
      }),
    ).toBe(true);
    expect(
      isCvCandidateRetryAvailable({
        ...base,
        status: "PARSE_FAILED",
        failureCode: "PARSER_OUTPUT_LIMIT_EXCEEDED",
      }),
    ).toBe(true);
    expect(
      isCvCandidateRetryAvailable({
        ...base,
        status: "PARSE_FAILED",
        failureCode: "PARSER_OUTPUT_INVALID",
      }),
    ).toBe(false);
    expect(
      isCvCandidateRetryAvailable({
        ...base,
        status: "SCAN_FAILED",
        failureCode: "CV_PROCESSING_FAILED",
      }),
    ).toBe(false);
    const exhausted = {
      ...base,
      status: "PARSE_FAILED" as const,
      failureCode: "PARSER_TIMEOUT" as const,
      parseRetriesRemaining: 0,
    };
    expect(isCvCandidateRetryAvailable(exhausted)).toBe(false);
    expect(cvRetryTerminalActions(exhausted)).toEqual([
      "REPLACE_DOCUMENT",
      "MANUAL_PROFILE",
      "DELETE",
    ]);
  });

  it("keeps missing external consent fail-closed without consuming a retry", async () => {
    const awaitingConsent = cvImportResourceSchema.parse({
      uploadId: "upload_fixture_1234",
      displayFilename: "candidate.pdf",
      documentKind: "PDF",
      parserClass: "EXTERNAL_OPENAI",
      status: "AWAITING_CONSENT",
      stage: "CONSENT",
      availableActions: ["GRANT_CONSENT", "DELETE", "MANUAL_PROFILE"],
      scanRetriesRemaining: 2,
      parseRetriesRemaining: 2,
      createdAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-31T00:00:00.000Z",
      draft: null,
      processingNotice: CV_PROCESSING_NOTICES.EXTERNAL_OPENAI,
      consent: {
        required: true,
        granted: false,
        providerDisplayName: "Approved external processor",
        processingPurpose: "Create a private CV review draft",
        noticeText: CV_PROCESSING_NOTICES.EXTERNAL_OPENAI.noticeText,
        consentChallenge:
          "consent_challenge_fixture_payload_1234567890.signature_fixture_1234567890",
      },
      failure: {
        code: "CONSENT_REQUIRED",
        message: "Consent is required before external processing can begin.",
        retryable: false,
        suggestedActions: ["MANUAL_PROFILE", "DELETE"],
      },
      receipt: null,
      contentInaccessibleAt: null,
      deleteAfter: null,
      deletedAt: null,
    });
    expect(awaitingConsent.availableActions).not.toContain("RETRY");
    expect(awaitingConsent.parseRetriesRemaining).toBe(2);

    const response = cvHttpErrorResponse(
      new CvImportServiceError("CONSENT_REQUIRED"),
      "request_fixture_1234",
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toMatch(/^no-store/u);
    expect(cvApiErrorSchema.safeParse(await response.json()).success).toBe(
      true,
    );
  });

  it("maps replay conflicts, state conflicts, and exhausted caps to safe responses", async () => {
    const cases = [
      ["IDEMPOTENCY_KEY_REUSED", 409, null],
      ["IMPORT_STATE_CONFLICT", 409, null],
      ["RETRY_LIMIT_REACHED", 429, "37"],
    ] as const;
    for (const [code, status, retryAfter] of cases) {
      const response = cvHttpErrorResponse(
        new CvImportServiceError(code, {
          retryAfterSeconds: retryAfter ? Number(retryAfter) : undefined,
        }),
        "request_fixture_1234",
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toMatch(/^no-store/u);
      expect(response.headers.get("retry-after")).toBe(retryAfter);
      const body = await response.json();
      expect(cvApiErrorSchema.safeParse(body).success).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(
        /admin|dead.?letter|provider|model|storage|attemptId|database/iu,
      );
    }
  });

  it("does not serialize raw provider, administrator, or dead-letter details", async () => {
    const response = cvHttpErrorResponse(
      new Error(
        "OpenAI provider response entered cv-admin-dead-letter with storage locator secret",
      ),
      "request_fixture_1234",
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(
      /openai|provider response|admin|dead.?letter|storage locator|secret/iu,
    );
  });

  it("keeps OpenAPI replay/new outcomes, no-store, conflicts, and retry metadata aligned", async () => {
    const openapi = await readFile(openApiPath, "utf8");
    const retryOperation = section(
      openapi,
      "  /api/account/cv-imports/{uploadId}/retries:",
      "  /api/account/cv-drafts/{draftId}:",
    );
    const retryOutcome = section(
      openapi,
      "    CvRetryAccepted:",
      "    SafeFailure:",
    );
    const idempotencyParameter = section(
      openapi,
      "    IdempotencyKey:",
      "    ContentLength:",
    );
    const capResponse = section(
      openapi,
      "    QuotaOrRateLimited:",
      "    ProcessingUnavailable:",
    );

    expect(retryOperation).toContain("operationId: retryOwnCvImport");
    expect(retryOperation).toContain("sessionCookie: []");
    expect(retryOperation).toContain("csrfToken: []");
    expect(retryOperation).toContain(
      '$ref: "#/components/parameters/IdempotencyKey"',
    );
    expect(retryOperation).toMatch(
      /requestBody:\s+required: false[\s\S]*additionalProperties: false[\s\S]*maxProperties: 0/u,
    );
    expect(retryOperation).toMatch(/"200":\s+description: Idempotent replay/u);
    expect(retryOperation).toMatch(
      /"202":\s+description: A new durable retry/u,
    );
    expect(retryOperation).not.toMatch(/awaiting consent/iu);
    for (const status of ["401", "403", "404", "409", "429"]) {
      expect(retryOperation).toContain(`"${status}":`);
    }
    expect(retryOperation.match(/NoStoreHeader/gu)).toHaveLength(2);

    expect(idempotencyParameter).toContain("required: true");
    expect(idempotencyParameter).toContain("server-side HMAC");
    expect(idempotencyParameter).toContain("minLength: 16");
    expect(idempotencyParameter).toContain("maxLength: 200");
    expect(retryOutcome).toContain("additionalProperties: false");
    expect(retryOutcome).toContain(
      "enum: [SCAN_QUEUED, EXTRACTION_QUEUED, PARSE_QUEUED]",
    );
    expect(retryOutcome).toContain("minimum: 0");
    expect(retryOutcome.match(/maximum: 2/gu)).toHaveLength(3);
    expect(capResponse).toContain("Retry-After:");
    expect(capResponse).toContain("minimum: 1");

    expect(`${retryOperation}\n${retryOutcome}`).not.toMatch(
      /admin|dead.?letter|provider(?:Request|Response|Payload|Detail)|storageLocator|rawError/iu,
    );
  });

  it("requires the live retry route to preserve exact idempotent HTTP semantics", async () => {
    const route = await readFile(
      resolve(
        process.cwd(),
        "src/app/api/account/cv-imports/[uploadId]/retries/route.ts",
      ),
      "utf8",
    );
    const handler = await readFile(
      resolve(
        process.cwd(),
        "src/app/api/account/cv-imports/[uploadId]/retries/handler.ts",
      ),
      "utf8",
    );
    const source = `${route}\n${handler}`;
    expect(route).toMatch(/^export async function POST\(/mu);
    expect(route.match(/^export /gmu)).toHaveLength(1);
    expect(source).toContain("CvAccountRequestBoundary");
    expect(source).toContain("mutation: true");
    expect(source).toContain('request.headers.get("idempotency-key")');
    expect(source).toContain("cvRetryHeadersSchema");
    expect(source).toContain("cvRetryRequestSchema");
    expect(source).toContain("cvRetryAcceptedSchema");
    expect(source).toMatch(/replayed\s*\?\s*200\s*:\s*202/u);
    expect(source).not.toMatch(
      /@\/backend\/database\/prisma|storageLocator|providerResponse|deadLetter|admin/iu,
    );
  });
});
