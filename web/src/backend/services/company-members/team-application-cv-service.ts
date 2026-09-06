import "server-only";

import { createCvWorkerStorage } from "@/backend/cv/workers/cv-worker-resources";
import {
  isCvFileValidationError,
  validatedCvUploadSource,
} from "@/backend/cv/validated-file-upload";
import { prepareDirectApplicationCv } from "@/backend/services/jobs/prepare-direct-application-cv";
import { prisma } from "@/backend/database/prisma";
import {
  TeamApplicationAuthorizationError,
  requireTeamApplicationOwner,
} from "./team-application-authorization";

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
 */
export async function prepareTeamApplicationCv(file: File) {
  if (!(file instanceof File)) {
    throw new TeamApplicationCvError("TEAM_CV_FILE_REQUIRED");
  }
  try {
    const validated = await validatedCvUploadSource(file);
    if (validated.kind !== "PDF" && validated.kind !== "DOCX") {
      throw new TeamApplicationCvError("TEAM_CV_FILE_TYPE_INVALID");
    }
    return await prepareDirectApplicationCv(
      {
        fileName: validated.fileName,
        mimeType: validated.mimeType,
        byteSize: validated.byteSize,
        source: validated.source,
      },
      { deferStorage: true },
    );
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
      cvFileName: true,
      cvMimeType: true,
      cvByteSize: true,
      cvStorageKey: true,
      cvDeleteAfter: true,
      cvDeletedAt: true,
    },
  });
  if (
    !application ||
    application.cvDeletedAt ||
    (application.cvDeleteAfter && application.cvDeleteAfter <= new Date())
  ) {
    throw new TeamApplicationCvError("TEAM_CV_UNAVAILABLE");
  }
  try {
    const storage = createCvWorkerStorage();
    await storage.assertReady();
    return {
      application,
      stream: storage.open(application.cvStorageKey, application.cvByteSize),
    };
  } catch {
    throw new TeamApplicationCvError("TEAM_CV_UNAVAILABLE");
  }
}
