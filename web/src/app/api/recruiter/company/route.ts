import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  AccountRequestError,
  accountErrorResponse,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import { requireSession } from "@/backend/auth/session/require-session";
import {
  deleteRecruiterCompany,
  readRecruiterCompanySettings,
  RecruiterCompanyDeletionError,
  updateRecruiterCompanySettings,
} from "@/backend/services/jobs/recruiter-job-posting-data";
import {
  recruiterCompanySettingsInputSchema,
  type RecruiterCompanySettings,
  type RecruiterCompanySettingsInput,
} from "@/shared/contracts/jobs/catalog";

const noStore = { "Cache-Control": "no-store" };

type ValidationFields = Record<string, string>;

function response(
  message: string,
  status: number,
  fieldErrors?: ValidationFields,
) {
  return NextResponse.json(
    fieldErrors ? { message, fieldErrors } : { message },
    { status, headers: noStore },
  );
}

function validationFields(error: ZodError): ValidationFields {
  const fields: ValidationFields = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !fields[field]) {
      fields[field] =
        field === "logo"
          ? "Choose a valid image file."
          : "This field is required.";
    }
  }
  return fields;
}

function normalizeOptionalEmptyValues(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const body = { ...(value as Record<string, unknown>) };
  for (const field of ["logo", "website", "description"]) {
    if (body[field] === "") body[field] = null;
  }
  return body;
}

function normalizedInput(
  value: RecruiterCompanySettingsInput,
): RecruiterCompanySettingsInput {
  return {
    ...value,
    name: value.name.trim(),
    size: value.size.trim(),
    industry: value.industry.trim(),
    address: value.address.trim(),
    website: value.website?.trim() || null,
    description: value.description?.trim() || null,
  };
}

export async function GET(request: Request) {
  const current = await requireSession(request.headers);
  if (!current) return response("Authentication required.", 401);
  const companyId =
    new URL(request.url).searchParams.get("companyId") ?? undefined;
  const company = await readRecruiterCompanySettings(current.userId, companyId);
  if (!company) return response("Recruiter company not found.", 404);
  return NextResponse.json(company satisfies RecruiterCompanySettings, {
    headers: noStore,
  });
}

export async function PATCH(request: Request) {
  try {
    const current = await requireAccountRequest(request, { mutation: true });
    const companyId =
      new URL(request.url).searchParams.get("companyId") ?? undefined;
    const input = recruiterCompanySettingsInputSchema.parse(
      normalizeOptionalEmptyValues(await request.json()),
    );
    const company = await updateRecruiterCompanySettings(
      current.userId,
      normalizedInput(input),
      companyId,
    );
    return NextResponse.json(company, { headers: noStore });
  } catch (error) {
    if (error instanceof AccountRequestError)
      return accountErrorResponse(error);
    if (error instanceof ZodError) {
      return response(
        "Review the highlighted company profile fields.",
        422,
        validationFields(error),
      );
    }
    if (error instanceof SyntaxError) {
      return response("Request body must be valid JSON.", 400);
    }
    if (
      error instanceof Error &&
      error.message === "Recruiter company not found."
    ) {
      return response(error.message, 404);
    }
    if (error instanceof Error && error.message === "Invalid company logo.") {
      return response(error.message, 422, {
        logo: "Choose a valid image file.",
      });
    }
    return response("Unable to save company settings.", 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const current = await requireAccountRequest(request, { mutation: true });
    const companyId = new URL(request.url).searchParams.get("companyId") ?? "";
    return NextResponse.json(
      await deleteRecruiterCompany(current.userId, companyId),
      { headers: noStore },
    );
  } catch (error) {
    if (error instanceof AccountRequestError)
      return accountErrorResponse(error);
    if (error instanceof RecruiterCompanyDeletionError) {
      if (error.code === "OWNER_REQUIRED")
        return response("Only the company owner can delete this company.", 403);
      if (error.code === "LEGAL_HOLD_ACTIVE")
        return response(
          "The deletion request was recorded, but an active legal hold blocks physical purge.",
          409,
        );
      return response("Recruiter company not found.", 404);
    }
    if (error instanceof Error && error.message === "CATALOGUE_WRITER_REQUIRED")
      return response(
        "Company data is temporarily locked for maintenance. Try again shortly.",
        503,
      );
    return response("Unable to delete company.", 400);
  }
}
