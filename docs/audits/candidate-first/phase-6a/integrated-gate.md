# Candidate-first Phase 6A integrated gate

Date: 19 September 2026  
Final source: `ac17ec1efb70c9b963b7c979c45d07d733295f8d`, branch `audit_improvement`, dirty worktree preserved.  
Final isolated database: `candidate_phase6a_20260919_final_e2e_test`.

## Verdict

**DONE / VERIFIED.** CF-601 through CF-604 have current executable evidence on the final source, including lifecycle faults, database-backed query/reconnect measurements, durable recovery, database fault injection, account/session/moderation browser revocation, EN/VI browser journeys, regression suites, static gates, and cleanup. The two unrelated baseline suite failures remain explicit `FAIL` exceptions and are not relabelled as green.

## Slice status

| Slice                                   | Status              | Current evidence                                                                                                                                                                                                                                        |
| --------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CF-601 lifecycle/cleanup                | **VERIFIED**        | [`cf601-lifecycle-fault-matrix.json`](evidence/cf601-lifecycle-fault-matrix.json) - 4 focused files, 12/12 tests                                                                                                                                        |
| CF-602 bounded authorization/query cost | **VERIFIED**        | [`cf602-final-db.json`](evidence/cf602-final-db.json), [`cf602-transport-final.json`](evidence/cf602-transport-final.json) - 12/12 DB and 12/12 transport measurements                                                                                  |
| CF-603 durable recovery/convergence     | **VERIFIED**        | [`cf603-recovery-and-convergence.json`](evidence/cf603-recovery-and-convergence.json), [`notification-baseline-triage.json`](evidence/notification-baseline-triage.json)                                                                                |
| CF-604 final runtime matrix             | **VERIFIED**        | [`cf604-browser-runtime-matrix.json`](evidence/cf604-browser-runtime-matrix.json), [`cf604-db-fault-injection.json`](evidence/cf604-db-fault-injection.json), [`cf604-account-moderation-browser.json`](evidence/cf604-account-moderation-browser.json) |
| Integrated Phase 6A gate                | **DONE / VERIFIED** | [`final-closure-ledger.json`](evidence/final-closure-ledger.json)                                                                                                                                                                                       |

## Current passing evidence

- Messaging focused/regression suite: **30/30 files, 78/78 tests**.
- Lifecycle and durable-boundary focus: **4/4 files, 12/12 tests**.
- Full messaging browser regression: **5/5 tests** - usability 1, safety 3, and two-user durable recovery 1.
- Dedicated Phase 6A browser: **EN 1/1 and VI 1/1**; two tabs, reconnect, offline recovery, `SENT`, dark mode, reduced motion, 320px responsive behavior, and no horizontal overflow.
- Database fault injection: **4/4** - initial authentication, conversation access, context authorization, and block-state lookup; fail-closed, generic errors, safe retry, no unhandled rejection, and zero final registry/room residue.
- Account/session/moderation revocation browser: **3/3**; target REST 401, control REST 200, and session/account/conversation cleanup to zero.
- Real PostgreSQL-backed 1/10/40/100 matrix: **12/12 measurements**, three repetitions per width, zero initial conversation rooms, width-100 socket-ready p95 **8.50ms** against the fixed 2,000ms threshold.
- Transport matrix: **12/12 measurements**, zero initial rooms, bounded repository calls (maximum 7).
- Notification affected scope: **24/24 files, 66/66 tests**; accessibility/read-state focus **4/4 files, 7/7 tests**.
- Support regression: **12/12 files, 29/29 tests**.
- Connections affected shared scope: **9/9 files, 17/17 tests**.
- TypeScript, targeted ESLint, targeted Prettier, Prisma validation, 97-migration sequence/status, production build, and `git diff --check`: **PASS**.

## Required baseline exceptions

1. `npm.cmd run test:notifications -- --reporter=dot` remains **FAIL**: 24/25 files and 67/68 tests. The only failure is `notification-openapi-parity.test.ts`, which expects `COMPANY_INVITATION` in the unchanged SpecKit Feature 016 OpenAPI contract. SpecKit was not modified; the affected Phase 6A notification scope is green. See [`notification-baseline-triage.json`](evidence/notification-baseline-triage.json).
2. `npm.cmd run test:connections -- --reporter=dot` remains **FAIL**: 9/10 files and 19/20 tests. The only failure is an unchanged Connections UI fixture that expects a `Disconnect` button while the current render is the empty state. No Connections source/test file was changed; the affected shared namespace scope is green. See [`connections-baseline-triage.json`](evidence/connections-baseline-triage.json).

Both failures remain `FAIL` by policy. They are accepted as outside-scope baseline exceptions because current evidence proves they do not affect a Phase 6A invariant; the full suites are not claimed as PASS.

## Safety and cleanup

All writes used the isolated final database with matching `DATABASE_URL` and `DIRECT_URL`; shared `smarthire` was not mutated. The pre-existing `web/.local/next-output.lock` and ambiguous user-owned `.next` output were preserved. Task-owned production servers and fixtures were closed by harness `finally` blocks. Final cleanup evidence is [`cleanup.json`](evidence/cleanup.json); the final closure ledger is [`final-closure-ledger.json`](evidence/final-closure-ledger.json).

Phase 6A remains single-instance only. Redis, multi-instance adapters, distributed presence, deployment changes, and Phase 6B are not claimed.
