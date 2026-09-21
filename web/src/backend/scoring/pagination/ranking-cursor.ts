import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export type RankingCursor = Readonly<{
  v: 1;
  jobId: string;
  snapshotId: string;
  filterHash: string;
  sort: string;
  pageSize: number;
  position: number;
  scoreKey: number | null;
  submittedAt: string;
  applicationId: string;
}>;

const secret = () =>
  process.env.RANKING_CURSOR_SECRET ?? "local-ranking-cursor-secret";

export function encodeRankingCursor(cursor: RankingCursor) {
  const body = Buffer.from(JSON.stringify(cursor), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret())
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function decodeRankingCursor(
  value: string | undefined,
  expected: {
    jobId: string;
    filterHash: string;
    sort: string;
    pageSize: number;
  },
): RankingCursor | null {
  if (!value || value.length > 1_024) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expectedSignature = createHmac("sha256", secret())
    .update(body)
    .digest("base64url");
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expectedSignature);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted))
    return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Partial<RankingCursor>;
    if (
      parsed.v !== 1 ||
      parsed.jobId !== expected.jobId ||
      parsed.filterHash !== expected.filterHash ||
      parsed.sort !== expected.sort ||
      parsed.pageSize !== expected.pageSize ||
      typeof parsed.snapshotId !== "string" ||
      typeof parsed.position !== "number" ||
      typeof parsed.applicationId !== "string" ||
      typeof parsed.submittedAt !== "string"
    )
      return null;
    return parsed as RankingCursor;
  } catch {
    return null;
  }
}
