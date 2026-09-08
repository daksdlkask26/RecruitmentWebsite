import pg from "pg";

import {
  assertCvSecurityTestDatabase,
  printSkippedDatabaseCheck,
  CvSecurityTestDatabaseError,
} from "./cv-security-test-database.mjs";

const POLICY_VERSION = "unified-cv-v1";
const apply = process.argv.includes("--apply");

const classificationQuery = `
WITH candidate_cv AS (
  SELECT
    CASE
      WHEN cv."sourceArtifactId" IS NULL AND cv."scanAssessmentId" IS NULL
        THEN 'legacy_denied'
      WHEN cv."sourceArtifactId" IS NULL
        OR cv."scanAssessmentId" IS NULL
        OR artifact."id" IS NULL
        OR assessment."id" IS NULL
        OR upload."id" IS NULL
        THEN 'missing'
      WHEN upload."accountId" = cv."candidateUserId"
        AND artifact."accountId" = upload."accountId"
        AND assessment."accountId" = upload."accountId"
        AND assessment."uploadId" = upload."id"
        AND artifact."uploadId" = upload."id"
        AND artifact."kind" = 'SOURCE_DOCUMENT'
        AND artifact."status" = 'AVAILABLE'
        AND artifact."deletedAt" IS NULL
        AND artifact."contentInaccessibleAt" IS NULL
        AND assessment."status" = 'CLEAN'
        AND assessment."completedAt" IS NOT NULL
        AND assessment."sourceArtifactId" = artifact."id"
        AND assessment."policyVersion" = $1
        AND upload."policyVersion" = $1
        AND upload."purpose" IN ('PROFILE_IMPORT', 'PROFILE_DIRECT')
        AND upload."processingMode" = CASE
          WHEN upload."purpose" = 'PROFILE_IMPORT' THEN 'IMPORT_AND_PARSE'::"CvProcessingMode"
          ELSE 'SCAN_ONLY'::"CvProcessingMode"
        END
        AND (
          (upload."purpose" = 'PROFILE_IMPORT'
            AND upload."status" = 'CONFIRMED'
            AND upload."confirmedAt" IS NOT NULL)
          OR (upload."purpose" <> 'PROFILE_IMPORT'
            AND upload."status" = 'SECURITY_CLEAN')
        )
        AND assessment."engineName" = 'clamav'
        AND assessment."engineVersion" IS NOT NULL
        AND assessment."signatureVersion" IS NOT NULL
        AND assessment."signaturePublishedAt" IS NOT NULL
        AND encode(artifact."plaintextSha256", 'hex') = lower(cv."checksumSha256")
        AND encode(upload."sourceSha256", 'hex') = lower(cv."checksumSha256")
        AND artifact."plaintextBytes" = cv."byteSize"
        AND artifact."plaintextBytes" = upload."actualBytes"
        AND artifact."plaintextBytes" = upload."declaredBytes"
        THEN 'safe'
      ELSE 'inconsistent'
    END AS category
  FROM "CandidateCv" cv
  LEFT JOIN "CvStoredArtifact" artifact
    ON artifact."id" = cv."sourceArtifactId"
  LEFT JOIN "CvScanAssessment" assessment
    ON assessment."id" = cv."scanAssessmentId"
  LEFT JOIN "CvUpload" upload
    ON upload."id" = artifact."uploadId"
), application_document AS (
  SELECT
    CASE
      WHEN document."sourceArtifactId" IS NULL AND document."scanAssessmentId" IS NULL
        THEN 'legacy_denied'
      WHEN document."sourceArtifactId" IS NULL
        OR document."scanAssessmentId" IS NULL
        OR artifact."id" IS NULL
        OR assessment."id" IS NULL
        OR upload."id" IS NULL
        THEN 'missing'
      WHEN upload."accountId" = candidate_cv."candidateUserId"
        AND document."sourceCandidateCvId" = candidate_cv."id"
        AND document."sourceCandidateCvVersion" = candidate_cv."version"
        AND candidate_cv."sourceArtifactId" = artifact."id"
        AND candidate_cv."scanAssessmentId" = assessment."id"
        AND artifact."accountId" = upload."accountId"
        AND assessment."accountId" = upload."accountId"
        AND assessment."uploadId" = upload."id"
        AND artifact."uploadId" = upload."id"
        AND artifact."kind" = 'SOURCE_DOCUMENT'
        AND artifact."status" = 'AVAILABLE'
        AND artifact."deletedAt" IS NULL
        AND artifact."contentInaccessibleAt" IS NULL
        AND assessment."status" = 'CLEAN'
        AND assessment."completedAt" IS NOT NULL
        AND assessment."sourceArtifactId" = artifact."id"
        AND assessment."policyVersion" = $1
        AND upload."policyVersion" = $1
        AND upload."purpose" IN (
          'PROFILE_IMPORT', 'PROFILE_DIRECT', 'JOB_APPLICATION_DIRECT'
        )
        AND (
          (upload."purpose" = 'PROFILE_IMPORT' AND upload."status" = 'CONFIRMED')
          OR (upload."purpose" <> 'PROFILE_IMPORT' AND upload."status" = 'SECURITY_CLEAN')
        )
        AND assessment."engineName" = 'clamav'
        AND assessment."engineVersion" IS NOT NULL
        AND assessment."signatureVersion" IS NOT NULL
        AND assessment."signaturePublishedAt" IS NOT NULL
        AND artifact."plaintextBytes" = document."byteLength"
        THEN 'safe'
      ELSE 'inconsistent'
    END AS category
  FROM "ApplicationDocument" document
  LEFT JOIN "CvStoredArtifact" artifact
    ON artifact."id" = document."sourceArtifactId"
  LEFT JOIN "CvScanAssessment" assessment
    ON assessment."id" = document."scanAssessmentId"
  LEFT JOIN "CvUpload" upload
    ON upload."id" = artifact."uploadId"
  LEFT JOIN "CandidateCv" candidate_cv
    ON candidate_cv."id" = document."sourceCandidateCvId"
  WHERE document."kind" = 'CV'
), team_application AS (
  SELECT
    CASE
      WHEN application."cvSourceArtifactId" IS NULL AND application."cvScanAssessmentId" IS NULL
        THEN 'legacy_denied'
      WHEN application."cvSourceArtifactId" IS NULL
        OR application."cvScanAssessmentId" IS NULL
        OR artifact."id" IS NULL
        OR assessment."id" IS NULL
        OR upload."id" IS NULL
        THEN 'missing'
      WHEN upload."accountId" = application."candidateUserId"
        AND artifact."accountId" = upload."accountId"
        AND assessment."accountId" = upload."accountId"
        AND assessment."uploadId" = upload."id"
        AND artifact."uploadId" = upload."id"
        AND artifact."kind" = 'SOURCE_DOCUMENT'
        AND artifact."status" = 'AVAILABLE'
        AND artifact."deletedAt" IS NULL
        AND artifact."contentInaccessibleAt" IS NULL
        AND assessment."status" = 'CLEAN'
        AND assessment."completedAt" IS NOT NULL
        AND assessment."sourceArtifactId" = artifact."id"
        AND upload."purpose" = 'TEAM_APPLICATION_DIRECT'
        AND upload."status" = 'SECURITY_CLEAN'
        AND upload."policyVersion" = $1
        AND assessment."policyVersion" = $1
        AND assessment."engineName" = 'clamav'
        AND assessment."engineVersion" IS NOT NULL
        AND assessment."signatureVersion" IS NOT NULL
        AND assessment."signaturePublishedAt" IS NOT NULL
        AND encode(artifact."plaintextSha256", 'hex') = lower(application."cvChecksumSha256")
        AND artifact."plaintextBytes" = application."cvByteSize"
        AND artifact."plaintextBytes" = upload."actualBytes"
        AND artifact."plaintextBytes" = upload."declaredBytes"
        THEN 'safe'
      ELSE 'inconsistent'
    END AS category
  FROM "TeamApplication" application
  LEFT JOIN "CvStoredArtifact" artifact
    ON artifact."id" = application."cvSourceArtifactId"
  LEFT JOIN "CvScanAssessment" assessment
    ON assessment."id" = application."cvScanAssessmentId"
  LEFT JOIN "CvUpload" upload
    ON upload."id" = artifact."uploadId"
)
SELECT surface, category, COUNT(*)::int AS count
FROM (
  SELECT 'candidateCv' AS surface, category FROM candidate_cv
  UNION ALL
  SELECT 'applicationDocument' AS surface, category FROM application_document
  UNION ALL
  SELECT 'teamApplication' AS surface, category FROM team_application
) classified
GROUP BY surface, category
ORDER BY surface, category;
`;

