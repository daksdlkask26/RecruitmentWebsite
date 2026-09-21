import "server-only";

import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  collectExact,
  openSearchEnvelope,
  sealSearchArtifact,
  SearchStorageFailure,
  type OpenSearchArtifact,
  type PrivateSearchArtifactStorage,
  type SearchArtifactLocator,
  type SearchStorageKeyring,
  type StoredSearchArtifact,
} from "./private-search-storage";

type Options = Readonly<{ root: string; keyring: SearchStorageKeyring }>;

function safeName(locator: SearchArtifactLocator): string {
  const value = String(locator);
  if (!/^[a-f0-9-]{36}\.bin$/u.test(value) || basename(value) !== value) {
    throw new SearchStorageFailure("SEARCH_STORAGE_LOCATOR_INVALID");
  }
  return value;
}

export class FilesystemPrivateSearchArtifactStorage implements PrivateSearchArtifactStorage {
  private readonly root: string;

  constructor(private readonly options: Options) {
    this.root = resolve(options.root);
  }

  private usesDockerDesktopBindMount(): boolean {
    return (
      process.env.IMAGE_SEARCH_STORAGE_DOCKER_BIND_MOUNT === "true" &&
      process.env.APP_ENV !== "production" &&
      this.root === "/app/.local/image-search-storage"
    );
  }

  async assertReady(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    // Docker Desktop bind mounts backed by Windows do not implement chmod and
    // return EPERM. This explicit local-only gate mirrors CV storage; Linux
    // deployments still enforce the private POSIX modes below.
    if (!this.usesDockerDesktopBindMount()) {
      await chmod(this.root, 0o700);
    }
    const details = await stat(this.root);
    if (!details.isDirectory()) {
      throw new SearchStorageFailure("SEARCH_STORAGE_NOT_READY");
    }
  }

  async put(input: {
    source: AsyncIterable<Uint8Array>;
    expectedBytes: number;
    context: Parameters<typeof sealSearchArtifact>[1];
  }): Promise<StoredSearchArtifact> {
    await this.assertReady();
    const plaintext = await collectExact(input.source, input.expectedBytes);
    const sealed = sealSearchArtifact(
      plaintext,
      input.context,
      this.options.keyring,
    );
    const locator = `${randomUUID()}.bin` as SearchArtifactLocator;
    const path = join(this.root, locator);
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(sealed.envelope);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!this.usesDockerDesktopBindMount()) {
      await chmod(path, 0o600);
    }
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
    const path = join(this.root, safeName(input.locator));
    let envelope: Buffer;
    try {
      envelope = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new SearchStorageFailure("SEARCH_STORAGE_NOT_FOUND");
      }
      throw error;
    }
    yield openSearchEnvelope(envelope, input, this.options.keyring);
  }

  async delete(
    locator: SearchArtifactLocator,
  ): Promise<"DELETED" | "ALREADY_ABSENT"> {
    try {
      await unlink(join(this.root, safeName(locator)));
      return "DELETED";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "ALREADY_ABSENT";
      }
      throw error;
    }
  }
}
