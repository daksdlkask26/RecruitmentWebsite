import "server-only";

import { randomUUID } from "node:crypto";

import type { z } from "zod";

import type { imageSearchApiErrorCodeSchema } from "@/shared/contracts/jobs/image-search";

type PublicCode = z.infer<typeof imageSearchApiErrorCodeSchema>;

export class ImageSearchServiceError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 413 | 415 | 429 | 503,
    public readonly code: PublicCode,
    public readonly publicMessage: string,
    public readonly retryAt: Date | null = null,
    public readonly fieldErrors: readonly Readonly<{
      path: string;
      code: string;
      message: string;
    }>[] = [],
  ) {
    super(code);
    this.name = "ImageSearchServiceError";
  }
}

export function imageSearchErrorResponse(error: unknown) {
  const boundary =
    error &&
    typeof error === "object" &&
    "status" in error &&
    "code" in error &&
    [400, 403, 404].includes(Number(error.status))
      ? new ImageSearchServiceError(
          Number(error.status) as 400 | 403 | 404,
          Number(error.status) === 403
            ? "FORBIDDEN"
            : Number(error.status) === 404
              ? "IMAGE_SEARCH_NOT_FOUND"
              : "VALIDATION_ERROR",
          Number(error.status) === 404
            ? "Image search was not found."
            : Number(error.status) === 403
              ? "The request was not authorized."
              : "Review the image-search request.",
        )
      : null;
  const safe =
    error instanceof ImageSearchServiceError
      ? error
      : boundary
        ? boundary
        : new ImageSearchServiceError(
            400,
            "VALIDATION_ERROR",
            "Review the image-search request.",
          );
  return Response.json(
    {
      error: {
        code: safe.code,
        message: safe.publicMessage,
        requestId: randomUUID(),
        retryAt: safe.retryAt?.toISOString() ?? null,
        fieldErrors: safe.fieldErrors,
      },
    },
    {
      status: safe.status,
      headers: {
        "cache-control": "no-store, max-age=0",
        pragma: "no-cache",
      },
    },
  );
}

export const noStoreHeaders = Object.freeze({
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
});