async function applySafeRepairs(client) {
  // These updates only attach already-existing CLEAN evidence. They never
  // promote a legacy row to CLEAN and never create scanner evidence.
  const candidate = await client.query(
    `
    UPDATE "CandidateCv" cv
       SET "sourceArtifactId" = artifact."id",
           "scanAssessmentId" = assessment."id"
      FROM "CvStoredArtifact" artifact
      JOIN "CvUpload" upload ON upload."id" = artifact."uploadId"
      JOIN "CvScanAssessment" assessment
        ON assessment."uploadId" = upload."id"
       AND assessment."sourceArtifactId" = artifact."id"
     WHERE cv."sourceArtifactId" IS NULL
       AND cv."scanAssessmentId" IS NULL
       AND cv."candidateUserId" = upload."accountId"
       AND cv."storageKey" = artifact."storageLocator"
       AND lower(cv."checksumSha256") = encode(artifact."plaintextSha256", 'hex')
       AND cv."byteSize" = artifact."plaintextBytes"
       AND artifact."kind" = 'SOURCE_DOCUMENT'
       AND artifact."status" = 'AVAILABLE'
       AND artifact."deletedAt" IS NULL
       AND artifact."contentInaccessibleAt" IS NULL
       AND assessment."status" = 'CLEAN'
       AND assessment."completedAt" IS NOT NULL
       AND assessment."policyVersion" = $1
       AND upload."policyVersion" = $1
       AND upload."purpose" IN ('PROFILE_IMPORT', 'PROFILE_DIRECT')
       AND upload."status" IN ('SECURITY_CLEAN', 'CONFIRMED')
       AND assessment."engineName" = 'clamav'
       AND assessment."engineVersion" IS NOT NULL
       AND assessment."signatureVersion" IS NOT NULL
       AND assessment."signaturePublishedAt" IS NOT NULL
    `,
    [POLICY_VERSION],
  );

  const applicationDocument = await client.query(
    `
    UPDATE "ApplicationDocument" document
       SET "sourceArtifactId" = candidate_cv."sourceArtifactId",
           "scanAssessmentId" = candidate_cv."scanAssessmentId"
      FROM "CandidateCv" candidate_cv
     WHERE document."kind" = 'CV'
       AND document."sourceArtifactId" IS NULL
       AND document."scanAssessmentId" IS NULL
       AND document."sourceCandidateCvId" = candidate_cv."id"
       AND document."sourceCandidateCvVersion" = candidate_cv."version"
       AND candidate_cv."sourceArtifactId" IS NOT NULL
       AND candidate_cv."scanAssessmentId" IS NOT NULL
    `,
  );

  const team = await client.query(
    `
    UPDATE "TeamApplication" application
       SET "cvSourceArtifactId" = artifact."id",
           "cvScanAssessmentId" = assessment."id"
      FROM "CvStoredArtifact" artifact
      JOIN "CvUpload" upload ON upload."id" = artifact."uploadId"
      JOIN "CvScanAssessment" assessment
        ON assessment."uploadId" = upload."id"
       AND assessment."sourceArtifactId" = artifact."id"
     WHERE application."cvSourceArtifactId" IS NULL
       AND application."cvScanAssessmentId" IS NULL
       AND application."candidateUserId" = upload."accountId"
       AND application."cvStorageKey" = artifact."storageLocator"
       AND lower(application."cvChecksumSha256") = encode(artifact."plaintextSha256", 'hex')
       AND application."cvByteSize" = artifact."plaintextBytes"
       AND artifact."kind" = 'SOURCE_DOCUMENT'
       AND artifact."status" = 'AVAILABLE'
       AND artifact."deletedAt" IS NULL
       AND artifact."contentInaccessibleAt" IS NULL
       AND assessment."status" = 'CLEAN'
       AND assessment."completedAt" IS NOT NULL
       AND assessment."policyVersion" = $1
       AND upload."purpose" = 'TEAM_APPLICATION_DIRECT'
       AND upload."status" = 'SECURITY_CLEAN'
       AND upload."policyVersion" = $1
       AND assessment."engineName" = 'clamav'
       AND assessment."engineVersion" IS NOT NULL
       AND assessment."signatureVersion" IS NOT NULL
       AND assessment."signaturePublishedAt" IS NOT NULL
    `,
    [POLICY_VERSION],
  );
  return {
    candidateCv: candidate.rowCount ?? 0,
    applicationDocument: applicationDocument.rowCount ?? 0,
    teamApplication: team.rowCount ?? 0,
  };
}

let database;
try {
  database = assertCvSecurityTestDatabase();
} catch (error) {
  if (error instanceof CvSecurityTestDatabaseError) {
    printSkippedDatabaseCheck(error);
    process.exitCode = 2;
  } else {
    throw error;
  }
}

if (database) {
  const client = new pg.Client({ connectionString: database.directUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    try {
      const repairs = apply ? await applySafeRepairs(client) : null;
      const result = await client.query(classificationQuery, [POLICY_VERSION]);
      await client.query(apply ? "COMMIT" : "ROLLBACK");
      const counts = Object.fromEntries(
        ["candidateCv", "applicationDocument", "teamApplication"].map(
          (surface) => [
            surface,
            Object.fromEntries(
              ["safe", "legacy_denied", "inconsistent", "missing"].map(
                (category) => [
                  category,
                  Number(
                    result.rows.find(
                      (row) =>
                        row.surface === surface && row.category === category,
                    )?.count ?? 0,
                  ),
                ],
              ),
            ),
          ],
        ),
      );
      console.log(
        JSON.stringify(
          {
            pass: true,
            mode: apply ? "apply-safe-evidence-only" : "dry-run",
            noAutoClean: true,
            repairs,
            counts,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
}
