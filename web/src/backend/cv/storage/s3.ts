import "server-only";

import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketPolicyStatusCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetPublicAccessBlockCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import {
  assertInventoryLimit,
  assertStorageByteCount,
  CvStorageError,
  sensitiveStorageLocator,
  type PrivateCvStorage,
  type PrivateCvStorageInventory,
  type PrivateCvStorageItem,
} from "./private-cv-storage";

interface CvS3Client {
  send(command: never): Promise<unknown>;
}

type S3StorageOptions = Readonly<{
  client: CvS3Client;
  bucket: string;
  region: string;
  kmsKeyId: string;
  prefix?: string;
  locatorFactory?: () => string;
}>;

const locatorPattern = /^[A-Za-z0-9_-]{16,128}$/u;

function errorName(error: unknown): string | null {
  return error && typeof error === "object" && "name" in error
    ? String(error.name)
    : null;
}

function isMissing(error: unknown): boolean {
  return ["NoSuchKey", "NotFound", "NoSuchBucket"].includes(
    errorName(error) ?? "",
  );
}

export class S3PrivateCvStorage implements PrivateCvStorage {
  private readonly prefix: string;
  private readonly locatorFactory: () => string;
  private ready = false;

  constructor(private readonly options: S3StorageOptions) {
    if (
      !options.bucket ||
      !options.region ||
      !options.kmsKeyId ||
      typeof options.client?.send !== "function"
    ) {
      throw new CvStorageError("CV_STORAGE_CONFIGURATION_INVALID");
    }
    this.prefix = (options.prefix ?? "cv-artifacts").replace(/^\/+|\/+$/gu, "");
    if (!this.prefix || this.prefix.includes("..")) {
      throw new CvStorageError("CV_STORAGE_CONFIGURATION_INVALID");
    }
    this.locatorFactory =
      options.locatorFactory ?? (() => randomBytes(32).toString("base64url"));
  }

  private async send<T>(command: object): Promise<T> {
    return (await (
      this.options.client.send as unknown as (value: object) => Promise<unknown>
    )(command)) as T;
  }

  private objectKey(locator: string): string {
    if (!locatorPattern.test(locator)) {
      throw new CvStorageError("CV_STORAGE_LOCATOR_INVALID");
    }
    return `${this.prefix}/${locator}`;
  }

  private requireReady(): void {
    if (!this.ready) throw new CvStorageError("CV_STORAGE_NOT_READY");
  }

  async assertReady(): Promise<void> {
    try {
      const access = await this.send<{
        PublicAccessBlockConfiguration?: Record<string, boolean>;
      }>(new GetPublicAccessBlockCommand({ Bucket: this.options.bucket }));
      const policy = access.PublicAccessBlockConfiguration;
      if (
        !policy?.BlockPublicAcls ||
        !policy.IgnorePublicAcls ||
        !policy.BlockPublicPolicy ||
        !policy.RestrictPublicBuckets
      ) {
        throw new CvStorageError("CV_STORAGE_NOT_READY");
      }
      const policyStatus = await this.send<{
        PolicyStatus?: { IsPublic?: boolean };
      }>(new GetBucketPolicyStatusCommand({ Bucket: this.options.bucket }));
      if (policyStatus.PolicyStatus?.IsPublic !== false) {
        throw new CvStorageError("CV_STORAGE_NOT_READY");
      }
      const versioning = await this.send<{ Status?: string }>(
        new GetBucketVersioningCommand({ Bucket: this.options.bucket }),
      );
      if (versioning.Status !== undefined) {
        throw new CvStorageError("CV_STORAGE_NOT_READY");
      }
      const encryption = await this.send<{
        ServerSideEncryptionConfiguration?: {
          Rules?: Array<{
            ApplyServerSideEncryptionByDefault?: {
              SSEAlgorithm?: string;
              KMSMasterKeyID?: string;
            };
            BucketKeyEnabled?: boolean;
          }>;
        };
      }>(new GetBucketEncryptionCommand({ Bucket: this.options.bucket }));
      const rule = encryption.ServerSideEncryptionConfiguration?.Rules?.[0];
      if (
        rule?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm !== "aws:kms" ||
        rule.ApplyServerSideEncryptionByDefault.KMSMasterKeyID !==
          this.options.kmsKeyId ||
        rule.BucketKeyEnabled !== true
      ) {
        throw new CvStorageError("CV_STORAGE_NOT_READY");
      }
      const lifecycle = await this.send<{
        Rules?: Array<{
          Status?: string;
          Prefix?: string;
          Filter?: { Prefix?: string };
          Expiration?: { Days?: number };
          AbortIncompleteMultipartUpload?: { DaysAfterInitiation?: number };
          NoncurrentVersionExpiration?: unknown;
          NoncurrentVersionTransitions?: unknown;
        }>;
      }>(
        new GetBucketLifecycleConfigurationCommand({
          Bucket: this.options.bucket,
        }),
      );
      const retentionRule = lifecycle.Rules?.find((candidate) => {
        const rulePrefix = candidate.Filter?.Prefix ?? candidate.Prefix ?? "";
        return (
          candidate.Status === "Enabled" &&
          (rulePrefix === this.prefix || rulePrefix === `${this.prefix}/`) &&
          Number.isInteger(candidate.Expiration?.Days) &&
          (candidate.Expiration?.Days ?? 0) >= 1 &&
          (candidate.Expiration?.Days ?? 32) <= 31 &&
          Number.isInteger(
            candidate.AbortIncompleteMultipartUpload?.DaysAfterInitiation,
          ) &&
          (candidate.AbortIncompleteMultipartUpload?.DaysAfterInitiation ??
            0) >= 1 &&
          (candidate.AbortIncompleteMultipartUpload?.DaysAfterInitiation ??
            2) <= 1 &&
          candidate.NoncurrentVersionExpiration === undefined &&
          candidate.NoncurrentVersionTransitions === undefined
        );
      });
      if (!retentionRule) {
        throw new CvStorageError("CV_STORAGE_NOT_READY");
      }
      this.ready = true;
    } catch (error) {
      this.ready = false;
      if (error instanceof CvStorageError) throw error;
      throw new CvStorageError("CV_STORAGE_NOT_READY");
    }
  }

