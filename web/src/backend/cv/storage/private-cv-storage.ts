import "server-only";

declare const sensitiveStorageLocatorBrand: unique symbol;
export type SensitiveStorageLocator = string & {
  readonly [sensitiveStorageLocatorBrand]: true;
};

export type PrivateCvStorageItem = Readonly<{
  locator: SensitiveStorageLocator;
  bytes: number;
  createdAt?: Date;
}>;

export type PrivateCvStorageInventory = Readonly<{
  items: readonly PrivateCvStorageItem[];
  nextCursor?: string;
}>;

export interface PrivateCvStorage {
  assertReady(): Promise<void>;
  put(input: {
    source: AsyncIterable<Uint8Array>;
    expectedBytes: number;
    /** Optional deterministic locator reserved by a durable ownership ledger. */
    locator?: string;
  }): Promise<PrivateCvStorageItem>;
  open(locator: string, expectedBytes: number): AsyncIterable<Uint8Array>;
  delete(locator: string): Promise<Readonly<{ deleted: boolean }>>;
  inventory(input: {
    limit: number;
    cursor?: string;
  }): Promise<PrivateCvStorageInventory>;
}

export type CvStorageErrorCode =
  | "CV_STORAGE_CONFIGURATION_INVALID"
  | "CV_STORAGE_NOT_READY"
  | "CV_STORAGE_LOCATOR_INVALID"
  | "CV_STORAGE_OBJECT_EXISTS"
  | "CV_STORAGE_OBJECT_NOT_FOUND"
  | "CV_STORAGE_LENGTH_MISMATCH"
  | "CV_STORAGE_OPERATION_FAILED";

export class CvStorageError extends Error {
  readonly name = "CvStorageError";

  constructor(readonly code: CvStorageErrorCode) {
    super(code);
  }

  toJSON() {
    return { name: this.name, code: this.code };
  }
}

export function sensitiveStorageLocator(
  value: string,
): SensitiveStorageLocator {
  return value as SensitiveStorageLocator;
}

export function assertStorageByteCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CvStorageError("CV_STORAGE_LENGTH_MISMATCH");
  }
}

export function assertInventoryLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
    throw new CvStorageError("CV_STORAGE_CONFIGURATION_INVALID");
  }
}
