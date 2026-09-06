import "server-only";

import { prisma } from "@/backend/database/prisma";
import type { ApplicationDocumentStoragePort } from "@/backend/applications/storage/application-document-storage";
import {
  createCvWorkerCryptor,
  createCvWorkerIntegrityReader,
  createCvWorkerStorage,
} from "@/backend/cv/workers/cv-worker-resources";

type CandidateCvSource = Readonly<{
  id: string;
  candidateUserId: string;
  byteSize: number;
  checksumSha256: string;
}>;

type Promotion = Readonly<{
  stored: Awaited<ReturnType<ApplicationDocumentStoragePort["put"]>>;
  destination: ApplicationDocumentStoragePort;
}>;

/**
 * Promotes a confirmed profile CV into application-purpose storage. The
 * profile projection owns the import-artifact boundary; application writes
 * receive only the resulting durable locator and digest.
 */
export async function promoteCandidateCvForApplication(
  sourceCv: CandidateCvSource,
  destination: ApplicationDocumentStoragePort,
  db: typeof prisma = prisma,
  options: Readonly<{ locator?: string }> = {},
): Promise<Promotion | null> {
  const copyFromExistingApplication = async () => {
    const peer = await db.applicationDocument.findFirst({
      where: {
        sourceCandidateCvId: sourceCv.id,
        contentDigestHmac: sourceCv.checksumSha256,
        byteLength: sourceCv.byteSize,
        committedAt: { not: null },
        deletedAt: null,
        application: { candidateUserId: sourceCv.candidateUserId },
      },
      orderBy: { createdAt: "desc" },
      select: { storageKeyEncrypted: true, byteLength: true },
    });
    if (!peer) return null;
    const sourceStorage = destination;
    await sourceStorage.assertReady();
    await destination.assertReady();
    try {
      const stored = await destination.put({
        expectedBytes: peer.byteLength,
        ...(options.locator ? { locator: options.locator } : {}),
        source: sourceStorage.open(peer.storageKeyEncrypted, peer.byteLength),
      });
      return { stored, destination };
    } catch {
      return null;
    }
  };

  const uploadId = sourceCv.id.startsWith("candidate-cv-")
    ? sourceCv.id.slice("candidate-cv-".length)
    : null;
  if (!uploadId) return copyFromExistingApplication();

  const rows = await db.$queryRaw<
    Array<{
      id: string;
      storageLocator: string;
      encryptionKeyVersion: number;
      encryptionIvHex: string;
      authenticationTagHex: string;
      plaintextBytes: number;
      ciphertextBytes: number;
      plaintextSha256Hex: string;
    }>
  >`
    SELECT artifact."id",
           artifact."storageLocator",
           artifact."encryptionKeyVersion",
           encode(artifact."encryptionIv", 'hex') AS "encryptionIvHex",
           encode(artifact."authenticationTag", 'hex') AS "authenticationTagHex",
           artifact."plaintextBytes",
           artifact."ciphertextBytes",
           encode(artifact."plaintextSha256", 'hex') AS "plaintextSha256Hex"
      FROM "CvStoredArtifact" artifact
     WHERE artifact."uploadId" = ${uploadId}
       AND artifact."accountId" = ${sourceCv.candidateUserId}
       AND artifact."kind" = 'SOURCE_DOCUMENT'
       AND artifact."status" = 'AVAILABLE'
       AND artifact."deletedAt" IS NULL
     ORDER BY artifact."availableAt" DESC NULLS LAST, artifact."createdAt" DESC
     LIMIT 1
  `;
  const artifact = rows[0];
  if (
    !artifact ||
    artifact.plaintextBytes !== sourceCv.byteSize ||
    artifact.plaintextSha256Hex !== sourceCv.checksumSha256
  ) {
    return copyFromExistingApplication();
  }

  const sourceStorage = createCvWorkerStorage();
  await sourceStorage.assertReady();
  const verified = await createCvWorkerIntegrityReader(
    sourceStorage,
    createCvWorkerCryptor(),
  ).verify({
    locator: artifact.storageLocator,
    ciphertextBytes: artifact.ciphertextBytes,
    plaintextBytes: artifact.plaintextBytes,
    plaintextSha256: Buffer.from(artifact.plaintextSha256Hex, "hex"),
    context: {
      accountId: sourceCv.candidateUserId,
      uploadId,
      artifactId: artifact.id,
      kind: "SOURCE_DOCUMENT",
    },
    envelope: {
      keyVersion: artifact.encryptionKeyVersion,
      iv: Buffer.from(artifact.encryptionIvHex, "hex"),
      authenticationTag: Buffer.from(artifact.authenticationTagHex, "hex"),
    },
  });
  try {
    await destination.assertReady();
    const stored = await destination.put({
      expectedBytes: verified.plaintextBytes,
      ...(options.locator ? { locator: options.locator } : {}),
      source: verified.open(),
    });
    return { stored, destination };
  } finally {
    await verified.dispose();
  }
}
