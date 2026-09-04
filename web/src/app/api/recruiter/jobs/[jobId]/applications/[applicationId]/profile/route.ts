import { NextResponse } from "next/server";
import { requireSession } from "@/backend/auth/session/require-session";
import { GetRecruiterApplicationProfileService } from "@/backend/applications/services/get-recruiter-application-profile";

const noStore = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string; applicationId: string }> },
) {
  const current = await requireSession(request.headers);
  if (!current)
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "Authentication required." },
      { status: 401, headers: noStore },
    );
  const { jobId, applicationId } = await context.params;
  const payload = await new GetRecruiterApplicationProfileService().execute({
    userId: current.userId,
    sessionId: current.sessionId,
    jobId,
    applicationId,
  });
  if (!payload)
    return NextResponse.json(
      { code: "NOT_FOUND", message: "Candidate profile is not available." },
      { status: 404, headers: noStore },
    );
  return NextResponse.json(payload, { headers: noStore });
}
