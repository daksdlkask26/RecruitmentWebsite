import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/backend/database/prisma";
import type { Prisma } from "@/backend/generated/prisma/client";
import { configuredJsonJobCatalogueRepository } from "@/backend/repositories/jobs/job-catalogue-repository-factory";
import { catalogueIndustryCode } from "@/backend/repositories/jobs/job-industry-files";
import { adoptActiveJobBaseline } from "@/backend/jobs/review/job-post-active-baseline-service";
import {
  closeManagedJobPost,
  reopenManagedJobPost,
  softDeleteManagedJobPost,
  withdrawManagedJobPostReview,
} from "@/backend/jobs/review/job-post-review-service";
import { applyRecruiterCapacityIncrease } from "@/backend/services/jobs/recruiter-capacity-service";
import { purgeCompanyDeletionRequest } from "./company-deletion-manifest-service";
import { findActiveCompanyDeletionRetentionBlock } from "./company-deletion-retention";
import {
  companyCatalogSchema,
  companyLogoSchema,
  jobDraftCatalogSchema,
  recruiterCompanySettingsInputSchema,
  jobCatalogSchema,
  jobPostingStatusSchema,
  type CompanyCatalogItem,
  type JobCatalogItem,
  type RecruiterCompanySettings,
  type RecruiterCompanySettingsInput,
  type RecruiterCompanyRole,
  type JobPostingStatus,
} from "@/shared/contracts/jobs/catalog";
import {
  deriveRecruiterClassification,
  isRecruiterIndustrySelectionValid,
} from "@/shared/contracts/jobs/industry-taxonomy";
import { splitCompanyIdentity } from "@/shared/contracts/employer-verification/business-verification";
import {
  isOwnerCompanyRole,
  MAX_OWNED_COMPANIES_PER_USER,
  OWNER_COMPANY_LIMIT_REACHED,
} from "@/shared/contracts/company-ownership";
import type {
  RecruiterJob,
  RecruiterJobManagementData,
} from "@/shared/contracts/recruiter-job-posting";
import {
  jobReviewSnapshotSchema,
  prepareRecruiterJobForSave,
} from "@/shared/contracts/recruiter-job-posting";
import { listRecruiterJobTaxonomy } from "@/backend/services/jobs/job-taxonomy-service";
import { buildJobSearchProfile } from "@/backend/services/search/job-search-profile";
import { searchCatalogProvider } from "@/backend/services/search/catalogs/search-catalog-provider";
import type { SearchCatalogIndex } from "@/backend/services/search/catalogs/job-search-catalog-index";

const jobsRepository = configuredJsonJobCatalogueRepository("jobs.json");
const companiesRepository =
  configuredJsonJobCatalogueRepository("companies.json");
const applicationsRepository =
  configuredJsonJobCatalogueRepository("applications.json");
const MAX_COMPANY_LOGO_BYTES = 800 * 1024;

function isCatalogueWriterConfigured() {
  return (
    process.env.NODE_ENV === "test" ||
    (process.env.JOB_CATALOGUE_MODE === "writer" &&
      Boolean(process.env.JOB_CATALOGUE_WRITER_HOST_ID?.trim()))
  );
}

type CompanyProfileField =
  RecruiterCompanySettings["missingProfileFields"][number];

const noCompanyProfileFields: CompanyProfileField[] = [
  "name",
  "industry",
  "size",
  "address",
  "logo",
];

function missingCompanyProfileFields(
  company: Pick<
    CompanyCatalogItem,
    "name" | "industry" | "size" | "address" | "logo"
  >,
): CompanyProfileField[] {
  const required = [
    ["name", company.name],
    ["industry", company.industry],
    ["size", company.size],
    ["address", company.address],
    ["logo", company.logo],
  ] as const;
  return required
    .filter(
      ([, value]) => typeof value !== "string" || value.trim().length === 0,
    )
    .map(([field]) => field);
}

