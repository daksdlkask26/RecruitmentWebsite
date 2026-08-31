import { z } from "zod";
import { careerPathSlugSchema } from "./career-paths";

export const employmentTypeSchema = z.enum([
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "INTERNSHIP",
  "TEMPORARY",
]);
export const experienceLevelSchema = z.enum([
  "ENTRY",
  "JUNIOR",
  "MID",
  "SENIOR",
  "LEAD",
  "MANAGER",
]);
export const workArrangementSchema = z.enum(["ONSITE", "HYBRID", "REMOTE"]);
export const salaryPeriodSchema = z.enum(["HOUR", "MONTH", "YEAR"]);
export const jobSortSchema = z.enum([
  "RELEVANCE",
  "NEWEST",
  "SALARY_DESC",
  "UPDATED",
  "URGENT",
]);
export const jobSearchBySchema = z.enum(["TITLE", "COMPANY", "BOTH"]);

const omitEmptyControlValue = (value: unknown) =>
  value === "" || value === null ? undefined : value;

const stringArray = <T extends z.ZodType>(item: T, maximum: number) =>
  z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value.filter((item) => item !== "" && item !== null)
        : value,
    z
      .array(item)
      .max(maximum)
      .refine((values) => new Set(values).size === values.length, {
        message: "Use each value only once.",
      }),
  );

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    omitEmptyControlValue,
    z.coerce.number().pipe(schema).optional(),
  );

const optionalTrue = z.preprocess(
  (value) => (value === "true" ? true : omitEmptyControlValue(value)),
  z.literal(true).optional(),
);

export const jobSearchQuerySchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    searchBy: jobSearchBySchema.default("BOTH"),
    location: z.string().trim().max(160).default(""),
    district: stringArray(z.string().trim().min(1).max(160), 20).default([]),
    categoryFamily: stringArray(z.string().trim().min(1).max(80), 29).default(
      [],
    ),
    categoryId: stringArray(z.string().trim().min(1).max(128), 20).default([]),
    categoryTitle: stringArray(z.string().trim().min(1).max(160), 20).default(
      [],
    ),
    employmentType: stringArray(employmentTypeSchema, 5).default([]),
    experienceLevel: stringArray(experienceLevelSchema, 6).default([]),
    workArrangement: stringArray(workArrangementSchema, 3).default([]),
    careerPath: z.preprocess(
      omitEmptyControlValue,
      careerPathSlugSchema.optional(),
    ),
    skills: stringArray(z.string().trim().min(1).max(80), 20).default([]),
    salaryMin: optionalNumber(z.number().finite().min(0)),
    salaryMax: optionalNumber(z.number().finite().min(0)),
    // This mirrors the public card state: a job is shown as "Negotiable"
    // when it has no complete numeric salary range.
    salaryNegotiable: optionalTrue,
    salaryCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .default("VND"),
    salaryPeriod: salaryPeriodSchema.default("MONTH"),
    postedWithinDays: z.preprocess(
      omitEmptyControlValue,
      z.coerce
        .number()
        .int()
        .refine((value) => [1, 3, 7, 14, 30].includes(value))
        .optional(),
    ),
    sort: jobSortSchema.default("RELEVANCE"),
    cursor: z.preprocess(
      omitEmptyControlValue,
      z.string().max(1024).optional(),
    ),
    page: z.preprocess(
      omitEmptyControlValue,
      z.coerce.number().int().min(1).max(10_000).default(1),
    ),
    limit: z.preprocess(
      omitEmptyControlValue,
      z.coerce.number().int().min(1).max(50).default(20),
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.salaryMin !== undefined &&
      value.salaryMax !== undefined &&
      value.salaryMin > value.salaryMax
    ) {
      context.addIssue({
        code: "custom",
        path: ["salaryMax"],
        message: "Maximum salary must not be below minimum salary.",
      });
    }
    if (
      value.salaryNegotiable &&
      (value.salaryMin !== undefined || value.salaryMax !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["salaryNegotiable"],
        message: "A negotiable-salary search cannot include a salary range.",
      });
    }
  });

