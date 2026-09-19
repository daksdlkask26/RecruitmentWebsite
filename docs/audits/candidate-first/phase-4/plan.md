# Candidate-first Phases 4–5 Plan: Discovery Performance and Transparent Match

**Version:** 1.0  
**Prepared:** 14 September 2026  
**Scope:** CF-401 through CF-406, then CF-501 through CF-503  
**Starting point:** commit `583171bf8cdb3cc76fea4a6ce818e89208a99dfb` on branch `audit_improvement` — Phase 3 `DONE`  
**Current status:** `PHASE_4_DONE_VERIFIED_PHASE_5_FROZEN` — CF-406 repeatability closure completed 17 September 2026 on one task-owned production server with three consecutive desktop/mobile rounds; CF-403, CF-405, CF-406, and the integrated Phase 4 gate are verified on current evidence. Phase 5 remains frozen and is not claimed by this audit.

## 1. Purpose

This plan combines Candidate-first Phase 4 and Phase 5 into one controlled milestone without combining their implementation gates.

Phase 4 must first make public discovery consistent, measurable, cache-safe, and complete across:

`Home → Jobs → Company Directory → Company Detail → Job Detail → Apply`

Phase 5 may begin only after the Phase 4 integrated gate passes. It then makes Candidate Match transparent and evidence-backed across:

`Profile/CV source → Immutable CV/JD lineage → Deterministic evidence → Optional AI guidance → Candidate-only report`

The intended outcome is not a new search platform, recommendation engine, scoring engine, or design system. The outcome is the smallest repository-aligned set of corrections that:

- separates public data from session/account/private data;
- reuses one Candidate visibility policy across every discovery surface;
- invalidates public cached data when its publication authority changes;
- keeps URL state and Candidate journey behaviour consistent;
- measures performance and retrieval quality before and after changes;
- shows a numeric match only when it comes from an actual allowed input and traceable result;
- labels incomplete evidence honestly;
- preserves human decision authority, Candidate privacy, and the verified Phase 1–3 behaviour.

The server remains authoritative for publication visibility, search interpretation, filters, sort, pagination, saved/application state, Candidate identity, private match ownership, CV/JD versions, parser completeness, and evidence. Browser state may improve interaction but must not become an authority for any of those values.

## 2. Normative language

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** define implementation requirements:

- **MUST / MUST NOT:** required for the relevant work-item and integrated gate.
- **SHOULD:** expected unless current repository evidence proves a safer or smaller alternative.
- **MAY:** optional and must not broaden the milestone, weaken an invariant, or introduce speculative infrastructure.

Evidence states are strict:

- **IMPLEMENTED:** source or configuration changed, but all required executable proof is not yet available.
- **VERIFIED:** every acceptance criterion for that work item has current executable evidence.
- **UNVERIFIED:** required evidence is absent, stale, interrupted, or only inferred from source.
- **BLOCKED:** a precise external or environmental blocker remains after reasonable safe attempts.

Focused green tests, historical artifacts, source inspection, typecheck, lint, and build are different evidence classes. None may be relabelled as browser, isolated PostgreSQL, cache invalidation, performance, recall, or full integrated proof.

## 3. Review verdict and anti-over-engineering rules

Combining the two phases is acceptable only under the following structure:

1. Use one plan, one implementation task, one audit ledger, and one final integrated report.
2. Execute CF-401 through CF-406 sequentially and pass the Phase 4 gate before changing CF-501 through CF-503 behaviour.
3. Execute each work item as one vertical slice: establish current behaviour, state the failed invariant, make the smallest change, run focused evidence, self-review, and clean task-owned resources.
4. Do not implement Phase 4 and Phase 5 as parallel horizontal refactors. There must be only one writer in the working tree.
5. Reuse `candidateVisibleJobWhere` / `candidateVisibleJobSql`, `JobDiscoveryService`, the Company discovery contracts, the existing search resolver/catalog, the existing private CV Match pipeline, the existing scoring engine, existing EN/VI catalogs, and `--sh-*` design tokens.
6. Do not add Redis, a CDN abstraction, a cache database, a new queue, event sourcing, CQRS, a vector database, a new search engine, a new AI provider, a new global client store, or a new UI framework.
7. Do not enable Next.js `cacheComponents` globally merely to use a cache API. Prefer the smallest server-only cache primitive supported by the installed Next.js version. If a different cache primitive is chosen, its build/runtime and privacy effects must be proven first.
8. Do not cache a complete page model that contains session, account, CSRF, saved/applied flags, profile signals, private match scores, or Candidate identity.
9. Do not create a generic repository-wide discovery or invalidation framework. A small Phase 4-owned public projection and tag helper is sufficient.
10. Do not lower a search candidate cap, remove broad-query results, reduce a corpus, weaken a visibility predicate, or narrow an assertion only to improve latency or make a test pass.
11. No schema migration or new index is assumed. Additive persistence or an index is allowed only when an acceptance failure or representative query plan proves it necessary. The plan must record the evidence and rollback order first.
12. Existing Company search normalization, URL-derived filters, keyboard listbox behaviour, debounce, and explicit submit fallback are assets to preserve, not features to rebuild.
13. The existing private match domain already provides immutable attempts, owner-scoped reads, deterministic fallback, CV/JD lineage, evidence quotes, and human-decision copy. Phase 5 must close observable contract gaps instead of replacing that domain.
14. AI guidance is not deterministic source evidence. Evidence displayed as proof must trace to the allowed Profile/CV/JD input; an AI summary or action remains clearly labelled guidance.
15. A synthetic or illustrative numeric score is prohibited on Candidate-facing production UI. An illustration may explain the concept only without a numeric score, score ring, synthetic contribution, or visual implication of an actual assessment.

## 4. Current repository baseline

This baseline was established from the source and executable checks at the starting commit. It is the implementation starting point, not proof that Phase 4 or Phase 5 is complete.

### 4.1 Source and architecture baseline

