import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SEARCH_STORAGE_ASSOCIATED_DATA_VERSION =
  "search-image-artifact-v1" as const;

declare const searchLocatorBrand: unique symbol;
export type SearchArtifactLocator = string & {
  readonly [searchLocatorBrand]: true;
};

export type SearchStorageContext = Readonly<{
  queryId: string;
  artifactId: string;
  kind: "SOURCE_IMAGE" | "NORMALIZED_IMAGE" | "OCR_TEXT" | "VALIDATED_INTENT";
}>;

export type SearchStorageKeyring = Readonly<{
  activeKeyVersion: number;
  keys: ReadonlyMap<number, Uint8Array>;
}>;

export type StoredSearchArtifact = Readonly<{
  locator: SearchArtifactLocator;
  plaintextBytes: number;
  ciphertextBytes: number;
  plaintextSha256: Uint8Array;
  encryptionKeyVersion: number;
  encryptionIv: Uint8Array;
  authenticationTag: Uint8Array;
}>;

export type OpenSearchArtifact = Readonly<{
  locator: SearchArtifactLocator;
  context: SearchStorageContext;
  authenticationTag?: Uint8Array;
}>;

export interface PrivateSearchArtifactStorage {
  assertReady(): Promise<void>;
  put(input: {
    source: AsyncIterable<Uint8Array>;
    expectedBytes: number;
    context: SearchStorageContext;
  }): Promise<StoredSearchArtifact>;
  open(input: OpenSearchArtifact): AsyncIterable<Uint8Array>;
  delete(locator: SearchArtifactLocator): Promise<"DELETED" | "ALREADY_ABSENT">;
}

const MAGIC = Buffer.from("SHIS1", "ascii");

function contextBytes(context: SearchStorageContext): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: SEARCH_STORAGE_ASSOCIATED_DATA_VERSION,
      queryId: context.queryId,
      artifactId: context.artifactId,
      kind: context.kind,
    }),
    "utf8",
  );
}

export class SearchStorageFailure extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "SearchStorageFailure";
  }
}

export async function collectExact(
  source: AsyncIterable<Uint8Array>,
  expectedBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
    throw new SearchStorageFailure("SEARCH_STORAGE_LENGTH_MISMATCH");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of source) {
    bytes += chunk.byteLength;
    if (bytes > expectedBytes) {
      throw new SearchStorageFailure("SEARCH_STORAGE_LENGTH_MISMATCH");
    }
    chunks.push(Buffer.from(chunk));
  }
  if (bytes !== expectedBytes) {
    throw new SearchStorageFailure("SEARCH_STORAGE_LENGTH_MISMATCH");
  }
  return Buffer.concat(chunks, bytes);
}

export function sealSearchArtifact(
  plaintext: Uint8Array,
  context: SearchStorageContext,
  keyring: SearchStorageKeyring,
): StoredSearchArtifact & { envelope: Buffer } {
  const keyVersion = keyring.activeKeyVersion;
  const key = keyring.keys.get(keyVersion);
  if (!key || key.byteLength !== 32) {
    throw new SearchStorageFailure("SEARCH_STORAGE_KEY_UNAVAILABLE");
  }
  const associatedData = contextBytes(context);
  const contextDigest = createHmac("sha256", key)
    .update(associatedData)
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const version = Buffer.allocUnsafe(4);
  version.writeUInt32BE(keyVersion);
  const envelope = Buffer.concat([
    MAGIC,
    version,
    contextDigest,
    iv,
    tag,
    ciphertext,
  ]);
  return {
    locator: "" as SearchArtifactLocator,
    plaintextBytes: plaintext.byteLength,
    ciphertextBytes: envelope.byteLength,
    plaintextSha256: createHash("sha256").update(plaintext).digest(),
    encryptionKeyVersion: keyVersion,
    encryptionIv: iv,
    authenticationTag: tag,
    envelope,
  };
}

export function openSearchEnvelope(
  envelope: Uint8Array,
  input: OpenSearchArtifact,
  keyring: SearchStorageKeyring,
): Buffer {
  const bytes = Buffer.from(envelope);
  if (bytes.byteLength < 69 || !bytes.subarray(0, 5).equals(MAGIC)) {
    throw new SearchStorageFailure("SEARCH_STORAGE_INTEGRITY_FAILED");
  }
  const version = bytes.readUInt32BE(5);
  const key = keyring.keys.get(version);
  if (!key) throw new SearchStorageFailure("SEARCH_STORAGE_KEY_UNAVAILABLE");
  const associatedData = contextBytes(input.context);
  const actualContextDigest = bytes.subarray(9, 41);
  const expectedContextDigest = createHmac("sha256", key)
    .update(associatedData)
    .digest();
  if (!timingSafeEqual(actualContextDigest, expectedContextDigest)) {
    throw new SearchStorageFailure("SEARCH_STORAGE_CONTEXT_MISMATCH");
  }
  const iv = bytes.subarray(41, 53);
  const storedTag = bytes.subarray(53, 69);
  const tag = input.authenticationTag
    ? Buffer.from(input.authenticationTag)
    : storedTag;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(associatedData);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(bytes.subarray(69)),
      decipher.final(),
    ]);
  } catch {
    throw new SearchStorageFailure("SEARCH_STORAGE_INTEGRITY_FAILED");
  }
}
