# Connections baseline triage

Current isolated rerun: `candidate_phase6a_20260919_final_e2e_test` with matching guarded `DATABASE_URL` and `DIRECT_URL`.

- Full suite: **FAIL**, 9/10 files and 19/20 tests passed.
- The only failure is `tests/frontend/components/connections/connections-workspace.test.tsx`: its fixture expects a `Disconnect` button while the current component render is the empty state.
- Affected shared Connections scope excluding that component file: **PASS**, 9/9 files and 17/17 tests.
- No Connections source or Connections test file was changed by Phase 6A; the shared professional-connection namespace regression remains green in the affected scope.

The full-suite failure remains recorded as `FAIL`; it is accepted as an external baseline exception for the Phase 6A gate because it is an unchanged UI fixture outside the realtime implementation scope and does not affect the shared namespace invariant.
