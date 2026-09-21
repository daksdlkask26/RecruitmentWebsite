# CF-805 observability, timezone, UI, and scale

**Recorded:** 2026-09-22; verification refreshed on the final uncommitted source.  
**Source identity:** base `eeb17d759a68437c6d15cc473a8d3cdb150cd59c` on `audit_improvement`; final Phase 8 changes are uncommitted in the working tree.  
**Owner:** [plan section 9](../plan.md#9-cf-805--observability-timezone-and-data-scale-f21f22)

## Implementation

- The company-location combobox now opens and focuses the first option on `ArrowDown` from the closed trigger, supports option navigation/Enter, and preserves Escape/focus return behavior.
- A bounded `smarthire.platform` diagnostics channel emits redacted structured events for export completion/audit retry/dead-letter, backup reclaim/fencing/failure, and health not-readiness. The runtime consumer accepts only bounded event names, values, and string dimensions.
- Existing report-time policy tests remain the timezone contract reference; no wholesale timestamp/schema conversion was introduced.

## Executable evidence

Focused command:

```text
..\node_modules\.bin\vitest.cmd run tests/frontend/company-discovery/company-list.test.tsx tests/backend/unit/recruitment-analytics/report-time-policy.test.ts tests/backend/unit/observability/platform-operational-metrics.test.ts --passWithNoTests
```

Result: **3 test files passed, 17 tests passed**. The final Phase 8 gate includes the same UI, timezone, and metric contract tests.

Final production browser smoke:

```text
npx playwright test tests/system/e2e/search-platform-v2.spec.ts --project=desktop-chromium --project=mobile-320
```

Result: **4 tests passed** across desktop and 320px mobile Jobs and Company
Search. The run executed serious/critical axe assertions and verified no
horizontal overflow on mobile. The company-location keyboard/unit contract
remained green; this browser smoke is evidence for the responsive search
surface, not a claim that every F21 locale/theme permutation was exercised.

## Boundary and limitation

The keyboard path, metric consumer boundary, and selected production-browser
responsive/axe path are locally verified. A complete computed light/dark and
EN/VI matrix, target log/metrics exporter, operator query, actionable alert
drill, UTC-versus-Asia-Bangkok process-parity run, representative-volume
query plan, pool-wait/RSS measurement, and scale correctness/recall run were
not executed. Those criteria remain **UNVERIFIED**; receiving a metric in a
test double is not treated as operator proof. CF-805 is **LOCALLY VERIFIED
WITH LIMITATIONS**.

## Cleanup

No CF-805-specific monitoring rule or performance dataset was created or retained. The browser and isolated database harness used for CF-801 are tracked in the CF-801 cleanup record.
