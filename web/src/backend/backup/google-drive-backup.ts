import "server-only";

import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

type OAuthClientFile = { web?: { client_id?: string; client_secret?: string } };
type OAuthTokenFile = { refresh_token?: string };

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`BACKUP_${name}_MISSING`);
  return value;
}

async function credentials(): Promise<{
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}> {
  const client = JSON.parse(
    await readFile(required("GOOGLE_DRIVE_BACKUP_CLIENT_PATH"), "utf8"),
  ) as OAuthClientFile;
  const token = JSON.parse(
    await readFile(required("GOOGLE_DRIVE_BACKUP_TOKEN_PATH"), "utf8"),
  ) as OAuthTokenFile;
  if (
    !client.web?.client_id ||
    !client.web.client_secret ||
    !token.refresh_token
  )
    throw new Error("BACKUP_GOOGLE_OAUTH_INVALID");
  return {
    clientId: client.web.client_id,
    clientSecret: client.web.client_secret,
    refreshToken: token.refresh_token,
  };
}

function encrypted(content: Buffer) {
  const key = Buffer.from(required("BACKUP_ENCRYPTION_KEY"), "base64");
  if (key.byteLength !== 32) throw new Error("BACKUP_ENCRYPTION_KEY_INVALID");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(content), cipher.final()]);
  return Buffer.concat([
    Buffer.from("SMARTHIRE-BACKUP-1\n"),
    iv,
    cipher.getAuthTag(),
    body,
  ]);
}

async function createFolder(
  accessToken: string,
  name: string,
  signal: AbortSignal,
) {
  const response = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name,
        parents: [required("GOOGLE_DRIVE_BACKUP_FOLDER_ID")],
        mimeType: "application/vnd.google-apps.folder",
      }),
      signal,
    },
  );
  const folder = (await response.json()) as { id?: string };
  if (!response.ok || !folder.id)
    throw new Error("BACKUP_GOOGLE_FOLDER_FAILED");
  return folder.id;
}

async function accessToken(
  oauth: { clientId: string; clientSecret: string; refreshToken: string },
  signal: AbortSignal,
) {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: oauth.refreshToken,
      grant_type: "refresh_token",
    }),
    signal,
  });
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenResponse.ok || !token.access_token)
    throw new Error("BACKUP_GOOGLE_TOKEN_FAILED");
  return token.access_token;
}

export async function uploadEncryptedBackup(input: {
  name: string;
  folderName: string;
  content: Buffer;
  timeoutMs?: number;
}) {
  const oauth = await credentials();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? 8 * 60_000,
  );
  let driveFolderId: string | null = null;
  try {
    const token = await accessToken(oauth, controller.signal);
    driveFolderId = await createFolder(
      token,
      input.folderName,
      controller.signal,
    );
    const boundary = "smarthire-" + randomBytes(12).toString("hex");
    const body = encrypted(input.content);
    const metadata = JSON.stringify({
      name: input.name,
      parents: [driveFolderId],
      mimeType: "application/octet-stream",
    });
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      body,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": `multipart/related; boundary=${boundary}`,
        },
        body: multipart,
        signal: controller.signal,
      },
    );
    const file = (await response.json()) as { id?: string };
    if (!response.ok || !file.id)
      throw new Error("BACKUP_GOOGLE_UPLOAD_FAILED");
    return {
      driveFileId: file.id,
      driveFolderId,
      checksum: createHash("sha256").update(input.content).digest("hex"),
      byteCount: input.content.byteLength,
    };
  } catch (error) {
    if (driveFolderId) {
      await deleteDriveResources([driveFolderId]).catch(() => undefined);
    }
    if (controller.signal.aborted)
      throw new Error("BACKUP_UPLOAD_TIMEOUT", { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function deleteUploadedBackup(input: {
  driveFileId: string;
  driveFolderId?: string;
  timeoutMs?: number;
}) {
  return deleteDriveResources(
    [input.driveFileId, input.driveFolderId].filter(
      (resourceId): resourceId is string => Boolean(resourceId),
    ),
    input.timeoutMs,
  );
}

async function deleteDriveResources(resourceIds: string[], timeoutMs = 60_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = await accessToken(await credentials(), controller.signal);
    for (const resourceId of resourceIds) {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(resourceId)}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        },
      );
      if (!response.ok && response.status !== 404)
        throw new Error("BACKUP_GOOGLE_DELETE_FAILED");
    }
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("BACKUP_DELETE_TIMEOUT", { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
