import "server-only";
import { AdminWorkerRuntime } from "./admin-worker-runtime";
import { runDashboardSnapshotCycle } from "./dashboard-snapshot-loop";
import {
  runBusinessVerificationPreparationCleanupCycle,
  runEvidenceSafetyCycle,
  runVerificationAdminNotificationCycle,
  runVerificationDeadlineCycle,
} from "./verification-lifecycle-loop";
import { runEvidenceRetentionCycle } from "./evidence-retention-loop";
import { runSecurityNotificationCycle } from "./security-notification-loop";
import { runVerificationNotificationCycle } from "./verification-notification-loop";
import { runRationaleRetentionCycle } from "./rationale-retention-loop";
import { runSupportLifecycleCycle } from "./support-lifecycle-loop";
import { runProposalLifecycleCycle } from "@/backend/connections/workers/proposal-lifecycle-loop";
import { runProposalRetentionCycle } from "@/backend/connections/workers/proposal-retention-loop";
import { runNotificationRetentionCycle } from "./notification-retention-loop";
import { runJobPostLifecycleCycle } from "./job-post-lifecycle-loop";
import { runBackupScheduleCycle } from "./backup-schedule-loop";
import { runDeletedJobReviewRetentionCycle } from "@/backend/jobs/review/job-post-review-retention";
import { runTeamApplicationRetentionCycle } from "@/backend/jobs/team-application-retention";
import { runCandidateCvArtifactReconciliationCycle } from "@/backend/cv/candidate-cv-artifact-reconciliation-worker";
import { runCompanyDeletionManifestReconciliation } from "@/backend/services/jobs/company-deletion-manifest-service";
import { resumeBlockedRecruiterCompanyDeletion } from "@/backend/services/jobs/recruiter-job-posting-data";

export async function startAdminWorker(options: { probe?: boolean } = {}) {
  const runtime = new AdminWorkerRuntime([
    { name: "snapshot", intervalMs: 30_000, run: runDashboardSnapshotCycle },
    { name: "evidence", intervalMs: 5_000, run: runEvidenceSafetyCycle },
    {
      name: "verification-deadline",
      intervalMs: 60_000,
      run: runVerificationDeadlineCycle,
    },
    {
      name: "verification-admin-notification-reconcile",
      intervalMs: 30_000,
      run: runVerificationAdminNotificationCycle,
    },
    {
      name: "business-verification-preparation-cleanup",
      intervalMs: 60_000,
      run: runBusinessVerificationPreparationCleanupCycle,
    },
    {
      name: "notification",
      intervalMs: 30_000,
      run: runSecurityNotificationCycle,
    },
    {
      name: "verification-notification",
      intervalMs: 30_000,
      run: runVerificationNotificationCycle,
    },
    {
      name: "in-app-notification-retention",
      intervalMs: 60_000,
      run: runNotificationRetentionCycle,
    },
    {
      name: "retention",
      intervalMs: 60_000,
      run: async (now) => ({
        evidence: await runEvidenceRetentionCycle(now),
        rationales: await runRationaleRetentionCycle(now),
      }),
    },
    { name: "support", intervalMs: 60_000, run: runSupportLifecycleCycle },
    {
      name: "connections",
      intervalMs: 60_000,
      run: async (now) => ({
        lifecycle: await runProposalLifecycleCycle(now),
        retention: await runProposalRetentionCycle(now),
      }),
    },
    {
      name: "job-post-lifecycle",
      intervalMs: 60_000,
      run: runJobPostLifecycleCycle,
    },
    {
      name: "job-review-retention",
      intervalMs: 60_000,
      run: runDeletedJobReviewRetentionCycle,
    },
    {
      name: "team-application-retention",
      intervalMs: 60_000,
      run: runTeamApplicationRetentionCycle,
    },
    {
      name: "candidate-cv-artifact-reconciliation",
      intervalMs: 60_000,
      run: runCandidateCvArtifactReconciliationCycle,
    },
    {
      name: "company-deletion-reconciliation",
      intervalMs: 60_000,
      run: (now) =>
        runCompanyDeletionManifestReconciliation(
          now,
          50,
          resumeBlockedRecruiterCompanyDeletion,
        ),
    },
    { name: "backup", intervalMs: 5_000, run: runBackupScheduleCycle },
  ]);
  const readiness = await runtime.probe();
  if (readiness.some((item) => !item.ready))
    throw new Error("ADMIN_WORKER_NOT_READY");
  if (!options.probe) runtime.start();
  return { readiness, stop: async () => runtime.stop() };
}
