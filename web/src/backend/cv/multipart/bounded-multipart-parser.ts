import "server-only";

export class MultipartParsingError extends Error {
  constructor(
    readonly code:
      | "PAYLOAD_TOO_LARGE"
      | "MALFORMED_MULTIPART"
      | "DUPLICATE_FIELD"
      | "FILE_TOO_LARGE"
      | "PART_COUNT_EXCEEDED",
    message?: string,
  ) {
    super(message ?? code);
  }
}

export type ParsedMultipartFile = Readonly<{
  fieldName: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  bytes: Buffer;
}>;

export type ParsedMultipart = Readonly<{
  fields: Record<string, string>;
  file?: ParsedMultipartFile;
}>;

export type BoundedMultipartOptions = Readonly<{
  maxTotalBytes?: number;
  maxFileBytes?: number;
  maxFieldBytes?: number;
  maxFields?: number;
  maxParts?: number;
}>;

const DEFAULT_MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5MB
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FIELD_BYTES = 16 * 1024; // 16KB
const DEFAULT_MAX_FIELDS = 25;

function findMultipartBoundary(
  body: Buffer,
  boundary: string,
  startIndex: number,
): number {
  const marker = Buffer.from(`--${boundary}`);
  let searchIndex = startIndex;
  while (searchIndex < body.length) {
    const position = body.indexOf(marker, searchIndex);
    if (position === -1) return -1;
    const atLineStart =
      position === 0 ||
      (body[position - 2] === 0x0d && body[position - 1] === 0x0a);
    const suffixIndex = position + marker.length;
    const openingBoundary =
      body[suffixIndex] === 0x0d && body[suffixIndex + 1] === 0x0a;
    const closingBoundary =
      body[suffixIndex] === 0x2d && body[suffixIndex + 1] === 0x2d;
    if (atLineStart && (openingBoundary || closingBoundary)) return position;
    searchIndex = position + 1;
  }
  return -1;
}

