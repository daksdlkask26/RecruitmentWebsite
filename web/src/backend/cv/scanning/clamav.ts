import "server-only";

import { lstat } from "node:fs/promises";
import { createConnection } from "node:net";

import {
  ClamAvScannerError,
  type MalwareScanner,
  type MalwareScanResult,
} from "./malware-scanner";

type Readiness = (signal?: AbortSignal) => Promise<Readonly<{ version: string }>>;
type Transport = (
  chunks: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
) => Promise<string>;

type ClamAvOptions = Readonly<{
  socketPath: string;
  timeoutMs?: number;
  maximumBytes?: number;
  signatureMaximumAgeMs?: number;
  now?: () => Date;
  transport?: Transport;
  readiness?: Readiness;
}>;

const DEFAULT_SOCKET = "/run/clamav/clamd.sock";
const DEFAULT_MAXIMUM_BYTES = 6 * 1024 * 1024;
const FRAME_BYTES = 64 * 1024;

async function unixCommand(
  socketPath: string,
  chunks: AsyncIterable<Uint8Array>,
  signal?: AbortSignal,
) {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    const responses: Buffer[] = [];
    let settled = false;
    const onAbort = () =>
      finish(new ClamAvScannerError("CV_SCANNER_TIMEOUT"));
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      if (error) reject(error);
      else resolve(Buffer.concat(responses).toString("utf8"));
    };
    if (signal?.aborted) {
      finish(new ClamAvScannerError("CV_SCANNER_TIMEOUT"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("error", (error) => finish(error));
    socket.on("data", (chunk) => responses.push(Buffer.from(chunk)));
    socket.once("end", () => finish());
    socket.once("connect", () => {
      void (async () => {
        try {
          for await (const chunk of chunks) {
            if (signal?.aborted)
              throw new ClamAvScannerError("CV_SCANNER_TIMEOUT");
            if (!socket.write(chunk))
              await new Promise<void>((done, fail) => {
                const onDrain = () => {
                  signal?.removeEventListener("abort", onAbortDrain);
                  done();
                };
                const onAbortDrain = () => {
                  socket.removeListener("drain", onDrain);
                  fail(new ClamAvScannerError("CV_SCANNER_TIMEOUT"));
                };
                socket.once("drain", onDrain);
                signal?.addEventListener("abort", onAbortDrain, {
                  once: true,
                });
              });
          }
          if (signal?.aborted)
            throw new ClamAvScannerError("CV_SCANNER_TIMEOUT");
          socket.end();
        } catch (error) {
          finish(
            error instanceof Error ? error : new Error("clamd write failed"),
          );
        }
      })();
    });
  });
}

async function* command(value: string) {
  yield Buffer.from(value, "utf8");
}

function parseVersion(raw: string) {
  const value = raw.replaceAll("\0", "").trim();
  const match = /^ClamAV\s+([^/\s]+)\/([^/]+)\/(.+)$/u.exec(value);
  if (!match) throw new ClamAvScannerError("CV_SCANNER_PROTOCOL_INVALID");
  const publishedAt = new Date(match[3]);
  if (Number.isNaN(publishedAt.getTime()))
    throw new ClamAvScannerError("CV_SCANNER_PROTOCOL_INVALID");
  return { engineVersion: match[1], signatureVersion: match[2], publishedAt };
}

async function* instreamFrames(
  source: AsyncIterable<Uint8Array>,
  maximumBytes: number,
  signal?: AbortSignal,
) {
  if (signal?.aborted)
    throw new ClamAvScannerError("CV_SCANNER_TIMEOUT");
  yield Buffer.from("zINSTREAM\0", "utf8");
  let total = 0;
  for await (const sourceChunk of source) {
    if (signal?.aborted)
      throw new ClamAvScannerError("CV_SCANNER_TIMEOUT");
    const bytes = Buffer.from(sourceChunk);
    for (let offset = 0; offset < bytes.byteLength; offset += FRAME_BYTES) {
      if (signal?.aborted)
        throw new ClamAvScannerError("CV_SCANNER_TIMEOUT");
      const frame = bytes.subarray(
        offset,
        Math.min(offset + FRAME_BYTES, bytes.byteLength),
      );
      total += frame.byteLength;
      if (total > maximumBytes)
        throw new ClamAvScannerError("CV_SCANNER_STREAM_LIMIT");
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(frame.byteLength);
      yield length;
      yield frame;
    }
  }
  yield Buffer.alloc(4);
}

