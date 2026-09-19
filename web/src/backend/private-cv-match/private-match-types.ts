import type { Prisma } from "@/backend/generated/prisma/client";
import { z } from "zod";

export const privateCvSnapshotSchema = z
  .object({
    versionId: z.string().trim().min(1).max(128),
    version: z.number().int().positive(),
    displayName: z.string().trim().min(1).max(200),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
    byteSize: z.number().int().positive().max(5_000_000),
    pageCount: z.number().int().positive().nullable(),
    parseStatus: z.enum(["READY", "PARTIAL", "FAILED"]),
    confirmedAt: z.string().datetime(),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/iu),
  })
  .strict();

const privateJdSkillSnapshotSchema = z
  .object({
    code: z.string().trim().min(1).max(128),
    label: z.string().trim().min(1).max(200),
  })
  .strict();

export const privateJdSnapshotSchema = z
  .object({
    jobId: z.string().trim().min(1).max(128),
    slug: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    company: z.string().trim().min(1).max(200),
    location: z.string().trim().min(1).max(200),
    employmentType: z.string().trim().min(1).max(80),
    workArrangement: z.string().trim().min(1).max(80),
    requiredExperienceYears: z.number().int().nonnegative().nullable(),
    requirements: z.array(z.string().trim().min(1).max(200)).max(100),
    requiredSkills: z.array(privateJdSkillSnapshotSchema).max(100),
    preferredSkills: z.array(privateJdSkillSnapshotSchema).max(100),
    requiredLanguages: z.array(z.string().trim().min(1).max(100)).max(20),
    jdVersion: z.number().int().positive(),
    jdUpdatedAt: z.string().datetime(),
    jdText: z.string().min(1).max(500_000),
    parseStatus: z.enum(["READY", "PARTIAL", "FAILED"]),
  })
  .strict();

export type PrivateCvSnapshot = Readonly<{
  versionId: string;
  version: number;
  displayName: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  pageCount: number | null;
  parseStatus: "READY" | "PARTIAL" | "FAILED";
  confirmedAt: string;
  checksumSha256: string;
}>;

export type PrivateJdSnapshot = Readonly<{
  jobId: string;
  slug: string;
  title: string;
  company: string;
  location: string;
  employmentType: string;
  workArrangement: string;
  requiredExperienceYears: number | null;
  requirements: readonly string[];
  requiredSkills: readonly { code: string; label: string }[];
  preferredSkills: readonly { code: string; label: string }[];
  requiredLanguages: readonly string[];
  jdVersion: number;
  jdUpdatedAt: string;
  jdText: string;
  parseStatus: "READY" | "PARTIAL" | "FAILED";
}>;

export function jsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
