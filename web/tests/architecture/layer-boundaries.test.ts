import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { describe, expect, it } from "vitest";

async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(root, entry.name);
        return entry.isDirectory() ? files(path) : Promise.resolve([path]);
      }),
    )
  ).flat();
}

describe("application layers", () => {
  it("does not implement Pages Router APIs", async () => {
    await expect(readdir("src/pages/api")).rejects.toThrow();
  });
  it("keeps health transport free of providers", async () => {
    const source = await readFile("src/app/api/health/route.ts", "utf8");
    expect(source).not.toMatch(/@prisma\/client|resend/);
  });
  it("keeps App Router modules free of direct data providers", async () => {
    for (const path of await files("src/app")) {
      if (![".ts", ".tsx"].includes(extname(path))) continue;
      expect(await readFile(path, "utf8")).not.toMatch(
        /@prisma\/client|from ["']resend["']|@\/backend\/(?:database|repositories|generated)\//,
      );
    }
  });

  it("keeps client state and effects in frontend features", async () => {
    for (const path of await files("src/app")) {
      if (![".ts", ".tsx"].includes(extname(path))) continue;
      // Next.js requires route error boundaries themselves to be Client
      // Components. They remain thin wrappers; stateful UI lives in frontend.
      if (basename(path) === "error.tsx") continue;
      expect(await readFile(path, "utf8")).not.toMatch(
        /["']use client["']|useState\(|useEffect\(/,
      );
    }
  });

  it("keeps generated Prisma code inside the backend boundary", async () => {
    await expect(readdir("src/shared/generated")).rejects.toThrow();
    expect(await readdir("src/backend/generated/prisma")).toContain(
      "client.ts",
    );
  });

  it("keeps the global stylesheet as an ordered import manifest", async () => {
    const stylesheet = await readFile("src/app/globals.css", "utf8");
    const lines = stylesheet.split(/\r?\n/).filter(Boolean);

    expect(lines).toEqual([
      '@import "tailwindcss";',
      '@import "../frontend/styles/tokens.css";',
      '@import "../frontend/styles/base.css";',
    ]);

    const routeStyles = [
      ["src/app/(auth)/layout.tsx", "frontend/styles/auth.css"],
      ["src/app/page.tsx", "frontend/styles/home.css"],
      ["src/app/(workspace)/layout.tsx", "frontend/styles/workspace.css"],
      ["src/app/(workspace)/profile/layout.tsx", "frontend/styles/profile.css"],
    ] as const;
    for (const [path, expectedImport] of routeStyles) {
      expect(await readFile(path, "utf8")).toContain(expectedImport);
    }
  });

  it("keeps route transitions and data providers scoped to consumers", async () => {
    await expect(readFile("src/app/template.tsx", "utf8")).rejects.toThrow();

    const rootLayout = await readFile("src/app/layout.tsx", "utf8");
    expect(rootLayout).not.toContain("AppProviders");

    for (const path of [
      "src/frontend/features/authentication/components/resend-verification-form.tsx",
      "src/frontend/features/profile/components/session-list.tsx",
    ]) {
      expect(await readFile(path, "utf8")).toContain("AppProviders");
    }
  });

  it("marks sanitizer, cryptography, database, and mail-provider modules as server-only", async () => {
    for (const path of await files("src/backend")) {
      if (![".ts", ".tsx"].includes(extname(path))) continue;
      const source = await readFile(path, "utf8");
      if (
        /sanitize-html|node:crypto|@\/backend\/database\/prisma|from ["'](?:nodemailer|resend)["']/u.test(
          source,
        )
      ) {
        expect(source, path).toMatch(/^import ["']server-only["'];/u);
      }
    }
  });

  it("enforces account transport-service-repository direction", async () => {
    for (const path of await files("src/app/api/account")) {
      if (extname(path) !== ".ts") continue;
      const source = await readFile(path, "utf8");
      expect(source, path).not.toMatch(
        /@\/backend\/(?:database|generated|repositories)\//u,
      );
      expect(source, path).not.toMatch(
        /@\/backend\/auth\/better-auth\/better-auth-(?:password|session)-gateway/u,
      );
    }
    for (const path of await files("src/backend/services")) {
      if (extname(path) !== ".ts") continue;
      expect(await readFile(path, "utf8"), path).not.toMatch(/@\/app\/api\//u);
    }
    for (const path of await files("src/backend/repositories")) {
      if (extname(path) !== ".ts") continue;
      expect(await readFile(path, "utf8"), path).not.toMatch(
        /@\/(?:app|backend\/services)\//u,
      );
    }
  });

  it("loads Feature 002 Server Component data through services, never internal HTTP", async () => {
    const pages = [
      [
        "src/app/(workspace)/profile/page.tsx",
        "@/backend/services/profile/get-profile-aggregate",
      ],
      [
        "src/app/(workspace)/profile/account/page.tsx",
        "@/backend/services/account/account-identity-service",
      ],
      [
        "src/app/(workspace)/profile/preferences/page.tsx",
        "@/backend/services/account/account-preferences-service",
      ],
    ] as const;
    for (const [path, service] of pages) {
      const source = await readFile(path, "utf8");
      expect(source, path).toContain(service);
      expect(source, path).not.toMatch(/fetch\s*\(|\/api\/account\//u);
      expect(source, path).not.toMatch(
        /@\/backend\/(?:database|generated|repositories)\//u,
      );
    }
  });

  it("retains one Better Auth-backed browser-session owner", async () => {
    const schema = await readFile("prisma/schema.prisma", "utf8");
    expect(schema.match(/^model Session \{/gmu)).toHaveLength(1);
    expect(schema).not.toMatch(
      /^model (?:AccountSession|CandidateSession|ProfileSession) \{/gmu,
    );

    const passwordGateway = await readFile(
      "src/backend/auth/better-auth/better-auth-password-gateway.ts",
      "utf8",
    );
    expect(passwordGateway).toContain("auth.api.revokeOtherSessions");
    for (const path of await files("src/frontend")) {
      if (![".ts", ".tsx"].includes(extname(path))) continue;
      expect(await readFile(path, "utf8"), path).not.toMatch(
        /better-auth\/(?:api|crypto)|@\/backend\/auth\/better-auth/u,
      );
    }
  });
});
