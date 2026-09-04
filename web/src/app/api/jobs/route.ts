import { JobDiscoveryService } from "@/backend/services/jobs/job-discovery-service";
import {
  jobErrorResponse,
  optionalJobActor,
  publicJobJson,
} from "@/backend/security/job-request-boundary";
import { jobSearchRequestQuery } from "./job-search-request-query";

export async function GET(request: Request) {
  try {
    const actor = await optionalJobActor(request.headers);
    const result = await new JobDiscoveryService().search(
      jobSearchRequestQuery(request),
      actor,
    );
    return publicJobJson(result, actor);
  } catch (error) {
    return jobErrorResponse(error);
  }
}