  async put(input: {
    source: AsyncIterable<Uint8Array>;
    expectedBytes: number;
    locator?: string;
  }): Promise<PrivateCvStorageItem> {
    this.requireReady();
    assertStorageByteCount(input.expectedBytes);
    const locator = input.locator ?? this.locatorFactory();
    if (!locatorPattern.test(locator)) {
      throw new CvStorageError("CV_STORAGE_LOCATOR_INVALID");
    }
    const key = this.objectKey(locator);
    let received = 0;
    const counted = async function* () {
      for await (const value of input.source) {
        const chunk = Buffer.from(value);
        received += chunk.byteLength;
        if (received > input.expectedBytes) {
          throw new CvStorageError("CV_STORAGE_LENGTH_MISMATCH");
        }
        yield chunk;
      }
    };
    try {
      await this.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          Body: Readable.from(counted()),
          ContentLength: input.expectedBytes,
          IfNoneMatch: "*",
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: this.options.kmsKeyId,
          BucketKeyEnabled: true,
        }),
      );
      if (received !== input.expectedBytes) {
        await this.send(
          new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }),
        ).catch(() => undefined);
        throw new CvStorageError("CV_STORAGE_LENGTH_MISMATCH");
      }
      return Object.freeze({
        locator: sensitiveStorageLocator(locator),
        bytes: received,
      });
    } catch (error) {
      if (error instanceof CvStorageError) throw error;
      if (
        errorName(error) === "PreconditionFailed" ||
        (error &&
          typeof error === "object" &&
          "$metadata" in error &&
          (error.$metadata as { httpStatusCode?: number }).httpStatusCode ===
            412)
      ) {
        throw new CvStorageError("CV_STORAGE_OBJECT_EXISTS");
      }
      throw new CvStorageError("CV_STORAGE_OPERATION_FAILED");
    }
  }

  async *open(
    locator: string,
    expectedBytes: number,
  ): AsyncGenerator<Uint8Array> {
    this.requireReady();
    assertStorageByteCount(expectedBytes);
    const key = this.objectKey(locator);
    let response: { Body?: unknown; ContentLength?: number };
    try {
      response = await this.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
    } catch (error) {
      if (isMissing(error))
        throw new CvStorageError("CV_STORAGE_OBJECT_NOT_FOUND");
      throw new CvStorageError("CV_STORAGE_OPERATION_FAILED");
    }
    if (response.ContentLength !== expectedBytes) {
      throw new CvStorageError("CV_STORAGE_LENGTH_MISMATCH");
    }
    const body = response.Body;
    if (!body || !(Symbol.asyncIterator in Object(body))) {
      throw new CvStorageError("CV_STORAGE_OPERATION_FAILED");
    }
    let received = 0;
    for await (const value of body as AsyncIterable<Uint8Array>) {
      const chunk = Buffer.from(value);
      received += chunk.byteLength;
      if (received > expectedBytes) {
        throw new CvStorageError("CV_STORAGE_LENGTH_MISMATCH");
      }
      yield chunk;
    }
    if (received !== expectedBytes) {
      throw new CvStorageError("CV_STORAGE_LENGTH_MISMATCH");
    }
  }

  async delete(locator: string): Promise<Readonly<{ deleted: boolean }>> {
    this.requireReady();
    const key = this.objectKey(locator);
    try {
      await this.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
    } catch (error) {
      if (isMissing(error)) return Object.freeze({ deleted: false });
      throw new CvStorageError("CV_STORAGE_OPERATION_FAILED");
    }
    try {
      await this.send(
        new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      return Object.freeze({ deleted: true });
    } catch {
      throw new CvStorageError("CV_STORAGE_OPERATION_FAILED");
    }
  }

  async inventory(input: {
    limit: number;
    cursor?: string;
  }): Promise<PrivateCvStorageInventory> {
    this.requireReady();
    assertInventoryLimit(input.limit);
    try {
      const response = await this.send<{
        Contents?: Array<{ Key?: string; Size?: number; LastModified?: Date }>;
        IsTruncated?: boolean;
        NextContinuationToken?: string;
      }>(
        new ListObjectsV2Command({
          Bucket: this.options.bucket,
          Prefix: `${this.prefix}/`,
          MaxKeys: input.limit,
          ContinuationToken: input.cursor,
        }),
      );
      const items = (response.Contents ?? []).flatMap((item) => {
        const key = item.Key ?? "";
        const locator = key.startsWith(`${this.prefix}/`)
          ? key.slice(this.prefix.length + 1)
          : "";
        return locatorPattern.test(locator) && Number.isSafeInteger(item.Size)
          ? [
              Object.freeze({
                locator: sensitiveStorageLocator(locator),
                bytes: item.Size ?? 0,
                ...(item.LastModified ? { createdAt: item.LastModified } : {}),
              }),
            ]
          : [];
      });
      return Object.freeze({
        items: Object.freeze(items),
        ...(response.IsTruncated && response.NextContinuationToken
          ? { nextCursor: response.NextContinuationToken }
          : {}),
      });
    } catch (error) {
      if (error instanceof CvStorageError) throw error;
      throw new CvStorageError("CV_STORAGE_OPERATION_FAILED");
    }
  }
}
