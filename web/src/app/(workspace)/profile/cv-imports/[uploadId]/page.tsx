import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import { getCvImportResource } from "@/backend/services/cv-import/cv-import-projection";
import { CvImportServiceError } from "@/backend/services/cv-import/cv-http-errors";
import { CvImportStatus } from "@/frontend/features/cv-import/components/cv-import-status";
import { CvConfirmationReceipt } from "@/frontend/features/cv-import/components/cv-confirmation-receipt";
import {
  cvImportStatusPageCopy,
  cvStatusLabel,
} from "@/frontend/features/cv-import/i18n/cv-import-copy";
import { PageHeader } from "@/frontend/components/layout/page-header";
import { ProfileNavigation } from "@/frontend/features/profile/components/profile-navigation";
import { cvUploadIdSchema } from "@/shared/contracts/cv-import/common";
import { cvStatusPollingAfterMs } from "@/shared/contracts/cv-import/upload";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CvImportStatusPage({
  params,
}: {
  params: Promise<{ uploadId: string }>;
}) {
  const { uploadId } = await params;
  const parsed = cvUploadIdSchema.safeParse(uploadId);
  if (!parsed.success) notFound();
  const context = await getWorkspaceContext();
  if (!context)
    redirect(
      `/login?returnTo=${encodeURIComponent(`/profile/cv-imports/${uploadId}`)}`,
    );
  let resource: Awaited<ReturnType<typeof getCvImportResource>>;
  try {
    resource = await getCvImportResource(context.userId, parsed.data);
  } catch (error) {
    if (
      error instanceof CvImportServiceError &&
      error.code === "CV_IMPORT_NOT_FOUND"
    )
      notFound();
    throw error;
  }
  const pollingAfterMs =
    cvStatusPollingAfterMs(
      resource.status,
      "stage" in resource ? resource.processingMode : undefined,
      resource,
    );
  const copy = cvImportStatusPageCopy(context.initialLocale);
  return (
    <main className={styles.page}>
      <div className={styles.workspace}>
        <div className={styles.header}>
          <Link className={styles.backLink} href="/profile/cv-imports">
            <span aria-hidden="true">←</span> {copy.backLink}
          </Link>
          <PageHeader
            className={styles.pageHeader}
            eyebrow={copy.eyebrow}
            title={copy.title}
            titleId="workspace-page-title"
            subtitle={copy.subtitle}
            rightSlot={
              <span className={styles.privacyBadge}>{copy.privacyBadge}</span>
            }
          />
        </div>
        <ProfileNavigation active="cv-imports" />
        <div className={styles.content}>
          <CvImportStatus
            csrfProof={context.csrfProof}
            resource={{ ...resource, pollingAfterMs }}
          />
          {"stage" in resource && resource.receipt ? (
            <CvConfirmationReceipt receipt={resource.receipt} />
          ) : null}
          <p className="sr-only" aria-live="polite">
            {copy.statusPrefix}
            {cvStatusLabel(context.initialLocale, resource.status)}
          </p>
        </div>
      </div>
    </main>
  );
}