function isPng(bytes: Buffer) {
  return bytes
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isJpeg(bytes: Buffer) {
  return (
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9
  );
}

function isWebp(bytes: Buffer) {
  return (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

function validateCompanyLogo(logo: string | null) {
  if (!logo?.startsWith("data:")) return;
  const match =
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(logo);
  if (!match) throw new Error("Invalid company logo.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > MAX_COMPANY_LOGO_BYTES) {
    throw new Error("Invalid company logo.");
  }
  const valid =
    match[1] === "png"
      ? isPng(bytes)
      : match[1] === "jpeg"
        ? isJpeg(bytes)
        : isWebp(bytes);
  if (!valid) throw new Error("Invalid company logo.");
}

const legacyStatusSchema = z.enum([
  "open",
  "closing_soon",
  "filled",
  "expired",
]);
const sourceJobSchema = jobDraftCatalogSchema
  .omit({ status: true })
  .extend({ status: z.string().min(1) })
  .passthrough();
const applicationSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    userId: z.string().min(1),
    appliedAt: z.string().datetime(),
    status: z.string().min(1),
  })
  .strict();

type JobApplicationRecord = z.infer<typeof applicationSchema>;
type RecruiterCompany = CompanyCatalogItem & {
  ownerUserId: string | null;
  memberUserIds: string[];
  role?: RecruiterCompanyRole;
  /** The persistent company id when the catalog id is a legacy JSON id. */
  databaseId?: string;
  databaseBacked?: boolean;
};

const legacyStatusMap: Record<
  z.infer<typeof legacyStatusSchema>,
  JobPostingStatus
> = {
  open: "active",
  closing_soon: "active",
  filled: "closed",
  expired: "closed",
};

let writeQueue: Promise<void> = Promise.resolve();
type RecruiterCatalog = {
  jobs: JobCatalogItem[];
  companies: RecruiterCompany[];
  rawJobs: unknown[];
  rawCompanies: unknown[];
};
type RecruiterCompanyCatalog = {
  companies: RecruiterCompany[];
  rawCompanies: unknown[];
};

// The split catalogue is intentionally large (the development fixture is
// over 200 MB). Keep parsed data warm between route requests in a long-lived
// server process. Tests run with NODE_ENV=test and bypass these caches so
// their in-memory file fixtures remain deterministic.
let catalogRead: Promise<RecruiterCatalog> | null = null;
let companyCatalogRead: Promise<RecruiterCompanyCatalog> | null = null;
let rawJobsRead: Promise<unknown[]> | null = null;
let rawCompaniesRead: Promise<unknown[]> | null = null;
let catalogReadAt = 0;
let companyCatalogReadAt = 0;
let rawJobsReadAt = 0;
let rawCompaniesReadAt = 0;
const CATALOGUE_CACHE_TTL_MS = 30_000;
// The management projection is scoped by user and short-lived so adjacent
// route/API requests share the same work without keeping authorization changes
// stale for a meaningful period. All local mutations invalidate it eagerly.
const MANAGEMENT_DATA_CACHE_TTL_MS = 15_000;
const RECRUITER_JOB_CACHE_TTL_MS = 60_000;
const managementDataRead = new Map<
  string,
  {
    value: Promise<RecruiterJobManagementData>;
    createdAt: number;
    sourceVersion: string;
  }
>();
const recruiterJobsRead = new Map<
  string,
  { value: Promise<JobCatalogItem[]>; createdAt: number; sourceVersion: string }
>();

function shouldCacheCatalogue() {
  return process.env.NODE_ENV !== "test";
}

export function invalidateRecruiterJobCatalogueCache() {
  catalogRead = null;
  companyCatalogRead = null;
  rawJobsRead = null;
  rawCompaniesRead = null;
  catalogReadAt = 0;
  companyCatalogReadAt = 0;
  rawJobsReadAt = 0;
  rawCompaniesReadAt = 0;
  managementDataRead.clear();
  recruiterJobsRead.clear();
}

// Keep the old local name for mutation call sites in this module. The
// exported wrapper is also used after an approved review is published.
const invalidateCatalogueCache = invalidateRecruiterJobCatalogueCache;

async function readRawJobs() {
  if (!shouldCacheCatalogue()) return jobsRepository.read();
  if (rawJobsRead && Date.now() - rawJobsReadAt < CATALOGUE_CACHE_TTL_MS)
    return rawJobsRead;

  const next = jobsRepository.read();
  rawJobsRead = next;
  rawJobsReadAt = Date.now();
  try {
    return await next;
  } catch (error) {
    if (rawJobsRead === next) {
      rawJobsRead = null;
      rawJobsReadAt = 0;
    }
    throw error;
  }
}

async function readRawCompanies() {
  if (!shouldCacheCatalogue()) return companiesRepository.read();
  if (
    rawCompaniesRead &&
    Date.now() - rawCompaniesReadAt < CATALOGUE_CACHE_TTL_MS
  )
    return rawCompaniesRead;

  const next = companiesRepository.read();
  rawCompaniesRead = next;
  rawCompaniesReadAt = Date.now();
  try {
    return await next;
  } catch (error) {
    if (rawCompaniesRead === next) {
      rawCompaniesRead = null;
      rawCompaniesReadAt = 0;
    }
    throw error;
  }
}

function withWriteLock<T>(operation: () => Promise<T>) {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function normalizedStatus(value: string): JobPostingStatus {
  const legacy = legacyStatusSchema.safeParse(value);
  return legacy.success
    ? legacyStatusMap[legacy.data]
    : jobPostingStatusSchema.parse(value);
}

function normalizeJob(value: unknown): JobCatalogItem {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : value;

  if (candidate && typeof candidate === "object") {
    const candidateRecord = candidate as Record<string, unknown>;
    // These fields are added to the recruiter-facing projection and are not
    // part of the catalog record sent through the strict job schema.
    delete candidateRecord.company;
    delete candidateRecord.review;
    delete candidateRecord.correctionRequest;
    // PATCH carries this transient hint so split-catalogue writes can locate
    // the previously persisted industry. It must never enter the strict job
    // catalogue schema or be persisted as part of the job record.
    delete candidateRecord.previousIndustryCode;
  }

  const source = sourceJobSchema.parse(candidate);
  const status = normalizedStatus(source.status);
  return (status === "draft" ? jobDraftCatalogSchema : jobCatalogSchema).parse({
    ...source,
    status,
  });
}

function normalizeCompany(value: unknown): RecruiterCompany {
  const company = companyCatalogSchema.parse(value);
  const identity = splitCompanyIdentity(company.name, company.entityType);
  return {
    ...company,
    name: identity.name,
    entityType: identity.entityType,
    ownerUserId: company.ownerUserId ?? null,
    memberUserIds: company.memberUserIds ?? [],
  };
}

type DatabaseCompanyRow = {
  id: string;
  slug: string;
  legalName: string;
  displayName: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  publicDescription: string | null;
  publicLocation: string | null;
  foundedYear: number | null;
  size: string | null;
  industry: string | null;
  address: string | null;
  entityType: string | null;
  normalizedTaxIdentifier: string | null;
  memberships: Array<{ userId: string; role: string }>;
};

function databaseCompanyToRecruiterCompany(
  company: DatabaseCompanyRow,
  userId: string,
  catalogCompany?: RecruiterCompany,
): RecruiterCompany {
  const owner = company.memberships.find(
    (membership) => membership.role === "OWNER",
  );
  const legalIdentity = splitCompanyIdentity(company.legalName);
  const identity = splitCompanyIdentity(
    company.displayName || company.legalName,
    company.entityType ??
      catalogCompany?.entityType ??
      legalIdentity.entityType,
  );
  const currentMembership = company.memberships.find(
    (membership) => membership.userId === userId,
  );
  const databaseCompany: RecruiterCompany = {
    // Keep the legacy catalog id when the company is already represented in
    // jobs.json. Jobs are still stored in that catalog, while auth and
    // verification remain authoritative in PostgreSQL.
    id: catalogCompany?.id ?? company.id,
    slug: catalogCompany?.slug ?? company.slug,
    name: identity.name,
    entityType: identity.entityType,
    logo: company.logoUrl ?? catalogCompany?.logo ?? null,
    size: company.size ?? "",
    industry: company.industry ?? "",
    address: company.address ?? company.publicLocation ?? "",
    foundedYear: company.foundedYear ?? catalogCompany?.foundedYear ?? null,
    website: company.websiteUrl ?? null,
    description: company.publicDescription ?? null,
    ownerUserId: owner?.userId ?? null,
    memberUserIds: company.memberships.map((membership) => membership.userId),
    role: currentMembership?.role as RecruiterCompanyRole | undefined,
    taxCode:
      company.normalizedTaxIdentifier ??
      catalogCompany?.taxCode ??
      "Not provided",
    verificationStatus: "approved",
    databaseId: company.id,
    databaseBacked: true,
  };

  return databaseCompany;
}

async function readDatabaseAuthorizedCompanies(userId: string) {
  try {
    return await prisma.company.findMany({
      where: {
        verificationState: "ACTIVE",
        verifiedAt: { not: null },
        memberships: {
          some: { userId, status: "ACTIVE" },
        },
      },
      select: {
        id: true,
        slug: true,
        legalName: true,
        displayName: true,
        logoUrl: true,
        websiteUrl: true,
        publicDescription: true,
        publicLocation: true,
        foundedYear: true,
        size: true,
        industry: true,
        address: true,
        entityType: true,
        normalizedTaxIdentifier: true,
        memberships: {
          where: { status: "ACTIVE" },
          select: { userId: true, role: true },
        },
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
    });
  } catch {
    // The JSON catalog remains a compatibility source for legacy local data.
    // A database-backed company is only added when its authorization can be
    // read successfully, so a transient database failure cannot grant new
    // access through this bridge.
    return [];
  }
}

async function authorizedCompanies(
  companies: RecruiterCompany[],
  userId: string,
) {
  const databaseCompanies = await readDatabaseAuthorizedCompanies(userId);
  const byTaxCode = new Map(
    companies
      .filter((company) => company.taxCode)
      .map((company) => [company.taxCode, company]),
  );
  const databaseViews = databaseCompanies.map((company) =>
    databaseCompanyToRecruiterCompany(
      company,
      userId,
      byTaxCode.get(company.normalizedTaxIdentifier ?? ""),
    ),
  );
  const databaseIds = new Set(databaseViews.map((company) => company.id));
  const legacyAuthorized = companies
    .filter(
      (company) =>
        !databaseIds.has(company.id) &&
        company.verificationStatus === "approved" &&
        (company.ownerUserId === userId ||
          company.memberUserIds.includes(userId)),
    )
    .map((company) => ({
      ...company,
      role:
        company.ownerUserId === userId
          ? ("OWNER" as const)
          : ("MEMBER" as const),
    }));
  return [...databaseViews, ...legacyAuthorized];
}

async function readCatalog() {
  if (catalogRead && Date.now() - catalogReadAt < CATALOGUE_CACHE_TTL_MS)
    return catalogRead;

  const next = Promise.all([readRawJobs(), readRawCompanies()])
    .then(([jobsValue, companiesValue]) => {
      const rawJobs = z.array(z.unknown()).parse(jobsValue);
      const rawCompanies = z.array(z.unknown()).parse(companiesValue);
      const jobs = rawJobs.map(normalizeJob);
      const companies = rawCompanies.map(normalizeCompany);
      return { jobs, companies, rawJobs, rawCompanies };
    })
    .then((catalog) => catalog);
  if (!shouldCacheCatalogue()) return next;

  catalogRead = next;
  catalogReadAt = Date.now();
  try {
    return await catalogRead;
  } catch (error) {
    catalogRead = null;
    catalogReadAt = 0;
    throw error;
  }
}

async function readCompanyCatalog(): Promise<RecruiterCompanyCatalog> {
  if (
    companyCatalogRead &&
    Date.now() - companyCatalogReadAt < CATALOGUE_CACHE_TTL_MS
  )
    return companyCatalogRead;

  const next = readRawCompanies().then((companiesValue) => {
    const rawCompanies = z.array(z.unknown()).parse(companiesValue);
    return {
      rawCompanies,
      companies: rawCompanies.map(normalizeCompany),
    };
  });
  if (!shouldCacheCatalogue()) return next;

  companyCatalogRead = next;
  companyCatalogReadAt = Date.now();
  try {
    return await companyCatalogRead;
  } catch (error) {
    companyCatalogRead = null;
    companyCatalogReadAt = 0;
    throw error;
  }
}

async function readRecruiterJobs(companyIds: ReadonlySet<string>) {
  if (companyIds.size === 0) return [];

  const cacheKey = [...companyIds].sort().join("\u0000");
  const sourceVersion = shouldCacheCatalogue()
    ? await jobsRepository.readSourceVersion()
    : "";
  const cached = recruiterJobsRead.get(cacheKey);
  if (
    shouldCacheCatalogue() &&
    cached &&
    cached.sourceVersion === sourceVersion &&
    Date.now() - cached.createdAt < RECRUITER_JOB_CACHE_TTL_MS
  ) {
    return cached.value;
  }

  // Parse split files sequentially and retain only this tenant's records. A
  // recruiter page must not materialize/cache the entire ~200 MB catalogue.
  const next = jobsRepository
    .readMatching((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
      const companyId = (value as { companyId?: unknown }).companyId;
      return typeof companyId === "string" && companyIds.has(companyId);
    })
    .then((rawJobs) => rawJobs.map(normalizeJob));
  if (!shouldCacheCatalogue()) return next;

  recruiterJobsRead.set(cacheKey, {
    value: next,
    createdAt: Date.now(),
    sourceVersion,
  });
  try {
    return await next;
  } catch (error) {
    if (recruiterJobsRead.get(cacheKey)?.value === next) {
      recruiterJobsRead.delete(cacheKey);
    }
    throw error;
  }
}

async function readRecruiterJobsForUpdate(
  raw: unknown,
  companyIds: ReadonlySet<string>,
): Promise<JobCatalogItem[]> {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  const requestedIndustryCode =
    typeof record?.previousIndustryCode === "string"
      ? record.previousIndustryCode
      : typeof record?.industryCode === "string"
        ? record.industryCode
        : null;
  const industryCode = requestedIndustryCode
    ? catalogueIndustryCode(requestedIndustryCode)
    : null;
  const id = typeof record?.id === "string" ? record.id : null;
  if (industryCode && id) {
    const rawMatch = (
      await jobsRepository.readIndustryPartition(industryCode)
    ).find(
      (job) =>
        job &&
        typeof job === "object" &&
        !Array.isArray(job) &&
        (job as { id?: unknown }).id === id &&
        typeof (job as { companyId?: unknown }).companyId === "string" &&
        companyIds.has((job as { companyId: string }).companyId),
    );
    if (rawMatch) return [normalizeJob(rawMatch)];
  }

  // A stale/malicious hint must never hide a valid authorized job. The
  // fallback is slower, but only runs when the targeted partition misses.
  return readRecruiterJobs(companyIds);
}

async function recruiterActionCompanies(userId: string) {
  const { companies } = await readCompanyCatalog();
  return authorizedCompanies(companies, userId);
}

function rawCompanyId(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = (raw as { companyId?: unknown }).companyId;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function authorizedCompanyForId(
  companies: readonly RecruiterCompany[],
  requestedCompanyId?: string,
) {
  if (!requestedCompanyId) return companies[0] ?? null;
  return (
    companies.find(
      (company) =>
        company.id === requestedCompanyId ||
        company.databaseId === requestedCompanyId,
    ) ?? null
  );
}

export async function authorizeLegacyRecruiterJobs(
  userId: string,
  jobIds: readonly string[],
) {
  const requestedJobIds = new Set(jobIds);
  const authorized = new Map<
    string,
    { jobId: string; companyId: string; jobTitle: string }
  >();
  if (requestedJobIds.size === 0) return authorized;

  const { jobs, companies } = await readCatalog();
  const databaseCompanies = await readDatabaseAuthorizedCompanies(userId);
  const databaseCompanyIds = new Set(
    databaseCompanies.map((company) => company.id),
  );
  const databaseCompanyIdsByTaxCode = new Set(
    databaseCompanies
      .map((company) => company.normalizedTaxIdentifier)
      .filter((taxCode): taxCode is string => Boolean(taxCode)),
  );
  const companyById = new Map(
    companies.map((company) => [company.id, company]),
  );
  for (const job of jobs) {
    if (!requestedJobIds.has(job.id)) continue;
    const company = companyById.get(job.companyId);
    const companyAuthorizedByDatabase = Boolean(
      databaseCompanyIds.has(job.companyId) ||
      (company &&
        (databaseCompanyIds.has(company.id) ||
          (company.taxCode &&
            databaseCompanyIdsByTaxCode.has(company.taxCode)))),
    );
    if (
      (!company && !databaseCompanyIds.has(job.companyId)) ||
      (company &&
        !companyAuthorizedByDatabase &&
        (company.verificationStatus !== "approved" ||
          (company.ownerUserId !== userId &&
            !company.memberUserIds.includes(userId))))
    )
      continue;
    authorized.set(job.id, {
      jobId: job.id,
      companyId: company?.id ?? job.companyId,
      jobTitle: job.title,
    });
  }
  return authorized;
}

export async function authorizeLegacyRecruiterJob(
  userId: string,
  jobId: string,
) {
  return (
    (await authorizeLegacyRecruiterJobs(userId, [jobId])).get(jobId) ?? null
  );
}

function replaceRawJob(rawJobs: unknown[], updated: JobCatalogItem) {
  let replaced = false;
  const next = rawJobs.map((value) => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).id === updated.id
    ) {
      replaced = true;
      return updated;
    }
    return value;
  });
  if (!replaced) throw new Error("Job posting not found.");
  return next;
}

function replaceOrAppendRawJob(rawJobs: unknown[], updated: JobCatalogItem) {
  let replaced = false;
  const next = rawJobs.map((value) => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).id === updated.id
    ) {
      replaced = true;
      return updated;
    }
    return value;
  });
  if (!replaced) next.push(updated);
  return next;
}

