import { z } from "zod";
import { jobCardSchema } from "@/shared/contracts/jobs/discovery";
import { teamRoleSchema } from "@/shared/contracts/company-members/team-applications";
import {
  searchInterpretationSchema,
  searchMetadataSchema,
  searchModeSchema,
} from "@/shared/contracts/search/search-interpretation";

export const companyCardSchema = z
  .object({
    companyId: z.string().min(1).max(128),
    slug: z.string().min(1).max(200),
    name: z.string().min(1).max(160),
    logoUrl: z.string().nullable(),
    description: z.string().max(3_000),
    // Optional keeps custom repository adapters and older cached responses
    // readable while the public Prisma projection supplies these fields.
    industry: z.string().max(160).nullable().optional(),
    location: z.string().max(300).nullable().optional(),
    openPositionCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const companyListResponseSchema = z
  .object({
    items: z.array(companyCardSchema).max(100),
    page: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    // Directory filters expose province/city labels, not raw district-level
    // company addresses.
    locations: z.array(z.string().min(1).max(300)).max(200).optional(),
    searchMetadata: searchMetadataSchema.optional(),
    searchInterpretation: searchInterpretationSchema.optional(),
  })
  .strict();

export const companyListQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional().default(""),
    searchMode: searchModeSchema.optional().default("SMART"),
    location: z.string().trim().max(160).optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
    limit: z.coerce.number().int().min(1).max(50).optional().default(24),
  })
  .strict();

export const companyDetailSchema = companyCardSchema
  .extend({
    foundedYear: z.number().int().positive().nullable(),
    sizeRange: z.string().min(1).max(80),
    industry: z.string().max(160).nullable(),
    location: z.string().max(300).nullable(),
    activeEmployeeCount: z.number().int().nonnegative(),
    openPositionCount: z.number().int().nonnegative().optional(),
    teamRoles: z.array(teamRoleSchema).max(2),
    jobs: z.array(jobCardSchema).max(50),
    jobTotal: z.number().int().nonnegative().default(0),
    jobPage: z.number().int().positive().default(1),
    jobTotalPages: z.number().int().nonnegative().default(0),
    searchMetadata: searchMetadataSchema.optional(),
    searchInterpretation: searchInterpretationSchema.optional(),
  })
  .strict();

export const companyJobSearchQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional().default(""),
    searchMode: searchModeSchema.optional().default("SMART"),
    location: z.string().trim().max(160).optional().default(""),
    page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  })
  .strict();

export const companyJobSearchResponseSchema = z
  .object({
    items: z.array(jobCardSchema).max(50),
    total: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
    page: z.number().int().positive(),
    totalPages: z.number().int().nonnegative(),
    companyId: z.string().min(1).max(128),
    searchMetadata: searchMetadataSchema.optional(),
    searchInterpretation: searchInterpretationSchema.optional(),
  })
  .strict();

export type CompanyCard = z.infer<typeof companyCardSchema>;
export type CompanyListQuery = z.infer<typeof companyListQuerySchema>;
export type CompanyListResponse = z.infer<typeof companyListResponseSchema>;
export type CompanyDetail = z.infer<typeof companyDetailSchema>;
export type CompanyJobSearchQuery = z.infer<typeof companyJobSearchQuerySchema>;
export type CompanyJobSearchResponse = z.infer<
  typeof companyJobSearchResponseSchema
>;
