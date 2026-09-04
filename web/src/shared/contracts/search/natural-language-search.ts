import { z } from "zod";

export const structuredSearchFilterKindSchema = z.enum([
  "TITLE",
  "OCCUPATION",
  "SKILL",
  "SENIORITY",
  "EMPLOYMENT_TYPE",
  "WORK_ARRANGEMENT",
  "LOCATION",
  "DISTRICT",
  "SALARY",
  "COMPANY",
  "POSTED_TIME",
]);

export const structuredSearchFilterSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    kind: structuredSearchFilterKindSchema,
    value: z.string().trim().min(1).max(160),
    query: z.string().trim().min(1).max(200),
    labelVi: z.string().trim().min(1).max(160),
    labelEn: z.string().trim().min(1).max(160),
    source: z.literal("QUERY"),
  })
  .strict();

export type StructuredSearchFilter = z.infer<
  typeof structuredSearchFilterSchema
>;
