import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCvSecurityUploadId,
  pollCvSecurityUpload,
  readCvSecurityUploadId,
  requestCvSecurityRetry,
  saveCvSecurityUploadId,
} from "@/frontend/lib/cv-security-upload";

function statusResponse(status: string, headers?: HeadersInit) {
  return new Response(JSON.stringify({ status }), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("CV security upload client boundary", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists only an opaque upload id and removes expired entries", () => {
    saveCvSecurityUploadId("job-1", "upload-1", { ttlMs: 10_000 });
    expect(readCvSecurityUploadId("job-1")).toBe("upload-1");
    clearCvSecurityUploadId("job-1");
    expect(readCvSecurityUploadId("job-1")).toBeNull();

    saveCvSecurityUploadId("job-1", "upload-expired", { ttlMs: -1 });
    expect(readCvSecurityUploadId("job-1")).toBeNull();
  });

  it("polls boundedly until SECURITY_CLEAN and honors Retry-After", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(statusResponse("SCAN_QUEUED", { "Retry-After": "2" }))
      .mockResolvedValueOnce(statusResponse("SECURITY_CLEAN"));
    const sleeps: number[] = [];

    const result = await pollCvSecurityUpload("upload-1", {
      fetcher,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    expect(result).toMatchObject({
      uploadId: "upload-1",
      status: "SECURITY_CLEAN",
      clean: true,
      attempts: 2,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([0, 2_000]);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
    });
  });

  it("returns terminal infected without treating it as clean", async () => {
    const result = await pollCvSecurityUpload("upload-infected", {
      fetcher: vi.fn().mockResolvedValue(statusResponse("INFECTED")),
      sleep: async () => undefined,
    });

    expect(result.clean).toBe(false);
    expect(result.status).toBe("INFECTED");
  });

  it("stops polling on abort instead of creating another request", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();

    await expect(
      pollCvSecurityUpload("upload-aborted", {
        signal: controller.signal,
        fetcher,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed and bounds a status timeout", async () => {
    await expect(
      pollCvSecurityUpload("upload-timeout", {
        maxPolls: 2,
        fetcher: vi
          .fn()
          .mockImplementation(() => Promise.resolve(statusResponse("SCANNING"))),
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({
      code: "CV_STATUS_TIMEOUT",
      retryable: true,
    });
  });

  it("sends retry with a fresh idempotency key through the mutation boundary", async () => {
    const mutate = vi.fn().mockResolvedValue(statusResponse("SCAN_QUEUED"));

    await requestCvSecurityRetry("upload-retry", "retry-key-1", mutate);

    expect(mutate).toHaveBeenCalledWith(
      "/api/account/cv-imports/upload-retry/retries",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Idempotency-Key": "retry-key-1",
        }),
      }),
    );
  });
});
