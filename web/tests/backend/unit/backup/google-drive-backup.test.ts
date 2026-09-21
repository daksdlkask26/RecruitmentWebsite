import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { uploadEncryptedBackup } from "@/backend/backup/google-drive-backup";

describe("Google Drive backup cleanup", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "phase8-drive-backup-"));
    const clientPath = join(directory, "client.json");
    const tokenPath = join(directory, "token.json");
    await writeFile(
      clientPath,
      JSON.stringify({ web: { client_id: "client", client_secret: "secret" } }),
    );
    await writeFile(tokenPath, JSON.stringify({ refresh_token: "refresh" }));
    process.env.GOOGLE_DRIVE_BACKUP_CLIENT_PATH = clientPath;
    process.env.GOOGLE_DRIVE_BACKUP_TOKEN_PATH = tokenPath;
    process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID = "backup-root";
    process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    delete process.env.GOOGLE_DRIVE_BACKUP_CLIENT_PATH;
    delete process.env.GOOGLE_DRIVE_BACKUP_TOKEN_PATH;
    delete process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
    delete process.env.BACKUP_ENCRYPTION_KEY;
    await rm(directory, { recursive: true, force: true });
  });

  it("deletes a newly created folder when the upload fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "access-1" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "folder-1" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "upload failed" }), {
          status: 500,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "access-2" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadEncryptedBackup({
        name: "postgresql.dump.enc",
        folderName: "backup-1",
        content: Buffer.from("dump"),
      }),
    ).rejects.toThrow("BACKUP_GOOGLE_UPLOAD_FAILED");

    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://www.googleapis.com/drive/v3/files/folder-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
