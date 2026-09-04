import { z } from "zod";
import { structuredSearchFilterSchema } from "./natural-language-search";
import { jobSearchIntentSchema } from "./job-search-intent";

export const searchModeSchema = z.enum(["SMART", "LITERAL"]);
export const searchConfidenceSchema = z.enum(["HIGH", "MEDIUM"]);
export const searchMetadataSchema = z
  .object({
    resolverVersion: z.string().min(1).max(64),
    catalogVersion: z.string().min(1).max(64),
  })
  .strict();
export const searchInterpretationReasonSchema = z.enum([
  "NONE",
  "NORMALIZED",
  "ALIAS_EXPANDED",
  "TYPO_CORRECTED",
  "TYPO_AND_ALIAS",
]);

export const searchInterpretationSchema = z
  .object({
    mode: searchModeSchema,
    originalQuery: z.string().max(200),
    normalizedQuery: z.string().max(200),
    foldedQuery: z.string().max(200).optional(),
    compactQuery: z.string().max(200).optional(),
    effectiveQuery: z.string().max(200),
    reason: searchInterpretationReasonSchema,
    confidence: searchConfidenceSchema.optional(),
    correction: z
      .object({
        from: z.string().min(1).max(200),
        to: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
    matchedTitle: z
      .object({
        titleId: z.string().min(1).max(180),
        labelVi: z.string().min(1).max(160),
        labelEn: z.string().min(1).max(160),
      })
      .strict()
      .optional(),
    matchedOccupation: z
      .object({
        occupationId: z.string().min(1).max(128),
        labelVi: z.string().min(1).max(160),
        labelEn: z.string().min(1).max(160),
      })
      .strict()
      .optional(),
    matchedFacets: z
      .array(
        z
          .object({
            facetId: z.string().min(1).max(128),
            kind: z.enum([
              "SPECIALIZATION",
              "SENIORITY",
              "MANAGEMENT_LEVEL",
              "EMPLOYMENT_LEVEL",
              "DOMAIN",
            ]),
            labelVi: z.string().min(1).max(160),
            labelEn: z.string().min(1).max(160),
          })
          .strict(),
      )
      .max(16)
      .optional(),
    structuredFilters: z.array(structuredSearchFilterSchema).max(16).optional(),
    /** The bounded resolver output saved with a search for controlled re-resolution. */
    searchIntent: jobSearchIntentSchema.optional(),
    corrections: z
      .array(
        z
          .object({
            from: z.string().min(1).max(200),
            to: z.string().min(1).max(200),
            confidence: searchConfidenceSchema,
            reason: z.enum(["TYPO", "ALIAS", "NORMALIZED"]),
          })
          .strict(),
      )
      .max(16)
      .optional(),
    suggestedQuery: z.string().min(1).max(200).optional(),
    autoCorrected: z.boolean().optional(),
    ambiguous: z.boolean().optional(),
    /** Prefixes interpreted as search intent rather than job-title terms. */
    intentPrefixes: z.array(z.string().min(1).max(80)).max(4).optional(),
    resolverVersion: z.string().min(1).max(64).optional(),
    catalogVersion: z.string().min(1).max(64).optional(),
    appliedTerms: z.array(z.string().min(1).max(200)).max(8),
    canSearchLiteral: z.boolean(),
    // Kept as a compatibility signal for older repository adapters. New UI
    // code should use `reason` and `mode` instead.
    usedFallback: z.boolean().optional(),
  })
  .strict();

export type SearchMode = z.infer<typeof searchModeSchema>;
export type SearchConfidence = z.infer<typeof searchConfidenceSchema>;
export type SearchMetadata = z.infer<typeof searchMetadataSchema>;
export type SearchInterpretationReason = z.infer<
  typeof searchInterpretationReasonSchema
>;
export type SearchInterpretation = z.infer<typeof searchInterpretationSchema>;
