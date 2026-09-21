# CF-603 — Durable recovery and convergence

Status: **PASS for the Phase 6A messaging/recovery implementation; integrated notification contract baseline remains FAIL outside scope.**

## Evidence

- `npm.cmd run test:messaging -- --reporter=dot`: 30/30 files, 78/78 tests passed.
- Lifecycle and durable-boundary focus: 4/4 files, 12/12 tests passed.
- Messaging/notification accessibility and read-state focus: 4/4 files, 7/7 tests passed.
- `npm.cmd run test:notifications -- --reporter=dot`: 24/25 files and 67/68 tests passed. The sole failure is the pre-existing SpecKit OpenAPI parity assertion for `COMPANY_INVITATION`; SpecKit was intentionally not modified.

## Contract verified

PostgreSQL remains authoritative. A message is persisted before realtime publication and returns `SENT` only after the authenticated send acknowledgement. Notification creation is isolated from the durable message transaction. Realtime publication failure therefore leaves the message and read boundary recoverable through REST/history. No unauthenticated `DELIVERED` state is claimed.

The client reconciles history by durable ID and sequence, orders by sequence, refetches the conversation list/history on connect, and polls notifications every four seconds while visible. Duplicate client operation IDs replay the committed result without creating a second message. Read updates remain monotonic and idempotent.

## Recovery matrix

Normal delivery, offline/reload recovery, duplicate/reordered message projection, publisher failure, multi-tab read convergence, block/membership/session revocation, notification retry, and missed-invalidation polling are covered by the focused suites and final browser runs. Logs and evidence contain no message content, notification payload, credentials, cookies, or PII.

The final rerun database was `candidate_phase6a_20260919_final_e2e_test`; both database URLs targeted that name and the shared `smarthire` database was not mutated. Cleanup is recorded in `cleanup.json` after the final gate.
