import "server-only";

import {
  CvSafetyEvidenceError,
  CvSafetyEvidenceService,
  type AssertCvArtifactSafeInput,
  type SafeCvArtifactEvidence,
} from "./cv-safety-evidence-service";
import {
  createCvWorkerCryptor,
  createCvWorkerIntegrityReader,
  createCvWorkerStorage,
  readCvWorkerArtifactBytes,
} from "@/backend/cv/workers/cv-worker-resources";
import type { IntegrityVerifiedArtifact } from "@/backend/cv/encryption/integrity-verified-reader";

export type OpenSafeCvArtifactResult = Readonly<{
  evidence: SafeCvArtifactEvidence;
  fileName: string;
  mimeType: string;
  byteLength: number;
  openStream: () => AsyncIterable<Uint8Array>;
  dispose: () => Promise<void>;
}>;

export class OpenSafeCvArtifactService {
  constructor(
    private readonly safetyEvidence: CvSafetyEvidenceService = new CvSafetyEvidenceService(),
  ) {}

  async open(
    input: AssertCvArtifactSafeInput,
  ): Promise<OpenSafeCvArtifactResult> {
    // 1. Verify immutable safety evidence
    const evidence =
      await this.safetyEvidence.assertCvArtifactSafeForUse(input);

    // 2. Read encrypted envelope metadata
    const artifactBytes = await readCvWorkerArtifactBytes({
      artifactId: evidence.artifactId,
      uploadId: evidence.uploadId,
      accountId: evidence.candidateUserId,
    });

    // 3. Prepare storage and integrity reader
    const storage = createCvWorkerStorage();
    await storage.assertReady();
    const cryptor = createCvWorkerCryptor();
    const reader = createCvWorkerIntegrityReader(storage, cryptor);

    let verified: IntegrityVerifiedArtifact | undefined;
    try {
      verified = await reader.verify({
        locator: evidence.storageLocator,
        ciphertextBytes: evidence.ciphertextBytes,
        plaintextBytes: evidence.plaintextBytes,
        plaintextSha256: artifactBytes.plaintextSha256,
        context: {
          accountId: evidence.candidateUserId,
          uploadId: evidence.uploadId,
          artifactId: evidence.artifactId,
          kind: "SOURCE_DOCUMENT",
        },
        envelope: {
          keyVersion: evidence.encryptionKeyVersion,
          iv: artifactBytes.encryptionIv,
          authenticationTag: artifactBytes.authenticationTag,
        },
      });

      return {
        evidence,
        fileName: evidence.fileName,
        mimeType: evidence.mimeType,
        byteLength: evidence.plaintextBytes,
        openStream: () => verified!.open(),
        dispose: async () => {
          await verified?.dispose();
        },
      };
    } catch {
      await verified?.dispose().catch(() => undefined);
      throw new CvSafetyEvidenceError(
        "CV_INTEGRITY_FAILED",
        "Artifact integrity check or envelope decryption failed.",
      );
    }
  }
}