function removeRawJob(rawJobs: unknown[], jobId: string) {
  return rawJobs.filter(
    (value) =>
      !(
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).id === jobId
      ),
  );
}

function replaceOrAppendRawCompany(
  rawCompanies: unknown[],
  updated: CompanyCatalogItem,
) {
  let replaced = false;
  const next = rawCompanies.map((value) => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).id === updated.id
    ) {
      replaced = true;
      return updated;
    }
    return value;
  });

  if (!replaced) next.push(updated);
  return next;
}

function replaceOrAppendDatabaseCompany(
  rawCompanies: unknown[],
  updated: CompanyCatalogItem,
  databaseCompanyId: string,
) {
  let replaced = false;
  const next = rawCompanies.map((value) => {
    const record = rawRecord(value);
    if (
      record &&
      (record.id === updated.id ||
        record.id === databaseCompanyId ||
        record.taxCode === updated.taxCode)
    ) {
      replaced = true;
      return updated;
    }
    return value;
  });
  if (!replaced) next.push(updated);
  return next;
}

function nonEmptyText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * Keeps the legacy recruiter catalogue in sync after an approved database
 * company is created. PostgreSQL remains the authorization source of truth;
 * this bridge is only written by an explicitly configured catalogue writer.
 */
export async function syncRecruiterCompanyToCatalogue(companyId: string) {
  if (!isCatalogueWriterConfigured())
    return { synced: false as const, reason: "WRITER_NOT_CONFIGURED" as const };

  return withWriteLock(async () => {
    const databaseCompany = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        slug: true,
        legalName: true,
        displayName: true,
        logoUrl: true,
        websiteUrl: true,
        publicDescription: true,
        publicLocation: true,
        foundedYear: true,
        size: true,
        industry: true,
        address: true,
        entityType: true,
        normalizedTaxIdentifier: true,
        memberships: {
          where: { status: "ACTIVE", removedAt: null },
          select: { userId: true, role: true },
        },
      },
    });
    if (!databaseCompany)
      return { synced: false as const, reason: "COMPANY_NOT_FOUND" as const };

    const { rawCompanies } = await readCompanyCatalog();
    const existingRecord = rawCompanies
      .map(rawRecord)
      .find(
        (record) =>
          record?.id === databaseCompany.id ||
          record?.taxCode === databaseCompany.normalizedTaxIdentifier,
      );
    const existingCatalog = existingRecord
      ? companyCatalogSchema.safeParse(existingRecord).data
      : undefined;
    const taxCode = databaseCompany.normalizedTaxIdentifier;
    if (!taxCode || !/^\d{10}$/u.test(taxCode)) {
      return {
        synced: false as const,
        reason: "TAX_IDENTIFIER_UNAVAILABLE" as const,
      };
    }

    const identity = splitCompanyIdentity(
      nonEmptyText(databaseCompany.displayName, databaseCompany.legalName),
      databaseCompany.entityType,
    );
    const logoCandidate =
      databaseCompany.logoUrl ?? existingCatalog?.logo ?? null;
    const logo = companyLogoSchema.safeParse(logoCandidate).success
      ? logoCandidate
      : null;
    const ownerUserId =
      databaseCompany.memberships.find(({ role }) => role === "OWNER")
        ?.userId ?? null;
    const updated = companyCatalogSchema.parse({
      id: existingCatalog?.id ?? databaseCompany.id,
      slug: existingCatalog?.slug ?? databaseCompany.slug,
      name: identity.name,
      entityType: identity.entityType,
      logo,
      size: nonEmptyText(
        databaseCompany.size,
        existingCatalog?.size ?? "Not provided",
      ),
      industry: nonEmptyText(
        databaseCompany.industry,
        existingCatalog?.industry ?? "Not provided",
      ),
      address: nonEmptyText(
        databaseCompany.address ?? databaseCompany.publicLocation,
        existingCatalog?.address ?? "Not provided",
      ),
      website: databaseCompany.websiteUrl ?? existingCatalog?.website ?? null,
      description:
        databaseCompany.publicDescription ??
        existingCatalog?.description ??
        null,
      foundedYear:
        databaseCompany.foundedYear ?? existingCatalog?.foundedYear ?? null,
      ...(existingCatalog?.rating ? { rating: existingCatalog.rating } : {}),
      jobCount: existingCatalog?.jobCount ?? 0,
      ownerUserId,
      memberUserIds: databaseCompany.memberships.map(({ userId }) => userId),
      taxCode,
      verificationStatus: "approved",
    });
    await companiesRepository.mutate((current) =>
      replaceOrAppendDatabaseCompany(current, updated, databaseCompany.id),
    );
    invalidateCatalogueCache();
    return {
      synced: true as const,
      companyId: databaseCompany.id,
      catalogueCompanyId: updated.id,
    };
  });
}

function rawRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function removeRawCompany(
  rawCompanies: unknown[],
  companyIds: ReadonlySet<string>,
  taxCode?: string,
) {
  return rawCompanies.filter((value) => {
    const record = rawRecord(value);
    if (!record) return true;
    if (typeof record.id === "string" && companyIds.has(record.id)) {
      return false;
    }
    return !(taxCode && record.taxCode === taxCode);
  });
}

function rawJobCompanyId(value: unknown) {
  const record = rawRecord(value);
  return typeof record?.companyId === "string" ? record.companyId : null;
}

function removeRawJobs(rawJobs: unknown[], companyIds: ReadonlySet<string>) {
  return rawJobs.filter((value) => {
    const companyId = rawJobCompanyId(value);
    return !companyId || !companyIds.has(companyId);
  });
}

function removeRawApplications(
  rawApplications: JobApplicationRecord[],
  jobIds: ReadonlySet<string>,
) {
  return rawApplications.filter(
    (application) => !jobIds.has(application.jobId),
  );
}

async function readApplicationsForDeletion(): Promise<JobApplicationRecord[]> {
  const value = await applicationsRepository.read();
  return z.array(applicationSchema).parse(value);
}

async function readApplications(): Promise<JobApplicationRecord[]> {
  try {
    const value = await applicationsRepository.read();
    return z.array(applicationSchema).parse(value);
  } catch {
    return [];
  }
}

/**
 * Recruiter pages are keyed by the catalogue job ID, while application
 * notifications are created from the public JobPosting ID. Resolve the
 * latter only against the already-authorized recruiter projection so an old
 * notification cannot be used to discover another company's job.
 */
export async function resolveRecruiterJobIdForNavigation(
  requestedJobId: string,
  availableJobs: ReadonlyArray<Pick<RecruiterJob, "id">>,
) {
  const normalizedJobId = requestedJobId.trim();
  if (!normalizedJobId) return null;

  const directMatch = availableJobs.find((job) => job.id === normalizedJobId);
  if (directMatch) return directMatch.id;

  const publicPosting = await prisma.jobPosting.findUnique({
    where: { id: normalizedJobId },
    select: { reviewAggregate: { select: { jobId: true } } },
  });
  const mappedJobId = publicPosting?.reviewAggregate?.jobId;
  return mappedJobId && availableJobs.some((job) => job.id === mappedJobId)
    ? mappedJobId
    : null;
}

export async function readMockAppliedJobIds(userId: string) {
  const applications = await readApplications();
  const candidateJobIds = [
    ...new Set(
      applications
        .filter((application) => application.userId === userId)
        .map((application) => application.jobId),
    ),
  ];
  if (!candidateJobIds.length) return [];
  const persistedApplications = await prisma.jobApplication.findMany({
    where: {
      candidateUserId: userId,
      jobPostingId: { in: candidateJobIds },
    },
    select: { jobPostingId: true },
  });
  const persistedJobIds = new Set(
    persistedApplications.map((application) => application.jobPostingId),
  );
  return applications
    .filter(
      (application) =>
        application.userId === userId &&
        !persistedJobIds.has(application.jobId),
    )
    .map((application) => application.jobId);
}

