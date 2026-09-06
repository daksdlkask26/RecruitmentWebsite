import "server-only";

import type { PrivateCvStorage } from "@/backend/cv/storage/private-cv-storage";
import {
  ApplicationDocumentStorageError,
  applicationStorageLocator,
  type ApplicationDocumentStoragePort,
} from "./application-document-storage";

export class FilesystemApplicationDocumentStorage
  implements ApplicationDocumentStoragePort
{
  constructor(private readonly storage: PrivateCvStorage) {}

  async assertReady() {
    try {
      await this.storage.assertReady();
    } catch {
      throw new ApplicationDocumentStorageError(
        "APPLICATION_STORAGE_NOT_READY",
      );
    }
  }

  async put(input: {
    source: AsyncIterable<Uint8Array>;
    expectedBytes: number;
    locator?: string;
  }) {
    try {
      const stored = await this.storage.put(input);
      return Object.freeze({
        locator: applicationStorageLocator(stored.locator),
        bytes: stored.bytes,
        storagePurposeVersion: "application-document-v1" as const,
      });
    } catch (error) {
      if (error instanceof ApplicationDocumentStorageError) throw error;
      throw new ApplicationDocumentStorageError("APPLICATION_STORAGE_FAILED");
    }
  }

  open(locator: string, expectedBytes: number) {
    return this.storage.open(locator, expectedBytes);
  }

  async delete(locator: string) {
    try {
      return await this.storage.delete(locator);
    } catch {
      throw new ApplicationDocumentStorageError("APPLICATION_STORAGE_FAILED");
    }
  }
}