| Area                      | Current source evidence                                                                                                                                                                                    | Gap owned by this plan                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Home route                | `web/src/app/page.tsx` is `force-dynamic` and calls one mixed `getHomePageContext` composition                                                                                                             | Measure first; separate cacheable public projection from request-private composition                                                 |
| Home composition          | `get-home-page-context.ts` loads jobs, company list/count, career paths, session/account/profile/recruiter state, recommendation candidates, private match scores, and CSRF into one `HomePageModel`       | Public and private ownership is implicit; public work repeats for every role and cannot be safely cached as one model                |
| Home job actor            | Authenticated Home job queries pass a user actor, causing public rows to include Candidate-specific saved/applied/action state                                                                             | Public snapshot must use a visitor-safe projection; private overlays must remain uncached and owner-scoped                           |
| Home Company visibility   | `prisma-home-public-company-repository.ts` checks verification and job status/deadline but does not reuse Company moderation or reviewed-job visibility predicates                                         | Home can drift from Company Directory and Jobs; one canonical predicate must apply                                                   |
| Canonical Job visibility  | `candidate-visible-job-policy.ts` already requires active/approved/published/in-window jobs, active verified companies, and published review state                                                         | Preserve and reuse it across Home, Jobs, Company jobs, saved jobs, and private match job selection                                   |
| Company discovery         | Company Directory/Detail already use `publicCompanyWhere`, server-ranked search, normalized locations, URL state, pagination, accessible controls, and canonical visible-job counts                        | Align Home to this contract; do not rebuild Company discovery                                                                        |
| Jobs discovery            | Jobs already has normalized URL criteria, SMART/LITERAL interpretation, server search/sort/pagination, saved/applied actions, explicit response cache headers, and Candidate-visible repository predicates | Close state/visibility and submit-fallback drift; preserve current resolver/catalog and recall                                       |
| Cache implementation      | No `cacheTag`, `revalidateTag`, `updateTag`, `unstable_cache`, `"use cache"`, or `cacheLife` usage exists under `web/src`                                                                                  | CF-403 is new but must remain local to public discovery; no private cache and no global cache mode                                   |
| HTTP cache boundary       | Guest `/api/jobs` responses are public for 30 seconds with 60-second stale-while-revalidate; authenticated responses use `no-store`; account routes use `no-store`                                         | Preserve the public/private header distinction and align server-side projection caching with it                                      |
| Mutation authorities      | Job review approval, recruiter close/reopen, automatic deadline archive, company verification, company moderation, and public company edits can change Candidate visibility                                | Every relevant committed mutation needs a tested tag invalidation mapping                                                            |
| Home Match                | Home trending jobs can display actual Profile or private CV Match results, but `HomeSmartMatch` ignores its model and always renders an illustrative score of 82 with synthetic contributions              | Remove Candidate-facing fabricated numeric presentation; actual scores need source/evidence context                                  |
| Private CV Match contract | The strict contract carries CV/JD versions, scoring configuration, parser provenance, required/preferred status, experience, evidence quote/location/confidence, and incomplete flag                       | Candidate UI does not currently surface `mayBeIncomplete` or parser provenance; input-source semantics need to be explicit           |
| Private Match UI          | Existing report/list/setup include privacy, advisory, source, evidence, retry, limited-mode, EN/VI, and accessibility affordances                                                                          | Score colour semantics are overly conclusive in places; incomplete/parser state and source distinction are not consistently rendered |
| Scoring prerequisites     | CF-105 human-only consequential decisions and CF-106 fixed-clock month-union experience are `VERIFIED` in the Candidate-first ledger                                                                       | Preserve their tests and prove the Phase 5 corpus against those contracts; do not reopen their architecture                          |
| Private-domain isolation  | Employer/recruiter code currently deletes `privateCvMatchCheck` rows directly during company deletion                                                                                                      | Move the cleanup behind a narrow private-domain lifecycle boundary without changing deletion/retention semantics                     |

### 4.2 Audit-time executable evidence

The following checks were run read-only with a non-reachable database URL whose name contains `test`; no shared database was mutated:

| Check                                                          | Result                                  | Interpretation                                                                                                                                                                                       |
| -------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home unit/component/accessibility/security/architecture bundle | **32 files, 85 PASS, 0 FAIL, 0 SKIP**   | Current Home behaviour is internally covered, including the currently intentional illustrative score; it does not verify Phase 4 cache separation or Phase 5's no-fabricated-score requirement       |
| Private CV Match focused bundle                                | **13 files, 34 PASS, 3 FAIL, 0 SKIP**   | Two failures expose the same employer/private-domain isolation issue; one entry-point assertion is stale after copy moved to the EN/VI catalog                                                       |
| Jobs + Company no-database focused bundle                      | **56 files, 273 PASS, 12 FAIL, 0 SKIP** | Current failures include a missing accessible Search fallback and several pre-existing UI/test-harness/copy drifts; each affected failure must be re-triaged, not blanket-relabeled or hidden        |
| Scoring bundle                                                 | **22 files, 104 PASS, 1 FAIL, 0 SKIP**  | Deterministic scoring, experience union, provider boundary, and human-decision tests pass; one recruiter document-preview title assertion is stale/outside Candidate Match unless Phase 5 touches it |

Current baseline failures are not automatically Phase 4–5 defects. Luna Max must classify every failure as one of:

- directly owned by CF-401–CF-503 and therefore required to close;
- caused by a Phase 4–5 change and therefore required to close;
- pre-existing and outside the affected path, retained with exact evidence and not counted as a Phase gate failure;
- environmental, with the missing dependency and skipped evidence class stated precisely.

Assertions must not be weakened to convert a product failure into a pass. Stale source-literal assertions should be replaced by behavioural, contract, localization, or rendered-output assertions only after the current user-visible behaviour is proven correct.

### 4.3 Historical performance evidence boundary

The 6 September artifacts are useful baselines but are not current reruns:

- isolated 1,000-job Home measurement: guest 46 queries/request; Candidate and Employer 93 queries/request; Candidate sequential p95 about 309 ms; Employer sequential p95 about 326 ms; significant pool wait under concurrency;
- local production browser gate: Home p95 below 3,000 ms and Jobs search p95 below 2,000 ms on desktop and mobile;
- the historical grouped career-path query already removed six independent fallback searches in its measured path.

CF-401 must produce a fresh pre-change artifact from the actual starting commit and environment. Historical numbers may guide investigation but may not be reported as current Phase 4 evidence.

## 5. Scope boundaries

### 5.1 Included

- CF-401 through CF-406 and CF-501 through CF-503.
- Home public projection and request-private composition.
- Candidate-visible discovery across Home, Jobs, Company Directory, Company Detail, Job Detail, saved jobs, and private CV Match job selection.
- The existing mutation paths that publish, close, archive, unpublish, verify, suspend/ban, restore, or edit public Job/Company data.
- URL-backed search/filter/sort/page state and affected loading/empty/error/retry/closed/expired/saved/applied states.
- The existing private CV Match and deterministic scoring contracts where required for provenance, completeness, evidence, and Candidate presentation.
- Candidate-facing Home and private Match UI; recruiter UI only when a shared contract change demonstrably affects it.
- EN/VI, light/dark, 320/375/768/1280 CSS pixels, 200% zoom, keyboard, visible focus, screen-reader semantics, non-colour cues, reduced motion, and overflow checks for touched journeys.
- Unit, contract, security, architecture, isolated PostgreSQL integration, mutation/invalidation, performance, recall, corpus, production build, browser E2E, and accessibility evidence proportional to each slice.

### 5.2 Excluded

- Phase 6 notification/messaging realtime work and later phases.
- A redesign of recruiter ranking, application stages, Team Applications, Admin management, CV Import, or Phase 3 application history.
- A new recommender, AI model/provider, embedding pipeline, vector search, search catalog, OCR engine, parser platform, or recruitment decision engine.
- Automatic shortlist, reject, stage change, invitation, membership, or application mutation from any score.
- Cross-account or employer access to Candidate private match results.
- Caching session/account/CSRF/Profile/CV/private score/saved/applied/notification data.
- Redis, CDN vendor work, a durable cache-invalidation outbox, or multi-region cache coherence unless an executable Phase 4 acceptance failure proves the local Next.js mechanism insufficient.
- Global `cacheComponents` enablement, broad Server Component conversion, or a whole-application caching audit.
- Generic repository-wide query instrumentation or OpenTelemetry migration; extend the existing bounded measurement harness only.
- Lowering search result caps or corpus size to improve benchmark numbers.
- Production deployment, commit, push, reset, clean, shared `smarthire` mutation, or stopping user-owned services.
- Bulk SmartHire-to-NextGen technical renaming. User-facing touched copy should say NextGen Careers; historical identifiers remain unchanged unless separately migrated.

## 6. Single-agent execution and repository safety

This plan is written for one root **GPT-5.6 Luna with Max reasoning** task. Luna Max owns investigation, design decisions, implementation, verification, self-review, and the final PASS/FAIL/UNVERIFIED decision.

Implementation MUST NOT request, call, spawn, delegate to, or rely on SubAgents, Terra, Sol, Astra, Antigravity, scouts, or external reviewers. Complexity and risk do not authorize delegation. When a second opinion would be useful, Luna Max must perform a documented risk-focused self-review.

