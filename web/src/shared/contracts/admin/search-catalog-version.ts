import { z } from "zod";
import { normalizedText, privilegedReasonCategorySchema } from "./common";

export const searchCatalogVersionStatusSchema = z.enum([
  "DRAFT",
  "PUBLISHED",
  "RETIRED",
]);

export const searchCatalogVersionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).max(160).optional(),
  status: searchCatalogVersionStatusSchema.optional(),
});

const commandShape = {
  confirmation: z.literal(true),
  reasonCategory: privilegedReasonCategorySchema,
  explanation: normalizedText(10, 1000),
};

export const searchCatalogVersionCommandSchema = z.discriminatedUnion(
  "command",
  [
    z.object({ command: z.literal("PUBLISH"), ...commandShape }).strict(),
    z.object({ command: z.literal("ROLLBACK"), ...commandShape }).strict(),
    z.object({ command: z.literal("RETIRE"), ...commandShape }).strict(),
  ],
);

export type SearchCatalogVersionStatus = z.infer<
  typeof searchCatalogVersionStatusSchema
>;
export type SearchCatalogVersionListQuery = z.infer<
  typeof searchCatalogVersionListQuerySchema
>;
export type SearchCatalogVersionCommand = z.infer<
  typeof searchCatalogVersionCommandSchema
>;