async function loadRecruiterJobManagementData(
  userId: string,
): Promise<RecruiterJobManagementData> {
  const { companies } = await readCompanyCatalog();
  const ownedCompanies = await authorizedCompanies(companies, userId);
  const ownedCompanyViews = ownedCompanies.map((company) => ({
    ...company,
    profileComplete: missingCompanyProfileFields(company).length === 0,
    missingProfileFields: missingCompanyProfileFields(company),
  }));
  const ownedCompanyIds = new Set(
    ownedCompanyViews.map((company) => company.id),
  );
  const jobs = await readRecruiterJobs(ownedCompanyIds);
  const companyById = new Map(
    [...companies, ...ownedCompanyViews].map((company) => [
      company.id,
      company,
    ]),
  );
  const ownedJobIds = jobs
    .filter((job) => ownedCompanyIds.has(job.companyId))
    .map((job) => job.id);
  const ownedDatabaseCompanyIds = ownedCompanies
    .map((company) => company.databaseId)
    .filter((id): id is string => Boolean(id));
  const reviewWhere = [
    ...(ownedJobIds.length ? [{ jobId: { in: ownedJobIds } }] : []),
    ...(ownedDatabaseCompanyIds.length
      ? [{ companyId: { in: ownedDatabaseCompanyIds } }]
      : []),
  ];
  // Tenant boundary is anchored to the owned job set. The DB company ids also
  // retain compatibility with legacy pending snapshots and recover a posting
  // if its draft catalogue write was interrupted before review submission.
  const reviewAggregates = reviewWhere.length
    ? await prisma.jobPostReviewAggregate.findMany({
        where: { softDeletedAt: null, OR: reviewWhere },
        select: {
          jobId: true,
          companyId: true,
          version: true,
          closedAt: true,
          pendingVersion: {
            select: {
              id: true,
              sequence: true,
              state: true,
              reasonCode: true,
              publicExplanation: true,
              submittedAt: true,
              decidedAt: true,
              snapshot: true,
            },
          },
          versions: {
            orderBy: { sequence: "desc" },
            take: 1,
            select: {
              id: true,
              sequence: true,
              state: true,
              reasonCode: true,
              publicExplanation: true,
              submittedAt: true,
              decidedAt: true,
              snapshot: true,
            },
          },
          correctionRequests: {
            where: { state: "OPEN" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              publicExplanation: true,
              hideImmediately: true,
              createdAt: true,
            },
          },
        },
      })
    : [];
  const reviewByJobId = new Map(
    reviewAggregates.map((aggregate) => [aggregate.jobId, aggregate]),
  );
  const companyForAggregate = (companyId: string) =>
    ownedCompanyViews.find(
      (company) => company.databaseId === companyId || company.id === companyId,
    );

  const reviewProjection = (
    aggregate: (typeof reviewAggregates)[number],
    company: RecruiterCompany,
  ): {
    current:
      | (typeof reviewAggregates)[number]["pendingVersion"]
      | (typeof reviewAggregates)[number]["versions"][number]
      | undefined;
    correctionRequest:
      | (typeof reviewAggregates)[number]["correctionRequests"][number]
      | undefined;
    review?: RecruiterJob["review"];
    company: RecruiterCompany;
    status?: JobPostingStatus;
    correction?: RecruiterJob["correctionRequest"];
  } => {
    const current = aggregate.pendingVersion ?? aggregate.versions[0];
    const correctionRequest = aggregate.correctionRequests[0];
    return {
      current,
      correctionRequest,
      review: current
        ? {
            reviewId: current.id,
            jobId: aggregate.jobId,
            sequence: current.sequence,
            state: current.state,
            readOnly: current.state === "PENDING_REVIEW",
            reasonCode: current.reasonCode ?? null,
            publicExplanation: current.publicExplanation ?? null,
            submittedAt: current.submittedAt.toISOString(),
            decidedAt: current.decidedAt?.toISOString() ?? null,
            version: aggregate.version,
          }
        : undefined,
      company,
      status: aggregate.closedAt
        ? ("closed" as const)
        : aggregate.pendingVersion
          ? ("pending_approval" as const)
          : current?.state === "REJECTED"
            ? ("rejected" as const)
            : current?.state === "WITHDRAWN"
              ? ("draft" as const)
              : current?.state === "APPROVED"
                ? ("active" as const)
                : undefined,
      correction: correctionRequest
        ? {
            id: correctionRequest.id,
            publicExplanation: correctionRequest.publicExplanation,
            hideImmediately: correctionRequest.hideImmediately,
            createdAt: correctionRequest.createdAt.toISOString(),
          }
        : undefined,
    };
  };

  const recruiterJobs = jobs
    .filter((job) => ownedCompanyIds.has(job.companyId))
    .map((job): RecruiterJob | null => {
      const aggregate = reviewByJobId.get(job.id);
      const company = companyById.get(job.companyId);
      if (!company) return null;
      if (!aggregate) return { ...job, company } satisfies RecruiterJob;
      const projection = reviewProjection(aggregate, company);
      let projectedJob: JobCatalogItem = job;
      // A withdrawn review is historical. Its JSON row is the new mutable
      // working draft written by the withdraw command, so projecting the old
      // immutable snapshot here would also replace the draft's updatedAt and
      // make the next submission fail the catalogue concurrency check.
      if (
        projection.current?.snapshot &&
        projection.current.state !== "WITHDRAWN"
      ) {
        const snapshot = jobReviewSnapshotSchema.safeParse(
          projection.current.snapshot,
        );
        if (snapshot.success) {
          projectedJob = jobCatalogSchema.parse({
            ...job,
            ...snapshot.data,
            id: job.id,
            companyId: job.companyId,
            status: projection.status ?? job.status,
            approvalComment: job.approvalComment ?? null,
            postedAt: job.postedAt,
            updatedAt: projection.current.submittedAt.toISOString(),
            stats: job.stats,
          });
        }
      }
      const derivedStatus = projection.status ?? projectedJob.status;
      return {
        ...projectedJob,
        status: derivedStatus,
        company,
        ...(projection.review ? { review: projection.review } : {}),
        ...(projection.correction
          ? { correctionRequest: projection.correction }
          : {}),
      } satisfies RecruiterJob;
    })
    .filter((job): job is RecruiterJob => job !== null);

  // New submissions normally retain their draft catalogue row while review is
  // pending. This fallback projects the immutable review snapshot for legacy
  // submissions or an interrupted catalogue write so the card stays visible.
  for (const aggregate of reviewAggregates) {
    if (recruiterJobs.some((job) => job.id === aggregate.jobId)) continue;
    const company = companyForAggregate(aggregate.companyId);
    const current = aggregate.pendingVersion ?? aggregate.versions[0];
    if (!company || !current) continue;
    const snapshot = jobReviewSnapshotSchema.safeParse(current.snapshot);
    if (!snapshot.success) continue;
    const projection = reviewProjection(aggregate, company);
    const projectedJob = jobCatalogSchema.parse({
      ...snapshot.data,
      id: aggregate.jobId,
      companyId: company.id,
      status: projection.status ?? "draft",
      approvalComment: null,
      isVerified: false,
      postedAt:
        current.decidedAt?.toISOString() ?? current.submittedAt.toISOString(),
      updatedAt: current.submittedAt.toISOString(),
      stats: { viewCount: 0, applicantCount: 0 },
    });
    recruiterJobs.push({
      ...projectedJob,
      company,
      ...(projection.review ? { review: projection.review } : {}),
      ...(projection.correction
        ? { correctionRequest: projection.correction }
        : {}),
    });
  }

  /*
   * The projection above is deliberately built from the review snapshot.
   * Keeping this merge in the management read path prevents a pending review
   * from disappearing while the public JSON catalogue remains unchanged.
   */
  const primaryCompany = ownedCompanyViews[0] ?? null;
  const missingProfileFields = primaryCompany
    ? missingCompanyProfileFields(primaryCompany)
    : noCompanyProfileFields;
  const jobTaxonomy = await listRecruiterJobTaxonomy({ forceRefresh: true });

  return {
    jobs: recruiterJobs,
    companies: ownedCompanyViews,
    jobTaxonomy,
    companyId: primaryCompany?.id ?? null,
    recruiterUserId: userId,
    companyProfileComplete: Boolean(
      primaryCompany && missingProfileFields.length === 0,
    ),
    missingCompanyProfileFields: missingProfileFields,
  };
}

async function recruiterCompanyMembership(
  userId: string,
  company: RecruiterCompany | undefined,
) {
  if (!company?.databaseBacked || !company.databaseId)
    throw new Error("JOB_POST_REVIEW_UNAVAILABLE");
  const membership = await prisma.companyMembership.findFirst({
    where: {
      companyId: company.databaseId,
      userId,
      status: "ACTIVE",
      role: { in: ["OWNER", "HR_MANAGER", "RECRUITER", "HIRING_MANAGER"] },
      user: { state: "ACTIVE", deletedAt: null },
      company: {
        verificationState: "ACTIVE",
        verifiedAt: { not: null },
        verificationInactiveAt: null,
      },
    },
    select: { id: true, companyId: true },
  });
  if (!membership) throw new Error("JOB_POST_REVIEW_UNAVAILABLE");
  return membership;
}

export async function readRecruiterJobManagementData(
  userId: string,
): Promise<RecruiterJobManagementData> {
  if (!shouldCacheCatalogue()) return loadRecruiterJobManagementData(userId);

  const now = Date.now();
  const sourceVersion = await jobsRepository.readSourceVersion();
  const cached = managementDataRead.get(userId);
  if (
    cached &&
    cached.sourceVersion === sourceVersion &&
    now - cached.createdAt < MANAGEMENT_DATA_CACHE_TTL_MS
  ) {
    // The management projection is cached for catalogue performance, but its
    // taxonomy must reflect an admin status change even when this request is
    // served by another application instance.
    const [value, jobTaxonomy] = await Promise.all([
      cached.value,
      listRecruiterJobTaxonomy({ forceRefresh: true }),
    ]);
    return { ...value, jobTaxonomy };
  }

  const value = loadRecruiterJobManagementData(userId);
  managementDataRead.set(userId, { value, createdAt: now, sourceVersion });
  if (managementDataRead.size > 100) {
    const oldest = managementDataRead.keys().next().value;
    if (oldest) managementDataRead.delete(oldest);
  }
  try {
    return await value;
  } catch (error) {
    const current = managementDataRead.get(userId);
    if (current?.value === value) managementDataRead.delete(userId);
    throw error;
  }
}

export async function readRecruiterJobReviewSource(
  userId: string,
  jobId: string,
) {
  const { companies } = await readCompanyCatalog();
  const authorized = await authorizedCompanies(companies, userId);
  const companyById = new Map(
    authorized.map((company) => [company.id, company]),
  );
  const jobs = await readRecruiterJobs(new Set(authorized.map(({ id }) => id)));
  const job = jobs.find((candidate) => candidate.id === jobId);
  const company = job ? companyById.get(job.companyId) : undefined;
  if (!job) throw new Error("JOB_POST_REVIEW_UNAVAILABLE");
  const membership = await recruiterCompanyMembership(userId, company);
  return { job, membership, existingJob: job };
}

/**
 * Submissions carry the current editor snapshot so a pending review does not
 * need to persist an unapproved job into the large JSON catalogue first.
 */
export async function readRecruiterJobReviewSourceFromPayload(
  userId: string,
  rawJob: unknown,
  submissionKey?: string,
) {
  const normalized = normalizeJob(rawJob);
  const { companies } = await readCompanyCatalog();
  const authorized = await authorizedCompanies(companies, userId);
  const company = authorized.find(({ id }) => id === normalized.companyId);
  if (!company) throw new Error("JOB_POST_REVIEW_UNAVAILABLE");
  const membership = await recruiterCompanyMembership(userId, company);

  if (normalized.id === "new-job") {
    // The idempotency key is stable across a network retry. Reusing it for a
    // new posting keeps the immutable review aggregate addressable without
    // first writing a draft row to the catalogue.
    const id = submissionKey
      ? `job-${submissionKey.slice(0, 124)}`
      : buildJobId();
    const locationPart = normalized.location.city || "remote";
    return {
      job: jobCatalogSchema.parse({
        ...normalized,
        id,
        slug: `${slugPart(normalized.title)}-${slugPart(locationPart)}-${id.slice(-8)}`,
        companyId: company.id,
        createdByUserId: normalized.createdByUserId ?? userId,
        status: "draft",
      }),
      membership,
      existingJob: null,
    };
  }

  const existing = (await readRecruiterJobs(new Set([company.id]))).find(
    (candidate) => candidate.id === normalized.id,
  );
  if (!existing) throw new Error("JOB_POST_REVIEW_UNAVAILABLE");
  return {
    job: jobCatalogSchema.parse({
      ...normalized,
      id: existing.id,
      slug: existing.slug,
      companyId: company.id,
      createdByUserId: existing.createdByUserId ?? null,
      // Submission creates a pending review version. The catalog status is
      // intentionally not mutated before the administrator decision.
      status: "draft",
    }),
    membership,
    existingJob: existing,
  };
}