export const publicCompanySchema = z
  .object({
    slug: z.string().min(1).max(200),
    displayName: z.string().min(1).max(160),
    logoUrl: z.string().url().nullable(),
    websiteUrl: z.string().url().nullable(),
    publicDescription: z.string().max(3000).nullable(),
    publicLocation: z.string().max(160).nullable(),
    size: z.string().max(80).optional(),
    industry: z.string().max(160).optional(),
    address: z.string().max(300).optional(),
  })
  .strict();

export const publicJobActionsSchema = z
  .object({
    authenticated: z.boolean(),
    saved: z.boolean(),
    applied: z.boolean(),
    canSave: z.boolean(),
    canReport: z.boolean(),
    canApply: z.boolean(),
    applicationCount: z.number().int().nonnegative().optional(),
    applicationLimitReached: z.boolean().optional(),
    applicationLimitMessage: z.string().min(1).max(300).optional(),
  })
  .strict();

export const salarySchema = z
  .object({
    minimum: z.number().nonnegative(),
    maximum: z.number().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    period: salaryPeriodSchema,
    isNegotiable: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.minimum <= value.maximum)
  .nullable();

export const jobCardSchema = z
  .object({
    id: z.string().min(1).max(128),
    slug: z.string().min(1).max(220),
    title: z.string().min(1).max(200),
    company: publicCompanySchema,
    location: z.string().min(1).max(160),
    employmentType: employmentTypeSchema,
    experienceLevel: experienceLevelSchema,
    workArrangement: workArrangementSchema,
    salary: salarySchema,
    summary: z.string().min(1).max(500),
    education: z.string().max(200).optional(),
    numberOfHires: z.number().int().positive().optional(),
    age: z.string().max(80).optional(),
    skills: z.array(z.string().min(1).max(80)).max(50),
    requirementHighlights: z
      .array(z.string().min(1).max(2000))
      .max(20)
      .optional(),
    benefitHighlights: z.array(z.string().min(1).max(2000)).max(20).optional(),
    benefitItems: z
      .array(
        z
          .object({
            icon: z.string().min(1).max(80),
            label: z.string().min(1).max(300),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    publishedAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
    applicationDeadline: z.string().datetime().nullable(),
    isUrgent: z.boolean().optional(),
    workOnSaturday: z.boolean().optional(),
    isVerified: z.boolean().optional(),
    categoryIds: z.array(z.string().min(1).max(128)).max(20).optional(),
    categoryFamily: z.string().max(80).optional(),
    experienceMinYears: z.number().int().nonnegative().optional(),
    matchScore: z.number().int().min(0).max(100).optional(),
    actions: publicJobActionsSchema,
  })
  .strict();

export const jobSearchResponseSchema = z
  .object({
    items: z.array(jobCardSchema).max(50),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
    page: z.number().int().positive(),
    totalPages: z.number().int().nonnegative(),
    criteria: z.record(z.string(), z.unknown()),
    searchInterpretation: z
      .object({
        appliedTerms: z.array(z.string().min(1).max(200)).max(6),
        correction: z
          .object({
            from: z.string().min(1).max(200),
            to: z.string().min(1).max(200),
            confidence: z.enum(["HIGH", "MEDIUM"]),
          })
          .optional(),
        usedFallback: z.boolean(),
      })
      .optional(),
  })
  .strict();

export const jobDetailSchema = jobCardSchema
  .extend({
    state: z.enum(["ACTIVE", "CLOSED", "EXPIRED"]),
    description: z.string().min(1).max(20_000),
    responsibilities: z.string().min(1).max(12_000),
    requirements: z.string().min(1).max(12_000),
    benefits: z.string().max(8_000).nullable(),
    canonicalUrl: z.string().url(),

    workOnSaturday: z.boolean().optional(),
    relatedJobs: z.array(jobCardSchema).max(6).optional(),
    recommendedJobs: z.array(jobCardSchema).max(5).optional(),
  })
  .strict();

export type JobSearchQuery = z.infer<typeof jobSearchQuerySchema>;
export type JobCard = z.infer<typeof jobCardSchema>;
export type JobSearchResponse = z.infer<typeof jobSearchResponseSchema>;
export type JobDetail = z.infer<typeof jobDetailSchema>;
