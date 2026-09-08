/**
 * @deprecated This compatibility export is retained for legacy tests and
 * callers while direct CV admission is owned by CvAdmissionService.
 * Production application code uses prepareDirectApplicationDocument for
 * non-CV application documents such as cover letters.
 */
export {
  prepareDirectApplicationDocument as prepareDirectApplicationCv,
} from "./prepare-direct-application-document";
export type {
  DirectApplicationDocumentSource as DirectApplicationCvSource,
  PreparedDirectApplicationDocument as PreparedDirectApplicationCv,
  PrepareDirectApplicationDocumentOptions as PrepareDirectApplicationCvOptions,
} from "./prepare-direct-application-document";
