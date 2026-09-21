# CF-804 dependencies, CI, regression, and architecture

**Recorded:** 2026-09-22; verification refreshed on the final uncommitted source.  
**Source identity:** base `eeb17d759a68437c6d15cc473a8d3cdb150cd59c` on `audit_improvement`; final Phase 8 changes are uncommitted in the working tree.  
**Owner:** [plan section 8](../plan.md#8-cf-804--dependencies-ci-tests-and-architecture-f17f20)

## Implementation

- `.github/workflows/ci.yml` now runs the explicit `test:phase8` contract gate and the isolated `test:phase8:integration` recovery rehearsal after typecheck on the isolated CI PostgreSQL job.
- Schema changes are additive: `ExportAuditObligation`, backup fencing, and bounded export-audit retry ownership use migrations `098_export_audit_obligation`, `099_backup_lease_fencing`, and `100_export_audit_retry_fencing`, with rollback comments.
- CodeGraph is up to date; no speculative dependency or architecture mass refactor was made.

## Executable evidence

The final Phase 8 gate passed:

```text
npm run test:phase8
```

Result: **12 test files passed, 73 tests passed**.

Additional final checks:

```text
npm run typecheck
npm run lint
npm run db:validate --workspace @smarthire/web
npm run db:migrations:check
npm run test:phase8:integration
```

All local commands passed. Migration check reported **100 migrations**, first
`001_identity_foundation`, last `100_export_audit_retry_fencing`, naming
convention `NNN_snake_case`, `pass: true`. Migration 100 was also applied to
two task-owned isolated databases and its retry/lease columns were verified
before cleanup. The integration command passed **1 file / 4 tests** on real
PostgreSQL and filesystem storage.

```text
npm ls --all --omit=dev --json
```

Exit code **0**. The final-source build was run through a task-owned isolated output:

```text
$env:PHASE5_NEXT_DIST_DIR='.next/phase8-build-20260922'; node ..\node_modules\next\dist\bin\next build
```

That build passed with **117/117** static pages and no warnings. The
task-owned dist directory and Next-generated `tsconfig` entries were removed
afterward; `git diff --check`, full ESLint, and typecheck also passed.

The affected regression rerun recorded **85 passed tests across 12 files**. The two prior failures used a fixed `applyDeadline` that had become expired relative to the current date; their fixtures now use a future deadline while preserving the original skills-formatting and withdrawn-draft assertions. The complete layer-boundary check improved from **5/11** to **10/11** through thin App Router service/error-boundary adapters, scoped client providers, the global CSS manifest, and missing server-only declarations.

Regression probes:

```text
..\node_modules\.bin\vitest.cmd run tests/backend/unit/jobs/recruiter-job-posting-data.test.ts tests/backend/unit/job-post-management tests/backend/contract/job-post-management tests/frontend/components/recruiter-workspace/job-posting-management.test.tsx tests/architecture/job-post-management-boundaries.test.ts --passWithNoTests
..\node_modules\.bin\vitest.cmd run tests/architecture/layer-boundaries.test.ts --passWithNoTests
```

The first probe produced **85 passed across 12 files**. The second produced **10 passed / 1 failed in 1 file**. The remaining architecture failure is the repository-to-service direction rule across established company/job/CV repositories. It is current, reproducible, and broader than the modules changed for CF-801–803; it was not hidden with an allow-list or a weaker assertion.

Architecture follow-up inventory for the remaining 1/11 failure:

```text
companies/prisma-company-discovery-repository.ts -> jobs/search-normalization,
  search/search-token-policy, search/search-query-resolver
companies/prisma-company-job-repository.ts -> jobs/job-types
cv-import/prisma-cv-confirmation-repository.ts -> cv-import/cv-http-errors,
  profile/profile-validation
cv-import/prisma-cv-consent-repository.ts -> cv-import/cv-http-errors
cv-import/prisma-cv-draft-command-repository.ts -> cv-import/cv-http-errors
cv-import/prisma-cv-quota-repository.ts -> cv-import/cv-http-errors
cv-import/prisma-cv-retry-repository.ts -> cv-import/cv-http-errors
jobs/prisma-job-application-repository.ts -> jobs/application-policy,
  jobs/application-attempt-policy, profile/candidate-cv-library,
  cv-admission/open-safe-cv-artifact-service, jobs/company-deletion-object-lock
jobs/prisma-job-post-review-repository.ts -> jobs/application-stage-service,
  jobs/job-taxonomy-service, search/job-search-profile,
  search/job-search-profile-projection, search/catalogs/job-search-catalog-index
jobs/prisma-public-job-repository.ts -> jobs/job-types,
  search/search-query-resolver, search/catalogs/job-search-catalog-index,
  search/search-release-flags, search/job-search-ranking,
  jobs/search-normalization, search/search-token-policy
```

These are pre-existing repository-to-service edges across a broad
company/job/CV redesign boundary, not imports introduced by CF-801–805.
Refactoring them safely needs separate contract coverage; no speculative mass
refactor was made. The full assertion remains enabled and this finding is
**DEFERRED_PREEXISTING / UNVERIFIED**.

Final CodeGraph probe:

```text
codegraph status
```

Result: **index up to date**, 2,884 files, 225,885 nodes, and 443,634 edges.

## Advisory and CI limitation

The local dependency graph is not an advisory inventory. The exact advisory probe, `npm audit --omit=dev --json`, was attempted in the sandbox and retried with approved external access; both attempts failed at the registry endpoint. A hosted CI run for this uncommitted source was not available. Advisory applicability/fixed-version disposition and live CI artifact redaction are therefore **UNVERIFIED**.

## Cleanup

No dependency lockfile mass upgrade, shared database write, CI secret, or
external service was changed. The isolated database/process/build/browser
harness and generated lock/output were cleaned; both isolated databases
reported no sessions before non-force drop. The exact resource record is in
CF-801.
