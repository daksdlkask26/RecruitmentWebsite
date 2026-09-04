import { z } from "zod";

const localizedTermsSchema = z
  .object({
    vi: z.array(z.string().trim().min(1).max(160)).max(64),
    en: z.array(z.string().trim().min(1).max(160)).max(64),
  })
  .strict();

const titleFacetMappingSchema = z
  .object({
    phrase: z.string().trim().min(1).max(160),
    facetIds: z.array(z.string().trim().min(1).max(128)).max(16),
  })
  .strict();

export const occupationSearchEntrySchema = z
  .object({
    occupationId: z
      .string()
      .regex(/^occ-[a-z0-9-]+$/u)
      .max(128),
    industryCode: z
      .string()
      .regex(/^r\d{2}$/u)
      .max(16),
    categoryIds: z
      .array(
        z
          .string()
          .regex(/^r\d{2}(?:-[a-z0-9-]+)?$/u)
          .max(128),
      )
      .min(1)
      .max(8),
    labels: z
      .object({
        vi: z.string().trim().min(1).max(160),
        en: z.string().trim().min(1).max(160),
      })
      .strict(),
    aliases: localizedTermsSchema,
    abbreviations: z.array(z.string().trim().min(1).max(40)).max(24),
    relatedTitles: localizedTermsSchema,
    titleFacetMappings: z.array(titleFacetMappingSchema).max(128).default([]),
    rankingSkills: z.array(z.string().trim().min(1).max(80)).max(24),
    irregularAliases: z.array(z.string().trim().min(1).max(160)).max(24),
    exclusions: z.array(z.string().trim().min(1).max(160)).max(24),
  })
  .strict();

export const occupationSearchCatalogSchema = z
  .array(occupationSearchEntrySchema)
  .min(1)
  .max(500);

export type OccupationSearchEntry = Readonly<{
  occupationId: string;
  industryCode: string;
  categoryIds: readonly string[];
  labels: Readonly<{ vi: string; en: string }>;
  aliases: Readonly<{
    vi: readonly string[];
    en: readonly string[];
  }>;
  abbreviations: readonly string[];
  relatedTitles: Readonly<{
    vi: readonly string[];
    en: readonly string[];
  }>;
  titleFacetMappings?: readonly {
    phrase: string;
    facetIds: readonly string[];
  }[];
  rankingSkills: readonly string[];
  irregularAliases: readonly string[];
  exclusions: readonly string[];
}>;
