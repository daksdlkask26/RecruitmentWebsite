# CF-604 - Final runtime and browser matrix

Status: **PASS for CF-604 runtime coverage**, with two external baseline suites retained as explicit `FAIL` exceptions in their own triage artifacts.

Current isolated rerun: `candidate_phase6a_20260919_final_e2e_test`. Shared `smarthire` was not mutated.

## Current final-source runs

- EN production-like browser run: 1/1 test passed in 7.9s.
- VI production-like browser run: 1/1 test passed in 7.2s.
- Existing messaging browser regression: 5/5 tests passed - usability 1, safety 3, and two-user durable recovery 1.
- Messaging/notification accessibility and read-state focus: 4/4 files, 7/7 tests passed; serious/critical violations 0.
- Real PostgreSQL-backed lazy socket-ready matrix: widths 1/10/40/100, three repetitions each, 0 failures, zero initial conversation rooms, width-100 socket-ready p95 8.50ms against the fixed 2,000ms threshold.
- Database fault injection: 4/4 cases passed across initial authentication, conversation access, context authorization, and block-state lookup.
- Account/session/moderation browser revocation: 3/3 cases passed with target REST 401, control REST 200, and runtime memberships cleaned to zero.
- Notification affected scope: 24/24 files, 66/66 tests passed after excluding the unchanged SpecKit parity file.
- Connections affected shared scope: 9/9 files, 17/17 tests passed after excluding the unchanged UI fixture.
- Support regression: 12/12 files, 29/29 tests passed.

The browser scenario covered Candidate and Recruiter contexts, two Candidate tabs, authenticated send and `SENT`, recipient list/history recovery, offline send followed by reload, reconnect, EN/VI, dark mode, reduced motion, and 320px overflow/composer checks. Task-owned production servers were closed after each run.

## Explicit baseline failures

1. The full notification suite remains **FAIL**, 24/25 files and 67/68 tests. The only failure is `notification-openapi-parity.test.ts`, which expects `COMPANY_INVITATION` in the unchanged SpecKit OpenAPI contract. See `notification-baseline-triage.json`.
2. The full Connections suite remains **FAIL**, 9/10 files and 19/20 tests. The only failure is an unchanged component fixture that expects a `Disconnect` button while the current render is the empty state. See `connections-baseline-triage.json`.

These failures remain `FAIL`, are not relabelled as green, and are accepted only as outside-scope baseline exceptions because the affected Phase 6A/shared namespaces pass and no SpecKit or Connections source/test files were changed.

See `cf604-db-fault-injection.json`, `cf604-account-moderation-browser.json`, and `cleanup.json` for the remaining runtime and cleanup evidence.
