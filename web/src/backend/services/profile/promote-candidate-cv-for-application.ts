import "server-only";

import { prisma } from "@/backend/database/prisma";
import type { ApplicationDocumentStoragePort } from "@/backend/applications/storage/application-document-storage";
import { OpenSafeCvArtifactService } from "@/backend/services/cv-admission/open-safe-cv-artifact-service";

type CandidateCvSource = Readonly<{
  id: string;
  candidateUserId: string;
  byteSize: number;
  checksumSha256: string;
  sourceArtifactId?: string | null;
  scanAssessmentId?: string | null;
  uploadId?: string | null;
}>;

type Promotion = Readonly<{
  artifactId: string;
  assessmentId: string;
  storageLocator: string;
  byteLength: number;
  checksumSha256: string;
}>;

/**
 * Promotes a saved CandidateCv only after the shared safe-open service has
 * rechecked ownership, clean evidence, envelope integrity, and the source
 * digest. A materialized application copy is never its own security proof.
 */
export async function promoteCandidateCvForApplication(
  sourceCv: CandidateCvSource,
  destination: ApplicationDocumentStoragePort,
  db: typeof prisma = prisma,
  options: Readonly<{ locator?: string }> = {},
): Promise<Promotion | null> {
  void db;
  void destination;
  void options;
  if (
    !sourceCv.sourceArtifactId ||
    !sourceCv.scanAssessmentId ||
    !sourceCv.uploadId
  ) {
    return null;
  }

  let opened: Awaited<ReturnType<OpenSafeCvArtifactService["open"]>>;
  try {
    opened = await new OpenSafeCvArtifactService().open({
      candidateUserId: sourceCv.candidateUserId,
      uploadId: sourceCv.uploadId,
      artifactId: sourceCv.sourceArtifactId,
      assessmentId: sourceCv.scanAssessmentId,
      allowedPurposes: [
        "PROFILE_IMPORT",
        "PROFILE_DIRECT",
        "JOB_APPLICATION_DIRECT",
      ],
    });
  } catch {
    return null;
  }
  if (
    opened.byteLength !== sourceCv.byteSize ||
    opened.evidence.checksumSha256 !== sourceCv.checksumSha256.toLowerCase()
  ) {
    await opened.dispose();
    return null;
  }

  await opened.dispose();
  return Object.freeze({
    artifactId: opened.evidence.artifactId,
    assessmentId: opened.evidence.assessmentId,
    storageLocator: opened.evidence.storageLocator,
    byteLength: opened.byteLength,
    checksumSha256: opened.evidence.checksumSha256,
  });
}
