import { requireSession } from "@/backend/auth/session/require-session";
import {
  OpenApplicationDocumentError,
  OpenApplicationDocumentService,
} from "@/backend/applications/services/open-application-document";

const noStore = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
  "X-Content-Type-Options": "nosniff",
};

function unavailable() {
  return new Response(null, { status: 404, headers: noStore });
}

function fileName(value: string | null, kind: "cv" | "cover-letter") {
  const fallback = kind === "cv" ? "submitted-cv.pdf" : "cover-letter.pdf";
  const normalized = (value ?? fallback)
    .replace(/[\\/\r\n]/gu, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .slice(0, 180);
  return normalized || fallback;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ applicationId?: string; kind?: string }> },
) {
  const current = await requireSession(request.headers);
  const params = await context.params;
  const kind =
    params.kind === "cv" || params.kind === "cover-letter" ? params.kind : null;
  if (!current || !kind || !params.applicationId) return unavailable();
  const attachment = new URL(request.url).searchParams.get("download") === "1";
  try {
    const result =
      await new OpenApplicationDocumentService().executeForCandidate({
        candidateUserId: current.userId,
        applicationId: params.applicationId,
        kind,
        preview: !attachment,
      });
    if (result.document.text !== null) {
      return new Response(result.document.text, {
        headers: {
          ...noStore,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `inline; filename="${fileName(null, kind)}"`,
        },
      });
    }
    if (!result.stream) return unavailable();
    const iterator = result.stream[Symbol.asyncIterator]();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      cancel() {
        void iterator.return?.();
      },
    });
    return new Response(stream, {
      headers: {
        ...noStore,
        "Content-Type": result.document.mediaType ?? "application/octet-stream",
        "Content-Length": String(result.document.byteLength),
        "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${fileName(result.document.fileName, kind)}"`,
      },
    });
  } catch (error) {
    if (error instanceof OpenApplicationDocumentError) return unavailable();
    return unavailable();
  }
}
