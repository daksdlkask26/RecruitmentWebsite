# Candidate-first Phase 6A final closure ledger

Date: 19 September 2026. Final verification used the isolated database `candidate_phase6a_20260919_final_e2e_test`, matching guarded URLs, and the final source state. No shared `smarthire` database, SpecKit artifact, commit, push, deploy, or user-owned process was changed.

| Work item                | Status              | Current evidence                                                                      |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------- |
| CF-601                   | **VERIFIED**        | Lifecycle/fault focus 4 files, 12/12 tests                                            |
| CF-602                   | **VERIFIED**        | PostgreSQL matrix 12/12 and transport matrix 12/12; width-100 socket-ready p95 8.50ms |
| CF-603                   | **VERIFIED**        | Messaging 30/30 files, 78/78 tests; affected notifications 24/24 files, 66/66 tests   |
| CF-604                   | **VERIFIED**        | DB fault injection 4/4; revocation browser 3/3; EN/VI 1/1 each; messaging E2E 5/5     |
| Integrated Phase 6A gate | **DONE / VERIFIED** | All in-scope criteria pass; external baseline failures remain explicit below          |

## Explicit baseline failures

- Notifications full suite remains **FAIL** at 24/25 files and 67/68 tests because the unchanged SpecKit OpenAPI parity contract omits `COMPANY_INVITATION`. See `notification-baseline-triage.json`.
- Connections full suite remains **FAIL** at 9/10 files and 19/20 tests because an unchanged UI fixture expects `Disconnect` in the empty state. The affected shared scope is 9/9 files and 17/17 tests. See `connections-baseline-triage.json`.

These failures are outside the Phase 6A diff and are kept as `FAIL`; they are not presented as full-suite PASS.

## Static and cleanup boundary

TypeScript, targeted ESLint/Prettier, Prisma validation, 97-migration sequence/status, production build, and diff check passed. The production build retained two known dynamic filesystem tracing warnings. Cleanup must drop the final isolated database and task-owned build output, verify task ports/processes, and preserve the pre-existing `web/.local/next-output.lock`.
