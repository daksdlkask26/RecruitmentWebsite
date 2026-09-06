import "server-only";

import { randomBytes } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  open,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  assertInventoryLimit,
  assertStorageByteCount,
  CvStorageError,
  sensitiveStorageLocator,
  type PrivateCvStorage,
  type PrivateCvStorageInventory,
  type PrivateCvStorageItem,
} from "./private-cv-storage";

const locatorPattern = /^[A-Za-z0-9_-]{32,128}$/u;
const temporaryPattern = /^\.[A-Za-z0-9_-]{32,128}[.]partial$/u;

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path.length > 0 && !path.startsWith("..") && !isAbsolute(path);
}

export class FilesystemPrivateCvStorage implements PrivateCvStorage {
  private readonly root: string;
  private readyRoot: string | null = null;

  constructor(input: Readonly<{ root: string }>) {
    if (!isAbsolute(input.root)) {
      throw new CvStorageError("CV_STORAGE_CONFIGURATION_INVALID");
    }
    this.root = resolve(input.root);
  }

  private isDockerDesktopBindMount(): boolean {
    return (
      process.env.CV_STORAGE_DOCKER_BIND_MOUNT === "true" &&
      process.env.APP_ENV !== "production" &&
      this.root === "/app/.local/cv-storage"
    );
  }