Before every slice, Luna Max must:

1. Read the active `AGENTS.md` and this plan.
2. Confirm repository, branch, HEAD, and `git status --short`.
3. Preserve all user-owned and unrelated changes.
4. Use CodeGraph before text search to trace owners, callers, mutation paths, and tests.
5. Reproduce or prove the exact missing invariant before editing production code.
6. Record whether evidence is current or historical.

During implementation Luna Max must:

1. Keep one active vertical slice and one writer.
2. Make the smallest source-aligned change.
3. Add tests for success, material failure, privacy/authorization, concurrency or invalidation races where relevant.
4. Run focused checks before broader gates.
5. Stop repeating the same failed approach after two attempts; change investigative strategy and report an exact blocker if a safe decision remains unavailable.
6. Never add `skip`/`only`, loosen assertions, change expected values without product evidence, or replace real integration evidence with mocks.
7. Never write non-deterministic live AI output into a deterministic gate.

Any data-writing test must use an isolated database with `test`, `spec`, or `e2e` in its name, apply the full current migration sequence, use a unique fixture namespace, and remove only task-owned data/database afterward. The shared `smarthire` database must remain read-only. Task-owned servers, locks, browser artifacts, temporary env files, and ports must be recorded and cleaned without touching uncertain resources.

## 7. Dependency order and gates

| Order | Work item                   | May begin when                               | Blocking gate                                        |
| ----: | --------------------------- | -------------------------------------------- | ---------------------------------------------------- |
|     1 | CF-401 measure Home         | Phase 3 is DONE                              | Fresh pre-change artifact accepted                   |
|     2 | CF-402 split projections    | CF-401 baseline exists                       | Public/private contract and privacy tests pass       |
|     3 | CF-403 cache/invalidation   | CF-402 boundary is stable                    | Mutation-to-read and cache isolation pass            |
|     4 | CF-404 unified discovery    | CF-403 visibility semantics are known        | Cross-surface parity and URL tests pass              |
|     5 | CF-405 Candidate journey/UI | CF-404 contract is stable                    | Browser and accessibility journey pass               |
|     6 | CF-406 benchmark/recall     | CF-401–405 are implemented                   | **Integrated Phase 4 gate PASS**                     |
|     7 | CF-501 evidence contract    | Phase 4 gate passes; CF-105/106 remain green | Provenance/completeness/privacy contract passes      |
|     8 | CF-502 Candidate Match UI   | CF-501 response contract is stable           | Actual-score-only and accessibility tests pass       |
|     9 | CF-503 EN/VI corpus         | CF-501/502 are implemented                   | **Integrated Phase 5 and final Phase 4–5 gate PASS** |

No Phase 5 production behaviour may be changed while the Phase 4 integrated gate is FAIL or UNVERIFIED. Test-fixture reconnaissance for CF-503 may be read-only during earlier work, but corpus implementation belongs to Slice 9.

## 8. Work plan

### Slice 1 — CF-401: Measure Home before cache changes

#### Problem

Home performs public and private work in one request composition. Existing artifacts are historical and do not measure the current commit, payload bytes, cache hit/miss, or each sub-operation precisely.

#### Required work

1. Extend the existing Home measurement harness; do not create a second benchmarking framework.
2. Use the same isolated PostgreSQL seed for guest, Candidate, and Employer runs, with at least 1,000 candidate-visible jobs and representative Companies, saved/applied state, Profile signals, and private match rows.
3. Measure separately:
   - end-to-end service latency p50/p95/p99/max;
   - query count and database query duration;
   - pool checkout wait and peak waiting;
   - response/model payload bytes and production HTML transfer bytes;
   - Home public jobs, recommendation corpus, Company list/count, career-path counts, session/account/Profile/recruiter, saved/applied state, and private match work;
   - sequential runs and concurrent width 10;
   - cold process, first read, and repeated warm reads.
4. Confirm whether the grouped career-path implementation is active. Do not infer six queries from six cards.
5. Record commit, Node/Next version, database name, migration endpoint, seed namespace/size, pool size, sample count, concurrency, warm-up, command, and cleanup result.
6. Store pre-change evidence under `docs/audits` with a versioned schema. Do not overwrite historical artifacts.
7. Identify the actual largest contributors. CF-402/403 must optimize only measured public duplication or cacheable work.

#### Acceptance criteria

- Guest, Candidate, and Employer each have current p50/p95/p99, query, pool-wait, and payload evidence.
- Public, session/account, and private match costs are distinguishable.
- A 1,000-job and width-10 run completes with zero request errors.
- The artifact can be rerun with the same seed/configuration for the post-change comparison.
- No shared database, production service, or user-owned server is mutated.

#### Minimum evidence

- Measurement-harness unit tests for percentile/count/byte calculation.
- One fresh isolated PostgreSQL pre-change artifact.
- One production-build browser pre-change artifact.
- Query-plan snapshots for the measured high-cost queries.
- Cleanup evidence for database namespace, server, port, lock, and browser outputs.

### Slice 2 — CF-402: Separate public snapshot from personal context

#### Problem

`HomePageModel` currently combines cacheable public content with Candidate identity, CSRF, saved/applied state, Profile recommendations, and private CV Match references. Authenticated job reads also carry private action state into otherwise public projections.

#### Required work

1. Define a server-only `HomePublicSnapshot` containing only:
   - public trending/spotlight job fields;
   - public Company cards and public Company count;
   - public career-path counts;
   - non-user-specific section state needed to render those areas.
2. Define a request-private `HomePersonalContext` containing only the current viewer and allowed per-user overlays: locale/account presentation, CSRF proof, recruiter status, saved/applied flags, Profile-derived match signals, and private CV Match references.
3. The public snapshot must execute with visitor/public semantics. It must not receive `userId`, `sessionId`, cookies, headers, CSRF, Profile, Candidate CV, private check ID, or account data.
4. Merge public and private data only at the server composition boundary, using stable job/company IDs. Never place the merged model in a public cache.
5. Preserve current role behaviour:
   - Guest gets public discovery and no private overlay;
   - Candidate may get saved/applied and Profile/CV match context;
   - Employer gets public discovery plus only authorized account/recruiter presentation, never Candidate recommendations.
6. Keep authenticated HTTP responses and any model containing private overlays `no-store`.
7. Preserve independent section failure states. Failure of private Match must not remove public jobs; failure of one public section must not fabricate content for another.
8. Do not introduce an internal Home HTTP API or duplicate page composition.

#### Acceptance criteria

- A serialization test proves `HomePublicSnapshot` cannot contain any private field or identifier.
- Guest rendering contains no identity, session, Profile, membership, saved/applied, private score, check ID, CSRF, or Candidate PII.
- Candidate and Employer public fields equal the guest public snapshot for the same clock/seed before overlays.
- Candidate saved/applied and match overlays remain owner-scoped and cannot alter another user or Employer model.
- Existing Home EN/VI, section order, error recovery, and role navigation remain intact.

#### Minimum evidence

- Public/personal contract tests and architecture boundary tests.
- Home service tests for all three roles and partial failures.
- Rendered HTML privacy tests.
- Isolated PostgreSQL integration proving same public snapshot and different private overlays for two Candidates.
- Affected Home component and accessibility tests.

### Slice 3 — CF-403: Public cache tags and invalidation

#### Problem

There is currently no server-side tagged cache in `web/src`. Adding caching without a narrow projection and complete mutation map could leak private data or keep unpublished content visible.

#### Required work

