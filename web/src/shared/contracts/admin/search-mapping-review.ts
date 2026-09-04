import { z } from "zod";
import { normalizedText, privilegedReasonCategorySchema } from "./common";

export const searchMappingReviewStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "MERGED",
  "DEDUPLICATED",
]);

export const searchMappingReviewListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).max(160).optional(),
  status: searchMappingReviewStatusSchema.optional(),
  catalogScope: z.enum(["ACTIVE", "ALL"]).default("ACTIVE"),
});

const commandShape = {
  confirmation: z.literal(true),
  reasonCategory: privilegedReasonCategorySchema,
  explanation: normalizedText(10, 1000),
};

const mappingFields = {
  titleId: z
    .string()
    .trim()
    .regex(/^title-[a-z0-9-]+$/u)
    .optional(),
  translationVi: z.string().trim().min(1).max(160).optional(),
  translationEn: z.string().trim().min(1).max(160).optional(),
  occupationId: z
    .string()
    .trim()
    .regex(/^occ-[a-z0-9-]+$/u)
    .optional(),
  facetIds: z.array(z.string().trim().min(1).max(128)).max(16).optional(),
};

export const searchMappingReviewCommandSchema = z.discriminatedUnion(
  "command",
  [
    z
      .object({
        command: z.literal("APPROVE"),
        ...commandShape,
        ...mappingFields,
      })
      .strict(),
    z
      .object({
        command: z.literal("REJECT"),
        ...commandShape,
      })
      .strict(),
    z
      .object({
        command: z.literal("MERGE"),
        ...commandShape,
        targetTitleId: z
          .string()
          .trim()
          .regex(/^title-[a-z0-9-]+$/u),
      })
      .strict(),
    z
      .object({
        command: z.literal("INTENTIONAL_UNTRANSLATED"),
        ...commandShape,
        titleId: z
          .string()
          .trim()
          .regex(/^title-[a-z0-9-]+$/u)
          .optional(),
        translationEn: z.string().trim().min(1).max(160).optional(),
        occupationId: z
          .string()
          .trim()
          .regex(/^occ-[a-z0-9-]+$/u)
          .optional(),
        facetIds: z.array(z.string().trim().min(1).max(128)).max(16).optional(),
      })
      .strict(),
  ],
);

export type SearchMappingReviewStatus = z.infer<
  typeof searchMappingReviewStatusSchema
>;
export type SearchMappingReviewListQuery = z.infer<
  typeof searchMappingReviewListQuerySchema
>;
export type SearchMappingReviewCommand = z.infer<
  typeof searchMappingReviewCommandSchema
>;
