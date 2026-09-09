/**
 * Calendar-month convention for deterministic experience calculations:
 * intervals are half-open `[startMonth, endMonthExclusive)`. A date token
 * denotes the whole calendar month; therefore an end token is normalized to
 * the boundary immediately after that month. Adjacent intervals merge.
 */
export type ExperienceMonthInterval = Readonly<{
  startMonth: number;
  endMonthExclusive: number;
  source?: string;
  startToken?: string;
  endToken?: string;
}>;

export type ExperienceDuration = Readonly<{
  totalMonths: number;
  years: number;
  /** Valid source intervals retained for evidence and review. */
  evidenceIntervals: readonly ExperienceMonthInterval[];
  /** The disjoint union used for the total. */
  unionIntervals: readonly Readonly<{
    startMonth: number;
    endMonthExclusive: number;
  }>[];
  discardedIntervalCount: number;
}>;

function validInterval(interval: ExperienceMonthInterval) {
  return (
    Number.isSafeInteger(interval.startMonth) &&
    Number.isSafeInteger(interval.endMonthExclusive) &&
    interval.startMonth >= 0 &&
    interval.endMonthExclusive > interval.startMonth
  );
}

/** Pure, clock-free union of calendar-month intervals. */
export function calculateExperienceDuration(
  intervals: readonly ExperienceMonthInterval[],
): ExperienceDuration {
  const evidenceIntervals = intervals
    .filter(validInterval)
    .slice()
    .sort(
      (left, right) =>
        left.startMonth - right.startMonth ||
        left.endMonthExclusive - right.endMonthExclusive ||
        (left.source ?? "").localeCompare(right.source ?? ""),
    );
  const discardedIntervalCount = intervals.length - evidenceIntervals.length;
  const unionIntervals: Array<{
    startMonth: number;
    endMonthExclusive: number;
  }> = [];

  for (const interval of evidenceIntervals) {
    const current = unionIntervals.at(-1);
    if (!current || interval.startMonth > current.endMonthExclusive) {
      unionIntervals.push({
        startMonth: interval.startMonth,
        endMonthExclusive: interval.endMonthExclusive,
      });
      continue;
    }
    current.endMonthExclusive = Math.max(
      current.endMonthExclusive,
      interval.endMonthExclusive,
    );
  }

  const totalMonths = unionIntervals.reduce(
    (total, interval) =>
      total + interval.endMonthExclusive - interval.startMonth,
    0,
  );
  return {
    totalMonths,
    years: totalMonths / 12,
    evidenceIntervals,
    unionIntervals,
    discardedIntervalCount,
  };
}
