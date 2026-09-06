import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createCvWorkerStorage } from "@/backend/cv/workers/cv-worker-resources";
import {
  CV_MAX_FILE_BYTES,
  validateCvFileBytes,
} from "@/shared/cv-file-validation";
import type { DirectApplicationCv } from "./application-policy";

export type DirectApplicationCvSource = Readonly<{
  fileName: string;
  mimeType: string;
  byteSize: number;
  source: AsyncIterable<Uint8Array>;
}>;

export type PreparedDirectApplicationCv = DirectApplicationCv & {
  /**
   * Moves the temporary upload across the database commit boundary. Once
   * claimed, request cleanup is deliberately a no-op; retention owns the
   * artifact from that point onward.
   */
  claimOwnership(): void;
  /** Keep the object when the database outcome cannot be proven. */
  preserveOnUnknown(): void;
  /** Complete a deferred object write after its ownership ledger is staged. */
  ensureStored?(): Promise<void>;
  cleanup(): Promise<void>;
};

export type PrepareDirectApplicationCvOptions = Readonly<{
  /** Reserve the deterministic locator but defer the object write. */
  deferStorage?: boolean;
}>;

function safeFileName(value: string) {
  const normalized = value
    .replace(/[\\/]/gu, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .slice(0, 255);
  return normalized || "uploaded-cv";
}

export async function prepareDirectApplicationCv(
  input: DirectApplicationCvSource,
  options: PrepareDirectApplicationCvOptions = {},
): Promise<PreparedDirectApplicationCv> {
  if (
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize < 1 ||
    input.byteSize > CV_MAX_FILE_BYTES
  ) {
    throw new Error("APPLICATION_CV_INELIGIBLE");
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  for await (const chunk of input.source) {
    const copy = Uint8Array.from(chunk);
    received += copy.byteLength;
    if (received > input.byteSize || received > CV_MAX_FILE_BYTES)
      throw new Error("APPLICATION_CV_INELIGIBLE");
    chunks.push(copy);
  }
  if (received !== input.byteSize) throw new Error("APPLICATION_CV_INELIGIBLE");
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const detected = validateCvFileBytes({
    bytes,
    fileName: input.fileName,
    declaredMimeType: input.mimeType,
  });

  const fileName = safeFileName(input.fileName);
  const id = "application-cv-" + randomUUID();
  // A request can reserve this locator in the ownership ledger before any
  // storage write. It is unique per prepared upload and valid for both local
  // filesystem and S3 locator policies.
  const plannedStorageKey =
    "application-cv-" + createHash("sha256").update(id, "utf8").digest("hex");
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  const storage = createCvWorkerStorage();
  const deferStorage = options.deferStorage === true;
  let storageKey = plannedStorageKey;
  let stored = false;
  let storageAttempted = false;
  let storagePromise: Promise<void> | null = null;
  let ownership: "TEMPORARY" | "OWNED" | "UNKNOWN" = "TEMPORARY";
  let cleanupPromise: Promise<void> | null = null;

  const ensureStored = async () => {
    if (stored) return;
    if (!storagePromise) {
      storagePromise = (async () => {
        await storage.assertReady();
        storageAttempted = true;
        try {
          const result = await storage.put({
            expectedBytes: bytes.byteLength,
            ...(deferStorage ? { locator: plannedStorageKey } : {}),
            source: (async function* () {
              yield bytes;
            })(),
          });
          if (deferStorage && result.locator !== plannedStorageKey) {
            throw new Error("APPLICATION_STORAGE_LOCATOR_MISMATCH");
          }
          if (result.bytes !== bytes.byteLength) {
            throw new Error("APPLICATION_STORAGE_LENGTH_MISMATCH");
          }
          storageKey = result.locator;
          stored = true;
        } catch (error) {
          // A storage write can have committed before its response was lost.
          // Keep the object and the already-staged ledger row discoverable.
          if (storageAttempted) ownership = "UNKNOWN";
          throw error;
        }
      })().catch((error) => {
        storagePromise = null;
        throw error;
      });
    }
    await storagePromise;
  };

  if (!deferStorage) await ensureStored();

  const prepared = {
    id,
    displayName: fileName,
    fileName,
    mimeType: detected.mimeType,
    byteSize: detected.byteSize,
    get storageKey() {
      return storageKey;
    },
    checksumSha256,
    ensureStored,
    claimOwnership() {
      ownership = "OWNED";
    },
    preserveOnUnknown() {
      ownership = "UNKNOWN";
    },
    async cleanup() {
      if (ownership !== "TEMPORARY" || !stored) return;
      if (!cleanupPromise) {
        cleanupPromise = storage
          .delete(storageKey)
          .then(() => undefined)
          .catch((error) => {
            // A failed cleanup must remain retryable, while a successful one is
            // shared by all duplicate cleanup calls.
            cleanupPromise = null;
            throw error;
          });
      }
      await cleanupPromise;
    },
  } satisfies PreparedDirectApplicationCv;
  return Object.freeze(prepared);
}