export class ClamAvScanner implements MalwareScanner {
  private timeoutMs: number;
  private readonly maximumBytes: number;
  private readonly signatureMaximumAgeMs: number;
  private readonly now: () => Date;
  private readonly transport: Transport;
  private readinessCheck: Readiness;
  private lastMetadata: ReturnType<typeof parseVersion> | null = null;

  constructor(options: ClamAvOptions) {
    if (
      !options.socketPath.startsWith("/") ||
      options.socketPath.includes("://") ||
      (options.socketPath !== DEFAULT_SOCKET && !options.transport)
    )
      throw new ClamAvScannerError("CV_SCANNER_CONFIGURATION_INVALID");
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
    this.signatureMaximumAgeMs =
      options.signatureMaximumAgeMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
    this.transport =
      options.transport ??
      ((chunks, signal) => unixCommand(options.socketPath, chunks, signal));
    this.readinessCheck =
      options.readiness ??
      (async (signal?: AbortSignal) => {
        const socket = await lstat(options.socketPath);
        if (!socket.isSocket() || (socket.mode & 0o007) !== 0)
          throw new ClamAvScannerError("CV_SCANNER_UNAVAILABLE");
        const pong = (
          await unixCommand(options.socketPath, command("zPING\0"), signal)
        )
          .replaceAll("\0", "")
          .trim();
        if (pong !== "PONG")
          throw new ClamAvScannerError("CV_SCANNER_PROTOCOL_INVALID");
        await unixCommand(
          options.socketPath,
          command("zVERSIONCOMMANDS\0"),
          signal,
        );
        return {
          version: await unixCommand(
            options.socketPath,
            command("zVERSION\0"),
            signal,
          ),
        };
      });
  }

  setReadinessForTest(readiness: Readiness) {
    this.readinessCheck = readiness;
  }

  setTimeoutForTest(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  assessmentMetadata() {
    return this.lastMetadata ? Object.freeze({ ...this.lastMetadata }) : null;
  }

  async assertReady(signal?: AbortSignal): Promise<void> {
    const readiness = parseVersion((await this.readinessCheck(signal)).version);
    const age = this.now().getTime() - readiness.publishedAt.getTime();
    if (age < 0 || age > this.signatureMaximumAgeMs)
      throw new ClamAvScannerError("CV_SCANNER_DEFINITIONS_STALE");
    this.lastMetadata = readiness;
  }

  async scan(source: AsyncIterable<Uint8Array>): Promise<MalwareScanResult> {
    if (this.timeoutMs <= 1) throw new ClamAvScannerError("CV_SCANNER_TIMEOUT");
    const controller = new AbortController();
    let handle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      handle = setTimeout(() => {
        controller.abort();
        reject(new ClamAvScannerError("CV_SCANNER_TIMEOUT"));
      }, this.timeoutMs);
      handle.unref?.();
    });
    try {
      return await Promise.race([
        this.scanWithinDeadline(source, controller.signal),
        timeout,
      ]);
    } catch (error) {
      if (error instanceof ClamAvScannerError) throw error;
      throw new ClamAvScannerError("CV_SCANNER_UNAVAILABLE");
    } finally {
      if (handle) clearTimeout(handle);
      controller.abort();
    }
  }

  private async scanWithinDeadline(
    source: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ) {
    await this.assertReady(signal);
    const readiness = this.lastMetadata;
    if (!readiness) throw new ClamAvScannerError("CV_SCANNER_PROTOCOL_INVALID");
    const raw = (
      await this.transport(instreamFrames(source, this.maximumBytes, signal), signal)
    )
      .replaceAll("\0", "")
      .trim();
    if (/:\s+OK$/u.test(raw))
      return Object.freeze({
        outcome: "CLEAN" as const,
        engineVersion: readiness.engineVersion,
      });
    if (/:\s+.+\s+FOUND$/u.test(raw))
      return Object.freeze({
        outcome: "INFECTED" as const,
        threatCode: "MALWARE_DETECTED" as const,
      });
    throw new ClamAvScannerError("CV_SCANNER_PROTOCOL_INVALID");
  }
}
