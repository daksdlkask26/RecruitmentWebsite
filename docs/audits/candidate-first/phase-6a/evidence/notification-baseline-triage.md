# Notification baseline triage

Current isolated rerun: `candidate_phase6a_20260919_final_e2e_test` with matching guarded `DATABASE_URL` and `DIRECT_URL`.

- Full suite: **FAIL**, 24/25 files and 67/68 tests passed.
- The only failure is `tests/backend/contract/notifications/notification-openapi-parity.test.ts`: the unchanged SpecKit Feature 016 OpenAPI contract omits `COMPANY_INVITATION`.
- Affected Phase 6A notification scope excluding that parity file: **PASS**, 24/24 files and 66/66 tests.
- The parity test and `spec-kit/specs/016-inapp-email-notification/contracts/notifications.openapi.yaml` were not changed.

The full-suite failure remains recorded as `FAIL`; it is accepted as an external baseline exception for the Phase 6A gate because it is outside the Phase 6A diff and the affected notification recovery/privacy/accessibility scope is green.
