import "server-only";

declare const applicationStorageLocatorBrand: unique symbol;
export type ApplicationStorageLocator = string & {
  readonly [applicationStorageLocatorBrand]: true;
};

export type ApplicationStoredObject = Readonly<{
  locator: ApplicationStorageLocator;
  bytes: number;
  storagePurposeVersion: "application-document-v1";
}>;

export type ApplicationDocumentStoragePort = Readonly<{
  assertReady(): Promise<void>;
  put(input: {
    source: AsyncIterable<Uint8Array>;
    expectedBytes: number;
    /** Optional deterministic locator reserved before the object is written. */
    locator?: string;
  }): Promise<ApplicationStoredObject>;
  open(locator: string, expectedBytes: number): AsyncIterable<Uint8Array>;
  delete(locator: string): Promise<Readonly<{ deleted: boolean }>>;
}>;

export type ApplicationDocumentStorageErrorCode =
  | "APPLICATION_STORAGE_NOT_READY"
  | "APPLICATION_STORAGE_INVALID"
  | "APPLICATION_STORAGE_NOT_FOUND"
  | "APPLICATION_STORAGE_LENGTH_MISMATCH"
  | "APPLICATION_STORAGE_FAILED";

export class ApplicationDocumentStorageError extends Error {
  readonly name = "ApplicationDocumentStorageError";

  constructor(readonly code: ApplicationDocumentStorageErrorCode) {
    super(code);
  }
}

export function applicationStorageLocator(
  value: string,
): ApplicationStorageLocator {
  return value as ApplicationStorageLocator;
}
