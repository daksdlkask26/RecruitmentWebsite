import { z } from "zod";

export const searchSuggestionScopeSchema = z.enum(["JOBS", "COMPANIES"]);
export const searchSuggestionTypeSchema = z.enum([
  "OCCUPATION",
  "TITLE",
  "SKILL",
  "COMPANY",
  "INDUSTRY",
  "LOCATION",
]);

export const searchSuggestionSchema = z
  .object({
    id: z.string().trim().min(1).max(180),
    type: searchSuggestionTypeSchema,
    labelVi: z.string().trim().min(1).max(160),
    labelEn: z.string().trim().min(1).max(160),
    secondaryLabelVi: z.string().trim().min(1).max(160).optional(),
    secondaryLabelEn: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export const searchSuggestionsQuerySchema = z
  .object({
    scope: searchSuggestionScopeSchema,
    q: z.string().trim().max(160),
    limit: z.coerce.number().int().min(1).max(8).default(8),
  })
  .strict();

export const searchSuggestionsResponseSchema = z
  .object({
    scope: searchSuggestionScopeSchema,
    query: z.string().max(160),
    suggestions: z.array(searchSuggestionSchema).max(8),
    catalogVersion: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export type SearchSuggestionScope = z.infer<typeof searchSuggestionScopeSchema>;
export type SearchSuggestionType = z.infer<typeof searchSuggestionTypeSchema>;
export type SearchSuggestion = z.infer<typeof searchSuggestionSchema>;
export type SearchSuggestionsResponse = z.infer<
  typeof searchSuggestionsResponseSchema
>;
