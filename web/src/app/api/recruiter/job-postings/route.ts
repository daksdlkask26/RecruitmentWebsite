import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { requireSession } from "@/backend/auth/session/require-session";
import { AccountRequestError } from "@/backend/security/account-request-boundary";
import {
  jobErrorResponse,
  parseBoundedJson,
  requireJobActor,
} from "@/backend/security/job-request-boundary";
import {
  closeRecruiterJob,
  createRecruiterJob,
  deleteRecruiterJob,
  readRecruiterJobManagementData,
  updateRecruiterJob,
} from "@/backend/services/jobs/recruiter-job-posting-data";

const noStore = { "Cache-Control": "no-store" };
const recruiterJobPostingMutationBodySchema = z.record(z.string(), z.unknown());
const recruiterJobPostingMutationBodyLimit = 256 * 1024;

function errorResponse(
  message: string,
  status = 400,
  fieldErrors?: Record<string, string>,
) {
  return NextResponse.json(
    fieldErrors ? { message, fieldErrors } : { message },
    { status, headers: noStore },
  );
}

async function actor(request: Request) {
  return requireSession(request.headers);
}

function mutationErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const path = issue.path.join(".");
      if (path && !fieldErrors[path]) {
        fieldErrors[path] = "Review this field and try again.";
      }
    }
    return errorResponse(
      "Review the highlighted fields before saving this posting.",
      422,
      fieldErrors,
    );
  }

  if (error instanceof SyntaxError) {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const message = error instanceof Error ? error.message : fallback;
  if (message === "Company profile is incomplete.") {
    return errorResponse(message, 409);
  }
  if (message === "Invalid recruiter job classification.") {
    return errorResponse(message, 422, {
      industry: "Choose an industry from the list.",
      subIndustry: "Choose or enter a valid sub-industry.",
    });
  }
  if (message === "A recruiter-owned company is required.") {
    return errorResponse(message, 409);
  }
  if (message === "Job posting not found.") {
    return errorResponse(message, 404);
  }
  if (
    message === "This job posting cannot be edited in its current status." ||
    message === "This job posting cannot be closed in its current status." ||
    message === "This job posting cannot be deleted in its current status." ||
    message === "Withdraw this job from review before deleting its draft." ||
    message === "This job posting is locked while review is pending."
  ) {
    return errorResponse(message, 409);
  }
  return errorResponse(message, 400);
}

export async function GET(request: Request) {
  const current = await actor(request);
  if (!current) return errorResponse("Authentication required.", 401);
  try {
    return NextResponse.json(
      await readRecruiterJobManagementData(current.userId),
      { headers: noStore },
    );
  } catch {
    return errorResponse("Unable to load job postings.", 503);
  }
}

export async function POST(request: Request) {
  let current: Awaited<ReturnType<typeof requireJobActor>>;
  try {
    current = await requireJobActor(request, { mutation: true });
  } catch (error) {
    return jobErrorResponse(error);
  }
  try {
    const body = await parseBoundedJson(
      request,
      recruiterJobPostingMutationBodySchema,
      recruiterJobPostingMutationBodyLimit,
    );
    if (body.status !== "draft") {
      return errorResponse("Only draft content can be saved here.", 422, {
        status: "Use the review submission action after saving the draft.",
      });
    }
    const job = await createRecruiterJob(current.userId, body.job, body.status);
    return NextResponse.json(job, { status: 201, headers: noStore });
  } catch (error) {
    if (error instanceof AccountRequestError) return jobErrorResponse(error);
    return mutationErrorResponse(error, "Unable to create job posting.");
  }
}

export async function PATCH(request: Request) {
  let current: Awaited<ReturnType<typeof requireJobActor>>;
  try {
    current = await requireJobActor(request, { mutation: true });
  } catch (error) {
    return jobErrorResponse(error);
  }
  try {
    const body = await parseBoundedJson(
      request,
      recruiterJobPostingMutationBodySchema,
      recruiterJobPostingMutationBodyLimit,
    );
    if (body.status !== "draft" && body.status !== "rejected")
      return errorResponse("Only draft content can be saved here.", 422);
    const job = await updateRecruiterJob(current.userId, {
      ...body,
      status: "draft",
    });
    return NextResponse.json(job, { headers: noStore });
  } catch (error) {
    if (error instanceof AccountRequestError) return jobErrorResponse(error);
    return mutationErrorResponse(error, "Unable to update job posting.");
  }
}

export async function DELETE(request: Request) {
  let current: Awaited<ReturnType<typeof requireJobActor>>;
  try {
    current = await requireJobActor(request, { mutation: true });
  } catch (error) {
    return jobErrorResponse(error);
  }
  try {
    const jobId = new URL(request.url).searchParams.get("jobId");
    if (!jobId) return errorResponse("A job id is required.");
    const action = new URL(request.url).searchParams.get("action");
    if (action === "delete") {
      const industryCode = new URL(request.url).searchParams.get(
        "industryCode",
      );
      if (!industryCode || industryCode.length > 16) {
        return errorResponse("A valid industry code is required.", 422);
      }
      const result = await deleteRecruiterJob(
        current.userId,
        current.sessionId,
        jobId,
        industryCode,
      );
      return NextResponse.json(result, { headers: noStore });
    }
    const industryCode = new URL(request.url).searchParams.get("industryCode");
    const job = await closeRecruiterJob(
      current.userId,
      jobId,
      industryCode && industryCode.length <= 16 ? industryCode : undefined,
    );
    return NextResponse.json(job, { headers: noStore });
  } catch (error) {
    return mutationErrorResponse(error, "Unable to close job posting.");
  }
}