  async assertReady(): Promise<void> {
    try {
      const metadata = await lstat(this.root);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new CvStorageError("CV_STORAGE_NOT_READY");
      }
      const dockerDesktopBindMount = this.isDockerDesktopBindMount();
      if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
        if (!dockerDesktopBindMount) {
          await chmod(this.root, 0o700);
          const secured = await lstat(this.root);
          if ((secured.mode & 0o077) !== 0) {
            throw new CvStorageError("CV_STORAGE_NOT_READY");
          }
        }
      }
      this.readyRoot = await realpath(this.root);
    } catch (error) {
      if (error instanceof CvStorageError) throw error;
      throw new CvStorageError("CV_STORAGE_NOT_READY");
    }
  }

  private requireReadyRoot(): string {
    if (!this.readyRoot) throw new CvStorageError("CV_STORAGE_NOT_READY");
    return this.readyRoot;
  }

  private pathFor(locator: string): string {
    const root = this.requireReadyRoot();
    if (!locatorPattern.test(locator)) {
      throw new CvStorageError("CV_STORAGE_LOCATOR_INVALID");
    }
    const candidate = resolve(root, locator);
    if (!isWithin(root, candidate)) {
      throw new CvStorageError("CV_STORAGE_LOCATOR_INVALID");
    }
    return candidate;
  }

  async put(input: {
    source: AsyncIterable<Uint8Array>;
    expectedBytes: number;
    locator?: string;
  }): Promise<PrivateCvStorageItem> {
    assertStorageByteCount(input.expectedBytes);
    const root = this.requireReadyRoot();
    const locator = input.locator ?? randomBytes(32).toString("base64url");
    if (!locatorPattern.test(locator)) {
      throw new CvStorageError("CV_STORAGE_LOCATOR_INVALID");
    }
    const finalPath = this.pathFor(locator);
    const temporaryPath = join(root, `.${locator}.partial`);
    const handle = await open(temporaryPath, "wx", 0o600).catch(() => {
      throw new CvStorageError("CV_STORAGE_OPERATION_FAILED");
    });
    let received = 0;
    let finalized = false;
    try {
      for await (const sourceChunk of input.source) {
        const chunk = Buffer.from(sourceChunk);
        received += chunk.byteLength;
        if (received > input.expectedBytes) {
          throw new CvStorageError("CV_STORAGE_LENGTH_MISMATCH");
        }
        await handle.write(chunk);
      }
      if (received !== input.expectedBytes) {
        throw new CvStorageError("CV_STORAGE_LENGTH_MISMATCH");
      }
      await handle.sync();
      await handle.close();
      if (this.isDockerDesktopBindMount()) {
        try {
          await lstat(finalPath);
          throw new CvStorageError("CV_STORAGE_OBJECT_EXISTS");
        } catch (error) {
          if (error instanceof CvStorageError) throw error;
          if (
            !(
              error &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "ENOENT"
            )
          ) {
            throw new CvStorageError("CV_STORAGE_OPERATION_FAILED");
          }
        }
        await rename(temporaryPath, finalPath).catch((error: unknown) => {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "EEXIST"
          ) {
            throw new CvStorageError("CV_STORAGE_OBJECT_EXISTS");
          }
          throw new CvStorageError("CV_STORAGE_OPERATION_FAILED");
        });
        finalized = true;
      } else {
        await link(temporaryPath, finalPath).catch((error: unknown) => {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "EEXIST"
          ) {
            throw new CvStorageError("CV_STORAGE_OBJECT_EXISTS");
          }
          throw new CvStorageError("CV_STORAGE_OPERATION_FAILED");
        });
        finalized = true;
        await unlink(temporaryPath);
      }
      return Object.freeze({
        locator: sensitiveStorageLocator(locator),
        bytes: received,
      });
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      if (finalized) await unlink(finalPath).catch(() => undefined);
      if (error instanceof CvStorageError) throw error;
      throw new CvStorageError("CV_STORAGE_OPERATION_FAILED");
    }
  }

  async *open(
    locator: string,
    expectedBytes: number,
  ): AsyncGenerator<Uint8Array> {
    assertStorageByteCount(expectedBytes);
    const root = this.requireReadyRoot();
    const path = this.pathFor(locator);
    let resolvedPath: string;
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new CvStorageError("CV_STORAGE_LOCATOR_INVALID");
      }
      resolvedPath = await realpath(path);
      if (!isWithin(root, resolvedPath)) {
        throw new CvStorageError("CV_STORAGE_LOCATOR_INVALID");
      }
      if (metadata.size !== expectedBytes) {
        throw new CvStorageError("CV_STORAGE_LENGTH_MISMATCH");
      }
    } catch (error) {
      if (error instanceof CvStorageError) throw error;
      throw new CvStorageError("CV_STORAGE_OBJECT_NOT_FOUND");
    }
    const handle = await open(resolvedPath, "r").catch(() => {
      throw new CvStorageError("CV_STORAGE_OBJECT_NOT_FOUND");
    });
    let received = 0;
    try {
      const stream = handle.createReadStream({ autoClose: false });
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk);
        received += bytes.byteLength;
        if (received > expectedBytes) {
          throw new CvStorageError("CV_STORAGE_LENGTH_MISMATCH");
        }
        yield bytes;
      }
      if (received !== expectedBytes) {
        throw new CvStorageError("CV_STORAGE_LENGTH_MISMATCH");
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  async delete(locator: string): Promise<Readonly<{ deleted: boolean }>> {
    const path = this.pathFor(locator);
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new CvStorageError("CV_STORAGE_LOCATOR_INVALID");
      }
      await unlink(path);
      return Object.freeze({ deleted: true });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return Object.freeze({ deleted: false });
      }
      if (error instanceof CvStorageError) throw error;
      throw new CvStorageError("CV_STORAGE_OPERATION_FAILED");
    }
  }

  async inventory(input: {
    limit: number;
    cursor?: string;
  }): Promise<PrivateCvStorageInventory> {
    assertInventoryLimit(input.limit);
    const root = this.requireReadyRoot();
    const offset = input.cursor === undefined ? 0 : Number(input.cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new CvStorageError("CV_STORAGE_LOCATOR_INVALID");
    }
    const names = (await readdir(root))
      .filter(
        (name) => locatorPattern.test(name) && !temporaryPattern.test(name),
      )
      .sort();
    const page = names.slice(offset, offset + input.limit);
    const items = await Promise.all(
      page.map(async (locator) => {
        const metadata = await stat(join(root, locator));
        return {
          locator: sensitiveStorageLocator(locator),
          bytes: metadata.size,
          createdAt: metadata.birthtime,
        };
      }),
    );
    const nextOffset = offset + page.length;
    return Object.freeze({
      items: Object.freeze(items),
      ...(nextOffset < names.length ? { nextCursor: String(nextOffset) } : {}),
    });
  }
}
