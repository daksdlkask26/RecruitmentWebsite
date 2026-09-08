import "server-only";

import type { PreparedDirectApplicationDocument } from "../jobs/prepare-direct-application-document";

/**
 * @deprecated Direct CV bytes must be admitted through CvAdmissionService and
 * finalized from a CLEAN upload id. This compatibility seam rejects the old
 * plaintext contract and removes any temporary object owned by the caller.
 */
export async function saveDirectCandidateCv(
  _candidateUserId: string,
  prepared: PreparedDirectApplicationDocument,
  _occurredAt = new Date(),
): Promise<never> {
  void _occurredAt;
  await prepared.cleanup();
  throw new Error("APPLICATION_CV_INELIGIBLE");
}
