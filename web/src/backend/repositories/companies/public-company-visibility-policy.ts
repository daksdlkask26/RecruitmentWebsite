import "server-only";

import { Prisma } from "@/backend/generated/prisma/client";

/**
 * One public Company predicate shared by Home, Directory, Detail, and any
 * candidate-visible job relation. Keeping moderation in this boundary avoids
 * a weaker Home-only copy of the publication rule.
 */
export function getPublicCompanyWhere() {
  return {
    verifiedAt: { not: null },
    verificationState: "ACTIVE" as const,
    verificationInactiveAt: null,
    moderationState: "ACTIVE" as const,
  };
}

export type PublicCompanyWhere = ReturnType<typeof getPublicCompanyWhere>;

/** SQL form for raw discovery queries. The alias is fixed by each caller and
 * never contains user input. Keeping both forms here prevents raw Company
 * searches from drifting away from the Prisma predicate. */
export function getPublicCompanySql(alias: string): Prisma.Sql {
  const column = (name: string) => Prisma.raw(`${alias}."${name}"`);
  return Prisma.sql`
    ${column("verifiedAt")} IS NOT NULL
    AND ${column("verificationState")} = 'ACTIVE'::"CompanyVerificationState"
    AND ${column("verificationInactiveAt")} IS NULL
    AND ${column("moderationState")} = 'ACTIVE'::"CompanyModerationState"
  `;
}
