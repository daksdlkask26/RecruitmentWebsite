const worker = await import("../src/backend/applications/workers/application-retention-worker.ts");
const candidateCvWorker = await import(
  "../src/backend/cv/candidate-cv-artifact-reconciliation-worker.ts",
);
if (process.argv.includes("--probe")) {
  console.log(
    JSON.stringify(
      {
        application: await worker.applicationRetentionProbe(),
        candidateCv: candidateCvWorker.candidateCvArtifactReconciliationProbe(),
      },
      null,
      2,
    ),
  );
} else {
  const application = await worker.runApplicationRetentionCycle();
  const candidateCv =
    await candidateCvWorker.runCandidateCvArtifactReconciliationCycle();
  console.log(JSON.stringify({ application, candidateCv }, null, 2));
}
