import { z } from "zod";

export const searchRecoveryActionSchema = z
  .object({
    id: z.string().min(1).max(160),
    kind: z.enum([
      "CORRECTED_QUERY",
      "RELATED_TITLE",
      "RELATED_OCCUPATION",
      "RELAX_FILTER",
      "LITERAL",
    ]),
    labelVi: z.string().trim().min(1).max(160),
    labelEn: z.string().trim().min(1).max(160),
    query: z.string().trim().max(200).optional(),
    removeFilter: z
      .enum([
        "LOCATION",
        "DISTRICT",
        "SALARY",
        "SENIORITY",
        "EMPLOYMENT_TYPE",
        "WORK_ARRANGEMENT",
        "SKILL",
        "CATEGORY",
      ])
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "RELAX_FILTER" && !value.removeFilter) {
      context.addIssue({
        code: "custom",
        path: ["removeFilter"],
        message: "A filter must be selected for a relaxation action.",
      });
    }
    if (value.kind !== "RELAX_FILTER" && !value.query?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["query"],
        message: "A query is required for this recovery action.",
      });
    }
  });

export const searchRecoverySchema = z
  .object({
    actions: z.array(searchRecoveryActionSchema).max(5),
  })
  .strict();

export type SearchRecoveryAction = z.infer<typeof searchRecoveryActionSchema>;
export type SearchRecovery = z.infer<typeof searchRecoverySchema>;
