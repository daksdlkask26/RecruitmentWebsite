import nextEnv from "@next/env";

// Standalone workers do not pass through the custom server's environment
// loader, so load the same .env/.env.local contract before importing TS code.
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const worker =
  await import("../src/backend/applications/workers/application-retention-worker.ts");
const candidateCvWorker =
  await import("../src/backend/cv/candidate-cv-artifact-reconciliation-worker.ts");
const companyDeletionWorker =
  await import("../src/backend/services/jobs/company-deletion-manifest-service.ts");
const companyDeletionData =
  await import("../src/backend/services/jobs/recruiter-job-posting-data.ts");
if (process.argv.includes("--probe")) {
  console.log(
    JSON.stringify(
      {
        application: await worker.applicationRetentionProbe(),
        candidateCv: candidateCvWorker.candidateCvArtifactReconciliationProbe(),
        companyDeletion: companyDeletionWorker.companyDeletionManifestProbe(),
      },
      null,
      2,
    ),
  );
} else {
  const application = await worker.runApplicationRetentionCycle();
  const candidateCv =
    await candidateCvWorker.runCandidateCvArtifactReconciliationCycle();
  const companyDeletion =
    await companyDeletionWorker.runCompanyDeletionManifestReconciliation(
      new Date(),
      50,
      companyDeletionData.resumeBlockedRecruiterCompanyDeletion,
    );
  console.log(
    JSON.stringify({ application, candidateCv, companyDeletion }, null, 2),
  );
}