export async function parseBoundedMultipart(
  request: Request,
  options: BoundedMultipartOptions = {},
): Promise<ParsedMultipart> {
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFieldBytes = options.maxFieldBytes ?? DEFAULT_MAX_FIELD_BYTES;
  const maxFields = options.maxFields ?? DEFAULT_MAX_FIELDS;
  const maxParts = options.maxParts ?? maxFields + 1;

  // 1. Check declared Content-Length header
  const contentLengthHeader = request.headers.get("content-length");
  if (
    !contentLengthHeader ||
    !/^\d+$/u.test(contentLengthHeader) ||
    !Number.isSafeInteger(Number(contentLengthHeader))
  ) {
    throw new MultipartParsingError(
      "MALFORMED_MULTIPART",
      "A valid Content-Length header is required.",
    );
  }
  const declaredLength = Number(contentLengthHeader);
  if (declaredLength > maxTotalBytes) {
    throw new MultipartParsingError(
      "PAYLOAD_TOO_LARGE",
      "Declared content length exceeds allowed maximum.",
    );
  }

  // 2. Read request body with streaming byte counter cutoff
  if (!request.body) {
    throw new MultipartParsingError(
      "MALFORMED_MULTIPART",
      "Empty request body.",
    );
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxTotalBytes) {
          throw new MultipartParsingError(
            "PAYLOAD_TOO_LARGE",
            "Uploaded body exceeded allowed maximum size.",
          );
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes !== declaredLength) {
    throw new MultipartParsingError(
      "MALFORMED_MULTIPART",
      "Content-Length does not match the received request body.",
    );
  }

  const bodyBuffer = Buffer.concat(chunks);

  // 3. Require one bounded header/body boundary. Inferring a different
  // boundary from the body creates request-parser differentials upstream.
  const contentTypeHeader = request.headers.get("content-type") || "";
  const headerMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader);
  const boundary = (headerMatch?.[1] || headerMatch?.[2] || "").trim();

  if (
    !boundary ||
    boundary.length > 70 ||
    Array.from(boundary).some((value) => {
      const code = value.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    }) ||
    findMultipartBoundary(bodyBuffer, boundary, 0) === -1
  ) {
    throw new MultipartParsingError(
      "MALFORMED_MULTIPART",
      "No valid multipart boundary found.",
    );
  }

  const delimiterBuffer = Buffer.from("\r\n\r\n");

  const fields: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  let extractedFile: ParsedMultipartFile | undefined;
  let fieldCount = 0;
  let partCount = 0;
  let sawClosingBoundary = false;

  let searchIndex = findMultipartBoundary(bodyBuffer, boundary, 0);
  while (searchIndex < bodyBuffer.length) {
    const partStart = findMultipartBoundary(bodyBuffer, boundary, searchIndex);
    if (partStart === -1) {
      throw new MultipartParsingError(
        "MALFORMED_MULTIPART",
        "Multipart body is missing its closing boundary.",
      );
    }

    const contentStart = partStart + boundary.length + 2;
    // Check if end of multipart (--boundary--)
    if (
      bodyBuffer[contentStart] === 0x2d &&
      bodyBuffer[contentStart + 1] === 0x2d
    ) {
      sawClosingBoundary = true;
      const trailing = bodyBuffer.subarray(contentStart + 2);
      if (trailing.length && !/^\r?\n$/u.test(trailing.toString("latin1"))) {
        throw new MultipartParsingError(
          "MALFORMED_MULTIPART",
          "Unexpected bytes after multipart closing boundary.",
        );
      }
      break;
    }

    partCount++;
    if (partCount > maxParts) {
      throw new MultipartParsingError(
        "PART_COUNT_EXCEEDED",
        "Too many multipart parts.",
      );
    }

    if (
      bodyBuffer[contentStart] !== 0x0d ||
      bodyBuffer[contentStart + 1] !== 0x0a
    ) {
      throw new MultipartParsingError(
        "MALFORMED_MULTIPART",
        "Multipart boundary delimiter is malformed.",
      );
    }

    // Skip trailing CRLF after boundary
    let headersStart = contentStart;
    if (
      bodyBuffer[headersStart] === 0x0d &&
      bodyBuffer[headersStart + 1] === 0x0a
    ) {
      headersStart += 2;
    }

    const nextBoundary = findMultipartBoundary(
      bodyBuffer,
      boundary,
      headersStart,
    );
    if (nextBoundary === -1) {
      throw new MultipartParsingError(
        "MALFORMED_MULTIPART",
        "Multipart body is missing its closing boundary.",
      );
    }

    const headersEnd = bodyBuffer.indexOf(delimiterBuffer, headersStart);
    if (headersEnd === -1 || headersEnd > nextBoundary) {
      throw new MultipartParsingError(
        "MALFORMED_MULTIPART",
        "Multipart part headers are malformed.",
      );
    }

    const rawHeaders = bodyBuffer
      .subarray(headersStart, headersEnd)
      .toString("utf8");
    let partBody = bodyBuffer.subarray(
      headersEnd + delimiterBuffer.length,
      nextBoundary,
    );
    // Strip trailing CRLF before next boundary
    if (
      partBody.length >= 2 &&
      partBody[partBody.length - 2] === 0x0d &&
      partBody[partBody.length - 1] === 0x0a
    ) {
      partBody = partBody.subarray(0, partBody.length - 2);
    }

    // Parse Content-Disposition
    const dispositionMatch =
      /Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(
        rawHeaders,
      );
    if (!dispositionMatch) {
      throw new MultipartParsingError(
        "MALFORMED_MULTIPART",
        "Multipart part is missing Content-Disposition.",
      );
    }

    const fieldName = dispositionMatch[1];
    const fileName = dispositionMatch[2];

    if (fileName !== undefined) {
      // File part
      if (extractedFile) {
        throw new MultipartParsingError(
          "DUPLICATE_FIELD",
          "Multiple file parts rejected.",
        );
      }
      if (partBody.byteLength > maxFileBytes) {
        throw new MultipartParsingError(
          "FILE_TOO_LARGE",
          "File size exceeds allowed limit.",
        );
      }
      const typeMatch = /Content-Type:\s*([^\r\n;]+)/i.exec(rawHeaders);
      const contentType = typeMatch
        ? typeMatch[1].trim()
        : "application/octet-stream";

      extractedFile = Object.freeze({
        fieldName,
        fileName: fileName || "upload",
        contentType,
        byteSize: partBody.byteLength,
        bytes: Buffer.from(partBody),
      });
    } else {
      // Text field part
      if (Object.prototype.hasOwnProperty.call(fields, fieldName)) {
        throw new MultipartParsingError(
          "DUPLICATE_FIELD",
          "Duplicate form fields are not accepted.",
        );
      }
      fieldCount++;
      if (fieldCount > maxFields) {
        throw new MultipartParsingError(
          "MALFORMED_MULTIPART",
          "Too many fields.",
        );
      }
      if (partBody.byteLength > maxFieldBytes) {
        throw new MultipartParsingError(
          "PAYLOAD_TOO_LARGE",
          "Field value exceeds allowed limit.",
        );
      }
      fields[fieldName] = partBody.toString("utf8");
    }

    searchIndex = nextBoundary;
  }

  if (!sawClosingBoundary) {
    throw new MultipartParsingError(
      "MALFORMED_MULTIPART",
      "Multipart body is missing its closing boundary.",
    );
  }

  return Object.freeze({
    fields: Object.freeze(fields),
    file: extractedFile,
  });
}
