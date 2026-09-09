import { Buffer } from "node:buffer";
import { readdir, readFile, unlink } from "node:fs/promises";
import { relative, resolve } from "node:path";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";
import sharp from "sharp";

import { createSyntheticImageDocx } from "../../../helpers/cv-document-buffers";
import { cleanupReviewAccounts } from "../../../helpers/cv-review-fixture";

test.describe.configure({ mode: "serial" });

const password = "Synthetic hybrid OCR CV 005!";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const contexts: BrowserContext[] = [];
const candidateEmails = new Set<string>();
const corpusRoot = resolve(process.cwd(), "tests/fixtures/ocr-corpus");

function pdfObject(id: number, body: string | Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`${id} 0 obj\n`, "latin1"),
    Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"),
    Buffer.from("\nendobj\n", "latin1"),
  ]);
}

function createImageOnlyPdf(jpeg: Buffer): Buffer {
  const imageWidth = 700;
  const imageHeight = 550;
  const pageWidth = 252;
  const pageHeight = 198;
  const imageStream = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`;
  const objects = [
    pdfObject(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    pdfObject(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    pdfObject(
      3,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
        "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
    ),
    pdfObject(
      4,
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`,
          "latin1",
        ),
        jpeg,
        Buffer.from("\nendstream", "latin1"),
      ]),
    ),
    pdfObject(
      5,
      `<< /Length ${Buffer.byteLength(imageStream)} >>\nstream\n${imageStream}\nendstream`,
    ),
  ];
  const chunks: Buffer[] = [
    Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1"),
  ];
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.concat(chunks).byteLength);
    chunks.push(object);
  }
  const xrefOffset = Buffer.concat(chunks).byteLength;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n`, "latin1"));
  chunks.push(Buffer.from("0000000000 65535 f \n", "latin1"));
  for (const offset of offsets.slice(1)) {
    chunks.push(
      Buffer.from(`${String(offset).padStart(10, "0")} 00000 n \n`, "latin1"),
    );
  }
  chunks.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      "latin1",
    ),
  );
  return Buffer.concat(chunks);
}

function createMixedPdf(nativeText: string, jpeg: Buffer): Buffer {
  const escaped = nativeText
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
  const nativeStream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const imagePageWidth = 252;
  const imagePageHeight = 198;
  const imageStream = `q ${imagePageWidth} 0 0 ${imagePageHeight} 0 0 cm /Im0 Do Q`;
  const objects = [
    pdfObject(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    pdfObject(2, "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>"),
    pdfObject(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
        "/Resources << /Font << /F1 6 0 R >> >> /Contents 5 0 R >>",
    ),
    pdfObject(
      4,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${imagePageWidth} ${imagePageHeight}] ` +
        "/Resources << /XObject << /Im0 7 0 R >> >> /Contents 8 0 R >>",
    ),
    pdfObject(
      5,
      `<< /Length ${Buffer.byteLength(nativeStream)} >>\nstream\n${nativeStream}\nendstream`,
    ),
    pdfObject(6, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    pdfObject(
      7,
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width 700 /Height 550 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`,
          "latin1",
        ),
        jpeg,
        Buffer.from("\nendstream", "latin1"),
      ]),
    ),
    pdfObject(
      8,
      `<< /Length ${Buffer.byteLength(imageStream)} >>\nstream\n${imageStream}\nendstream`,
    ),
  ];
  const chunks: Buffer[] = [
    Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1"),
  ];
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.concat(chunks).byteLength);
    chunks.push(object);
  }
  const xrefOffset = Buffer.concat(chunks).byteLength;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n`, "latin1"));
  chunks.push(Buffer.from("0000000000 65535 f \n", "latin1"));
  for (const offset of offsets.slice(1)) {
    chunks.push(
      Buffer.from(`${String(offset).padStart(10, "0")} 00000 n \n`, "latin1"),
    );
  }
  chunks.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      "latin1",
    ),
  );
  return Buffer.concat(chunks);
}

