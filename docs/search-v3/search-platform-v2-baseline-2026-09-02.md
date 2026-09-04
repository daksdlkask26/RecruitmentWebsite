# Search Platform V2 baseline — 2026-09-02

This report is a read-only baseline for the current checkout. It does not
modify `spec-kit/` or the existing user changes.

## Scope and versions

- Commit inspected: `d206c1e12effb8fde0608b706ce87faa0cafb18f`
- Worktree: dirty; unrelated user changes were preserved.
- Database scope: PostgreSQL database configured by `web/.env.local`.
- Candidate-visible policy: `OPEN`, `CLOSING_SOON`, or `ACTIVE` with no expired
  `applyDeadline`.
- Catalog version: `2026-09-02.2-2026-09-02.2`.
- Resolver version: `2026-09-02.2-2026-09-02.2:resolver-7`.
- Prisma stack after P0.2: `prisma`, `@prisma/client`, and
  `@prisma/adapter-pg` `7.9.0`.

## Job population

| Scope | Jobs | Distinct titles | Notes |
| --- | ---: | ---: | --- |
| All `JobPosting` rows | 51,943 | 405 | Includes non-public and expired rows. |
| `ACTIVE` rows observed | 17,861 | — | Status-only count; not the visibility policy. |
| Candidate-visible rows | 14,187 | 398 | The only scope used for public Job Search. |

Top candidate-visible titles by row count:

| Title | Jobs |
| --- | ---: |
| Real Estate Agent | 80 |
| Video Editor | 79 |
| Visual Merchandiser | 77 |
| Financial Analyst | 72 |
| Contact Center Agent | 50 |
| Brand Assistant | 49 |
| Pattern Maker | 49 |
| Software Engineer (Ruby) | 49 |
| Document Processing Executive | 48 |
| Front Desk Team Lead | 48 |

## Bilingual taxonomy and projection coverage

- Observed candidate-visible titles: `398/398` present in the compiled catalog;
  missing title definitions: `0`.
- Translation status: `HUMAN_VERIFIED 0`, `AUTO_HIGH_CONFIDENCE 20`,
  `REQUIRES_REVIEW 374`, `INTENTIONAL_UNTRANSLATED 4`, `AMBIGUOUS 0`,
  `UNMAPPED 0`.
- This is not verified-translation coverage: inferred/auto mappings are
  reported separately and are not promoted to `HUMAN_VERIFIED`.
- `SearchMappingReview`: `378` pending rows.
- `JobSearchProjection`: `14,187/14,187` candidate-visible jobs present,
  missing `0`, stale `0`, without title identity `0`.
- Projection status distribution: `REQUIRES_REVIEW 13,183`,
  `AUTO_HIGH_CONFIDENCE 696`, `INTENTIONAL_UNTRANSLATED 308`.

## Performance sample

Command:

```powershell
$env:PERF_SEARCH_ITERATIONS = "3"
$env:PERF_SEARCH_WARMUPS = "1"
npm run perf:search --workspace @smarthire/web
```

The sample passed the current script budgets (`jobs/companies p95 <= 2,000ms`,
suggestions `p95 <= 200ms`). Representative job rows are shown below; the
candidate cap is the largest candidate set observed in the sample.

| Query | Candidate cap | p50 (ms) | p95 (ms) | p99 (ms) |
| --- | ---: | ---: | ---: | ---: |
| `kế toán` | 888 | 52.47 | 64.12 | 64.12 |
| `ke tona` | 888 | 65.34 | 71.14 | 71.14 |
| `kế toán trưởng` | 1,016 | 173.16 | 214.54 | 214.54 |
| `lập trình viên frontend` | 2,104 | 166.42 | 167.22 | 167.22 |
| `nhân viên bán hàng` | 2,241 | 139.60 | 151.37 | 151.37 |
| `qwertyuiop` | 0 | 28.96 | 29.77 | 29.77 |
| **Matrix maximum** | **2,241** | — | **214.54** | **214.54** |

Additional maxima: Company Search p95 `111.48ms`, suggestions p95
`19.36ms`, filter/sort/pagination p95 `12.44ms`, concurrency-4 p95
`122.49ms`.

## Reproducible commands

```powershell
npm run search:occupation:audit --workspace @smarthire/web -- --summary
npm run search:occupation:audit:catalog --workspace @smarthire/web -- --summary --limit-error-samples=20
npm run perf:search --workspace @smarthire/web
```

The baseline intentionally records the review backlog and the distinction
between catalog presence, inferred mapping, and human-verified translation.
P0 is not considered complete until the dependency, test-discovery, and CI
gates below pass.