function slugPart(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
}

function buildJobId() {
  return `job-${randomUUID()}`;
}

function jobFromCommand(
  raw: unknown,
  companyId: string,
  createdByUserId: string,
  status: Extract<JobPostingStatus, "draft">,
  now: string,
  id = buildJobId(),
  catalogIndex?: SearchCatalogIndex,
): JobCatalogItem {
  const normalized = normalizeJob(raw);
  if (!isRecruiterIndustrySelectionValid(normalized)) {
    throw new Error("Invalid recruiter job classification.");
  }
  const input = prepareRecruiterJobForSave(normalized);
  const title = input.title.trim();
  const locationPart = input.location.city || "remote";
  return jobDraftCatalogSchema.parse({
    ...input,
    searchProfile: buildJobSearchProfile(
      {
        title: input.title,
        industryCode: input.industryCode,
        categoryFamily: input.categoryFamily,
        categoryIds: input.categoryIds,
        skills: input.skillTags,
        description: [
          input.description.overview,
          ...input.description.responsibilities,
          ...input.description.requirements,
        ],
      },
      catalogIndex ? { index: catalogIndex } : undefined,
    ),
    id,
    slug: `${slugPart(title || "untitled-job")}-${slugPart(locationPart)}-${id.slice(-8)}`,
    companyId,
    createdByUserId,
    status,
    approvalComment: input.approvalComment ?? null,
    postedAt: input.postedAt || now,
    updatedAt: now,
    stats: {
      viewCount: input.stats.viewCount ?? 0,
      applicantCount: input.stats.applicantCount ?? 0,
    },
  });
}

export async function createRecruiterJob(
  userId: string,
  raw: unknown,
  status: Extract<JobPostingStatus, "draft">,
) {
  return withWriteLock(async () => {
    const company = authorizedCompanyForId(
      await recruiterActionCompanies(userId),
      rawCompanyId(raw),
    );
    if (!company) throw new Error("A recruiter-owned company is required.");
    const now = new Date().toISOString();
    const missingProfileFields = missingCompanyProfileFields(company);
    if (missingProfileFields.length) {
      throw new Error("Company profile is incomplete.");
    }
    const catalogSnapshot = await searchCatalogProvider.getActiveSnapshot();
    const job = await jobFromCommand(
      raw,
      company.id,
      userId,
      status,
      now,
      undefined,
      catalogSnapshot.index,
    );
    await jobsRepository.mutateIndustryPartition(job.industryCode, (jobs) => [
      ...jobs,
      job,
    ]);
    invalidateCatalogueCache();
    return { ...job, company } satisfies RecruiterJob;
  });
}

function recruiterCanUpdateStatus(
  current: JobPostingStatus,
  target: JobPostingStatus,
) {
  if (current === "draft" || current === "rejected") {
    return target === "draft" || target === "pending_approval";
  }
  if (current === "active") return target === "active" || target === "draft";
  if (current === "closed") return target === "closed";
  return false;
}
export async function updateRecruiterJob(userId: string, raw: unknown) {
  return withWriteLock(async () => {
    const normalized = normalizeJob(raw);
    const company = authorizedCompanyForId(
      await recruiterActionCompanies(userId),
      normalized.companyId,
    );
    if (!company) throw new Error("A recruiter-owned company is required.");
    const jobs = await readRecruiterJobsForUpdate(raw, new Set([company.id]));
    if (
      !isRecruiterIndustrySelectionValid(normalized) ||
      (normalized.status !== "draft" &&
        !deriveRecruiterClassification(normalized).valid)
    ) {
      throw new Error("Invalid recruiter job classification.");
    }
    const input = prepareRecruiterJobForSave(normalized);
    const current = jobs.find(
      (job) => job.id === input.id && job.companyId === company.id,
    );
    if (!current) throw new Error("Job posting not found.");
    const reviewLock = await prisma.jobPostReviewAggregate.findUnique({
      where: { jobId: current.id },
      select: { pendingVersionId: true },
    });
    if (reviewLock?.pendingVersionId)
      throw new Error("This job posting is locked while review is pending.");
    if (current.status === "active" && input.status === "draft") {
      if (!company.databaseBacked || !company.databaseId)
        throw new Error("JOB_POST_REVIEW_UNAVAILABLE");
      await adoptActiveJobBaseline({
        job: current,
        authoritativeCompanyId: company.databaseId,
        actorUserId: userId,
      });
    }
    if (!recruiterCanUpdateStatus(current.status, input.status)) {
      throw new Error(
        "This job posting cannot be edited in its current status.",
      );
    }
    const now = new Date().toISOString();
    const catalogSnapshot = await searchCatalogProvider.getActiveSnapshot();
    const updatedSchema =
      input.status === "draft" ? jobDraftCatalogSchema : jobCatalogSchema;
    const updated = updatedSchema.parse({
      ...input,
      searchProfile: buildJobSearchProfile(
        {
          title: input.title,
          industryCode: input.industryCode,
          categoryFamily: input.categoryFamily,
          categoryIds: input.categoryIds,
          skills: input.skillTags,
          description: [
            input.description.overview,
            ...input.description.responsibilities,
            ...input.description.requirements,
          ],
        },
        { index: catalogSnapshot.index },
      ),
      id: current.id,
      slug: current.slug,
      companyId: current.companyId,
      createdByUserId: current.createdByUserId ?? null,
      approvalComment: input.approvalComment ?? current.approvalComment ?? null,
      postedAt: current.postedAt,
      updatedAt: now,
      stats: {
        viewCount: current.stats.viewCount,
        applicantCount: current.stats.applicantCount,
      },
    });
    const currentIndustryCode = catalogueIndustryCode(current.industryCode);
    const updatedIndustryCode = catalogueIndustryCode(updated.industryCode);
    if (!currentIndustryCode || !updatedIndustryCode) {
      throw new Error("Invalid recruiter job classification.");
    }
    await jobsRepository.mutateIndustryPartitions(
      [currentIndustryCode, updatedIndustryCode],
      (partitions) => {
        const previous = partitions.get(currentIndustryCode) ?? [];
        if (currentIndustryCode === updatedIndustryCode) {
          partitions.set(currentIndustryCode, replaceRawJob(previous, updated));
          return;
        }

        const remaining = removeRawJob(previous, current.id);
        if (remaining.length === previous.length)
          throw new Error("Job posting not found.");
        partitions.set(currentIndustryCode, remaining);
        partitions.set(
          updatedIndustryCode,
          replaceOrAppendRawJob(
            partitions.get(updatedIndustryCode) ?? [],
            updated,
          ),
        );
      },
    );
    invalidateCatalogueCache();
    if (company.databaseBacked && company.databaseId) {
      await applyRecruiterCapacityIncrease({
        jobId: updated.id,
        companyId: company.databaseId,
        newCapacity: updated.numberOfHires,
        actorUserId: userId,
      });
    }
    return { ...updated, company } satisfies RecruiterJob;
  });
}

export async function closeRecruiterJob(
  userId: string,
  jobId: string,
  requestedIndustryCode?: string,
) {
  return withWriteLock(async () => {
    const companies = await recruiterActionCompanies(userId);
    const jobs = await readRecruiterJobsForUpdate(
      { id: jobId, industryCode: requestedIndustryCode },
      new Set(companies.map((candidate) => candidate.id)),
    );
    const current = jobs.find((job) => job.id === jobId);
    if (!current) throw new Error("Job posting not found.");
    const company =
      companies.find((candidate) => candidate.id === current.companyId) ?? null;
    if (!company) throw new Error("A recruiter-owned company is required.");
    if (current.status !== "active") {
      throw new Error(
        "This job posting cannot be closed in its current status.",
      );
    }
    if (company.databaseBacked && company.databaseId)
      await closeManagedJobPost({
        jobId: current.id,
        companyId: company.databaseId,
        actorUserId: userId,
      });
    const updated = jobCatalogSchema.parse({
      ...current,
      status: "closed",
      updatedAt: new Date().toISOString(),
    });
    const industryCode = catalogueIndustryCode(current.industryCode);
    if (!industryCode) throw new Error("Invalid recruiter job classification.");
    await jobsRepository.mutateIndustryPartition(industryCode, (rawJobs) =>
      replaceRawJob(rawJobs, updated),
    );
    invalidateCatalogueCache();
    return { ...updated, company } satisfies RecruiterJob;
  });
}

export async function reactivateRecruiterJob(
  userId: string,
  jobId: string,
  requestedIndustryCode?: string,
) {
  return withWriteLock(async () => {
    const companies = await recruiterActionCompanies(userId);
    const jobs = await readRecruiterJobsForUpdate(
      { id: jobId, industryCode: requestedIndustryCode },
      new Set(companies.map((candidate) => candidate.id)),
    );
    const current = jobs.find((job) => job.id === jobId);
    if (!current) throw new Error("Job posting not found.");
    const company =
      companies.find((candidate) => candidate.id === current.companyId) ?? null;
    if (!company) throw new Error("A recruiter-owned company is required.");

    const aggregate =
      company.databaseBacked && company.databaseId
        ? await prisma.jobPostReviewAggregate.findUnique({
            where: { jobId: current.id },
            select: { companyId: true, closedAt: true, softDeletedAt: true },
          })
        : null;
    if (aggregate?.softDeletedAt) throw new Error("Job posting not found.");
    if (current.status !== "closed" && !aggregate?.closedAt) {
      throw new Error(
        "This job posting cannot be reactivated in its current status.",
      );
    }

    if (company.databaseBacked && company.databaseId && aggregate?.closedAt) {
      await reopenManagedJobPost({
        jobId: current.id,
        companyId: company.databaseId,
        actorUserId: userId,
      });
    }
    const updated = jobCatalogSchema.parse({
      ...current,
      status: "active",
      updatedAt: new Date().toISOString(),
    });
    const industryCode = catalogueIndustryCode(current.industryCode);
    if (!industryCode) throw new Error("Invalid recruiter job classification.");
    await jobsRepository.mutateIndustryPartition(industryCode, (rawJobs) =>
      replaceRawJob(rawJobs, updated),
    );
    invalidateCatalogueCache();
    await invalidateCandidateJobCatalogueCache();
    return { ...updated, company } satisfies RecruiterJob;
  });
}