1. Cache only the Phase 4 public projection functions established by CF-402.
2. Prefer the installed Next.js server cache primitive that supports explicit tags without global cache-mode changes. A small `unstable_cache`-style wrapper is acceptable. `cacheTag`/`"use cache"` is acceptable only if Luna first proves that enabling its required configuration does not change unrelated routes.
3. Use the smallest tag set:
   - `public-home-jobs` for Home job cards and career-path counts;
   - `public-home-companies` for Home Company cards/count;
   - `public-jobs` for public Job list/taxonomy projections when cached;
   - `public-job:{jobId}` for one Job detail/projection;
   - `public-companies` for public Company list projections when cached;
   - `public-company:{companyId}` and `public-company-jobs:{companyId}` for Company detail/jobs.
4. Do not put user, session, CV, private match, saved job, or application IDs into public cache tags or keys.
5. Bind tags only at the owning public read function; do not scatter raw strings across routes.
6. Invalidate after the authoritative mutation commits. Cover at least:

| Mutation                                         | Required invalidation                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Admin approves or republishes a Job revision     | Home jobs, public jobs, exact Job, owning Company jobs/detail                               |
| Recruiter closes or reopens an approved Job      | Same Job and Company-scoped tags plus Home jobs                                             |
| Deadline lifecycle archives/removes a Job        | Same Job and Company-scoped tags plus Home jobs                                             |
| Company verification becomes active/inactive     | Home Companies, public Companies, exact Company, Company jobs, Home jobs                    |
| Admin bans/unbans or suspends/restores a Company | Same Company and Home/public discovery tags; safety removal uses immediate expiry semantics |
| Public Company profile fields change             | Home Companies, public Companies, exact Company                                             |

7. Ordinary publication freshness target is the next read after a successful invalidation and no later than 30 seconds if a normal stale-while-revalidate path is intentionally used.
8. Unpublish, archive, moderation ban, verification inactivation, and suspension are fail-closed: the first read after the committed command returns must not expose the removed Job/Company. Test both list and direct detail reads.
9. Natural deadline expiry must disappear no later than the declared 30-second public cache TTL, and the lifecycle worker must invalidate earlier when it archives the record.
10. Keep guest HTTP cache headers and authenticated `no-store` semantics coherent with server-side caching.
11. Do not add a durable invalidation outbox unless a reproduced failure proves the local Next.js mechanism cannot meet the single-deployment contract.

#### Acceptance criteria

- Warm repeated public reads demonstrate a real cache hit and avoid public repository work.
- Candidate/Employer private overlay work still executes per request and never appears in another session.
- Each mutation row in the table has a focused mutation-to-read test.
- Safety removals expose zero stale list/detail reads after command completion.
- Invalid or unavailable cache state falls back to authoritative public reads without widening visibility.
- Production build and runtime start pass with the chosen Next.js cache API.

#### Minimum evidence

- Cache key/tag isolation tests.
- Mutation-to-tag mapping tests.
- Isolated PostgreSQL publish/close/reopen/expire/ban/unban/verification integration tests.
- Production runtime tests for cold, miss, hit, revalidation, and invalidation.
- Privacy tests across two Candidate sessions and one Employer session.

### Slice 4 — CF-404: Unify Candidate discovery contracts

#### Problem

Jobs, Company discovery, and private Match already reuse the canonical Job visibility policy, while the Home Company repository duplicates a weaker predicate. URL and state presentation are also not proven equivalent across every surface, and the current Jobs filter test detects a missing explicit Search fallback.

#### Required work

1. Make `candidate-visible-job-policy.ts` the single Job publication predicate for:
   - Home trending/recommendation inputs;
   - Jobs list and detail;
   - Company open-position count and Company jobs;
   - saved-job presentation/eligibility;
   - private CV Match job picker and direct preselection.
2. Make Company public visibility one shared predicate containing verified/active/not-inactive/moderation-active semantics. Home must not maintain a weaker copy.
3. Preserve neutral not-found behaviour for unknown, unpublished, expired, moderated, or unauthorized direct URLs.
4. Preserve the existing search resolver/catalog and Company location normalization. Do not create another normalization library.
5. Confirm one URL contract for `q`, search mode, location/district, category, employment type, experience, work arrangement, salary/negotiable, posted window, sort, page/cursor, and page size where each route supports that field.
6. Live controls may debounce/replace the URL, but every search surface must retain an explicit keyboard-accessible Search/Apply submit fallback. Back/Forward, refresh, direct links, and retry must restore server-applied criteria without synthetic `popstate`, polling, or duplicate refetch loops.
7. Normalize the same business states across surfaces:
   - salary with no amount and `isNegotiable=true` displays Negotiable, never zero;
   - passed deadline is expired/closed and cannot apply or start a new private check;
   - remote/hybrid/on-site labels use the same enum mapping;
   - saved/applied state is personal and uncached;
   - application state never changes Candidate-visible publication eligibility by itself.
8. Add parity fixtures containing active, future-published, expired, closed, removed, unreviewed, review-archived, unverified Company, inactive Company, and moderated Company records.
9. For every fixture, assert the same Job ID is either visible on every applicable surface or absent from every applicable surface.
10. Preserve search breadth. Do not reduce the 5,000-row freshness/candidate window or any other cap without before/after recall evidence.

#### Acceptance criteria

- Cross-surface parity is exact for the visibility fixture matrix.
- Home Company counts match Company Directory/Detail candidate-visible counts.
- Direct Job/Company/private-check links fail neutrally after visibility is revoked.
- URL refresh/Back/Forward/direct navigation restores criteria and result state.
- Salary, deadline, work arrangement, saved, applied, and closed/expired labels agree across Home, Jobs, Company, and Job Detail.
- Search button fallback is present and operable by keyboard without disabling current live search.

#### Minimum evidence

- Shared policy unit/architecture tests.
- Isolated PostgreSQL parity integration across all surfaces.
- Search/filter URL contract tests.
- Saved/applied and private-check authorization/security tests.
- EN/VI component tests for normalized display states.

### Slice 5 — CF-405: Complete the Candidate discovery journey and UI

#### Problem

Individual screens are mature, but the complete Home-to-Apply journey has not been verified as one stable experience after the Phase 4 contract changes.

#### Required work

1. Preserve the route sequence and give each transition one clear primary action:
   - Home public Job/Company cards;
   - Jobs result and filter recovery;
   - Company Directory card and Company Detail jobs;
   - Job Detail and private Match entry point;
   - Apply/sign-in/already-applied/closed outcomes.
2. Reuse current headers, cards, pagination, controls, copy catalogs, and semantic tokens. Refine only affected layout/state issues.
3. Long Company names, Job titles, locations, salaries, skills, EN/VI labels, counts, and CTAs must not overlap, truncate essential meaning, or create page-level horizontal scrolling.
4. Loading placeholders must preserve major layout dimensions. Empty, partial failure, full error, retry, no permission, closed, expired, saved, applied, and no-results states must each provide one valid next action.
5. Keyboard order must follow visual order. Drawers/listboxes/dialogs must manage Escape, focus entry/return, and visible focus. Status must not rely on colour alone.
6. Animations must respect reduced motion. Match visual changes belong to CF-502, not this slice.
7. Validate at 320, 375, 768, and 1280 CSS pixels, light/dark, and 200% zoom.
8. Preserve the Phase 3 application route and idempotent submission behaviour; this slice stops at the existing Apply journey and must not refactor application persistence.

#### Acceptance criteria

- The complete browser journey succeeds for Guest handoff and authenticated Candidate paths.
- Refresh, direct link, Back/Forward, retry, saved state, and selection state remain correct.
- No affected viewport has page-level horizontal overflow or hidden primary CTA.
- EN/VI, dark mode, reduced motion, keyboard, visible focus, and serious/critical axe checks pass.
- A revoked/expired Job cannot be applied to or used for a new private Match after navigation races.

