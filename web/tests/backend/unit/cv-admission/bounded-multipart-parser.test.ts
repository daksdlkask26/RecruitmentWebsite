import { describe, expect, it } from "vitest";
import { parseBoundedMultipart } from "@/backend/cv/multipart/bounded-multipart-parser";

function requestFor(body: string, headers: Record<string, string> = {}) {
  const encoded = Buffer.from(body, "utf8");
  return new Request("http://localhost/upload", {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=NextGenBoundary",
      "content-length": String(encoded.byteLength),
      ...headers,
    },
    body: encoded,
  });
}

function validBody() {
  return [
    "--NextGenBoundary",
    'Content-Disposition: form-data; name="companyId"',
    "",
    "company-1",
    "--NextGenBoundary",
    'Content-Disposition: form-data; name="cv"; filename="resume.pdf"',
    "Content-Type: application/pdf",
    "",
    "%PDF-1.7\\n%%EOF",
    "--NextGenBoundary--",
    "",
  ].join("\r\n");
}

describe("bounded multipart parser", () => {
  it("parses a bounded field and file without using formData()", async () => {
    const parsed = await parseBoundedMultipart(requestFor(validBody()));

    expect(parsed.fields.companyId).toBe("company-1");
    expect(parsed.file).toMatchObject({
      fieldName: "cv",
      fileName: "resume.pdf",
      contentType: "application/pdf",
    });
    expect(parsed.file?.bytes.toString("utf8")).toContain("%PDF-1.7");
  });

  it("rejects missing Content-Length before parsing", async () => {
    await expect(
      parseBoundedMultipart(requestFor(validBody(), { "content-length": "" })),
    ).rejects.toMatchObject({
      code: "MALFORMED_MULTIPART",
    });
  });

  it("rejects a forged smaller Content-Length", async () => {
    const body = validBody();
    await expect(
      parseBoundedMultipart(
        requestFor(body, {
          "content-length": String(Buffer.byteLength(body) - 1),
        }),
      ),
    ).rejects.toMatchObject({
      code: "MALFORMED_MULTIPART",
    });
  });

  it("rejects a multipart body without its closing boundary", async () => {
    const body = validBody().replace("\r\n--NextGenBoundary--\r\n", "\r\n");
    await expect(parseBoundedMultipart(requestFor(body))).rejects.toMatchObject(
      {
        code: "MALFORMED_MULTIPART",
      },
    );
  });

  it("rejects a header/body boundary mismatch", async () => {
    await expect(
      parseBoundedMultipart(
        requestFor(validBody(), {
          "content-type": "multipart/form-data; boundary=DifferentBoundary",
        }),
      ),
    ).rejects.toMatchObject({ code: "MALFORMED_MULTIPART" });
  });

  it("rejects a multipart part flood before accepting any application fields", async () => {
    const body = [
      "--NextGenBoundary",
      'Content-Disposition: form-data; name="one"',
      "",
      "1",
      "--NextGenBoundary",
      'Content-Disposition: form-data; name="two"',
      "",
      "2",
      "--NextGenBoundary",
      'Content-Disposition: form-data; name="three"',
      "",
      "3",
      "--NextGenBoundary--",
      "",
    ].join("\r\n");

    await expect(
      parseBoundedMultipart(requestFor(body), { maxFields: 2, maxParts: 2 }),
    ).rejects.toMatchObject({ code: "PART_COUNT_EXCEEDED" });
  });
});