async function invalidateCandidateJobCatalogueCache() {
  await import("@/backend/services/jobs/job-workspace-data")
    .then(({ invalidateJobWorkspaceCatalogueCache }) =>
      invalidateJobWorkspaceCatalogueCache(),
    )
    .catch(() => undefined);
}

export async function withdrawRecruiterJobReview(
  userId: string,
  actorSessionId: string | null,
  jobId: string,
  industryCode: string,
) {
  return withWriteLock(async () => {
    // Release any legacy whole-catalogue projections before allocating the
    // target partition. This is especially important for long-lived dev
    // servers that loaded the old ~200 MB recruiter projection.
    invalidateCatalogueCache();
    await invalidateCandidateJobCatalogueCache();
    const ownedCompanies = await recruiterActionCompanies(userId);
    let result: RecruiterJob | null = null;
    await jobsRepository.mutateIndustryPartition(industryCode, async (jobs) => {
      const rawJob = jobs.find(
        (value) =>
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          (value as Record<string, unknown>).id === jobId,
      );
      const current = rawJob ? normalizeJob(rawJob) : null;
      const aggregate = current
        ? null
        : await prisma.jobPostReviewAggregate.findUnique({
            where: { jobId },
            select: { companyId: true, softDeletedAt: true },
          });
      const company = ownedCompanies.find((candidate) =>
        current
          ? candidate.id === current.companyId
          : candidate.databaseId === aggregate?.companyId,
      );
      if (!company) throw new Error("Job posting not found.");
      if (aggregate?.softDeletedAt) throw new Error("Job posting not found.");
      if (!company.databaseBacked || !company.databaseId) {
        throw new Error("JOB_POST_REVIEW_UNAVAILABLE");
      }
      await recruiterCompanyMembership(userId, company);

      const withdrawn = await withdrawManagedJobPostReview({
        jobId,
        companyId: company.databaseId,
        actorUserId: userId,
        actorSessionId,
      });
      const draft = jobCatalogSchema.parse({
        ...withdrawn.snapshot,
        id: jobId,
        companyId: current?.companyId ?? company.id,
        status: "draft",
        approvalComment: null,
        isVerified: current?.isVerified ?? false,
        createdByUserId: current?.createdByUserId ?? userId,
        postedAt: current?.postedAt ?? withdrawn.submittedAt.toISOString(),
        updatedAt: new Date().toISOString(),
        stats: current?.stats ?? { viewCount: 0, applicantCount: 0 },
      });
      result = { ...draft, company };
      return replaceOrAppendRawJob(jobs, draft);
    });
    if (!result) throw new Error("Job posting not found.");
    invalidateCatalogueCache();
    await invalidateCandidateJobCatalogueCache();
    return result;
  });
}

export async function deleteRecruiterJob(
  userId: string,
  actorSessionId: string | null,
  jobId: string,
  industryCode: string,
) {
  return withWriteLock(async () => {
    invalidateCatalogueCache();
    await invalidateCandidateJobCatalogueCache();
    const ownedCompanies = await recruiterActionCompanies(userId);
    await jobsRepository.mutateIndustryPartition(industryCode, async (jobs) => {
      const rawJob = jobs.find(
        (value) =>
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          (value as Record<string, unknown>).id === jobId,
      );
      const current = rawJob ? normalizeJob(rawJob) : null;
      const aggregate = current
        ? null
        : await prisma.jobPostReviewAggregate.findUnique({
            where: { jobId },
            select: {
              companyId: true,
              pendingVersionId: true,
              closedAt: true,
              softDeletedAt: true,
            },
          });
      const company = ownedCompanies.find((candidate) =>
        current
          ? candidate.id === current.companyId
          : candidate.databaseId === aggregate?.companyId,
      );
      if (!company) throw new Error("Job posting not found.");
      if (aggregate?.softDeletedAt) return jobs;
      if (aggregate?.pendingVersionId) {
        throw new Error(
          "Withdraw this job from review before deleting its draft.",
        );
      }
      if (aggregate?.closedAt) {
        throw new Error(
          "This job posting cannot be deleted in its current status.",
        );
      }
      if (
        current &&
        current.status !== "active" &&
        current.status !== "draft" &&
        current.status !== "rejected"
      ) {
        throw new Error(
          "This job posting cannot be deleted in its current status.",
        );
      }

      if (company.databaseBacked && company.databaseId) {
        await recruiterCompanyMembership(userId, company);
        if (current?.status === "active") {
          await adoptActiveJobBaseline({
            job: current,
            authoritativeCompanyId: company.databaseId,
            actorUserId: userId,
          });
        }
        await softDeleteManagedJobPost({
          jobId,
          companyId: company.databaseId,
          actorUserId: userId,
          actorSessionId,
        });
      }
      return removeRawJob(jobs, jobId);
    });
    invalidateCatalogueCache();
    await invalidateCandidateJobCatalogueCache();
    return { jobId, deleted: true as const };
  });
}

export async function ensureRecruiterCompany(
  userId: string,
  input: Pick<CompanyCatalogItem, "name" | "industry" | "address">,
) {
  return withWriteLock(async () => {
    const { companies, rawCompanies } = await readCatalog();
    const authorized = await authorizedCompanies(companies, userId);
    const existing = authorized[0] ?? null;
    if (existing) return existing;
    const ownedCompanyCount = authorized.filter((company) =>
      isOwnerCompanyRole(company.role),
    ).length;
    if (ownedCompanyCount >= MAX_OWNED_COMPANIES_PER_USER) {
      throw new Error(OWNER_COMPANY_LIMIT_REACHED);
    }
    const id = `comp-${randomUUID()}`;
    const identity = splitCompanyIdentity(input.name);
    const company = companyCatalogSchema.parse({
      id,
      slug: `${slugPart(identity.name)}-${id.slice(-8)}`,
      name: identity.name,
      entityType: identity.entityType,
      logo: null,
      size: "1-50 employees",
      industry: input.industry,
      address: input.address,
      website: null,
      description: null,
      foundedYear: null,
      ownerUserId: userId,
      memberUserIds: [],
      taxCode: "0000000000",
      verificationStatus: "pending",
      jobCount: 0,
    });
    await companiesRepository.mutate(() => [...rawCompanies, company]);
    invalidateCatalogueCache();
    return { ...company, ownerUserId: userId } satisfies RecruiterCompany;
  });
}

function settingsFromCompany(
  company: RecruiterCompany,
): RecruiterCompanySettings {
  return {
    id: company.id,
    databaseId: company.databaseId,
    slug: company.slug,
    name: company.name,
    entityType: company.entityType ?? null,
    logo: company.logo,
    size: company.size,
    industry: company.industry,
    address: company.address,
    website: company.website,
    description: company.description,
    foundedYear: company.foundedYear ?? null,
    ownerUserId: company.ownerUserId,
    memberUserIds: company.memberUserIds,
    taxCode: company.taxCode,
    verificationStatus: company.verificationStatus,
    role: company.role,
    profileComplete: missingCompanyProfileFields(company).length === 0,
    missingProfileFields: missingCompanyProfileFields(company),
  };
}

export class RecruiterCompanyDeletionError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "OWNER_REQUIRED" | "LEGAL_HOLD_ACTIVE",
  ) {
    super(code);
  }
}

export async function readRecruiterCompanySettingsList(
  userId: string,
): Promise<RecruiterCompanySettings[]> {
  const { companies } = await readCompanyCatalog();
  return (await authorizedCompanies(companies, userId)).map(
    settingsFromCompany,
  );
}

export async function readRecruiterCompanySettings(
  userId: string,
  companyId?: string,
) {
  const settings = await readRecruiterCompanySettingsList(userId);
  if (companyId) {
    return (
      settings.find(
        (company) =>
          company.id === companyId || company.databaseId === companyId,
      ) ?? null
    );
  }
  return settings[0] ?? null;
}

export async function updateRecruiterCompanySettings(
  userId: string,
  input: RecruiterCompanySettingsInput,
  companyId?: string,
) {
  return withWriteLock(async () => {
    const { companies, rawCompanies } = await readCatalog();
    const authorized = await authorizedCompanies(companies, userId);
    const company = companyId
      ? (authorized.find(
          (candidate) =>
            candidate.id === companyId || candidate.databaseId === companyId,
        ) ?? null)
      : (authorized[0] ?? null);
    if (!company) throw new Error("Recruiter company not found.");
    const editable = recruiterCompanySettingsInputSchema.parse(input);
    validateCompanyLogo(editable.logo);
    const identity = splitCompanyIdentity(
      company.verificationStatus === "approved" ? company.name : editable.name,
      company.entityType,
    );
    // These fields identify the PostgreSQL bridge and are not part of the
    // strict public catalog contract. Strip them before parsing the updated
    // catalog record, otherwise every DB-backed company save fails with an
    // object-level Zod error.
    const catalogCompany = { ...company };
    delete catalogCompany.databaseId;
    delete catalogCompany.databaseBacked;
    delete catalogCompany.role;
    const updated = companyCatalogSchema.parse({
      ...catalogCompany,
      name: identity.name,
      entityType: identity.entityType,
      logo: editable.logo,
      size: editable.size,
      industry: editable.industry,
      address: editable.address,
      website: editable.website,
      description: editable.description,
      foundedYear: editable.foundedYear,
    });
    if (company.databaseBacked && company.databaseId) {
      await prisma.company.update({
        where: { id: company.databaseId },
        data: {
          displayName: updated.name,
          entityType: updated.entityType,
          logoUrl: updated.logo,
          size: updated.size,
          industry: updated.industry,
          address: updated.address,
          websiteUrl: updated.website,
          publicDescription: updated.description,
          publicLocation: updated.address,
          foundedYear: updated.foundedYear,
        },
      });
    }
    if (!company.databaseBacked || isCatalogueWriterConfigured()) {
      await companiesRepository.mutate(() =>
        replaceOrAppendRawCompany(rawCompanies, updated),
      );
    }
    invalidateCatalogueCache();
    return settingsFromCompany({
      ...updated,
      ownerUserId: updated.ownerUserId ?? null,
      memberUserIds: updated.memberUserIds,
      role: company.role,
    });
  });
}

