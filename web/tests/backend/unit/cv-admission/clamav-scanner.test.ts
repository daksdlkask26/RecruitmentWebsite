import { describe, expect, it, vi } from "vitest";

import { ClamAvScanner } from "@/backend/cv/scanning/clamav";

const bytes = new TextEncoder().encode("synthetic cv bytes");

function scanner(options: {
  response?: string;
  publishedAt?: string;
  transport?: (
    chunks: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ) => Promise<string>;
  timeoutMs?: number;
  signatureMaximumAgeMs?: number;
}) {
  const transport =
    options.transport ??
    vi.fn(async (chunks: AsyncIterable<Uint8Array>) => {
      for await (const chunk of chunks) {
        // Drain the bounded INSTREAM source before returning a fixture reply.
        void chunk;
      }
      return options.response ?? "stream: OK\0";
    });
  return new ClamAvScanner({
    socketPath: "/run/clamav/clamd.sock",
    transport,
    timeoutMs: options.timeoutMs ?? 20,
    signatureMaximumAgeMs: options.signatureMaximumAgeMs ?? 24 * 60 * 60_000,
    now: () => new Date("2026-09-07T00:00:00.000Z"),
    readiness: async () => ({
      version: `ClamAV 1.4.5/fixture/${options.publishedAt ?? "Sun Sep 6 00:00:00 2026 GMT"}`,
    }),
  });
}

describe("ClamAV scanner fail-closed contract", () => {
  it("returns only normalized CLEAN evidence for a valid protocol response", async () => {
    const result = await scanner({}).scan((async function* () {
      yield bytes;
    })());

    expect(result).toEqual({ outcome: "CLEAN", engineVersion: "1.4.5" });
  });

  it("maps FOUND to a non-sensitive malware result", async () => {
    const result = await scanner({
      response: "stream: Eicar-Signature FOUND\0",
    }).scan((async function* () {
      yield bytes;
    })());

    expect(result).toEqual({
      outcome: "INFECTED",
      threatCode: "MALWARE_DETECTED",
    });
    expect(JSON.stringify(result)).not.toContain("Eicar");
  });

  it.each([
    ["malformed protocol", { response: "not-a-clamav-response\0" }, "CV_SCANNER_PROTOCOL_INVALID"],
    [
      "stale signatures",
      { publishedAt: "Mon Aug 1 00:00:00 2026 GMT" },
      "CV_SCANNER_DEFINITIONS_STALE",
    ],
  ])("fails closed for %s", async (_name, options, code) => {
    await expect(
      scanner(options).scan((async function* () {
        yield bytes;
      })()),
    ).rejects.toMatchObject({ code });
  });

  it("normalizes a transport failure to scanner unavailable", async () => {
    const transport = vi.fn(async () => {
      throw new Error("socket detail must not escape");
    });
    await expect(
      scanner({ transport }).scan((async function* () {
        yield bytes;
      })()),
    ).rejects.toMatchObject({ code: "CV_SCANNER_UNAVAILABLE" });
  });

  it("aborts a hanging transport at the deadline", async () => {
    const transport = vi.fn(
      async (_chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    await expect(
      scanner({ transport, timeoutMs: 5 }).scan((async function* () {
        yield bytes;
      })()),
    ).rejects.toMatchObject({ code: "CV_SCANNER_TIMEOUT" });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("rejects an INSTREAM source beyond the scanner bound", async () => {
    await expect(
      scanner({}).scan((async function* () {
        yield new Uint8Array(6 * 1024 * 1024 + 1);
      })()),
    ).rejects.toMatchObject({ code: "CV_SCANNER_STREAM_LIMIT" });
  });
});
