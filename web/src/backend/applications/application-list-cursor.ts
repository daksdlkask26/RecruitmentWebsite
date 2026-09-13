import "server-only";

import { z } from "zod";
import { TokenProtector } from "@/backend/security/security-token/security-tokens";

export const applicationListCursorListSchema = z.enum([
  "CANDIDATE_JOB_APPLICATIONS",
  "CANDIDATE_TEAM_APPLICATIONS",
  "OWNER_TEAM_APPLICATIONS",
]);
export type ApplicationListCursorList = z.infer<
  typeof applicationListCursorListSchema
>;

export const applicationListCursorSortSchema = z.enum([
  "SUBMITTED_DESC",
  "SUBMITTED_ASC",
]);
export type ApplicationListCursorSort = z.infer<
  typeof applicationListCursorSortSchema
>;

const applicationListCursorSchema = z
  .object({
    v: z.literal(1),
    list: applicationListCursorListSchema,
    subjectId: z.string().min(1).max(128),
    scopeId: z.string().min(1).max(128).nullable(),
    filter: z.string().min(1).max(128),
    sort: applicationListCursorSortSchema,
    submittedAt: z.string().datetime({ offset: true }),
    id: z.string().min(1).max(128),
  })
  .strict();

export type ApplicationListCursor = z.infer<typeof applicationListCursorSchema>;

const protector = new TokenProtector();

export function encodeApplicationListCursor(
  input: Omit<ApplicationListCursor, "v">,
) {
  return protector.seal(
    JSON.stringify(applicationListCursorSchema.parse({ v: 1, ...input })),
  );
}

export function decodeApplicationListCursor(
  value: string,
  expected: Pick<
    ApplicationListCursor,
    "list" | "subjectId" | "scopeId" | "filter" | "sort"
  >,
) {
  if (value.length > 1024) return null;
  try {
    const parsed = applicationListCursorSchema.parse(
      JSON.parse(protector.unseal(value)),
    );
    if (
      parsed.list !== expected.list ||
      parsed.subjectId !== expected.subjectId ||
      parsed.scopeId !== expected.scopeId ||
      parsed.filter !== expected.filter ||
      parsed.sort !== expected.sort
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
