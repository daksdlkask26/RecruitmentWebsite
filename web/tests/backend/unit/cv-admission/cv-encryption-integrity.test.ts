import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";

import { createCvWorkerCryptor } from "@/backend/cv/workers/cv-worker-resources";
import { FilesystemPrivateCvStorage } from "@/backend/cv/storage/filesystem";
import { IntegrityVerifiedReader } from "@/backend/cv/encryption/integrity-verified-reader";

describe("Slice 2 — Encryption context AAD and integrity fail-closed invariants", () => {
  it("enforces AES-256-GCM envelope, verified decryption, and fail-closed AAD/tag tampering", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "smarthire-cv-encrypt-test-"));
    try {
      const storage = new FilesystemPrivateCvStorage({ root: tempDir });
      await storage.assertReady();

      const cryptor = createCvWorkerCryptor();
      const plaintextMarker = "CONFIDENTIAL_PII_TEST_MARKER_98765";
      const plaintextBytes = Buffer.from(
        `%PDF-1.7\n1 0 obj\n<<>>\nstream\n${plaintextMarker}\nendstream\nendobj\n%%EOF`,
        "utf8",
      );
      const plaintextSha256 = createHash("sha256")
        .update(plaintextBytes)
        .digest();

      const context = {
        accountId: "account-alpha",
        uploadId: "upload-beta",
        artifactId: "artifact-gamma",
        kind: "SOURCE_DOCUMENT" as const,
      };

      const ciphertextStream = new PassThrough();
      const storagePromise = storage.put({
        source: ciphertextStream,
        expectedBytes: plaintextBytes.byteLength,
      });

      const envelope = await cryptor.encrypt({
        plaintext: (async function* () {
          yield plaintextBytes;
        })(),
        ciphertext: ciphertextStream,
        context,
      });
      ciphertextStream.end();

      const storedItem = await storagePromise;

      // 1. Filesystem MUST NOT contain the plaintext marker
      const storedCiphertext = await readFile(
        join(tempDir, storedItem.locator),
      );
      expect(storedCiphertext.includes(Buffer.from(plaintextMarker))).toBe(
        false,
      );

      // 2. Decrypt with exact matching context succeeds
      const decryptedStream = new PassThrough();
      const decryptedChunks: Buffer[] = [];
      decryptedStream.on("data", (chunk: Buffer) =>
        decryptedChunks.push(chunk),
      );

      await cryptor.decrypt({
        ciphertext: storage.open(storedItem.locator, storedItem.bytes),
        plaintext: decryptedStream,
        context,
        envelope,
      });
      decryptedStream.end();

      const recovered = Buffer.concat(decryptedChunks);
      expect(recovered.toString("utf8")).toBe(plaintextBytes.toString("utf8"));

      // 3. Decrypt with wrong accountId fails closed
      await expect(
        cryptor.decrypt({
          ciphertext: storage.open(storedItem.locator, storedItem.bytes),
          plaintext: new PassThrough(),
          context: { ...context, accountId: "account-attacker" },
          envelope,
        }),
      ).rejects.toMatchObject({ code: "CV_ARTIFACT_AUTHENTICATION_FAILED" });

      // 4. Decrypt with wrong uploadId fails closed
      await expect(
        cryptor.decrypt({
          ciphertext: storage.open(storedItem.locator, storedItem.bytes),
          plaintext: new PassThrough(),
          context: { ...context, uploadId: "wrong-upload-id" },
          envelope,
        }),
      ).rejects.toMatchObject({ code: "CV_ARTIFACT_AUTHENTICATION_FAILED" });

      // 5. Decrypt with wrong artifactId fails closed
      await expect(
        cryptor.decrypt({
          ciphertext: storage.open(storedItem.locator, storedItem.bytes),
          plaintext: new PassThrough(),
          context: { ...context, artifactId: "wrong-artifact-id" },
          envelope,
        }),
      ).rejects.toMatchObject({ code: "CV_ARTIFACT_AUTHENTICATION_FAILED" });

      // 6. Decrypt with corrupted authentication tag fails closed
      const corruptedTag = Buffer.from(envelope.authenticationTag);
      corruptedTag[0] ^= 0xff;
      await expect(
        cryptor.decrypt({
          ciphertext: storage.open(storedItem.locator, storedItem.bytes),
          plaintext: new PassThrough(),
          context,
          envelope: { ...envelope, authenticationTag: corruptedTag },
        }),
      ).rejects.toMatchObject({ code: "CV_ARTIFACT_AUTHENTICATION_FAILED" });

      // 7. IntegrityVerifiedReader fails closed if expected digest does not match
      const denyMock = vi.fn().mockResolvedValue(undefined);
      const reader = new IntegrityVerifiedReader({
        storage,
        cryptor,
        denyAndScheduleDeletion: denyMock,
      });
      const wrongDigest = Buffer.from(plaintextSha256);
      wrongDigest[0] ^= 0xff;

      await expect(
        reader.verify({
          locator: storedItem.locator,
          ciphertextBytes: storedItem.bytes,
          plaintextBytes: plaintextBytes.byteLength,
          plaintextSha256: wrongDigest,
          context,
          envelope,
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILED" });
      expect(denyMock).toHaveBeenCalled();

      // 8. IntegrityVerifiedReader succeeds when digest matches
      const verified = await reader.verify({
        locator: storedItem.locator,
        ciphertextBytes: storedItem.bytes,
        plaintextBytes: plaintextBytes.byteLength,
        plaintextSha256,
        context,
        envelope,
      });

      expect(verified.plaintextBytes).toBe(plaintextBytes.byteLength);
      expect(verified.sha256).toBe(plaintextSha256.toString("hex"));
      await verified.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
