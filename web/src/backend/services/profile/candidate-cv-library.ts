import "server-only";

import { prisma } from "@/backend/database/prisma";
import { OpenSafeCvArtifactService } from "@/backend/services/cv-admission/open-safe-cv-artifact-service";
import { safeFilename } from "@/backend/services/cv-import/cv-import-projection";
import {
  candidateCvDeleteOutcomeSchema,
  candidateCvLibrarySchema,
  candidateCvRenameRequestSchema,
  candidateCvSummarySchema,
  type CandidateCvLibrary,
  type CandidateCvSummary,
} from "@/shared/contracts/cv-import/candidate-cv";
import {
  CV_ACCOUNT_MAX_IMPORTS,
  CV_SECURITY_POLICY_VERSION,
} from "@/shared/contracts/cv-import/common";

function initialDisplayName(originalName: string | null, fallback: string) {
  const value = originalName?.trim() || fallback;
  return value.slice(0, 200);
}

function renamedFilename(value: string, current: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/\r\n]/gu, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .slice(0, 255);
  if (!normalized) return current;
  if (/\.[A-Za-z0-9]{1,8}$/u.test(normalized)) return normalized;
  const extension = current.match(/\.[A-Za-z0-9]{1,8}$/u)?.[0] ?? "";
  return `${normalized}${extension}`.slice(0, 255);
}

function isGeneratedFilename(value: string | undefined): boolean {
  return Boolean(
    value &&
    /^(?:imported-cv|application-cv|candidate-cv)-[A-Za-z0-9-]+\.[A-Za-z0-9]{1,8}$/iu.test(
      value,
    ),
  );
}

type ConfirmedCvImport = Readonly<{
  id: string;
  declaredMediaType: string;
  actualBytes: number | null;
  sourceSha256: Uint8Array | null;
  confirmedAt: Date | null;
  displayFilenameCiphertext: string | null;
  sourceArtifactId: string | null;
  sourceStorageLocator: string | null;
  scanAssessmentId: string | null;
}>;

