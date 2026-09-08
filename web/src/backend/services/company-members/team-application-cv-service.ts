import "server-only";

import {
  isCvFileValidationError,
  validatedCvUploadSource,
} from "@/backend/cv/validated-file-upload";
import { prisma } from "@/backend/database/prisma";
import {
  TeamApplicationAuthorizationError,
  requireTeamApplicationOwner,
} from "./team-application-authorization";
import { OpenSafeCvArtifactService } from "@/backend/services/cv-admission/open-safe-cv-artifact-service";

export class TeamApplicationCvError extends Error {
  constructor(
    readonly code:
      | "TEAM_CV_FILE_REQUIRED"
      | "TEAM_CV_FILE_TYPE_INVALID"
      | "TEAM_CV_FILE_INVALID"
      | "TEAM_CV_UNAVAILABLE",
  ) {
    super(code);
  }
}

/**
 * Team Applications accept PDF and DOCX only. The shared CV validator also
 * supports legacy DOC uploads for other flows, so this boundary explicitly
 * narrows the feature contract before any bytes reach storage.
 * Team Applications accept PDF and DOCX only.
 * Direct unassessed preparation is deprecated and disabled in favor of
 * the unified admission pipeline (CvAdmissionService).
 */
export async function prepareTeamApplicationCv(file: File): Promise<{
  cleanup(): Promise<void>;
  storageKey: string;
  checksumSha256: string;
  byteSize: number;
  mimeType: string;
  fileName: string;
  displayName: string;
  claimOwnership(): void;
}> {
  if (!(file instanceof File)) {
    throw new TeamApplicationCvError("TEAM_CV_FILE_REQUIRED");
  }
  try {
    const validated = await validatedCvUploadSource(file);
    if (validated.kind !== "PDF" && validated.kind !== "DOCX") {
      throw new TeamApplicationCvError("TEAM_CV_FILE_TYPE_INVALID");
    }
    // Direct admission without security scan is disabled
    throw new TeamApplicationCvError("TEAM_CV_FILE_INVALID");
  } catch (error) {
    if (error instanceof TeamApplicationCvError) throw error;
    if (isCvFileValidationError(error)) {
      throw new TeamApplicationCvError("TEAM_CV_FILE_INVALID");
    }
    throw error;
  }
}

export async function openTeamApplicationCv(
  ownerUserId: string,
  applicationId: string,
) {
  try {
    await requireTeamApplicationOwner(ownerUserId, applicationId);
  } catch (error) {
    if (error instanceof TeamApplicationAuthorizationError) {
      throw new TeamApplicationCvError("TEAM_CV_UNAVAILABLE");
    }
    throw error;
  }
  const application = await prisma.teamApplication.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      candidateUserId: true,
      cvFileName: true,
      cvMimeType: true,
      cvByteSize: true,
      cvChecksumSha256: true,
      cvStorageKey: true,
      cvDeleteAfter: true,
      cvDeletedAt: true,
      cvSourceArtifactId: true,
      cvScanAssessmentId: true,
    },
  });
  if (
    !application ||
    application.cvDeletedAt ||
    (application.cvDeleteAfter && application.cvDeleteAfter <= new Date())
  ) {
    throw new TeamApplicationCvError("TEAM_CV_UNAVAILABLE");
  }

  // Security boundary: cvSourceArtifactId and cvScanAssessmentId are required.
  // Legacy rows or rows without clean scan provenance fail closed.
  if (!application.cvSourceArtifactId || !application.cvScanAssessmentId) {
    throw new TeamApplicationCvError("TEAM_CV_UNAVAILABLE");
  }

  try {
    const artifact = await prisma.cvStoredArtifact.findUnique({
      where: { id: application.cvSourceArtifactId },
      select: { uploadId: true },
    });
    if (!artifact) {
      throw new TeamApplicationCvError("TEAM_CV_UNAVAILABLE");
    }

    const safeService = new OpenSafeCvArtifactService();
    const opened = await safeService.open({
      candidateUserId: application.candidateUserId,
      uploadId: artifact.uploadId,
      artifactId: application.cvSourceArtifactId,
      assessmentId: application.cvScanAssessmentId,
      expectedPurpose: "TEAM_APPLICATION_DIRECT",
    });

    if (
      application.cvByteSize !== opened.byteLength ||
      application.cvMimeType !== opened.mimeType ||
      application.cvChecksumSha256.toLowerCase() !==
        opened.evidence.checksumSha256.toLowerCase() ||
      application.cvStorageKey !== opened.evidence.storageLocator
    ) {
      await opened.dispose();
      throw new TeamApplicationCvError("TEAM_CV_UNAVAILABLE");
    }

    return {
      application: {
        ...application,
        id: application.id,
        cvFileName: opened.fileName,
        cvMimeType: opened.mimeType,
        cvByteSize: opened.byteLength,
      },
      stream: opened.openStream(),
      dispose: opened.dispose,
    };
  } catch {
    throw new TeamApplicationCvError("TEAM_CV_UNAVAILABLE");
  }
}
