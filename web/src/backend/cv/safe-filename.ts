import "server-only";

import { cvConfiguration } from "@/backend/cv/config";
import { createMetadataCryptor } from "@/backend/cv/encryption/metadata-cryptor";

export function safeCvFilename(
  encrypted: string | null,
  context: { accountId: string; uploadId: string },
): string | null {
  if (!encrypted) return null;
  const cryptor = createMetadataCryptor({
    activeKeyVersion: cvConfiguration.encryption.activeKeyVersion,
    keys: Object.fromEntries(
      Object.entries(cvConfiguration.encryption.encodedKeys).map(
        ([version, encoded]) => [
          Number(version),
          Buffer.from(encoded, "base64"),
        ],
      ),
    ),
  });
  try {
    return cryptor.decryptDisplayFilename(encrypted, context);
  } catch {
    return null;
  } finally {
    cryptor.destroy();
  }
}