async function deleteExactLocalArtifacts(
  artifacts: ReadonlyArray<{ storageAdapter: string; storageLocator: string }>,
) {
  const localArtifacts = artifacts.filter(
    ({ storageAdapter }) => storageAdapter === "filesystem",
  );
  if (localArtifacts.length === 0) return;
  const allowedRoots = new Set([
    resolve(process.cwd(), ".local/cv-storage"),
    resolve(process.cwd(), ".local/cv-storage-cf-phase2"),
  ]);
  const allowedRoot = resolve(process.cwd(), ".local/cv-storage");
  const configuredRoot = resolve(
    process.env.CV_STORAGE_LOCAL_ROOT ?? allowedRoot,
  );
  if (!allowedRoots.has(configuredRoot))
    throw new Error("CV_E2E_STORAGE_ROOT_UNSAFE");
  for (const { storageLocator } of localArtifacts) {
    if (!/^[A-Za-z0-9_-]{32,128}$/u.test(storageLocator)) {
      throw new Error("CV_E2E_STORAGE_LOCATOR_UNSAFE");
    }
    const target = resolve(configuredRoot, storageLocator);
    const path = relative(configuredRoot, target);
    if (
      !path ||
      path.startsWith("..") ||
      path.includes("/") ||
      path.includes("\\")
    ) {
      throw new Error("CV_E2E_STORAGE_TARGET_UNSAFE");
    }
    await unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function registerCandidate(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  const email = `cv-ocr-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  candidateEmails.add(email);
  const mailDirectory = resolve(process.cwd(), ".local/mail");
  const before = new Set(await readdir(mailDirectory).catch(() => []));

  await page.goto("/register");
  await page.getByLabel("Full name").fill("Synthetic Hybrid OCR Candidate");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  let verificationLink = "";
  await expect
    .poll(
      async () => {
        for (const name of (await readdir(mailDirectory)).filter(
          (entry) => !before.has(entry),
        )) {
          const body = await readFile(resolve(mailDirectory, name), "utf8");
          if (body.includes(`To: ${email}`)) {
            verificationLink =
              body.match(
                /http:\/\/localhost:3001\/verify-email\?token=[A-Za-z0-9._~-]+/u,
              )?.[0] ?? "";
          }
        }
        return verificationLink;
      },
      { timeout: 30_000 },
    )
    .not.toBe("");
  await page.goto(verificationLink);
  await page.getByRole("link", { name: "Continue to login" }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
  return page;
}

async function uploadForReview(
  page: Page,
  fixture: { name: string; mimeType: string; buffer: Buffer },
) {
  await page.goto("/profile/cv-imports");
  const fileInput = page.getByLabel("CV file");
  await expect(fileInput).toBeEnabled();
  await fileInput.setInputFiles(fixture);
  await expect(
    page.getByRole("status").filter({ hasText: /is ready to upload/i }),
  ).toBeVisible();
  const reservationPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/account/cv-imports",
  );
  await page.getByRole("button", { name: /upload cv/i }).click();
  const reservation = await reservationPromise;
  expect(reservation.status()).toBe(201);
  const { uploadId } = (await reservation.json()) as { uploadId: string };
  await expect(
    page.getByRole("status").filter({ hasText: /review ready/i }),
  ).toBeVisible({ timeout: 180_000 });
  return uploadId;
}

test.afterAll(async () => pool.end());

test.afterEach(async () => {
  try {
    const emails = [...candidateEmails];
    candidateEmails.clear();
    if (emails.length > 0) {
      const client = await pool.connect();
      try {
        const accounts = await client.query<{ id: string }>(
          `SELECT "id" FROM "user" WHERE "normalizedEmail" = ANY($1::text[])`,
          [emails.map((email) => email.toLowerCase())],
        );
        const accountIds = accounts.rows.map(({ id }) => id);
        const artifacts = await client.query<{
          storageAdapter: string;
          storageLocator: string;
        }>(
          `SELECT "storageAdapter", "storageLocator"
             FROM "CvStoredArtifact"
            WHERE "accountId" = ANY($1::text[])`,
          [accountIds],
        );
        await deleteExactLocalArtifacts(artifacts.rows);
        await cleanupReviewAccounts(client, accountIds);
      } finally {
        client.release();
      }
    }
  } finally {
    await Promise.allSettled(
      contexts.splice(0).map((context) => context.close()),
    );
  }
});

test("imports image-only/mixed PDF and main-body-image DOCX through review and explicit confirmation", async ({
  browser,
}) => {
  test.setTimeout(720_000);
  const page = await registerCandidate(browser);
  const profileAtStart = await page.request
    .get("/api/account/profile")
    .then((response) => response.json());
  const jpeg = await sharp(
    await readFile(resolve(corpusRoot, "images/ocr-001.jpg")),
  )
    .resize({ width: 700, withoutEnlargement: true })
    .jpeg()
    .toBuffer();
  const fixtures = [
    {
      name: "synthetic-image-only.pdf",
      mimeType: "application/pdf",
      buffer: createImageOnlyPdf(jpeg),
      expectNative: false,
    },
    {
      name: "synthetic-mixed.pdf",
      mimeType: "application/pdf",
      buffer: createMixedPdf(
        "Native contact and experience with deterministic context",
        jpeg,
      ),
      expectNative: true,
    },
    {
      name: "synthetic-body-image.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: createSyntheticImageDocx(jpeg),
      expectNative: true,
    },
  ];

  for (const fixture of fixtures) {
    const uploadId = await uploadForReview(page, fixture);
    const profileBeforeConfirm = await page.request
      .get("/api/account/profile")
      .then((response) => response.json());
    expect(profileBeforeConfirm).toEqual(profileAtStart);

    const extraction = await pool.query<{
      segmentSchemaVersion: string;
      nativeSegmentCount: number;
      ocrSegmentCount: number;
      accountedUnitCount: number;
      ocrStatus: string;
    }>(
      `SELECT extraction."segmentSchemaVersion",
              extraction."nativeSegmentCount",
              extraction."ocrSegmentCount",
              extraction."accountedUnitCount",
              attempt."status"::text AS "ocrStatus"
         FROM "CvExtraction" extraction
         JOIN "OcrProcessingAttempt" attempt
           ON attempt."cvExtractionId" = extraction."id"
        WHERE extraction."uploadId" = $1`,
      [uploadId],
    );
    expect(extraction.rows).toHaveLength(1);
    expect(extraction.rows[0]).toMatchObject({
      segmentSchemaVersion: "cv-segments-v2",
      ocrStatus: expect.stringMatching(/SUCCEEDED|PARTIAL_REVIEW_REQUIRED/u),
    });
    expect(extraction.rows[0].ocrSegmentCount).toBeGreaterThan(0);
    expect(extraction.rows[0].accountedUnitCount).toBeGreaterThan(0);
    if (fixture.expectNative) {
      expect(extraction.rows[0].nativeSegmentCount).toBeGreaterThan(0);
    }

    await page.goto(`/profile/cv-imports/${uploadId}/review`);
    await expect(
      page.getByRole("heading", { name: "Review CV proposals" }),
    ).toBeVisible();
    const sourceDetails = page
      .locator("summary")
      .filter({ hasText: "Data source details" });
    for (let index = 0; index < (await sourceDetails.count()); index += 1)
      await sourceDetails.nth(index).click();
    await expect(page.getByText(/Extraction method:.*OCR/iu).first()).toBeVisible();
  }

  await page.getByRole("radio", { name: "add" }).first().check();
  await page
    .getByRole("checkbox", { name: "I have reviewed every proposal." })
    .check();
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByRole("status")).toContainText("Review saved");
  expect(
    await page.request
      .get("/api/account/profile")
      .then((response) => response.json()),
  ).toEqual(profileAtStart);

  await page
    .getByRole("checkbox", {
      name: /confirm updates my candidate profile/i,
    })
    .check();
  await page.getByRole("button", { name: "Confirm selected changes" }).click();
  await expect(
    page.getByRole("heading", { name: "CV import confirmed" }),
  ).toBeVisible();
  const profileAfter = await page.request
    .get("/api/account/profile")
    .then((response) => response.json());
  expect(profileAfter.revision).toBe(profileAtStart.revision + 1);
});

test("keeps standalone PNG/JPEG outside the Candidate CV upload boundary", async ({
  browser,
}) => {
  const page = await registerCandidate(browser);
  const jpeg = await readFile(resolve(corpusRoot, "images/ocr-001.jpg"));
  await page.goto("/profile/cv-imports");

  for (const fixture of [
    { name: "standalone-cv.jpg", mimeType: "image/jpeg", buffer: jpeg },
    {
      name: "standalone-cv.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fea73581840000000049454e44ae426082",
        "hex",
      ),
    },
  ]) {
    const fileInput = page.getByLabel("CV file");
    await expect(fileInput).toBeEnabled();
    await fileInput.setInputFiles(fixture);
    await expect(
      page.getByTestId("cv-upload-form").getByRole("alert"),
    ).toContainText(
      "Only PDF, DOC, or DOCX files are supported.",
    );
    await expect(
      page.getByRole("button", { name: /upload cv/i }),
    ).toBeEnabled();
  }
});
