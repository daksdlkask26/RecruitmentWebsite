import { describe, expect, it } from "vitest";
import {
  decodeApplicationListCursor,
  encodeApplicationListCursor,
} from "@/backend/applications/application-list-cursor";
import { TokenProtector } from "@/backend/security/security-token/security-tokens";

const input = {
  list: "CANDIDATE_JOB_APPLICATIONS" as const,
  subjectId: "candidate-1",
  scopeId: null,
  filter: "ALL",
  sort: "SUBMITTED_DESC" as const,
  submittedAt: "2026-08-18T09:01:00.000Z",
  id: "application-24",
};

describe("application list cursor", () => {
  it("round-trips an opaque versioned cursor and binds every context field", () => {
    const cursor = encodeApplicationListCursor(input);
    expect(cursor).not.toContain(input.subjectId);
    expect(cursor).not.toContain(input.id);
    expect(
      decodeApplicationListCursor(cursor, {
        list: input.list,
        subjectId: input.subjectId,
        scopeId: input.scopeId,
        filter: input.filter,
        sort: input.sort,
      }),
    ).toMatchObject({ v: 1, ...input });
  });

  it.each([
    { subjectId: "other-candidate" },
    { list: "CANDIDATE_TEAM_APPLICATIONS" as const },
    { filter: "UNDER_REVIEW" },
    { sort: "SUBMITTED_ASC" as const },
    { scopeId: "company-1" },
  ])("rejects a mismatched cursor context %#", (mismatch) => {
    const cursor = encodeApplicationListCursor(input);
    expect(
      decodeApplicationListCursor(cursor, {
        list: mismatch.list ?? input.list,
        subjectId: mismatch.subjectId ?? input.subjectId,
        scopeId: mismatch.scopeId ?? input.scopeId,
        filter: mismatch.filter ?? input.filter,
        sort: mismatch.sort ?? input.sort,
      }),
    ).toBeNull();
  });

  it("fails closed for malformed and replayed values", () => {
    expect(
      decodeApplicationListCursor("v1.invalid.invalid.invalid", {
        list: input.list,
        subjectId: input.subjectId,
        scopeId: input.scopeId,
        filter: input.filter,
        sort: input.sort,
      }),
    ).toBeNull();
    expect(
      decodeApplicationListCursor(
        `${encodeApplicationListCursor(input)}.extra`,
        {
          list: input.list,
          subjectId: input.subjectId,
          scopeId: input.scopeId,
          filter: input.filter,
          sort: input.sort,
        },
      ),
    ).toBeNull();
  });

  it("rejects a correctly sealed cursor with an unsupported version", () => {
    const forgedVersionCursor = new TokenProtector().seal(
      JSON.stringify({ v: 2, ...input }),
    );
    expect(
      decodeApplicationListCursor(forgedVersionCursor, {
        list: input.list,
        subjectId: input.subjectId,
        scopeId: input.scopeId,
        filter: input.filter,
        sort: input.sort,
      }),
    ).toBeNull();
  });
});
