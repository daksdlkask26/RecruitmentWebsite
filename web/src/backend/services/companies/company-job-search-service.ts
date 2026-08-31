import "server-only";

import { PrismaCompanyJobRepository } from "@/backend/repositories/companies/prisma-company-job-repository";
import { JobDiscoveryService } from "@/backend/services/jobs/job-discovery-service";
import type { JobActor } from "@/backend/services/jobs/job-types";
import { requirePublicCompany } from "./company-discovery-authorization";
import {
  companyJobSearchQuerySchema,
  companyJobSearchResponseSchema,
  type CompanyJobSearchResponse,
} from "@/shared/contracts/company";

export class CompanyJobSearchService {
  constructor(
    private readonly repository = new PrismaCompanyJobRepository(),
    private readonly discovery = new JobDiscoveryService(repository),
  ) {}

  async search(
    companyId: string,
    raw: unknown,
    actor: JobActor,
    now = new Date(),
  ): Promise<CompanyJobSearchResponse> {
    await requirePublicCompany(companyId);
    const query = companyJobSearchQuerySchema.parse(raw);
    const result = await this.discovery.searchScoped(
      {
        q: query.q,
        location: query.location,
        searchBy: "BOTH",
        sort: "NEWEST",
        page: query.page,
        limit: query.limit,
      },
      actor,
      now,
      { companyId },
    );
    return companyJobSearchResponseSchema.parse({
      items: result.items,
      total: result.total,
      nextCursor: result.nextCursor,
      page: result.page,
      totalPages: result.totalPages,
      companyId,
      ...(result.searchInterpretation
        ? { searchInterpretation: result.searchInterpretation }
        : {}),
    });
  }
}
