import "server-only";

import { Prisma } from "@/backend/generated/prisma/client";
import { prisma } from "@/backend/database/prisma";

const WATERMARK_ID = "singleton";

type WatermarkRow = { version: bigint };

/**
 * Read the durable public-discovery revision shared by every application
 * process. The revision is advanced by PostgreSQL triggers in the same
 * transaction as Company/Job writes, including standalone worker writes.
 *
 * A missing/unavailable watermark is deliberately represented as null. The
 * Home composer treats that as a cache safety failure and reads the
 * authoritative projection directly.
 */
export async function readPublicDiscoveryWatermark(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<WatermarkRow[]>(Prisma.sql`
      SELECT "version"
      FROM "PublicDiscoveryInvalidation"
      WHERE "id" = ${WATERMARK_ID}
      LIMIT 1
    `);
    const version = rows[0]?.version;
    return typeof version === "bigint" ? version.toString() : null;
  } catch {
    return null;
  }
}