#### Minimum evidence

- Component tests for every affected state.
- Production-build Playwright matrix at all required widths.
- Keyboard and focus journey tests.
- Axe serious/critical = 0 and explicit overflow/200% zoom assertions.
- Candidate-first Phase 3 regression for Apply/receipt boundaries affected by navigation.

### Slice 6 — CF-406: Post-change benchmark, query plans, and discovery recall

#### Problem

Performance optimizations are not acceptable if they leak private data, hide valid Jobs, lower search recall, or compare different seeds/configurations.

#### Required work

1. Rerun the CF-401 harness with the same seed, commit configuration, pool, sample count, concurrency, warm-up, and hardware.
2. Report cold, miss, and warm-hit results separately. A warm result must not conceal first-read latency.
3. Record cache hit/miss, public repository calls, private overlay calls, payload bytes, mutation-to-read time, and p50/p95/p99.
4. Capture representative `EXPLAIN (ANALYZE, BUFFERS)` plans for Home jobs/counts, Company list/count/jobs, exact Job detail, broad search, normalized short-token search, and filtered search.
5. Use a small, source-controlled, labelled discovery corpus covering EN and VI queries, diacritics/no diacritics, punctuation, exact title, broad role, Company abbreviation, location/district, category, negotiable salary, remote/hybrid, zero result, and ambiguous correction.
6. Compute recall from explicit expected IDs. Do not substitute result count for recall.
7. Required budgets:
   - request error rate: `0`;
   - local production Home steady-state p95: `≤ 3,000 ms`;
   - local production Jobs search steady-state p95: `≤ 2,000 ms`;
   - no guest/Candidate/Employer service p95 regression greater than 10% against the same-run pre-change baseline;
   - no role's query count or pool wait p95 may increase without a documented correctness reason;
   - warmed unchanged public snapshot hit rate: `≥ 90%`, with zero public repository calls on a true hit;
   - safety mutation first-read stale exposure: `0`;
   - exact/normalized labelled queries: `100%` expected-ID recall;
   - broad labelled queries: `≥ 95%` recall and not below the pre-change result;
   - payload bytes must not grow more than 10% without a documented user-visible requirement.
8. Do not add an index because a plan contains a sequential scan. Add one only when the representative plan and latency budget demonstrate the need, then verify write/storage cost and migration rollback.

#### Acceptance criteria — integrated Phase 4 gate

- CF-401 through CF-406 are each `VERIFIED`.
- Public/private projection separation and authenticated `no-store` behaviour pass.
- All mutation/invalidation and visibility parity tests pass.
- URL and complete browser journey tests pass.
- Every budget above passes on current evidence.
- Any unrelated baseline failure remains explicitly listed and has no affected Phase 4 path.
- Isolated data, process, lock, port, env, and browser artifacts are cleaned.

#### Minimum evidence

- Versioned before/after JSON artifacts and a concise Markdown comparison.
- Query plans and recall report.
- Integrated Phase 4 focused/integration/security/browser/accessibility suites.
- Production build, typecheck, affected ESLint/Prettier, Prisma validation/migration sequence, and `git diff --check`.

### Slice 7 — CF-501: Evidence, provenance, completeness, and private-domain boundary

#### Problem

The private Match contract contains most required lineage data, but Candidate presentation does not expose parser completeness, input source is not explicit across Profile and CV estimates, and employer/recruiter deletion code directly references private-match storage.

#### Required work

1. Extend the smallest existing response contracts to state the input source explicitly: `PROFILE` estimate or `CV` private check. Do not merge those two result types or claim equivalent evidence strength.
2. For a CV result, preserve and expose:
   - Candidate-owned CV version ID/version and confirmed timestamp;
   - Job ID/slug and immutable JD version/update timestamp;
   - scoring configuration, parser, input-policy, prompt/provider/model versions where applicable;
   - required and preferred skills with neutral preferred semantics;
   - required and detected experience;
   - parser/CV/JD completeness and `mayBeIncomplete`;
   - deterministic evidence criterion, quote, section/page location, and confidence.
3. For a Profile estimate, expose only the allowed profile signals actually used and a clear estimate label. Do not fabricate CV quote/page evidence or imply a full private check exists.
4. Treat deterministic quotes/anchors as source evidence. Keep AI summary, strengths, gaps, and actions labelled as guidance unless they reference an allowed deterministic evidence item.
5. Define Candidate score presentation state without new persistence unless required:
   - `AVAILABLE`: actual result with sufficient parsed input;
   - `INCOMPLETE`: actual result exists but parser or required evidence is partial/ambiguous; show warning and limitations;
   - `UNAVAILABLE`: parsing/source failed or no valid actual result; show no numeric score.
6. Missing, failed, or mismatched CV/JD lineage must fail closed. Never fall back to the current mutable CV/JD while projecting an old check.
7. Preserve owner-scoped neutral denial, retention, immutable retry, AI limited-mode fallback, content-free logging, and human-decision invariants.
8. Move company/job deletion cleanup of private checks behind a narrow private-domain lifecycle function/port that accepts the existing transaction. The employer/recruiter service may request lifecycle cleanup but must not query or name private-check tables or expose private discovery terms.
9. Update the stale entry-point test to assert rendered localized copy/link behaviour through the copy contract; do not re-inline English text into the component.
10. No recruiter ranking, employer score, or application-stage response may gain private Candidate match fields.

#### Acceptance criteria

- Every displayed source evidence item traces to the immutable allowed Profile/CV/JD input and version.
- Parser partial/missing/failure paths produce INCOMPLETE or UNAVAILABLE, never a confident-looking fabricated score.
- Required/preferred skills and required/detected experience retain their correct neutral semantics.
- Two Candidates cannot read, delete, retry, infer, or receive each other's check or evidence.
- Employer/recruiter/Admin transports, exports, search, and presentation remain unaware of private results.
- Company deletion retains its existing authorization, legal-hold, manifest, and transactional cleanup behaviour through the private-owned boundary.
- CF-105 and CF-106 focused regressions remain green.

#### Minimum evidence

- Strict response-contract tests for PROFILE/CV and AVAILABLE/INCOMPLETE/UNAVAILABLE.
- Projection/worker tests for immutable lineage, partial parse, failed parse, stale versions, missing evidence, AI timeout, and retry.
- Private ownership/security/architecture tests.
- Company deletion integration proving identical cleanup and retention behaviour through the new boundary.
- Content-free log assertions.

### Slice 8 — CF-502: Candidate Match UI using actual evidence only

#### Problem

Home still renders an illustrative 82 score and synthetic composition. The private report renders actual data but does not surface incomplete/parser state consistently and uses success/danger colour patterns that can look like a hiring conclusion.

#### Required work

1. Remove the numeric 82 score, score ring, synthetic skill/experience/education split, and fabricated strengths/gaps from the Home explanatory panel.
2. For Guest, Employer, or Candidate without an actual result, render a non-numeric explanation and a valid CTA to Profile/CV Match/Jobs as authorized.
3. Render a score ring only for an actual `AVAILABLE` or clearly cautioned `INCOMPLETE` result. The accessible name must include score, source type, and completeness state.
4. Every actual score presentation must place nearby:
   - numeric value and descriptive non-decision label;
   - Profile estimate or CV version/JD version source;
   - evidence/limitations link or summary;
   - “guidance, not a hiring decision” meaning in EN/VI.
