import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Writable } from "node:stream";

import { cvConfiguration } from "@/backend/cv/config";
import {
  createCvWorkerCryptor,
  createCvWorkerStorage,
} from "@/backend/cv/workers/cv-worker-resources";
import { prisma } from "@/backend/database/prisma";

const fixtureBytes = Buffer.from(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  "utf8",
);

/**
 * Seeds an application-eligible CV through the same encrypted artifact
 * envelope used by production readers. The scan row is explicitly fixture
 * CLEAN evidence; it is not a raw CandidateCv shortcut.
 */
export async function seedCleanJobApplicationCv(input: {
  candidateUserId: string;
  profileId?: string;
  now: Date;
  label: string;
  purpose?: "PROFILE_IMPORT" | "JOB_APPLICATION_DIRECT";
  processingMode?: "IMPORT_AND_PARSE" | "SCAN_ONLY";
}) {
  const purpose = input.purpose ?? "JOB_APPLICATION_DIRECT";
  const processingMode =
    input.processingMode ??
    (purpose === "PROFILE_IMPORT" ? "IMPORT_AND_PARSE" : "SCAN_ONLY");
  const uploadStatus =
    purpose === "PROFILE_IMPORT" ? "CONFIRMED" : "SECURITY_CLEAN";
  // These IDs cross a public API projection capped at 80 characters. Keep the
  // caller label for test diagnostics without allowing long E2E suffixes to
  // make the persisted upload ID invalid.
  const labelFragment =
    input.label.replace(/[^A-Za-z0-9_-]/gu, "-").slice(0, 16) || "fixture";
  const fixtureToken = `${labelFragment}-${randomUUID()}`;
  const uploadId = `job-cv-upload-${fixtureToken}`;
  const artifactId = `job-cv-artifact-${fixtureToken}`;
  const assessmentId = `job-cv-assessment-${fixtureToken}`;
  const candidateCvId =
    purpose === "PROFILE_IMPORT"
      ? `candidate-cv-${uploadId}`
      : `job-cv-${fixtureToken}`;
  const storage = createCvWorkerStorage();
  await storage.assertReady();
  const cryptor = createCvWorkerCryptor();
  const profileId =
    input.profileId ??
    (
      await prisma.candidateProfile.findUnique({
        where: { candidateUserId: input.candidateUserId },
        select: { id: true },
      })
    )?.id;
  if (!profileId) throw new Error("JOB_CV_FIXTURE_PROFILE_NOT_FOUND");
  const ciphertextChunks: Buffer[] = [];
  const ciphertext = new Writable({
    write(chunk, _encoding, callback) {
      ciphertextChunks.push(Buffer.from(chunk));
      callback();
    },
  });
  const storageLocator = `job-application-cv-${randomUUID()}`;
  let stored: Awaited<ReturnType<typeof storage.put>> | undefined;
  try {
    const envelope = await cryptor.encrypt({
      plaintext: (async function* () {
        yield fixtureBytes;
      })(),
      ciphertext,
      context: {
        accountId: input.candidateUserId,
        uploadId,
        artifactId,
        kind: "SOURCE_DOCUMENT",
      },
    });
    ciphertext.end();
    const encrypted = Buffer.concat(ciphertextChunks);
    if (encrypted.byteLength !== envelope.ciphertextBytes) {
      throw new Error("JOB_CV_FIXTURE_CIPHERTEXT_LENGTH_MISMATCH");
    }
    const storedItem = await storage.put({
      source: (async function* () {
        yield encrypted;
      })(),
      expectedBytes: envelope.ciphertextBytes,
      locator: storageLocator,
    });
    stored = storedItem;
    const checksum = createHash("sha256").update(fixtureBytes).digest();
    await prisma.$transaction(async (tx) => {
      await tx.cvAccountQuota.upsert({
        where: { accountId: input.candidateUserId },
        update: { retainedBytes: { increment: fixtureBytes.byteLength } },
        create: {
          accountId: input.candidateUserId,
          reservedBytes: 0,
          retainedBytes: fixtureBytes.byteLength,
        },
      });
      await tx.cvUpload.create({
        data: {
          id: uploadId,
          accountId: input.candidateUserId,
          profileId,
          purpose,
          processingMode,
          policyVersion: "unified-cv-v1",
          documentKind: "PDF",
          parserClass: "DETERMINISTIC_INTERNAL",
          status: uploadStatus,
          declaredMediaType: "application/pdf",
          declaredBytes: fixtureBytes.byteLength,
          actualBytes: fixtureBytes.byteLength,
          quotaReservationBytes: fixtureBytes.byteLength + 524288,
          quotaReservationRemaining: 0,
          sourceSha256: Uint8Array.from(checksum),
          idempotencyDigest: Uint8Array.from(randomBytes(32)),
          createBindingDigest: Uint8Array.from(randomBytes(32)),
          contentReceivedAt: input.now,
          confirmedAt: purpose === "PROFILE_IMPORT" ? input.now : undefined,
          expiresAt: new Date(input.now.getTime() + 30 * 24 * 60 * 60_000),
          createdAt: input.now,
          updatedAt: input.now,
        },
        select: { id: true },
      });
      await tx.cvStoredArtifact.create({
        data: {
          id: artifactId,
          uploadId,
          accountId: input.candidateUserId,
          kind: "SOURCE_DOCUMENT",
          status: "AVAILABLE",
          storageAdapter: cvConfiguration.storage.adapter,
          storageLocator: storedItem.locator,
          encryptionKeyVersion: envelope.keyVersion,
          encryptionIv: Uint8Array.from(envelope.iv),
          authenticationTag: Uint8Array.from(envelope.authenticationTag),
          plaintextBytes: envelope.plaintextBytes,
          ciphertextBytes: envelope.ciphertextBytes,
          plaintextSha256: Uint8Array.from(checksum),
          availableAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
        select: { id: true },
      });
      await tx.cvScanAssessment.create({
        data: {
          id: assessmentId,
          uploadId,
          sourceArtifactId: artifactId,
          accountId: input.candidateUserId,
          attemptNumber: 1,
          policyVersion: "unified-cv-v1",
          status: "CLEAN",
          engineName: "clamav",
          engineVersion: "1.4.5",
          signatureVersion: "fixture-signatures",
          signaturePublishedAt: input.now,
          startedAt: input.now,
          completedAt: input.now,
          createdAt: input.now,
        },
      });
      await tx.candidateCv.create({
        data: {
          id: candidateCvId,
          candidateUserId: input.candidateUserId,
          displayName: "Secure fixture CV",
          fileName: "secure-fixture.pdf",
          mimeType: "application/pdf",
          byteSize: fixtureBytes.byteLength,
          storageKey: storedItem.locator,
          checksumSha256: checksum.toString("hex"),
          sourceArtifactId: artifactId,
          scanAssessmentId: assessmentId,
          version: 1,
          confirmedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
    });
    return Object.freeze({
      candidateCvId,
      uploadId,
      artifactId,
      assessmentId,
      storageLocator: String(storedItem.locator),
      checksumSha256: checksum.toString("hex"),
      byteSize: fixtureBytes.byteLength,
    });
  } catch (error) {
    ciphertext.destroy(error instanceof Error ? error : new Error("fixture"));
    const storedLocator = stored?.locator;
    if (storedLocator)
      await storage.delete(storedLocator).catch(() => undefined);
    throw error;
  } finally {
    cryptor.destroy();
  }
}