async function confirmedCvImports(
  userId: string,
  db: typeof prisma,
): Promise<ConfirmedCvImport[]> {
  // PrismaPg currently exposes PostgreSQL bytea values as objects that the
  // generated client cannot deserialize into Bytes. Encode the checksum in
  // PostgreSQL and reconstruct it here so one bad projection cannot leave a
  // confirmed import without its CandidateCv row.
  if (typeof (db as { $queryRaw?: unknown }).$queryRaw === "function") {
    const rows = await db.$queryRaw<
      Array<{
        id: string;
        declaredMediaType: string;
        actualBytes: number | null;
        sourceSha256Hex: string | null;
        confirmedAt: Date | null;
        displayFilenameCiphertext: string | null;
        sourceArtifactId: string | null;
        sourceStorageLocator: string | null;
        scanAssessmentId: string | null;
      }>
    >`
      SELECT upload."id",
             upload."declaredMediaType",
             upload."actualBytes",
             encode(upload."sourceSha256", 'hex') AS "sourceSha256Hex",
             upload."confirmedAt",
             upload."displayFilenameCiphertext",
             source_artifact."sourceArtifactId",
             source_artifact."sourceStorageLocator",
             clean_assessment."scanAssessmentId"
        FROM "CvUpload" upload
   LEFT JOIN LATERAL (
           SELECT artifact."id" AS "sourceArtifactId",
                  artifact."storageLocator" AS "sourceStorageLocator"
             FROM "CvStoredArtifact" artifact
           WHERE artifact."uploadId" = upload."id"
              AND artifact."accountId" = upload."accountId"
              AND artifact."kind" = 'SOURCE_DOCUMENT'
              AND artifact."status" = 'AVAILABLE'
              AND artifact."deletedAt" IS NULL
              AND artifact."plaintextBytes" = upload."actualBytes"
              AND artifact."plaintextSha256" = upload."sourceSha256"
            ORDER BY artifact."createdAt" DESC, artifact."id" DESC
            LIMIT 1
         ) source_artifact ON TRUE
   LEFT JOIN LATERAL (
           SELECT assessment."id" AS "scanAssessmentId"
             FROM "CvScanAssessment" assessment
            WHERE assessment."uploadId" = upload."id"
              AND assessment."accountId" = upload."accountId"
              AND assessment."sourceArtifactId" = source_artifact."sourceArtifactId"
              AND assessment."status" = 'CLEAN'
              AND assessment."completedAt" IS NOT NULL
              AND assessment."policyVersion" = ${CV_SECURITY_POLICY_VERSION}
            ORDER BY assessment."attemptNumber" DESC, assessment."createdAt" DESC
            LIMIT 1
         ) clean_assessment ON TRUE
       WHERE upload."accountId" = ${userId}
         AND upload."parserClass" IN ('DETERMINISTIC_INTERNAL', 'EXTERNAL_OPENAI')
         AND upload."status" = 'CONFIRMED'
         AND upload."confirmedAt" IS NOT NULL
         AND upload."purpose" = 'PROFILE_IMPORT'
         AND upload."processingMode" = 'IMPORT_AND_PARSE'
         AND upload."policyVersion" = ${CV_SECURITY_POLICY_VERSION}
         AND upload."actualBytes" IS NOT NULL
         AND upload."sourceSha256" IS NOT NULL
         AND upload."declaredMediaType" IN (
           'application/pdf',
           'application/msword',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
         )
       ORDER BY upload."confirmedAt" DESC, upload."id" DESC
       LIMIT ${CV_ACCOUNT_MAX_IMPORTS}
    `;
    return rows.map((row) => ({
      ...row,
      sourceSha256: row.sourceSha256Hex
        ? Buffer.from(row.sourceSha256Hex, "hex")
        : null,
    }));
  }

  // Lightweight test doubles do not implement Prisma's tagged raw-query API.
  const rows = await db.cvUpload.findMany({
    where: {
      accountId: userId,
      parserClass: {
        in: ["DETERMINISTIC_INTERNAL", "EXTERNAL_OPENAI"],
      },
      status: "CONFIRMED",
      confirmedAt: { not: null },
      purpose: "PROFILE_IMPORT",
      processingMode: "IMPORT_AND_PARSE",
      policyVersion: CV_SECURITY_POLICY_VERSION,
      actualBytes: { not: null },
      sourceSha256: { not: null },
      declaredMediaType: {
        in: [
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ],
      },
    },
    orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
    take: CV_ACCOUNT_MAX_IMPORTS,
    select: {
      id: true,
      declaredMediaType: true,
      actualBytes: true,
      sourceSha256: true,
      confirmedAt: true,
      displayFilenameCiphertext: true,
      artifacts: {
        where: {
          kind: "SOURCE_DOCUMENT",
          status: "AVAILABLE",
          deletedAt: null,
          upload: {
            is: {
              status: { in: ["SECURITY_CLEAN", "CONFIRMED"] },
              purpose: { in: ["PROFILE_IMPORT", "PROFILE_DIRECT"] },
              policyVersion: CV_SECURITY_POLICY_VERSION,
              deletedAt: null,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          storageLocator: true,
          plaintextBytes: true,
          plaintextSha256: true,
        },
      },
      scanAssessments: {
        where: {
          status: "CLEAN",
          completedAt: { not: null },
          policyVersion: CV_SECURITY_POLICY_VERSION,
        },
        orderBy: { attemptNumber: "desc" },
        take: 1,
        select: { id: true, sourceArtifactId: true },
      },
    },
  });
  return rows.map((row) => {
    const artifact = row.artifacts?.[0];
    const checksumMatches = Boolean(
      artifact?.plaintextSha256 &&
      row.sourceSha256 &&
      Buffer.from(artifact.plaintextSha256).equals(
        Buffer.from(row.sourceSha256),
      ),
    );
    const artifactMatches =
      artifact?.plaintextBytes === row.actualBytes && checksumMatches;
    const assessment = row.scanAssessments?.[0];
    return {
      ...row,
      sourceArtifactId: artifactMatches ? artifact.id : null,
      sourceStorageLocator: artifactMatches ? artifact.storageLocator : null,
      scanAssessmentId:
        artifactMatches && assessment?.sourceArtifactId === artifact.id
          ? assessment.id
          : null,
    };
  });
}

/**
 * A confirmed CV import has completed the parser/review flow and is therefore
 * eligible for the retained Profile CV library consumed by Apply. The
 * application repository reads only CandidateCv; this projection keeps the
 * temporary import lifecycle out of the application transaction itself.
 */
export async function ensureCandidateCvLibrary(
  userId: string,
  db: typeof prisma = prisma,
) {
  const imports = await confirmedCvImports(userId, db);

  const desiredIds = imports.map((upload) => "candidate-cv-" + upload.id);
  const desiredStorageKeys = [...desiredIds];
  const legacyRows = imports.length
    ? await db.candidateCv.findMany({
        where: {
          OR: [
            { id: { in: desiredIds } },
            { storageKey: { in: desiredStorageKeys } },
          ],
        },
        select: {
          id: true,
          candidateUserId: true,
          storageKey: true,
          displayName: true,
          fileName: true,
        },
      })
    : [];
  const existingByStorageKey = new Map(
    legacyRows.map((row) => [row.storageKey, row]),
  );
  const existingById = new Map(legacyRows.map((row) => [row.id, row]));

  await Promise.all(
    imports.map(async (upload) => {
      if (
        upload.actualBytes === null ||
        upload.sourceSha256 === null ||
        upload.confirmedAt === null
      )
        return;
      const extension =
        upload.declaredMediaType === "application/pdf"
          ? "pdf"
          : upload.declaredMediaType === "application/msword"
            ? "doc"
            : "docx";
      const desiredId = "candidate-cv-" + upload.id;
      const storageKey = upload.sourceStorageLocator ?? desiredId;
      const fallbackFileName = "candidate-cv." + extension;
      const existing =
        existingByStorageKey.get(storageKey) ?? existingById.get(desiredId);
      if (existing && existing.candidateUserId !== userId) return;
      const recoveredName = safeFilename(upload.displayFilenameCiphertext, {
        accountId: userId,
        uploadId: upload.id,
      });
      const existingUserFilename =
        existing && !isGeneratedFilename(existing.fileName)
          ? existing.fileName
          : null;
      const originalName = initialDisplayName(
        recoveredName ?? existingUserFilename,
        fallbackFileName,
      );
      const checksumSha256 = Buffer.from(upload.sourceSha256).toString("hex");
      const stableId = existing?.id ?? desiredId;
      await db.candidateCv.upsert({
        where: { id: stableId },
        create: {
          id: desiredId,
          candidateUserId: userId,
          displayName: originalName,
          fileName: originalName,
          mimeType: upload.declaredMediaType,
          byteSize: upload.actualBytes,
          storageKey,
          checksumSha256,
          version: 1,
          confirmedAt: upload.confirmedAt,
          sourceArtifactId: upload.sourceArtifactId,
          scanAssessmentId: upload.scanAssessmentId,
        },
        update: {
          ...(existing &&
          (existing.displayName === "Imported CV" ||
            isGeneratedFilename(existing.displayName))
            ? { displayName: originalName }
            : {}),
          // CandidateCv points at the same encrypted source artifact; it must
          // never preserve or recreate a legacy plaintext materialization.
          storageKey,
          fileName: existingUserFilename ?? originalName,
          mimeType: upload.declaredMediaType,
          byteSize: upload.actualBytes,
          checksumSha256,
          confirmedAt: upload.confirmedAt,
          sourceArtifactId: upload.sourceArtifactId,
          scanAssessmentId: upload.scanAssessmentId,
        },
      });
    }),
  );
}

/**
 * Replace the temporary bridge locator with the verified encrypted source
 * locator after confirmation. No second plaintext object is materialized.
 */
export async function materializeConfirmedCandidateCv(
  accountId: string,
  uploadId: string,
  db: typeof prisma = prisma,
) {
  const candidateCvId = `candidate-cv-${uploadId}`;
  const cv = await db.candidateCv.findUnique({
    where: { id: candidateCvId },
  });
  if (!cv || cv.storageKey !== candidateCvId) return;

  const opened = await new OpenSafeCvArtifactService().open({
    candidateUserId: accountId,
    uploadId,
    expectedPurpose: "PROFILE_IMPORT",
  });
  if (
    opened.byteLength !== cv.byteSize ||
    opened.evidence.checksumSha256 !== cv.checksumSha256.toLowerCase()
  ) {
    await opened.dispose();
    throw new Error("CANDIDATE_CV_SOURCE_MISMATCH");
  }

  try {
    // CandidateCv is a projection over the immutable encrypted source
    // artifact. Do not create a second plaintext object after safe-open.
    await db.candidateCv.update({
      where: { id: candidateCvId, storageKey: candidateCvId },
      data: { storageKey: opened.evidence.storageLocator },
    });
  } finally {
    await opened.dispose();
  }
}

export async function listCandidateCvLibrary(
  userId: string,
  db: typeof prisma = prisma,
): Promise<CandidateCvLibrary> {
  await ensureCandidateCvLibrary(userId, db);
  const rows = await db.candidateCv.findMany({
    where: {
      candidateUserId: userId,
      confirmedAt: { not: null },
      archivedAt: null,
      sourceArtifactId: { not: null },
      scanAssessmentId: { not: null },
      sourceArtifact: {
        is: {
          kind: "SOURCE_DOCUMENT",
          status: "AVAILABLE",
          deletedAt: null,
          contentInaccessibleAt: null,
          upload: {
            is: {
              status: { in: ["SECURITY_CLEAN", "CONFIRMED"] },
              purpose: { in: ["PROFILE_IMPORT", "PROFILE_DIRECT"] },
              policyVersion: CV_SECURITY_POLICY_VERSION,
              deletedAt: null,
              contentInaccessibleAt: null,
            },
          },
        },
      },
      scanAssessment: {
        is: {
          status: "CLEAN",
          completedAt: { not: null },
          policyVersion: CV_SECURITY_POLICY_VERSION,
        },
      },
    },
    orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
    // Match Check and Profile share the ten-file account quota.
    take: CV_ACCOUNT_MAX_IMPORTS,
    select: {
      id: true,
      displayName: true,
      fileName: true,
      mimeType: true,
      byteSize: true,
      version: true,
      confirmedAt: true,
      sourceArtifactId: true,
      scanAssessmentId: true,
      sourceArtifact: { select: { id: true } },
      scanAssessment: {
        select: { id: true, sourceArtifactId: true },
      },
    },
  });
  return candidateCvLibrarySchema.parse({
    items: rows.flatMap((row) => {
      if (
        row.sourceArtifactId !== row.sourceArtifact?.id ||
        row.scanAssessmentId !== row.scanAssessment?.id ||
        row.scanAssessment.sourceArtifactId !== row.sourceArtifact?.id
      ) {
        return [];
      }
      return [
        candidateCvSummarySchema.parse({
          id: row.id,
          displayName: row.displayName,
          fileName: row.fileName,
          mimeType: row.mimeType,
          byteSize: row.byteSize,
          version: row.version,
          confirmedAt: row.confirmedAt?.toISOString(),
        }),
      ];
    }),
  });
}

export class CandidateCvNotFoundError extends Error {
  constructor() {
    super("CANDIDATE_CV_NOT_FOUND");
  }
}

function summary(row: unknown): CandidateCvSummary {
  return candidateCvSummarySchema.parse(row);
}

export async function renameCandidateCv(
  userId: string,
  cvId: string,
  input: unknown,
  db: typeof prisma = prisma,
): Promise<CandidateCvSummary> {
  const { displayName } = candidateCvRenameRequestSchema.parse(input);
  const existing = await db.candidateCv.findFirst({
    where: { id: cvId, candidateUserId: userId, archivedAt: null },
    select: {
      id: true,
      displayName: true,
      fileName: true,
      mimeType: true,
      byteSize: true,
      version: true,
      confirmedAt: true,
    },
  });
  if (!existing || !existing.confirmedAt) throw new CandidateCvNotFoundError();
  const updated = await db.candidateCv.update({
    where: { id: existing.id },
    // `storageKey` remains an internal locator. A rename updates the
    // user-facing original filename metadata instead.
    data: {
      displayName,
      fileName: renamedFilename(displayName, existing.fileName),
    },
    select: {
      id: true,
      displayName: true,
      fileName: true,
      mimeType: true,
      byteSize: true,
      version: true,
      confirmedAt: true,
    },
  });
  if (!updated.confirmedAt) throw new CandidateCvNotFoundError();
  return summary({
    ...updated,
    confirmedAt: updated.confirmedAt.toISOString(),
  });
}

export async function archiveCandidateCv(
  userId: string,
  cvId: string,
  db: typeof prisma = prisma,
) {
  const existing = await db.candidateCv.findFirst({
    where: { id: cvId, candidateUserId: userId, archivedAt: null },
    select: { id: true },
  });
  if (!existing) throw new CandidateCvNotFoundError();
  const archived = await db.candidateCv.update({
    where: { id: existing.id },
    data: { archivedAt: new Date() },
    select: { id: true, archivedAt: true },
  });
  if (!archived.archivedAt) throw new CandidateCvNotFoundError();
  return candidateCvDeleteOutcomeSchema.parse({
    id: archived.id,
    archivedAt: archived.archivedAt.toISOString(),
  });
}
