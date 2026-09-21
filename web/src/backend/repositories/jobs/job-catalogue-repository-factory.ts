import "server-only";
import { resolve } from "node:path";
import {
  JsonJobCatalogueRepository,
  type JobCatalogueLeaseCoordinator,
} from "./json-job-catalogue-repository";
import { defaultJobIndustryFiles } from "./job-industry-files";
import { PrismaJobCatalogueWriteLeaseRepository } from "./prisma-job-catalogue-write-lease-repository";

const testLeaseCoordinator: JobCatalogueLeaseCoordinator = {
  async claim(input) {
    return { ...input, version: 1 };
  },
  async renew(claim, leaseExpiresAt) {
    return { ...claim, leaseExpiresAt };
  },
  async assertOwned() {},
  async release() {},
};

export function configuredJsonJobCatalogueRepository<T = unknown>(
  name: "jobs.json" | "companies.json" | "applications.json",
) {
  const configuredJobsPath = process.env.JOB_CATALOGUE_PATH?.trim();
  const defaultJobsPath = resolve(process.cwd(), "data", "jobs", "jobs.json");
  const configuredJobsFilePath = configuredJobsPath
    ? resolve(/* turbopackIgnore: true */ process.cwd(), configuredJobsPath)
    : defaultJobsPath;
  const useSplitJobFallback =
    name === "jobs.json" && configuredJobsFilePath === defaultJobsPath;
  const defaultPaths: Record<typeof name, string> = {
    "jobs.json": defaultJobsPath,
    "companies.json": resolve(
      process.cwd(),
      "data",
      "companies",
      "companies.json",
    ),
    "applications.json": resolve(
      process.cwd(),
      "data",
      "user",
      "applications.json",
    ),
  };
  const filePath =
    name === "jobs.json" && configuredJobsPath
      ? configuredJobsFilePath
      : defaultPaths[name];
  const leaseTtlMs = Number.parseInt(
    process.env.JOB_CATALOGUE_LEASE_TTL_MS ?? "30000",
    10,
  );
  const isTest = process.env.NODE_ENV === "test";
  return new JsonJobCatalogueRepository<T>({
    filePath,
    fallbackFiles: useSplitJobFallback ? defaultJobIndustryFiles() : undefined,
    mode:
      isTest || process.env.JOB_CATALOGUE_MODE === "writer"
        ? "writer"
        : "readonly",
    writerHostId:
      process.env.JOB_CATALOGUE_WRITER_HOST_ID?.trim() ||
      (isTest ? "vitest-isolated-writer" : null),
    leaseCoordinator: isTest
      ? testLeaseCoordinator
      : new PrismaJobCatalogueWriteLeaseRepository(),
    leaseTtlMs,
  });
}