async function hardDeleteDatabaseCompany(
  transaction: Prisma.TransactionClient,
  companyId: string,
  userId: string,
  now: Date,
  existingRequestId?: string,
): Promise<Readonly<{ requestId: string; blocked: boolean }>> {
  if (existingRequestId) {
    await transaction.$queryRaw`
      SELECT 1::integer AS locked
      FROM (
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`company-deletion-request:${existingRequestId}`}, 0)
        )
      ) AS advisory_lock
    `;
    const existingRequest = await transaction.companyDeletionRequest.findFirst({
      where: {
        id: existingRequestId,
        companyId,
        requestedByUserId: userId,
      },
      select: { id: true, state: true },
    });
    if (!existingRequest) throw new RecruiterCompanyDeletionError("NOT_FOUND");
    if (existingRequest.state !== "BLOCKED_BY_LEGAL_HOLD") {
      return { requestId: existingRequest.id, blocked: false };
    }
  }

  const owner = await transaction.companyMembership.findFirst({
    where: {
      companyId,
      userId,
      role: "OWNER",
      status: "ACTIVE",
      removedAt: null,
    },
    select: { id: true },
  });
  if (!owner) throw new RecruiterCompanyDeletionError("OWNER_REQUIRED");

  const persistedCompany = await transaction.company.findUnique({
    where: { id: companyId },
    select: { id: true, verificationState: true },
  });
  if (!persistedCompany || persistedCompany.verificationState !== "ACTIVE") {
    throw new RecruiterCompanyDeletionError("NOT_FOUND");
  }

  const jobRows = await transaction.jobPosting.findMany({
    where: { companyId },
    select: { id: true },
  });
  const jobIds = jobRows.map(({ id }) => id);
  const applicationRows = jobIds.length
    ? await transaction.jobApplication.findMany({
        where: { jobPostingId: { in: jobIds } },
        select: { id: true },
      })
    : [];
  const applicationIds = applicationRows.map(({ id }) => id);

  const documentRows = applicationIds.length
    ? await transaction.applicationDocument.findMany({
        where: { jobApplicationId: { in: applicationIds } },
        select: {
          id: true,
          storageKeyEncrypted: true,
          storagePurposeVersion: true,
          sourceArtifactId: true,
        },
      })
    : [];
  const promotionRows = jobIds.length
    ? await transaction.applicationArtifactPromotion.findMany({
        where: { jobPostingId: { in: jobIds } },
        select: {
          id: true,
          storageKeyEncrypted: true,
          storagePurposeVersion: true,
        },
      })
    : [];
  const threadRows = await transaction.recruitmentThread.findMany({
    where: jobIds.length
      ? { OR: [{ companyId }, { jobPostingId: { in: jobIds } }] }
      : { companyId },
    select: { id: true },
  });
  const threadIds = threadRows.map(({ id }) => id);
  const conversationRows = await transaction.messagingConversation.findMany({
    where: applicationIds.length
      ? { OR: [{ companyId }, { applicationId: { in: applicationIds } }] }
      : { companyId },
    select: { id: true },
  });
  const conversationIds = conversationRows.map(({ id }) => id);
  const retentionBlock = await findActiveCompanyDeletionRetentionBlock(
    transaction,
    {
      companyId,
      jobIds,
      applicationIds,
      threadIds,
      conversationIds,
      now,
    },
  );

  const deletionRequest = existingRequestId
    ? { id: existingRequestId }
    : await transaction.companyDeletionRequest.create({
        data: {
          companyId,
          requestedByUserId: userId,
          requestedAt: now,
          retentionEligibleAt: now,
        },
        select: { id: true },
      });
  const databaseManifestEntries = [
    { resourceType: "COMPANY", recordId: companyId },
    ...jobIds.map((id) => ({ resourceType: "JOB_POSTING", recordId: id })),
    ...applicationIds.map((id) => ({
      resourceType: "JOB_APPLICATION",
      recordId: id,
    })),
    ...threadIds.map((id) => ({
      resourceType: "RECRUITMENT_THREAD",
      recordId: id,
    })),
    ...conversationIds.map((id) => ({
      resourceType: "MESSAGING_CONVERSATION",
      recordId: id,
    })),
    ...documentRows.map(({ id }) => ({
      resourceType: "APPLICATION_DOCUMENT",
      recordId: id,
    })),
    ...promotionRows.map(({ id }) => ({
      resourceType: "ARTIFACT_PROMOTION",
      recordId: id,
    })),
  ];
  const objectEntries = new Map<
    string,
    Readonly<{
      objectKeyEncrypted: string;
      objectVersion: string;
      state: "PENDING" | "RETAINED_SHARED";
      outcomeCode: string | null;
    }>
  >();
  for (const row of documentRows) {
    const existing = objectEntries.get(row.storageKeyEncrypted);
    objectEntries.set(row.storageKeyEncrypted, {
      objectKeyEncrypted: row.storageKeyEncrypted,
      objectVersion: row.storagePurposeVersion,
      state:
        row.sourceArtifactId || existing?.state === "RETAINED_SHARED"
          ? "RETAINED_SHARED"
          : "PENDING",
      outcomeCode:
        row.sourceArtifactId || existing?.state === "RETAINED_SHARED"
          ? "OBJECT_SHARED_SOURCE"
          : null,
    });
  }
  for (const row of promotionRows) {
    if (!objectEntries.has(row.storageKeyEncrypted)) {
      objectEntries.set(row.storageKeyEncrypted, {
        objectKeyEncrypted: row.storageKeyEncrypted,
        objectVersion: row.storagePurposeVersion,
        state: "PENDING",
        outcomeCode: null,
      });
    }
  }
  await transaction.companyDeletionManifestEntry.createMany({
    data: [
      ...databaseManifestEntries.map(({ resourceType, recordId }) => ({
        requestId: deletionRequest.id,
        identityKey: `database:${resourceType}:${recordId}`,
        resourceKind: "DATABASE_RECORD" as const,
        resourceType,
        recordId,
      })),
      ...[...objectEntries.values()].map((entry) => ({
        requestId: deletionRequest.id,
        identityKey: `object:${entry.objectKeyEncrypted}`,
        resourceKind: "OBJECT" as const,
        resourceType: "APPLICATION_DOCUMENT_OBJECT",
        objectKeyEncrypted: entry.objectKeyEncrypted,
        objectVersion: entry.objectVersion,
        state: entry.state,
        outcomeCode: entry.outcomeCode,
      })),
    ],
    skipDuplicates: Boolean(existingRequestId),
  });

  if (retentionBlock) {
    await transaction.companyDeletionManifestEntry.updateMany({
      where: { requestId: deletionRequest.id, state: "PENDING" },
      data: {
        state: "BLOCKED_BY_LEGAL_HOLD",
        outcomeCode: retentionBlock.code,
      },
    });
    await transaction.companyDeletionRequest.update({
      where: { id: deletionRequest.id },
      data: {
        state: "BLOCKED_BY_LEGAL_HOLD",
        holdState: "ACTIVE",
        purgeState: "BLOCKED",
        holdEvaluatedAt: now,
        lastFailureCode: retentionBlock.code,
      },
    });
    return { requestId: deletionRequest.id, blocked: true };
  }

  if (existingRequestId) {
    const released = await transaction.companyDeletionRequest.updateMany({
      where: {
        id: deletionRequest.id,
        state: "BLOCKED_BY_LEGAL_HOLD",
      },
      data: {
        state: "ELIGIBLE",
        holdState: "RELEASED",
        purgeState: "PENDING",
        holdEvaluatedAt: now,
        lastFailureCode: null,
      },
    });
    if (released.count !== 1) {
      return { requestId: deletionRequest.id, blocked: false };
    }
    await transaction.companyDeletionManifestEntry.updateMany({
      where: {
        requestId: deletionRequest.id,
        state: "BLOCKED_BY_LEGAL_HOLD",
      },
      data: {
        state: "PENDING",
        outcomeCode: "RETENTION_RELEASED",
        lastAttemptAt: now,
      },
    });
    await transaction.auditEvent.create({
      data: {
        occurredAt: now,
        actorType: "system",
        action: "company.deletion.retention_released",
        targetType: "company",
        targetId: companyId,
        result: "SUCCESS",
        correlationId: randomUUID(),
        context: {
          deletionRequestId: deletionRequest.id,
          resultingState: "ELIGIBLE",
        },
      },
    });
  }

  await transaction.companyDeletionRequest.update({
    where: { id: deletionRequest.id },
    data: {
      state: "ELIGIBLE",
      holdState: existingRequestId ? "RELEASED" : "CLEAR",
      purgeState: "PENDING",
      holdEvaluatedAt: now,
    },
  });

  const reviewAggregates = await transaction.jobPostReviewAggregate.findMany({
    where: jobIds.length
      ? { OR: [{ companyId }, { jobId: { in: jobIds } }] }
      : { companyId },
    select: { id: true },
  });
  const aggregateIds = reviewAggregates.map(({ id }) => id);
  const reviewVersions = aggregateIds.length
    ? await transaction.jobPostReviewVersion.findMany({
        where: { reviewAggregateId: { in: aggregateIds } },
        select: { id: true },
      })
    : [];
  const reviewVersionIds = reviewVersions.map(({ id }) => id);

  // Review aggregates contain restrictive pointers to their versions and
  // public postings. Clear those pointers before removing the review tree.
  if (aggregateIds.length) {
    await transaction.jobPostReviewAggregate.updateMany({
      where: { id: { in: aggregateIds } },
      data: {
        pendingVersionId: null,
        approvedVersionId: null,
        publicJobPostingId: null,
      },
    });
    if (reviewVersionIds.length) {
      await transaction.jobPostReviewHistory.deleteMany({
        where: { reviewVersionId: { in: reviewVersionIds } },
      });
      await transaction.jobPostReviewPrivateNote.deleteMany({
        where: { reviewVersionId: { in: reviewVersionIds } },
      });
    }
    await transaction.jobPostRevisionRequest.deleteMany({
      where: { aggregateId: { in: aggregateIds } },
    });
    await transaction.jobPostFeaturedPlacement.deleteMany({
      where: { aggregateId: { in: aggregateIds } },
    });
    await transaction.jobPostEnforcementTarget.deleteMany({
      where: { aggregateId: { in: aggregateIds } },
    });
    await transaction.jobPostOperationalHistory.deleteMany({
      where: { aggregateId: { in: aggregateIds } },
    });
    if (reviewVersionIds.length) {
      await transaction.jobPostReviewVersion.deleteMany({
        where: { id: { in: reviewVersionIds } },
      });
    }
    await transaction.jobPostReviewAggregate.deleteMany({
      where: { id: { in: aggregateIds } },
    });
  }

  // Reports use RESTRICT for their conversation relation. Remove the report
  // rows first; their review notes/events are configured to cascade with them.
  if (conversationIds.length || threadIds.length) {
    await transaction.messagingReport.deleteMany({
      where: {
        OR: [
          ...(conversationIds.length
            ? [{ conversationId: { in: conversationIds } }]
            : []),
          ...(threadIds.length
            ? [{ recruitmentThreadId: { in: threadIds } }]
            : []),
        ],
      },
    });
  }
  if (conversationIds.length) {
    await transaction.messagingConversation.deleteMany({
      where: { id: { in: conversationIds } },
    });
  }
  if (threadIds.length) {
    await transaction.recruitmentThread.deleteMany({
      where: { id: { in: threadIds } },
    });
  }

  if (jobIds.length) {
    // This table intentionally has no FK to JobPosting because it stores
    // candidate-owned private match snapshots. Delete it explicitly and
    // clear its current-attempt pointer before its cascading children.
    await transaction.privateCvMatchCheck.updateMany({
      where: { jobPostingId: { in: jobIds } },
      data: { currentAttemptId: null },
    });
    await transaction.privateCvMatchCheck.deleteMany({
      where: { jobPostingId: { in: jobIds } },
    });
    await transaction.savedJob.deleteMany({
      where: { jobPostingId: { in: jobIds } },
    });
    await transaction.jobReport.deleteMany({
      where: { jobPostingId: { in: jobIds } },
    });
    await transaction.applicationArtifactPromotion.deleteMany({
      where: { jobPostingId: { in: jobIds } },
    });
  }
  await transaction.exportRequest.deleteMany({
    where: jobIds.length
      ? { OR: [{ companyId }, { jobPostingId: { in: jobIds } }] }
      : { companyId },
  });

  if (applicationIds.length) {
    // These scoring rows have restrictive references to one another. Remove
    // them explicitly before deleting applications so no orphaned matching
    // snapshot remains after the company is gone.
    await transaction.aiSuggestedInterviewQuestion.deleteMany({
      where: {
        aiAssessment: { jobApplicationId: { in: applicationIds } },
      },
    });
    await transaction.applicationScoringResult.deleteMany({
      where: { jobApplicationId: { in: applicationIds } },
    });
    await transaction.aiAssessmentAttempt.deleteMany({
      where: { jobApplicationId: { in: applicationIds } },
    });
    await transaction.scoringWorkItem.deleteMany({
      where: { jobApplicationId: { in: applicationIds } },
    });
    await transaction.aiAssessment.deleteMany({
      where: { jobApplicationId: { in: applicationIds } },
    });
    await transaction.automaticMatchResult.deleteMany({
      where: { jobApplicationId: { in: applicationIds } },
    });
    await transaction.jobApplication.deleteMany({
      where: { id: { in: applicationIds } },
    });
  }

  if (jobIds.length) {
    // Remaining job children use CASCADE (skills, questions, drafts,
    // counters, ranking snapshots, and analytics facts).
    await transaction.jobPosting.deleteMany({
      where: { id: { in: jobIds } },
    });
  }

  // An approved verification request points at its company with RESTRICT;
  // remove that request and its evidence history before the company row.
  await transaction.recruiterVerificationRequest.deleteMany({
    where: { targetCompanyId: companyId },
  });
  await transaction.company.delete({ where: { id: companyId } });
  await transaction.companyDeletionManifestEntry.updateMany({
    where: {
      requestId: deletionRequest.id,
      resourceKind: "DATABASE_RECORD",
      state: "PENDING",
    },
    data: {
      state: "DELETED",
      outcomeCode: "DATABASE_RECORD_DELETED",
      attemptCount: { increment: 1 },
      lastAttemptAt: now,
      deletedAt: now,
    },
  });
  await transaction.companyDeletionRequest.update({
    where: { id: deletionRequest.id },
    data: {
      state: "PURGING",
      purgeState: "PENDING",
      physicalPurgeStartedAt: now,
    },
  });
  await transaction.auditEvent.create({
    data: {
      occurredAt: now,
      actorType: "user",
      actorUserId: userId,
      action: "company.deleted",
      targetType: "company",
      targetId: companyId,
      result: "SUCCESS",
      correlationId: randomUUID(),
      context: {
        companyReference: companyId,
        priorState: "ACTIVE",
        resultingState: "DELETED",
        deletionResult: "HARD_DELETED",
        deletionRequestId: deletionRequest.id,
        deletedJobCount: jobIds.length,
        deletedApplicationCount: applicationIds.length,
        deletionManifestEntryCount:
          databaseManifestEntries.length + objectEntries.size,
      },
    },
  });
  return { requestId: deletionRequest.id, blocked: false };
}

