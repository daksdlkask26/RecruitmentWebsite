import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  INTERNAL_ADMIN_ROUTE,
  INTERNAL_RECRUITER_ROUTE,
  INTERNAL_SHELL_HEADER,
  proxy,
} from "@/proxy";

function request(url: string, headers?: HeadersInit) {
  const target = new URL(url);
  return new NextRequest(target, {
    headers: { host: target.host, ...headers },
  });
}

describe("product host shell routing", () => {
  it("rewrites the exact admin and recruiter hosts to routable segments", async () => {
    const admin = await proxy(
      request("http://console.admin.localhost:3001/accounts"),
    );
    const recruiter = await proxy(
      request("http://console.recruiter.localhost:3001/"),
    );

    expect(admin.headers.get("x-middleware-rewrite")).toBe(
      `http://console.admin.localhost:3001${INTERNAL_ADMIN_ROUTE}/accounts`,
    );
    expect(recruiter.headers.get("x-middleware-rewrite")).toBe(
      `http://console.recruiter.localhost:3001${INTERNAL_RECRUITER_ROUTE}`,
    );
  });

  it("redirects the user-facing admin alias without exposing the internal shell", async () => {
    const candidateAlias = await proxy(
      request(`http://localhost:3001${INTERNAL_ADMIN_ROUTE}/accounts`),
    );

    expect(candidateAlias.status).toBe(307);
    expect(candidateAlias.headers.get("location")).toBe(
      "http://console.admin.localhost:3001/accounts",
    );
    expect(
      (await proxy(
        request(`http://console.admin.localhost:3001${INTERNAL_ADMIN_ROUTE}`),
      )).status,
    ).toBe(404);
    expect(
      (await proxy(
        request(
          `http://console.recruiter.localhost:3001${INTERNAL_RECRUITER_ROUTE}`,
        ),
      )).status,
    ).toBe(404);
    expect(
      (await proxy(
        request(`http://localhost:3001${INTERNAL_ADMIN_ROUTE}`, {
          "x-smarthire-internal-admin-shell": "1",
        }),
      )).status,
    ).toBe(307);
  });

  it("allows only server-routed internal product shells", async () => {
    const admin = new NextRequest(
      `http://console.admin.localhost:3001${INTERNAL_ADMIN_ROUTE}`,
      {
        headers: {
          host: "console.admin.localhost:3001",
          [INTERNAL_SHELL_HEADER]: "admin",
        },
      },
    );
    const recruiter = new NextRequest(
      `http://console.recruiter.localhost:3001${INTERNAL_RECRUITER_ROUTE}`,
      {
        headers: {
          host: "console.recruiter.localhost:3001",
          [INTERNAL_SHELL_HEADER]: "recruiter",
        },
      },
    );

    expect((await proxy(admin)).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(recruiter)).headers.get("x-middleware-next")).toBe("1");
  });

  it("leaves candidate pages and APIs to their authoritative handlers", async () => {
    expect(
      (await proxy(request("http://localhost:3001/jobs"))).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
    expect(
      (await proxy(
        request("http://console.admin.localhost:3001/api/admin/dashboard"),
      )).headers.get("x-middleware-next"),
    ).toBe("1");
  });
});
