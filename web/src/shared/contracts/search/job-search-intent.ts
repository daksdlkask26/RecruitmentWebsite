import { z } from "zod";

export const searchFacetKindSchema = z.enum([
  "SPECIALIZATION",
  "SENIORITY",
  "MANAGEMENT_LEVEL",
  "EMPLOYMENT_LEVEL",
  "DOMAIN",
]);

export const searchOccupationStatusSchema = z.enum(["ACTIVE", "DEPRECATED"]);
export const searchLanguageSchema = z.enum(["vi", "en", "neutral"]);

/**
 * Translation state is deliberately separate from the occupation mapping
 * state.  An automatically inferred title must never look like a
 * human-reviewed translation in the public search contract.
 */
export const bilingualJobTitleStatusSchema = z.enum([
  "HUMAN_VERIFIED",
  "AUTO_HIGH_CONFIDENCE",
  "REQUIRES_REVIEW",
  "INTENTIONAL_UNTRANSLATED",
  "AMBIGUOUS",
  "UNMAPPED",
]);

export const searchMappingSourceSchema = z.enum([
  "CURATED",
  "EXACT_CANONICAL",
  "EXACT_VERIFIED_ALIAS",
  "FUZZY_VERIFIED_ALIAS",
  "TAXONOMY_INFERENCE",
  "SEMANTIC_SUGGESTION",
  "MANUAL_REVIEW",
]);

const localizedLabelSchema = z
  .object({
    vi: z.string().trim().min(1).max(160),
    en: z.string().trim().min(1).max(160),
  })
  .strict();

