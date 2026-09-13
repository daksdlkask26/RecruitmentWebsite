import type { TeamRole } from "@/shared/contracts/company-members/team-applications";

export const companyTeamApplicationFixtureIds = {
  company: "company-team-028",
  otherCompany: "company-team-028-other",
  owner: "owner-team-028",
  candidate: "candidate-team-028",
  otherCandidate: "candidate-team-028-other",
  job: "job-team-028",
  invitation: "invitation-team-028",
  application: "application-team-028",
} as const;

export const approvedCompanyFixture = Object.freeze({
  id: companyTeamApplicationFixtureIds.company,
  slug: "northstar-labs",
  displayName: "Northstar Labs",
  logoUrl: null,
  publicDescription: "A verified product company.",
  publicLocation: "Ho Chi Minh City",
  foundedYear: 2018,
  industry: "Technology",
  activeEmployeeCount: 2,
  activeOwnerCount: 1,
  verificationState: "ACTIVE" as const,
  moderationState: "ACTIVE" as const,
});

export const activePublicJobFixture = Object.freeze({
  id: companyTeamApplicationFixtureIds.job,
  companyId: companyTeamApplicationFixtureIds.company,
  slug: "senior-recruiter",
  title: "Senior Recruiter",
  location: "Ho Chi Minh City",
  status: "ACTIVE" as const,
});

export const publicJobCardFixture = Object.freeze({
  id: activePublicJobFixture.id,
  slug: activePublicJobFixture.slug,
  title: activePublicJobFixture.title,
  company: {
    slug: approvedCompanyFixture.slug,
    displayName: approvedCompanyFixture.displayName,
    logoUrl: null,
    websiteUrl: null,
    publicDescription: approvedCompanyFixture.publicDescription,
    publicLocation: approvedCompanyFixture.publicLocation,
    size: "1-10 employees",
    industry: approvedCompanyFixture.industry,
    address: approvedCompanyFixture.publicLocation,
  },
  location: activePublicJobFixture.location,
  employmentType: "FULL_TIME" as const,
  experienceLevel: "MID" as const,
  workArrangement: "HYBRID" as const,
  salary: null,
  summary: "Build a thoughtful recruiting experience.",
  skills: ["Recruiting"],
  publishedAt: "2026-08-27T00:00:00.000Z",
  applicationDeadline: null,
  actions: {
    authenticated: true,
    saved: false,
    applied: false,
    canSave: true,
    canReport: true,
    canApply: true,
  },
});

export const ownerAccountFixture = Object.freeze({
  id: companyTeamApplicationFixtureIds.owner,
  email: "owner@northstar.example",
  role: "OWNER" as const,
});

export const candidateAccountFixture = Object.freeze({
  id: companyTeamApplicationFixtureIds.candidate,
  email: "candidate@example.com",
  role: "CANDIDATE" as const,
});

export const teamRoleFixtures = Object.freeze([
  "HR_MANAGER",
  "RECRUITER",
] as const satisfies readonly TeamRole[]);

export const teamInvitationFixture = Object.freeze({
  id: companyTeamApplicationFixtureIds.invitation,
  companyId: companyTeamApplicationFixtureIds.company,
  normalizedEmail: candidateAccountFixture.email,
  role: "RECRUITER" as const,
  state: "PENDING" as const,
  expiresAt: new Date("2026-09-03T00:00:00.000Z"),
});

export function signedPdfFixtureBytes(size = 64) {
  if (!Number.isSafeInteger(size) || size < 32 || size > 5_000_000) {
    throw new Error("fixture size must be between 32 and 5,000,000 bytes");
  }
  const bytes = new Uint8Array(size);
  bytes.set(
    new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n"),
  );
  return bytes;
}

export function signedDocxFixtureBytes(size = 64) {
  if (!Number.isSafeInteger(size) || size < 32 || size > 5_000_000) {
    throw new Error("fixture size must be between 32 and 5,000,000 bytes");
  }
  const bytes = new Uint8Array(size);
  bytes.set(
    new TextEncoder().encode(
      "PK\u0003\u0004 [Content_Types].xml word/document.xml",
    ),
  );
  return bytes;
}

export function teamApplicationFixture(
  overrides: Partial<{
    applicationId: string;
    companyId: string;
    companyName: string;
    appliedRole: TeamRole;
    status:
      | "SUBMITTED"
      | "VIEWED"
      | "REJECTED"
      | "INVITATION_SENT"
      | "WITHDRAWN"
      | "JOINED";
    invitationStatus:
      | "PENDING"
      | "REVOKED"
      | "ACCEPTED"
      | "DECLINED"
      | "EXPIRED"
      | null;
    invitationId?: string | null;
  }> = {},
) {
  return {
    applicationId: companyTeamApplicationFixtureIds.application,
    companyId: approvedCompanyFixture.id,
    companyName: approvedCompanyFixture.displayName,
    companySlug: approvedCompanyFixture.slug,
    appliedRole: "RECRUITER" as const,
    status: "SUBMITTED" as const,
    invitationStatus: null,
    invitationId: null,
    submittedAt: "2026-08-27T00:00:00.000Z",
    ownerViewed: false,
    ownerFirstViewedAt: null,
    decidedAt: null,
    joinedAt: null,
    invitationExpiresAt: null,
    ...overrides,
  };
}
