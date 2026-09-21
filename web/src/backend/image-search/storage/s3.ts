import "server-only";

import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import {
  collectExact,
  openSearchEnvelope,
  sealSearchArtifact,
  SearchStorageFailure,
  type OpenSearchArtifact,
  type PrivateSearchArtifactStorage,
  type SearchArtifactLocator,
  type SearchStorageContext,
  type SearchStorageKeyring,
  type StoredSearchArtifact,
} from "./private-search-storage";

type S3Port = Readonly<{
  send(command: unknown): Promise<unknown>;
}>;
type Options = Readonly<{
  client: S3Port;
  bucket: string;
  region: string;
  prefix: string;
  kmsKeyId: string;
  keyring: SearchStorageKeyring;
}>;

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body && typeof body === "object" && Symbol.asyncIterator in body) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new SearchStorageFailure("SEARCH_STORAGE_INTEGRITY_FAILED");
}

function locatorName(locator: SearchArtifactLocator): string {
  const value = String(locator);
  if (!/^[a-f0-9-]{36}\.bin$/u.test(value)) {
    throw new SearchStorageFailure("SEARCH_STORAGE_LOCATOR_INVALID");
  }
  return value;
}

export class S3PrivateSearchArtifactStorage implements PrivateSearchArtifactStorage {
  private readonly deletedLocators = new Set<string>();

  constructor(private readonly options: Options) {
    if (!options.prefix.endsWith("/") || options.prefix.startsWith("/")) {
      throw new SearchStorageFailure("SEARCH_STORAGE_PREFIX_INVALID");
    }
  }

  async assertReady(): Promise<void> {
    await this.options.client.send(
      new HeadBucketCommand({ Bucket: this.options.bucket }),
    );
  }

  async put(input: {
    source: AsyncIterable<Uint8Array>;
    expectedBytes: number;
    context: SearchStorageContext;
  }): Promise<StoredSearchArtifact> {
    const plaintext = await collectExact(input.source, input.expectedBytes);
    const sealed = sealSearchArtifact(
      plaintext,
      input.context,
      this.options.keyring,
    );
    const locator = `${randomUUID()}.bin` as SearchArtifactLocator;
    await this.options.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: `${this.options.prefix}${locator}`,
        Body: Readable.from([sealed.envelope]),
        ContentLength: sealed.envelope.byteLength,
        ContentType: "application/octet-stream",
        CacheControl: "no-store",
        IfNoneMatch: "*",
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: this.options.kmsKeyId,
        BucketKeyEnabled: true,
      }),
    );
    return {
      locator,
      plaintextBytes: sealed.plaintextBytes,
      ciphertextBytes: sealed.ciphertextBytes,
      plaintextSha256: sealed.plaintextSha256,
      encryptionKeyVersion: sealed.encryptionKeyVersion,
      encryptionIv: sealed.encryptionIv,
      authenticationTag: sealed.authenticationTag,
    };
  }

  async *open(input: OpenSearchArtifact): AsyncIterable<Uint8Array> {
    let response: unknown;
    try {
      response = await this.options.client.send(
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: `${this.options.prefix}${locatorName(input.locator)}`,
        }),
      );
    } catch (error) {
      if (["NoSuchKey", "NotFound"].includes((error as Error).name)) {
        throw new SearchStorageFailure("SEARCH_STORAGE_NOT_FOUND");
      }
      throw error;
    }
    const envelope = await bodyToBuffer((response as { Body?: unknown }).Body);
    yield openSearchEnvelope(envelope, input, this.options.keyring);
  }

  async delete(
    locator: SearchArtifactLocator,
  ): Promise<"DELETED" | "ALREADY_ABSENT"> {
    const name = locatorName(locator);
    if (this.deletedLocators.has(name)) return "ALREADY_ABSENT";
    // S3 DeleteObject is deliberately idempotent; absence is a successful state.
    await this.options.client.send(
      new DeleteObjectCommand({
        Bucket: this.options.bucket,
        Key: `${this.options.prefix}${name}`,
      }),
    );
    this.deletedLocators.add(name);
    return "DELETED";
  }
}