5. Display parser/incomplete warnings before strengths or recommendations. Do not hide warnings behind a tooltip, colour, or secondary tab.
6. Replace red/green hiring-conclusion semantics with neutral/informational/caution semantics. Green may indicate a technical success state such as “source ready,” but not “candidate should be hired.” Red may indicate an actual error, not a low match.
7. Keep required and preferred skills visually/textually distinct; missing preferred skills remain optional and must not look like rejection reasons.
8. Preserve private ownership, no employer sharing, retry/limited mode, delete, apply CTA, and immutable report navigation.
9. Reuse existing `HomeMatchRing`, report components, tokens, and copy catalogs only where they satisfy the new contract. Do not create a second visualization system.
10. Respect reduced motion and do not animate score changes when reduced motion is enabled.

#### Acceptance criteria

- No Candidate-facing production source renders a fabricated numeric Match score.
- Score rings render only from actual response data and have source/completeness semantics.
- Incomplete/unavailable input is prominent and no confident numeric score appears for UNAVAILABLE.
- No copy or colour states that the system made a hiring decision.
- EN/VI text is complete; light/dark, 320–1280 px, 200% zoom, keyboard, focus, reduced motion, and non-colour semantics pass.
- Home actual CV Match links to the owner-scoped immutable report; Profile estimates remain labelled estimates.

#### Minimum evidence

- Home tests for guest, Employer, no result, Profile estimate, CV result, incomplete, and unavailable.
- Private report tests for full, limited, incomplete, unavailable, evidence-empty, and long EN/VI data.
- Source scan that rejects hard-coded illustrative numeric scores in Candidate production components.
- Production browser/accessibility matrix and privacy checks.

### Slice 9 — CF-503: Labelled EN/VI corpus and deterministic quality gate

#### Problem

Existing unit cases cover important scoring rules, but there is no one versioned corpus report measuring experience error, skill precision/recall, parser drift, and equivalent EN/VI/source representations.

#### Required work

1. Create a small source-controlled, synthetic, PII-free labelled corpus under the existing scoring/private-match test fixture structure. Do not create a dataset platform.
2. Include at least 24 cases with both EN and VI represented and at least eight semantically equivalent pairs. The matrix must cover:
   - structured CV/JD text;
   - flattened text PDF extraction;
   - DOCX or the already supported structured document path;
   - overlap, nested, adjacent, gap, reversed, year-only, and open-ended experience ranges using a fixed clock;
   - skill aliases, punctuation such as C++/.NET/Node.js, diacritics/no diacritics, negated/weak mentions, preferred-only skills, and missing skills;
   - missing/partial/failed parse and missing Job criteria.
3. Label expected union months, incomplete state, required/preferred skill matches, allowed evidence excerpts/anchors, and whether a score may be shown.
4. Run the same production deterministic parser/matcher adapters used by private Match. Do not duplicate scoring logic inside the evaluator.
5. Produce machine-readable and human-readable reports for:
   - experience absolute error in months;
   - skill true/false positives/negatives, precision, recall, and F1;
   - evidence-anchor validity;
   - parser status drift by input format;
   - result difference for equivalent EN/VI and formatting pairs;
   - score-presentation eligibility.
6. Gate only deterministic output. Live provider AI may have a separate opt-in compatibility smoke when credentials/environment are explicitly available, but it is not required for deterministic Phase 5 PASS.
7. Required tolerances:
   - fully specified valid experience timelines: `0` month absolute error;
   - semantically equivalent timeline pairs: `0` month difference;
   - equivalent deterministic automatic scores: absolute difference `≤ 1.0` point;
   - required/preferred matched-skill set for equivalent pairs: exact equality;
   - labelled skill precision and recall: each `≥ 0.95` and not below the captured pre-change baseline;
   - evidence-anchor validity: `100%` of published deterministic evidence points to allowed input text;
   - incomplete/unavailable classification: `100%` for labelled missing/partial/failed cases;
   - prohibited fabricated score on UNAVAILABLE cases: `0`.
8. Fail with a per-case diagnostic that contains fixture IDs and safe expected/actual labels, never real CV text, credentials, or PII.

#### Acceptance criteria — integrated Phase 5 and final gate

- CF-501 through CF-503 are each `VERIFIED` on current evidence.
- CF-105 and CF-106 remain green; no score changes recruitment stage or authority.
- Every tolerance above passes.
- Candidate Match UI displays only actual traceable results and honest incomplete/unavailable states.
- Private results remain Candidate-owned and absent from employer/recruiter/Admin surfaces.
- The integrated Phase 4 gate remains green after Phase 5 changes.
- Production build, browser/accessibility, static gates, isolated database checks, and cleanup pass.

#### Minimum evidence

- Versioned corpus fixture/schema tests.
- Machine-readable metrics artifact and concise Markdown report.
- Full deterministic scoring and private CV Match suites.
- CF-105/106 regression.
- Integrated Phase 4 discovery/performance/recall rerun if Phase 5 changes any Home/discovery source.
- Production browser matrix for Home and private Match.

## 9. Expected impact area

Luna Max must verify actual ownership before editing. Likely affected files include:

### Home and public projection

- `web/src/app/page.tsx`
- `web/src/backend/services/home/get-home-page-context.ts`
- `web/src/backend/repositories/home/prisma-home-public-company-repository.ts`
- `web/src/frontend/features/home/home-page-model.ts`
- `web/src/frontend/features/home/components/home-trending-jobs.tsx`
- `web/src/frontend/features/home/components/home-smart-match.tsx`
- `web/src/frontend/features/home/home-copy.ts`

### Jobs, Company, visibility, and mutations

- `web/src/backend/repositories/jobs/candidate-visible-job-policy.ts`
- `web/src/backend/repositories/jobs/prisma-public-job-repository.ts`
- `web/src/backend/services/jobs/job-discovery-service.ts`
- `web/src/backend/repositories/companies/prisma-company-discovery-repository.ts`
- `web/src/backend/services/companies/company-discovery-service.ts`
- `web/src/backend/repositories/jobs/prisma-job-post-review-repository.ts`
- `web/src/backend/services/jobs/recruiter-job-posting-data.ts`
- `web/src/backend/admin/workers/job-post-lifecycle-loop.ts`
- `web/src/backend/admin/companies/company-moderation-service.ts`
- `web/src/backend/admin/verification/verification-approval-transaction.ts`
- affected Jobs/Company route and component files already owning URL/filter/state behaviour

### Match and scoring

- `web/src/shared/contracts/private-cv-match/index.ts`
- `web/src/backend/private-cv-match/private-cv-match-service.ts`
- `web/src/backend/private-cv-match/private-match-worker.ts`
- `web/src/backend/private-cv-match/private-match-projection.ts`
- `web/src/backend/repositories/private-cv-match/prisma-private-cv-match-repository.ts`
- `web/src/backend/scoring-engine/scoring-engine-adapter.ts`
- `web/src/backend/scoring-engine/scoring-contracts.ts`
- `web/src/frontend/features/private-cv-match/components/*`
- `web/src/frontend/features/private-cv-match/i18n/private-match-copy.ts`

### Tests and evidence

- existing Home, Jobs, Company, private Match, scoring, security, and architecture suites
- `web/scripts/measure-candidate-first-home-performance.mjs`
- existing Playwright Home/search configuration and specs where reusable
- new Phase 4–5 focused integration/corpus specs only where existing suites have no correct owner
- `docs/audits` evidence artifacts and this ledger

This is an impact map, not permission for broad edits. Files must be touched only when the active slice proves they are necessary.

## 10. Data, migration, compatibility, and rollback

