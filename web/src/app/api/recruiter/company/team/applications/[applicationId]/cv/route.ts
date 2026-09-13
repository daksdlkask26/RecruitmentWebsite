import {
  accountErrorResponse,
  accountJson,
  requireAccountRequest,
} from "@/backend/security/account-request-boundary";
import {
  openTeamApplicationCv,
  TeamApplicationCvError,
} from "@/backend/services/company-members/team-application-cv-service";
import { TeamApplicationService } from "@/backend/services/company-members/team-application-service";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function fileName(value: string) {
  const safe = value
    .replace(/[\\/\r\n]/gu, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .slice(0, 180);
  return safe || "team-application-cv";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
) {
  try {
    const account = await requireAccountRequest(request);
    const { applicationId } = await context.params;
    const companyId =
      new URL(request.url).searchParams.get("companyId") ?? undefined;
    const result = await openTeamApplicationCv(
      account.userId,
      applicationId,
      companyId,
    );
    await new TeamApplicationService().markOwnerViewed(
      account.userId,
      applicationId,
      companyId,
    );
    const iterator = result.stream[Symbol.asyncIterator]();
    let disposed = false;
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      await result.dispose().catch(() => undefined);
    };
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) {
            await dispose();
            controller.close();
          } else {
            controller.enqueue(next.value);
          }
        } catch (error) {
          await dispose();
          controller.error(error);
        }
      },
      async cancel() {
        try {
          await iterator.return?.();
        } finally {
          await dispose();
        }
      },
    });
    return new Response(stream, {
      headers: {
        ...headers,
        "Content-Type": result.application.cvMimeType,
        "Content-Length": String(result.application.cvByteSize),
        "Content-Disposition": `inline; filename="${fileName(result.application.cvFileName)}"`,
      },
    });
  } catch (error) {
    if (error instanceof TeamApplicationCvError) {
      return accountJson(
        { code: error.code, message: "The CV is not available." },
        { status: 404, headers },
      );
    }
    return accountErrorResponse(error);
  }
}
