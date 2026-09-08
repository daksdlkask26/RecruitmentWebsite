import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getWorkspaceContext } from "@/backend/auth/get-workspace-context";
import { CvImportServiceError } from "@/backend/services/cv-import/cv-http-errors";
import { getCvImportResource } from "@/backend/services/cv-import/cv-import-projection";
import { CvConfirmationReceipt } from "@/frontend/features/cv-import/components/cv-confirmation-receipt";
import { ProfileNavigation } from "@/frontend/features/profile/components/profile-navigation";
import { cvUploadIdSchema } from "@/shared/contracts/cv-import/common";
import styles from "../review/page.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ReceiptPageProps = {
  params: Promise<{ uploadId: string }>;
};

/**
 * Resolve receipt availability before the App Router starts streaming the
 * workspace layout. A late notFound() from the page body can otherwise be
 * rendered as a content-free 200 response after the layout has flushed.
 */
export async function generateMetadata({
  params,
}: ReceiptPageProps): Promise<Metadata> {
  const { uploadId } = await params;
  const parsed = cvUploadIdSchema.safeParse(uploadId);
  if (!parsed.success) notFound();
  const context = await getWorkspaceContext();
  if (!context) return { title: "CV import receipt" };
  try {
    const resource = await getCvImportResource(context.userId, parsed.data);
    if (!("receipt" in resource) || !resource.receipt) notFound();
  } catch (error) {
    if (
      error instanceof CvImportServiceError &&
      error.code === "CV_IMPORT_NOT_FOUND"
    )
      notFound();
    throw error;
  }
  return { title: "CV import receipt" };
}

export default async function CvConfirmationReceiptPage({
  params,
}: ReceiptPageProps) {
  const { uploadId } = await params;
  const parsed = cvUploadIdSchema.safeParse(uploadId);
  if (!parsed.success) notFound();
  const context = await getWorkspaceContext();
  if (!context)
    redirect(
      `/login?returnTo=${encodeURIComponent(`/profile/cv-imports/${uploadId}/receipt`)}`,
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

  if (!("receipt" in resource) || !resource.receipt) notFound();
  const vi = context.initialLocale === "vi";
  return (
    <main className={styles.page}>
      <div className={styles.workspace}>
        <header className={styles.header}>
          <Link
            className={styles.backLink}
            href={`/profile/cv-imports/${resource.uploadId}`}
          >
            <span aria-hidden="true">←</span>{" "}
            {vi ? "Quay lại trạng thái nhập" : "Back to import status"}
          </Link>
          <div className={styles.context}>
            <p>{vi ? "BIÊN NHẬN NHẬP CV" : "CV IMPORT RECEIPT"}</p>
            <strong>
              {vi
                ? "Xác nhận đã được lưu và có thể tải lại an toàn."
                : "Your confirmation is saved and safely reloadable."}
            </strong>
          </div>
        </header>
        <ProfileNavigation active="cv-imports" />
        <div className={styles.content}>
          <CvConfirmationReceipt receipt={resource.receipt} />
        </div>
      </div>
    </main>
  );
}