1. The expected implementation requires no schema migration: public cache state is derived, provenance already exists in private Match records, and Candidate presentation state can be projected.
2. If an additive field or index becomes necessary, Luna must first record:
   - the failing acceptance/query-plan evidence;
   - why existing JSON snapshot/projection fields are insufficient;
   - deploy order, mixed-version compatibility, backfill need, and rollback order;
   - isolated full migration-sequence validation.
3. Never rewrite historical CV/JD/private Match rows merely to populate a new UI field. Legacy rows use a safe derived fallback or become clearly incomplete/unavailable.
4. Cache changes must be removable without data migration. Rollback disables the public cache wrapper and leaves authoritative repository reads intact.
5. Invalidation calls occur only after successful committed mutations. A failed mutation must not publish a false visibility change.
6. Private Match cleanup refactoring must retain existing company-deletion transaction, legal holds, retention manifest, and idempotency. It changes ownership boundaries, not deletion policy.
7. Search resolver/catalog versions, cursor contracts, and existing URLs remain backward compatible. Unknown/old query values normalize through the existing safe defaults.

## 11. Test strategy and required matrices

### 11.1 Visibility matrix

For each surface, test active, future publish, expired deadline, closed, removed, unreviewed, review archived, Company unverified, verification inactive, and Company moderated. Expected visibility must be identical wherever the surface is applicable.

Surfaces: Home, Jobs list, Job detail, Company count, Company jobs, saved-job rendering, private Match picker, private Match direct preselection.

### 11.2 Cache/privacy matrix

| Viewer/read                            | Public cache allowed                | Private overlay allowed                        | Response policy                  |
| -------------------------------------- | ----------------------------------- | ---------------------------------------------- | -------------------------------- |
| Guest Home/Jobs                        | Yes, public projection only         | No                                             | public header per route contract |
| Candidate Home/Jobs                    | Public sub-projection only          | Own saved/applied/Profile/private Match        | complete response `no-store`     |
| Employer Home/Jobs                     | Public sub-projection only          | Authorized account/recruiter presentation only | complete response `no-store`     |
| Company Directory/Detail account route | Optional public sub-projection only | Authorized Team actions remain separate        | account response `no-store`      |
| Private Match                          | No public cache                     | owning Candidate only                          | private `no-store`               |

### 11.3 Invalidation race matrix

- cache hit concurrent with close/unpublish;
- cache hit concurrent with Company ban/inactivation;
- publish followed immediately by list and detail read;
- reopen/unban followed immediately by list and detail read;
- deadline crossing with and without lifecycle worker;
- invalid/tampered tag input is impossible because tags are built server-side from validated IDs;
- a failed/stale mutation does not invalidate as if it committed.

### 11.4 Candidate journey matrix

- Guest Home → Jobs → Job Detail → sign-in handoff → Apply;
- Candidate Home → Company Directory → Company Detail → filtered Job → Job Detail → save → private check → Apply;
- direct Job/Company/private-check link;
- refresh, Back/Forward, retry, rapid filter changes, stale response race;
- closed/expired/revoked Job during navigation;
- EN/VI, light/dark, 320/375/768/1280, 200% zoom, reduced motion, keyboard/focus, no serious/critical axe violation, no horizontal overflow.

### 11.5 Match matrix

- PROFILE estimate, CV full report, CV limited report;
- available, incomplete, unavailable;
- required/preferred/missing/negated skills;
- exact/partial/missing experience;
- immutable old CV/JD version after current Profile/Job changes;
- AI success, timeout, malformed output, retry, no provider configuration;
- cross-account read/delete/retry/direct link;
- employer/recruiter/Admin source and response scans for private data.

## 12. Gate after every slice

Before advancing, Luna Max must record:

1. Exact root cause or missing invariant.
2. Source files changed and why each was necessary.
3. Acceptance criteria with `PASS`, `FAIL`, or `UNVERIFIED`.
4. Focused test command and PASS/FAIL/SKIP counts.
5. Integration/security/browser/performance evidence required by that slice.
6. Diff self-review for business, architecture, authorization/privacy, concurrency/invalidation, performance, UI/accessibility, and operational safety.
7. Baseline failures re-triaged with ownership and regression status.
8. Task-owned database/process/port/lock/env/artifact cleanup.

A slice with a required FAIL or UNVERIFIED criterion cannot be called VERIFIED and cannot unlock its dependent slice.

## 13. Definition of Done

The combined milestone is `DONE` only when all of the following are true:

- CF-401, CF-402, CF-403, CF-404, CF-405, CF-406, CF-501, CF-502, and CF-503 are individually `VERIFIED`.
- The Phase 4 integrated gate passed before Phase 5 implementation proceeded.
- The final rerun proves the Phase 4 gate still passes after Phase 5.
- No public cache contains or keys on private/session/account data.
- Safety visibility mutations have zero stale first-read exposure after command completion.
- Discovery visibility and URL state are consistent across all included surfaces.
- Performance, payload, query, cache-hit, mutation-to-read, and recall budgets pass on current artifacts.
- Candidate Match has traceable source/version/evidence and honest completeness semantics.
- No fabricated numeric score or synthetic contribution remains in Candidate production UI.
- Scores remain advisory and cannot change recruitment stage, application outcome, invitation, or membership.
- Corpus tolerances pass for EN/VI, experience months, skill precision/recall, evidence anchors, input formats, and incomplete/unavailable cases.
- Focused, integration, security, architecture, regression, browser, accessibility, production build, typecheck, affected ESLint/Prettier, Prisma validation/migration sequence, and `git diff --check` evidence are recorded with exact counts.
- No required test is skipped, assertion weakened, expected value changed without evidence, or failure hidden.
- Unrelated baseline failures are listed accurately and proven unaffected; relevant failures are closed.
- No shared database is mutated and every task-owned database, fixture, process, lock, port, env file, and browser artifact is cleaned.
- No commit, push, deploy, reset, clean, or user-owned service stop occurs without separate authorization.

## 14. Status and final reporting contract

The implementation task must maintain this table:

| Work item            | Status      | Current evidence                                   | Remaining blocker/limitation                     |
| -------------------- | ----------- | -------------------------------------------------- | ------------------------------------------------ |
| CF-401               | VERIFIED    | Same-commit isolated pre/post service and browser measurements; runtime cache probe closes the direct-harness cache boundary | Direct service query p95 exception is documented in the closure artifact |
| CF-402               | VERIFIED    | Public snapshot/private overlay contract, rendered-data privacy, role parity, and failure isolation suites | None                                             |
| CF-403               | VERIFIED    | `docs/audits/candidate-first/phase-4/evidence/cf403-authoritative-invalidation.json`: 13/13 authoritative profile, moderation, approve/republish, close/reopen, worker, verification, rollback, race, watermark, and first-read checks PASS | None |
| CF-404               | VERIFIED    | Shared Job/Company visibility policies, isolated cross-surface parity, URL/search fallback, and live recall | None                                             |
| CF-405               | VERIFIED    | Current production-build light and dark reruns: 32/32 PASS per theme across 320/375/768/1280; applied theme, axe serious/critical 0, 200% zoom, keyboard/focus, reduced motion, overflow, EN/VI, and revoked/expired navigation-race checks PASS | None |
| CF-406               | VERIFIED    | Cache probe 20/20 warm hits (100%), zero public repository calls on true hits, first-read-after-mutation PASS; final same-server repeatability 6/6 PASS (three desktop/mobile rounds, 1,002 jobs, concurrency 10, 100 Home + 100 Search each, 0% errors) in `docs/audits/candidate-first/phase-4/evidence/cf406-repeatability.json` | Historical same-run pre-change baseline remains UNVERIFIED; all current absolute budgets and repeatability reruns PASS |
| Phase 4 gate         | VERIFIED    | CF-401–CF-406 closed; current CF-403/405/406 closure evidence is recorded in the 2026-09-16/17 audit artifacts and Phase 5 remains frozen | None |
| CF-501               | NOT_STARTED | Existing lineage/evidence contract is partial      | Source/completeness/private-boundary gaps remain |
| CF-502               | NOT_STARTED | Actual private report exists                       | Fabricated Home score and UI semantics remain    |
| CF-503               | NOT_STARTED | Scattered deterministic unit cases exist           | Versioned labelled corpus/report absent          |
| Final Phase 4–5 gate | NOT_STARTED | —                                                  | Both integrated gates must pass                  |

