import { NextResponse, type NextRequest } from "next/server";

const local = {
  candidate: "localhost:3001",
  admin: "console.admin.localhost:3001",
  recruiter: "console.recruiter.localhost:3001",
};

export const INTERNAL_ADMIN_ROUTE = "/admin-console";
export const INTERNAL_RECRUITER_ROUTE = "/recruiter-entitlement";
export const INTERNAL_SHELL_HEADER = "x-smarthire-internal-shell";
const REQUEST_PATH_HEADER = "x-smarthire-request-path";

function isInternalShellPath(pathname: string) {
  return [INTERNAL_ADMIN_ROUTE, INTERNAL_RECRUITER_ROUTE].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function expectedHost(kind: "candidate" | "admin" | "recruiter") {
  const configured =
    kind === "candidate"
      ? process.env.CANDIDATE_ORIGIN
      : kind === "admin"
        ? process.env.ADMIN_ORIGIN
        : process.env.RECRUITER_ORIGIN;
  return configured ? new URL(configured).host : local[kind];
}

function redirectToAdminOrigin(request: NextRequest) {
  const target = new URL(
    process.env.ADMIN_ORIGIN ?? "http://console.admin.localhost:3001",
  );
  const internalPath = request.nextUrl.pathname.slice(
    INTERNAL_ADMIN_ROUTE.length,
  );
  target.pathname = internalPath || "/";
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target);
}

function cvImportUploadId(pathname: string): string | null {
  return (
    pathname.match(/^\/profile\/cv-imports\/([^/]+)(?:\/receipt)?$/u)?.[1] ??
    null
  );
}

async function preflightCvImport(
  request: NextRequest,
  uploadId: string,
  requireReceipt: boolean,
): Promise<NextResponse | null> {
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  try {
    const resource = await fetch(
      new URL(
        `/api/account/cv-imports/${encodeURIComponent(uploadId)}`,
        request.url,
      ),
      { headers, cache: "no-store" },
    );
    if (resource.status === 404) return new NextResponse(null, { status: 404 });
    if (resource.status < 200 || resource.status >= 300) return null;
    const body: unknown = await resource.json().catch(() => null);
    if (
      requireReceipt &&
      (!body ||
        typeof body !== "object" ||
        !("receipt" in body) ||
        !body.receipt)
    )
      return new NextResponse(null, { status: 404 });
  } catch {
    // The page performs the authoritative server-side check as a fallback.
    return null;
  }
  return null;
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase() ?? "";
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/")) return NextResponse.next();
  const importUploadId = cvImportUploadId(pathname);
  if (importUploadId) {
    const unavailable = await preflightCvImport(
      request,
      importUploadId,
      pathname.endsWith("/receipt"),
    );
    if (unavailable) return unavailable;
  }
  if (
    host === expectedHost("candidate") &&
    (pathname === INTERNAL_ADMIN_ROUTE ||
      pathname.startsWith(`${INTERNAL_ADMIN_ROUTE}/`))
  ) {
    return redirectToAdminOrigin(request);
  }
  if (isInternalShellPath(pathname)) {
    const shell = request.headers.get(INTERNAL_SHELL_HEADER);
    const trustedAdminRoute =
      shell === "admin" &&
      host === expectedHost("admin") &&
      (pathname === INTERNAL_ADMIN_ROUTE ||
        pathname.startsWith(`${INTERNAL_ADMIN_ROUTE}/`));
    const trustedRecruiterRoute =
      shell === "recruiter" &&
      host === expectedHost("recruiter") &&
      (pathname === INTERNAL_RECRUITER_ROUTE ||
        pathname.startsWith(`${INTERNAL_RECRUITER_ROUTE}/`));
    return trustedAdminRoute || trustedRecruiterRoute
      ? NextResponse.next()
      : new NextResponse(null, { status: 404 });
  }
  if (host === expectedHost("admin")) {
    const url = request.nextUrl.clone();
    url.pathname = `${INTERNAL_ADMIN_ROUTE}${pathname === "/" ? "" : pathname}`;
    const headers = new Headers(request.headers);
    headers.set(INTERNAL_SHELL_HEADER, "admin");
    return NextResponse.rewrite(url, { request: { headers } });
  }
  if (host === expectedHost("recruiter")) {
    const url = request.nextUrl.clone();
    url.pathname = `${INTERNAL_RECRUITER_ROUTE}${pathname === "/" ? "" : pathname}`;
    const headers = new Headers(request.headers);
    headers.set(INTERNAL_SHELL_HEADER, "recruiter");
    return NextResponse.rewrite(url, { request: { headers } });
  }
  if (host === expectedHost("candidate")) {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_PATH_HEADER, pathname);
    return NextResponse.next({ request: { headers } });
  }
  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