/**
 * Re-evaluates one durable deletion request after its retention block may have
 * expired. The request advisory lock serializes worker/manual retries across
 * processes; object deletion remains protected by the per-locator lock/CAS in
 * the manifest service.
 */
export async function resumeBlockedRecruiterCompanyDeletion(
  requestId: string,
  now = new Date(),
) {
  return withWriteLock(async () => {
    const request = await prisma.companyDeletionRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        companyId: true,
        requestedByUserId: true,
        state: true,
      },
    });
    if (!request) {
      return purgeCompanyDeletionRequest(requestId, { now });
    }

    if (request.state === "BLOCKED_BY_LEGAL_HOLD") {
      const databaseDeletion = await prisma.$transaction((transaction) =>
        hardDeleteDatabaseCompany(
          transaction,
          request.companyId,
          request.requestedByUserId,
          now,
          request.id,
        ),
      );
      if (databaseDeletion.blocked) {
        return {
          requestId,
          status: "BLOCKED_BY_LEGAL_HOLD" as const,
          deletedObjects: 0,
          alreadyAbsentObjects: 0,
          retainedSharedObjects: 0,
          retryableObjects: 0,
          conflictingObjects: 0,
        };
      }
    }

    return purgeCompanyDeletionRequest(requestId, { now });
  });
}

async function deleteLegacyCompanyData(
  company: RecruiterCompany,
  rawJobs: unknown[],
  rawCompanies: unknown[],
) {
  const companyIds = new Set(
    [company.id, company.databaseId].filter((id): id is string => Boolean(id)),
  );
  const legacyJobIds = new Set(
    rawJobs.flatMap((value) => {
      const record = rawRecord(value);
      const id = typeof record?.id === "string" ? record.id : null;
      return id && companyIds.has(rawJobCompanyId(value) ?? "") ? [id] : [];
    }),
  );
  const hasRawCompany = rawCompanies.some((value) => {
    const record = rawRecord(value);
    return Boolean(
      record &&
      ((typeof record.id === "string" && companyIds.has(record.id)) ||
        (company.taxCode && record.taxCode === company.taxCode)),
    );
  });
  const hasLegacyData = hasRawCompany || legacyJobIds.size > 0;
  if (
    company.databaseBacked &&
    hasLegacyData &&
    !isCatalogueWriterConfigured()
  ) {
    throw new Error("CATALOGUE_WRITER_REQUIRED");
  }

  if (legacyJobIds.size) {
    await jobsRepository.mutate((current) =>
      removeRawJobs(current, companyIds),
    );
    const applications = await readApplicationsForDeletion();
    const remainingApplications = removeRawApplications(
      applications,
      legacyJobIds,
    );
    if (remainingApplications.length !== applications.length) {
      await applicationsRepository.mutate(() => remainingApplications);
    }
  }
  if (hasRawCompany) {
    await companiesRepository.mutate((current) =>
      removeRawCompany(current, companyIds, company.taxCode),
    );
  }
}

/**
 * Permanently removes a recruiter company and its tenant-owned data. Only an
 * active Owner may perform this operation. Audit records are retained, while
 * shared user accounts, candidate CVs, and global skills remain untouched.
 */
export async function deleteRecruiterCompany(
  userId: string,
  requestedCompanyId: string,
) {
  return withWriteLock(async () => {
    const normalizedCompanyId = requestedCompanyId.trim();
    if (!normalizedCompanyId)
      throw new RecruiterCompanyDeletionError("NOT_FOUND");

    const { companies, rawJobs, rawCompanies } = await readCatalog();
    const company = (await authorizedCompanies(companies, userId)).find(
      (candidate) =>
        candidate.id === normalizedCompanyId ||
        candidate.databaseId === normalizedCompanyId,
    );
    if (!company) throw new RecruiterCompanyDeletionError("NOT_FOUND");

    const isOwner =
      company.role === "OWNER" ||
      (!company.role && company.ownerUserId === userId);
    if (!isOwner) throw new RecruiterCompanyDeletionError("OWNER_REQUIRED");

    const now = new Date();
    const databaseCompanyId = company.databaseId;
    let databaseDeletion: Readonly<{
      requestId: string;
      blocked: boolean;
    }> | null = null;
    if (company.databaseBacked && databaseCompanyId) {
      databaseDeletion = await prisma.$transaction(async (transaction) =>
        hardDeleteDatabaseCompany(transaction, databaseCompanyId, userId, now),
      );
      if (databaseDeletion.blocked) {
        invalidateCatalogueCache();
        return {
          companyId: company.id,
          deleted: false as const,
          status: "BLOCKED_BY_LEGAL_HOLD" as const,
          requestId: databaseDeletion.requestId,
        };
      }
    }

    await deleteLegacyCompanyData(company, rawJobs, rawCompanies);

    if (databaseDeletion) {
      const purge = await purgeCompanyDeletionRequest(
        databaseDeletion.requestId,
        { now },
      );
      if (purge.status !== "COMPLETED") {
        invalidateCatalogueCache();
        return {
          companyId: company.id,
          deleted: false as const,
          status: "PURGE_PENDING" as const,
          requestId: databaseDeletion.requestId,
        };
      }
    }

    invalidateCatalogueCache();
    return { companyId: company.id, deleted: true as const };
  });
}

export async function recordApplication(
  userId: string,
  jobId: string,
  status = "applied",
) {
  return withWriteLock(async () => {
    const { jobs, rawJobs } = await readCatalog();
    const job = jobs.find((candidate) => candidate.id === jobId);
    if (!job) throw new Error("Job posting not found.");
    const applications = await readApplications();
    const alreadyApplied = applications.some(
      (application) =>
        application.jobId === jobId && application.userId === userId,
    );
    if (alreadyApplied) return job;
    const updated = jobCatalogSchema.parse({
      ...job,
      stats: {
        ...job.stats,
        applicantCount: job.stats.applicantCount + 1,
      },
    });
    await jobsRepository.mutate(() => replaceRawJob(rawJobs, updated));
    invalidateCatalogueCache();
    await applicationsRepository.mutate(
      () =>
        [
          ...applications,
          {
            id: `application-${randomUUID()}`,
            jobId,
            userId,
            appliedAt: new Date().toISOString(),
            status,
          },
        ] satisfies JobApplicationRecord[],
    );
    return updated;
  });
}