function normalizedCatalogPhrase(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export const searchFacetDefinitionSchema = z
  .object({
    facetId: z.string().trim().min(1).max(128),
    kind: searchFacetKindSchema,
    labels: localizedLabelSchema,
    positiveTerms: z.array(z.string().trim().min(1).max(160)).min(1).max(64),
    conflictFacetIds: z
      .array(z.string().trim().min(1).max(128))
      .max(32)
      .default([]),
    /** Empty means the facet is valid for every occupation family. */
    compatibleIndustryCodes: z
      .array(
        z
          .string()
          .regex(/^r\d{2}$/u)
          .max(16),
      )
      .max(32)
      .optional(),
    compatibleCategoryIds: z
      .array(
        z
          .string()
          .regex(/^r\d{2}(?:-[a-z0-9-]+)?$/u)
          .max(128),
      )
      .max(64)
      .optional(),
  })
  .strict();

export const searchOccupationAliasSchema = z
  .object({
    phrase: z.string().trim().min(1).max(160),
    language: searchLanguageSchema,
    kind: z.enum(["CANONICAL", "ALIAS", "ABBREVIATION", "IRREGULAR"]),
    weight: z.number().finite().min(0).max(100),
    facetIds: z.array(z.string().trim().min(1).max(128)).max(16).default([]),
  })
  .strict();

export const searchRelatedTitleSchema = z
  .object({
    phrase: z.string().trim().min(1).max(160),
    language: searchLanguageSchema,
    facetIds: z.array(z.string().trim().min(1).max(128)).max(16).default([]),
    weight: z.number().finite().min(0).max(100),
  })
  .strict();

export const searchTitleFacetMappingSchema = z
  .object({
    phrase: z.string().trim().min(1).max(160),
    facetIds: z.array(z.string().trim().min(1).max(128)).max(16),
  })
  .strict();

export const bilingualJobTitleDefinitionSchema = z
  .object({
    titleId: z
      .string()
      .regex(/^title-[a-z0-9-]+$/u)
      .max(180),
    occupationId: z
      .string()
      .regex(/^occ-[a-z0-9-]+$/u)
      .max(128)
      .nullable(),
    industryCode: z
      .string()
      .regex(/^r\d{2}$/u)
      .max(16)
      .nullable(),
    categoryIds: z
      .array(
        z
          .string()
          .regex(/^r\d{2}(?:-[a-z0-9-]+)?$/u)
          .max(128),
      )
      .max(16),
    canonical: localizedLabelSchema,
    aliases: z
      .object({
        vi: z.array(z.string().trim().min(1).max(160)).max(64),
        en: z.array(z.string().trim().min(1).max(160)).max(64),
      })
      .strict(),
    abbreviations: z
      .array(z.string().trim().min(1).max(80))
      .max(32)
      .default([]),
    facetIds: z.array(z.string().trim().min(1).max(128)).max(16),
    skillSignals: z
      .array(z.string().trim().min(1).max(100))
      .max(32)
      .default([]),
    excludedTerms: z
      .array(z.string().trim().min(1).max(160))
      .max(32)
      .default([]),
    translationStatus: bilingualJobTitleStatusSchema,
    mappingSource: searchMappingSourceSchema,
    mappingConfidence: z.number().finite().min(0).max(1),
    reviewReason: z.string().trim().min(1).max(240).nullable(),
    /** @deprecated Use translationStatus. Kept during the rollout window. */
    status: bilingualJobTitleStatusSchema.optional(),
    catalogVersion: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const occupationDefinitionSchema = z
  .object({
    occupationId: z
      .string()
      .regex(/^occ-[a-z0-9-]+$/u)
      .max(128),
    version: z.string().trim().min(1).max(64),
    status: searchOccupationStatusSchema,
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
      .max(16),
    labels: localizedLabelSchema,
    canonicalTitles: z.array(searchRelatedTitleSchema).min(1).max(64),
    aliases: z.array(searchOccupationAliasSchema).max(128).default([]),
    relatedTitles: z.array(searchRelatedTitleSchema).max(128).default([]),
    titleFacetMappings: z
      .array(searchTitleFacetMappingSchema)
      .max(128)
      .optional(),
    defaultFacetIds: z
      .array(z.string().trim().min(1).max(128))
      .max(16)
      .default([]),
    supportedFacetIds: z
      .array(z.string().trim().min(1).max(128))
      .max(64)
      .default([]),
    skills: z.array(z.string().trim().min(1).max(100)).max(64).default([]),
    negativeTerms: z
      .array(z.string().trim().min(1).max(160))
      .max(64)
      .default([]),
  })
  .strict();

export const genericRoleTermSchema = z
  .object({
    phrase: z.string().trim().min(1).max(80),
    language: searchLanguageSchema,
    role: z.enum(["INDIVIDUAL_CONTRIBUTOR", "MANAGEMENT", "INTERN"]),
  })
  .strict();

export const searchSkillDefinitionSchema = z
  .object({
    skillId: z.string().trim().min(1).max(128),
    phrases: z.array(z.string().trim().min(1).max(100)).min(1).max(64),
  })
  .strict();

export const jobSearchProfileSourceSchema = z.enum([
  "EXPLICIT",
  "AUTO_HIGH_CONFIDENCE",
  "REVIEWED",
  "UNMAPPED",
]);

export const jobSearchProfileSchema = z
  .object({
    titleIds: z.array(z.string().trim().min(1).max(180)).max(16).default([]),
    occupationIds: z.array(z.string().trim().min(1).max(128)).max(16),
    facetIds: z.array(z.string().trim().min(1).max(128)).max(16),
    normalizedTitle: z.string().max(200),
    canonicalTitleVi: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .nullable()
      .default(null),
    canonicalTitleEn: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .nullable()
      .default(null),
    normalizedAliases: z
      .array(z.string().trim().min(1).max(160))
      .max(64)
      .default([]),
    normalizedSkills: z.array(z.string().trim().min(1).max(100)).max(64),
    source: jobSearchProfileSourceSchema,
    confidence: z.number().finite().min(0).max(1),
    translationStatus: bilingualJobTitleStatusSchema.default("UNMAPPED"),
    mappingSource: searchMappingSourceSchema.default("MANUAL_REVIEW"),
    mappingConfidence: z.number().finite().min(0).max(1).default(0),
    reviewReason: z.string().trim().min(1).max(240).nullable().default(null),
    catalogVersion: z.string().trim().min(1).max(64),
  })
  .strict();

export const searchCatalogSchema = z
  .object({
    version: z.string().trim().min(1).max(64),
    occupations: z.array(occupationDefinitionSchema).min(1).max(1000),
    titleDefinitions: z
      .array(bilingualJobTitleDefinitionSchema)
      .max(20_000)
      .optional(),
    facets: z.array(searchFacetDefinitionSchema).max(256),
    genericRoleTerms: z.array(genericRoleTermSchema).max(128).default([]),
    skills: z.array(searchSkillDefinitionSchema).max(512).default([]),
  })
  .strict()
  .superRefine((catalog, context) => {
    const occupationIds = new Set<string>();
    const facetIds = new Set<string>();
    const skillIds = new Set<string>();
    const titleIds = new Set<string>();

    for (const facet of catalog.facets) {
      if (facetIds.has(facet.facetId)) {
        context.addIssue({
          code: "custom",
          path: ["facets"],
          message: `Duplicate facet id: ${facet.facetId}`,
        });
      }
      facetIds.add(facet.facetId);
      if (facet.conflictFacetIds.includes(facet.facetId)) {
        context.addIssue({
          code: "custom",
          path: ["facets"],
          message: `Facet cannot conflict with itself: ${facet.facetId}`,
        });
      }
    }

    for (const skill of catalog.skills) {
      if (skillIds.has(skill.skillId)) {
        context.addIssue({
          code: "custom",
          path: ["skills"],
          message: `Duplicate skill id: ${skill.skillId}`,
        });
      }
      skillIds.add(skill.skillId);
    }

    for (const occupation of catalog.occupations) {
      if (occupationIds.has(occupation.occupationId)) {
        context.addIssue({
          code: "custom",
          path: ["occupations"],
          message: `Duplicate occupation id: ${occupation.occupationId}`,
        });
      }
      occupationIds.add(occupation.occupationId);
      const referencedFacetIds = [
        ...occupation.defaultFacetIds,
        ...occupation.supportedFacetIds,
        ...occupation.canonicalTitles.flatMap((title) => title.facetIds),
        ...occupation.aliases.flatMap((alias) => alias.facetIds),
        ...occupation.relatedTitles.flatMap((title) => title.facetIds),
        ...(occupation.titleFacetMappings ?? []).flatMap(
          (title) => title.facetIds,
        ),
      ];
      for (const facetId of referencedFacetIds) {
        if (!facetIds.has(facetId)) {
          context.addIssue({
            code: "custom",
            path: ["occupations"],
            message: `Unknown facet id: ${facetId}`,
          });
        }
      }
      const aliases = [
        ...occupation.canonicalTitles,
        ...occupation.aliases,
        ...occupation.relatedTitles,
      ];
      if (aliases.some((alias) => !alias.phrase.trim())) {
        context.addIssue({
          code: "custom",
          path: ["occupations"],
          message: `Occupation has an empty alias: ${occupation.occupationId}`,
        });
      }
    }

    const titlePhraseOwners = new Map<string, string[]>();
    for (const [index, title] of (catalog.titleDefinitions ?? []).entries()) {
      if (titleIds.has(title.titleId)) {
        context.addIssue({
          code: "custom",
          path: ["titleDefinitions", index, "titleId"],
          message: `Duplicate title id: ${title.titleId}`,
        });
      }
      titleIds.add(title.titleId);

      if (title.status && title.status !== title.translationStatus) {
        context.addIssue({
          code: "custom",
          path: ["titleDefinitions", index, "status"],
          message: "Legacy status must equal translationStatus when supplied.",
        });
      }
      if (title.occupationId && !occupationIds.has(title.occupationId)) {
        context.addIssue({
          code: "custom",
          path: ["titleDefinitions", index, "occupationId"],
          message: `Unknown occupation id: ${title.occupationId}`,
        });
      }
      for (const facetId of title.facetIds) {
        if (!facetIds.has(facetId)) {
          context.addIssue({
            code: "custom",
            path: ["titleDefinitions", index, "facetIds"],
            message: `Unknown facet id: ${facetId}`,
          });
        }
      }
      if (
        title.translationStatus === "HUMAN_VERIFIED" &&
        !["CURATED", "MANUAL_REVIEW"].includes(title.mappingSource)
      ) {
        context.addIssue({
          code: "custom",
          path: ["titleDefinitions", index, "translationStatus"],
          message:
            "HUMAN_VERIFIED titles require curated or manual-review provenance.",
        });
      }
      if (
        title.translationStatus === "HUMAN_VERIFIED" &&
        normalizedCatalogPhrase(title.canonical.vi) ===
          normalizedCatalogPhrase(title.canonical.en)
      ) {
        context.addIssue({
          code: "custom",
          path: ["titleDefinitions", index, "canonical", "vi"],
          message:
            "HUMAN_VERIFIED titles cannot use an unchanged English canonical as Vietnamese.",
        });
      }
      if (
        title.translationStatus === "AUTO_HIGH_CONFIDENCE" &&
        title.mappingSource === "MANUAL_REVIEW"
      ) {
        context.addIssue({
          code: "custom",
          path: ["titleDefinitions", index, "mappingSource"],
          message: "Manual review cannot be labelled AUTO_HIGH_CONFIDENCE.",
        });
      }
      const needsReason = [
        "REQUIRES_REVIEW",
        "INTENTIONAL_UNTRANSLATED",
        "AMBIGUOUS",
        "UNMAPPED",
      ].includes(title.translationStatus);
      if (needsReason && !title.reviewReason) {
        context.addIssue({
          code: "custom",
          path: ["titleDefinitions", index, "reviewReason"],
          message: `${title.translationStatus} titles require reviewReason.`,
        });
      }
      if (!needsReason && title.reviewReason) {
        context.addIssue({
          code: "custom",
          path: ["titleDefinitions", index, "reviewReason"],
          message: `${title.translationStatus} titles cannot carry reviewReason.`,
        });
      }
      for (const phrase of [
        title.canonical.vi,
        title.canonical.en,
        ...title.aliases.vi,
        ...title.aliases.en,
        ...title.abbreviations,
      ]) {
        const normalizedPhrase = normalizedCatalogPhrase(phrase);
        if (!normalizedPhrase) continue;
        const owners = titlePhraseOwners.get(normalizedPhrase) ?? [];
        owners.push(title.titleId);
        titlePhraseOwners.set(normalizedPhrase, owners);
      }
    }
    for (const [phrase, owners] of titlePhraseOwners) {
      const uniqueOwners = [...new Set(owners)];
      if (uniqueOwners.length > 1) {
        const definitions = uniqueOwners
          .map((titleId) =>
            (catalog.titleDefinitions ?? []).find(
              (definition) => definition.titleId === titleId,
            ),
          )
          .filter((definition): definition is NonNullable<typeof definition> =>
            Boolean(definition),
          );
        const sharedOccupationPhrase =
          definitions.length === uniqueOwners.length &&
          Boolean(definitions[0]?.occupationId) &&
          definitions.every(
            (definition) =>
              definition.occupationId === definitions[0]?.occupationId,
          );
        // A shared bilingual synonym within one occupation is intentionally
        // retained as an ambiguous title set. The resolver keeps every title
        // candidate instead of silently selecting one; cross-occupation
        // collisions remain schema errors.
        if (sharedOccupationPhrase) continue;
        context.addIssue({
          code: "custom",
          path: ["titleDefinitions"],
          message: `Title phrase collision without disambiguation: ${phrase}`,
        });
      }
    }

    for (const facet of catalog.facets) {
      for (const conflictFacetId of facet.conflictFacetIds) {
        if (!facetIds.has(conflictFacetId)) {
          context.addIssue({
            code: "custom",
            path: ["facets"],
            message: `Unknown conflict facet id: ${conflictFacetId}`,
          });
        }
      }
    }
  });

const correctionSchema = z
  .object({
    from: z.string().trim().min(1).max(200),
    to: z.string().trim().min(1).max(200),
    confidence: z.enum(["HIGH", "MEDIUM"]),
    reason: z.enum(["TYPO", "ALIAS", "NORMALIZED"]),
  })
  .strict();

const occupationCandidateSchema = z
  .object({
    occupationId: z.string().trim().min(1).max(128),
    confidence: z.enum(["HIGH", "MEDIUM"]),
    matchKind: z.enum(["EXACT", "RELATED", "FUZZY", "SKILL"]),
    score: z.number().finite().min(0).max(100),
  })
  .strict();

export const jobSearchIntentSchema = z
  .object({
    language: searchLanguageSchema,
    titleCandidates: z
      .array(
        z
          .object({
            titleId: z.string().trim().min(1).max(180),
            confidence: z.enum(["HIGH", "MEDIUM"]),
            matchKind: z.enum(["EXACT", "ALIAS", "FUZZY", "RELATED"]),
            score: z.number().finite().min(0).max(100),
          })
          .strict(),
      )
      .max(16)
      .default([]),
    occupationCandidates: z.array(occupationCandidateSchema).max(16),
    requiredFacetIds: z.array(z.string().trim().min(1).max(128)).max(16),
    preferredFacetIds: z.array(z.string().trim().min(1).max(128)).max(16),
    excludedFacetIds: z.array(z.string().trim().min(1).max(128)).max(16),
    skills: z.array(z.string().trim().min(1).max(100)).max(16),
    retainedTerms: z.array(z.string().trim().min(1).max(200)).max(16),
    corrections: z.array(correctionSchema).max(16),
    ambiguous: z.boolean(),
    resolverVersion: z.string().trim().min(1).max(64),
    catalogVersion: z.string().trim().min(1).max(64),
  })
  .strict()
  .superRefine((intent, context) => {
    const occupationIds = intent.occupationCandidates.map(
      (candidate) => candidate.occupationId,
    );
    const duplicateOccupation = occupationIds.find(
      (occupationId, index) => occupationIds.indexOf(occupationId) !== index,
    );
    if (duplicateOccupation) {
      context.addIssue({
        code: "custom",
        path: ["occupationCandidates"],
        message: `Duplicate occupation candidate: ${duplicateOccupation}`,
      });
    }
    const titleIds = intent.titleCandidates.map(
      (candidate) => candidate.titleId,
    );
    const duplicateTitle = titleIds.find(
      (titleId, index) => titleIds.indexOf(titleId) !== index,
    );
    if (duplicateTitle) {
      context.addIssue({
        code: "custom",
        path: ["titleCandidates"],
        message: `Duplicate title candidate: ${duplicateTitle}`,
      });
    }

    const required = new Set(intent.requiredFacetIds);
    const preferred = new Set(intent.preferredFacetIds);
    const excluded = new Set(intent.excludedFacetIds);
    for (const facetId of required) {
      if (preferred.has(facetId) || excluded.has(facetId)) {
        context.addIssue({
          code: "custom",
          path: ["requiredFacetIds"],
          message: `Facet appears in conflicting intent buckets: ${facetId}`,
        });
      }
    }
    for (const facetId of preferred) {
      if (excluded.has(facetId)) {
        context.addIssue({
          code: "custom",
          path: ["preferredFacetIds"],
          message: `Facet appears in conflicting intent buckets: ${facetId}`,
        });
      }
    }
  });

export function createJobSearchIntentSchema(input: {
  occupationIds: ReadonlySet<string>;
  titleIds?: ReadonlySet<string>;
  facets: ReadonlyMap<string, { conflictFacetIds: readonly string[] }>;
}) {
  return jobSearchIntentSchema.superRefine((intent, context) => {
    for (const candidate of intent.occupationCandidates) {
      if (!input.occupationIds.has(candidate.occupationId)) {
        context.addIssue({
          code: "custom",
          path: ["occupationCandidates"],
          message: `Unknown occupation id: ${candidate.occupationId}`,
        });
      }
    }
    for (const candidate of intent.titleCandidates) {
      if (input.titleIds && !input.titleIds.has(candidate.titleId)) {
        context.addIssue({
          code: "custom",
          path: ["titleCandidates"],
          message: `Unknown title id: ${candidate.titleId}`,
        });
      }
    }
    const allFacetIds = [
      ...intent.requiredFacetIds,
      ...intent.preferredFacetIds,
      ...intent.excludedFacetIds,
    ];
    for (const facetId of allFacetIds) {
      if (!input.facets.has(facetId)) {
        context.addIssue({
          code: "custom",
          path: ["requiredFacetIds"],
          message: `Unknown facet id: ${facetId}`,
        });
      }
    }
    const required = new Set(intent.requiredFacetIds);
    for (const facetId of required) {
      const definition = input.facets.get(facetId);
      if (!definition) continue;
      for (const conflictFacetId of definition.conflictFacetIds) {
        if (required.has(conflictFacetId)) {
          context.addIssue({
            code: "custom",
            path: ["requiredFacetIds"],
            message: `Required facets conflict: ${facetId} and ${conflictFacetId}`,
          });
        }
      }
    }
  });
}

export type SearchFacetKind = z.infer<typeof searchFacetKindSchema>;
export type BilingualJobTitleStatus = z.infer<
  typeof bilingualJobTitleStatusSchema
>;
export type SearchMappingSource = z.infer<typeof searchMappingSourceSchema>;
export type BilingualJobTitleDefinition = z.infer<
  typeof bilingualJobTitleDefinitionSchema
>;
export type SearchFacetDefinition = z.infer<typeof searchFacetDefinitionSchema>;
export type SearchRelatedTitle = z.infer<typeof searchRelatedTitleSchema>;
export type OccupationDefinition = z.infer<typeof occupationDefinitionSchema>;
export type SearchCatalog = z.infer<typeof searchCatalogSchema>;
export type JobSearchIntent = z.infer<typeof jobSearchIntentSchema>;
export type JobSearchCorrection = z.infer<typeof correctionSchema>;
export type GenericRoleTerm = z.infer<typeof genericRoleTermSchema>;
export type SearchSkillDefinition = z.infer<typeof searchSkillDefinitionSchema>;
export type JobSearchProfile = z.infer<typeof jobSearchProfileSchema>;
export type JobSearchProfileSource = z.infer<
  typeof jobSearchProfileSourceSchema
>;