The final report must be concise but include:

1. Final verdict and root causes resolved.
2. Before/after behaviour.
3. Important changed files.
4. Exact PASS/FAIL/SKIP counts by evidence class.
5. Performance, cache, invalidation, recall, and corpus metrics.
6. Remaining UNVERIFIED items or exact blockers.
7. Unrelated baseline failures and why they do not affect the gate.
8. Cleanup and repository/database safety result.
9. Per-work-item status and final integrated gate.

## 15. Risk register

| Risk                                             | Required control                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Private data enters public cache                 | Type/serialization boundary, public visitor projection, two-session privacy tests, authenticated `no-store` |
| Stale banned/unpublished content remains visible | Post-commit exact/domain invalidation, immediate-expiry safety semantics, first-read list/detail tests      |
| Cache improves Home but worsens cold path        | Separate cold/miss/hit metrics and no-regression p95 budget                                                 |
| Home/Company predicate remains weaker than Jobs  | Shared canonical visibility policy and parity fixture matrix                                                |
| Search optimization reduces recall               | Fixed labelled corpus, expected IDs, pre/post recall, no cap reduction without proof                        |
| URL live search creates duplicate requests/races | Native router/history behaviour, latest-response ownership, no synthetic events/polling                     |
| Match displays fabricated certainty              | Actual-result-only state, incomplete/unavailable contract, no synthetic numeric source scan                 |
| AI guidance is mistaken for evidence             | Distinct contract/presentation for deterministic evidence and AI guidance                                   |
| Preferred skill looks mandatory                  | Neutral kind contract and EN/VI UI assertions                                                               |
| Private check leaks through lifecycle code       | Private-domain cleanup boundary and employer/recruiter source/security scans                                |
| Corpus overfits a few English fixtures           | Minimum matrix, EN/VI equivalent pairs, flattened documents, missing/partial cases                          |
| Non-deterministic AI makes gate flaky            | Deterministic adapter gate only; optional live compatibility smoke kept separate                            |
| Broad refactor destabilizes Phase 1–3            | Sequential slices, affected regression after each contract change, final Candidate-first regression         |

## 16. Evidence log template

Append one entry per completed slice:

```md
### YYYY-MM-DD — CF-40X/CF-50X

- Starting branch/HEAD:
- Working-tree ownership checked:
- Root cause / missing invariant:
- Source changed:
- Migration/index decision and evidence:
- Focused tests: N files, N PASS, N FAIL, N SKIP
- Isolated PostgreSQL: N PASS, N FAIL, N SKIP; database/namespace:
- Security/architecture: N PASS, N FAIL, N SKIP
- Browser/accessibility: projects/viewports; N PASS, N FAIL, N SKIP
- Performance/cache/invalidation/recall/corpus metrics:
- Production build/typecheck/lint/format/Prisma/diff-check:
- Baseline failure re-triage:
- Cleanup:
- Acceptance criteria: PASS / FAIL / UNVERIFIED
- Work-item status:
- Next unlocked slice or exact blocker:
```

### 2026-09-17 — CF-403 / CF-405 / CF-406 final-source closure

- Starting branch/HEAD: preserved dirty `audit_improvement` worktree; no reset or clean.
- Root cause / missing invariant: the final browser gate needed an applied dark theme and deterministic revoked/expired navigation races; application drafts also used a weaker visibility predicate than public discovery. The earlier worker/cache evidence needed an independent authoritative rerun.
- Source changed: shared candidate-visible job policy for application reads; public Home theme bootstrap/provider correction; fixture-only JobSearchProjection materialization and authoritative navigation-race controls; configurable light/dark CF-405 matrix; final CF-403/CF-406 probes and evidence. The CF-406 browser gate now waits for `load` and drains a 250 ms post-search stream window outside measured samples to prevent cancelled RSC/prefetch work contaminating the next round.
- Focused tests: 3 files, 10 PASS, 0 FAIL, 0 SKIP; verification decisions, discovery parity, and discovery-cache unit gates.
- Isolated PostgreSQL: authoritative CF-403 13/13 PASS; final cache probe 4/4 PASS; the browser/performance database is task-owned and is dropped after this closure run.
- Browser/accessibility: CF-405 light 32/32 PASS and dark 32/32 PASS; 320/375/768/1280, applied theme, 200% zoom, keyboard/focus, reduced motion, overflow, EN/VI, revoked/expired race, and axe serious/critical 0. CF-406 final repeatability **6/6 PASS** on one production server with no restart between rounds, 100 Home + 100 Search samples per run, 0% errors.
- Performance/cache/recall: final desktop Home/Search p95 rounds **1,755.2/1,186.8**, **1,893.9/1,671.0**, **1,759.1/1,236.4 ms**; final mobile **1,350.1/996.0**, **1,761.7/1,348.0**, **1,313.2/1,155.5 ms**; dataset 1,002 jobs, concurrency 10; warm hit 20/20 (100%); zero public repository calls on true hit; exact/normalized and broad recall 100%, zero-result PASS. Earlier failure outcomes are consolidated and documented in `docs/audits/candidate-first/phase-4/evidence/cf406-repeatability.json`.
- Production build/typecheck/lint/format/Prisma/diff-check: isolated current-source production build PASS (116/116 pages); root worktree build was not forced because user-owned PID 32700 holds `web/.local/next-output.lock` and port `3001`; it was not stopped; affected static gates and diff check PASS.
- Cleanup: task-owned production server, isolated database, temporary build workspace, launcher/logs, and temporary helper scripts are removed after verification; shared `smarthire` remains untouched.
- Acceptance criteria: PASS for CF-403, CF-405, CF-406 and the requested integrated Phase 4 gate; Phase 5 remains frozen.
- Work-item status: CF-403 VERIFIED; CF-405 VERIFIED; CF-406 VERIFIED; Phase 4 gate VERIFIED.

## 17. Recommended execution command for Luna Max

Use this plan as the authoritative scope for a single root Luna Max task:

> Implement Candidate-first Phases 4–5 exactly as defined in `docs/audits/candidate-first/phase-4/plan.md`. Work as the sole root GPT-5.6 Luna Max agent; do not call or request SubAgents. Execute CF-401 → CF-406 sequentially, pass and record the integrated Phase 4 gate, then execute CF-501 → CF-503 sequentially and rerun the final integrated gate. Repository evidence overrides stale assumptions. Preserve existing work and Phase 1–3 invariants. Make the smallest source-aligned change per slice, test all listed success/failure/privacy/invalidation/browser/corpus criteria, use only isolated test/spec/e2e databases for writes, clean task-owned resources, and never commit, push, deploy, reset, clean, mutate shared `smarthire`, or stop user-owned services without explicit authorization. Report PASS/FAIL/UNVERIFIED precisely; do not stop at a plan, checkpoint, or focused green test while required work remains.
