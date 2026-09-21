import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  PrivateBusinessEvidenceStorage,
  StoredEvidence,
} from "./private-business-evidence-storage";

function key() {
  const configured = process.env.ADMIN_EVIDENCE_KEY_V1;
  if (configured && Buffer.from(configured, "base64").byteLength === 32)
    return Buffer.from(configured, "base64");
  return createHash("sha256")
    .update(process.env.TOKEN_SECRET ?? "test-business-evidence")
    .digest();
}

function defaultRoot() {
  const workingDirectory = resolve(/* turbopackIgnore: true */ process.cwd());
  const workspaceWebRoot = resolve(workingDirectory, "web");

  // The root development supervisor starts the web workspace with the
  // repository root as cwd, while direct workspace commands use web/ as cwd.
  // Keep both entry points on the same private directory so an evidence row
  // never becomes unreadable merely because the server was restarted from a
  // different workspace directory.
  return existsSync(resolve(workspaceWebRoot, "package.json"))
    ? resolve(workspaceWebRoot, ".private-admin-evidence")
    : resolve(workingDirectory, ".private-admin-evidence");
}

export class FilesystemPrivateBusinessEvidenceStorage implements PrivateBusinessEvidenceStorage {
  constructor(
    private readonly root = process.env.ADMIN_EVIDENCE_STORAGE_ROOT ??
      defaultRoot(),
  ) {}

  private path(locator: string) {
    const root = resolve(this.root);
    const path = resolve(root, locator);
    const child = relative(root, path);
    if (!child || child.startsWith("..") || isAbsolute(child))
      throw new Error("UNAVAILABLE");
    return path;
  }

  async write(reference: string, bytes: Buffer): Promise<StoredEvidence> {
    await mkdir(this.root, { recursive: true });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(), iv);
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const locator = `${createHash("sha256").update(reference).digest("hex")}.bin`;
    await writeFile(this.path(locator), encrypted, { flag: "wx", mode: 0o600 });
    return {
      storageAdapter: "filesystem",
      storageLocator: locator,
      encryptionKeyVersion: 1,
      iv: iv.toString("base64"),
      authenticationTag: cipher.getAuthTag().toString("base64"),
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength,
    };
  }

  async read(
    locator: string,
    metadata: { iv: string; authenticationTag: string },
  ) {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(metadata.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(metadata.authenticationTag, "base64"));
    return Buffer.concat([
      decipher.update(await readFile(this.path(locator))),
      decipher.final(),
    ]);
  }

  async delete(locator: string) {
    await unlink(this.path(locator)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
