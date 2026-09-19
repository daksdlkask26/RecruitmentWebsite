# Candidate-first Phase 5 Plan: Transparent and Evidence-backed Candidate Match

**Version:** 1.0  
**Prepared:** 17 September 2026  
**Scope:** CF-501 through CF-503, then the integrated Phase 5 and final Phase 4–5 gate  
**Starting point:** commit `583171bf8cdb3cc76fea4a6ce818e89208a99dfb` on branch `audit_improvement`, with a dirty working tree containing preserved partial Phase 5 source  
**Dependency:** Candidate-first Phase 4 is `DONE / VERIFIED`  
**Current status:** `DONE / VERIFIED` — CF-501, CF-502, CF-503, and the final Phase 4–5 gate have current executable evidence. The accepted historical discovery-baseline limitation and the unrelated full-scoring baseline failure remain explicitly recorded.

## 1. Purpose

Phase 5 shall make every Candidate-facing Match result honest, traceable, private, and testable. A Candidate may see a numeric value only when it comes from an allowed real input and a result whose source, immutable versions, completeness, and evidence can be explained. Missing or unreliable input must never be disguised as a confident score.

The target journey is:

`Profile or confirmed CV → Candidate-visible Job/JD snapshot → deterministic evidence → optional AI guidance → Candidate-owned report`

Phase 5 contains three sequential work items:

1. **CF-501:** establish the evidence, provenance, completeness, ownership, and private-domain contracts;
2. **CF-502:** make Home and private Match UI render only permitted actual results with honest incomplete/unavailable states;
3. **CF-503:** prove deterministic quality with a labelled, synthetic, PII-free EN/VI corpus and close the final integrated gate.

This phase does not create a new recommendation engine, scoring architecture, parser platform, AI provider, or recruiter ranking system. It closes observable gaps in the existing private CV Match, Profile estimate, Home, deterministic scoring, and Candidate-only presentation boundaries.

The server remains authoritative for Candidate identity, private-result ownership, input source, CV/JD versions, parser state, evidence, score eligibility, retry, deletion, expiry, and application availability. The browser may present these facts but must not infer or manufacture them.

## 2. Normative language and evidence states

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** define implementation requirements:

- **MUST / MUST NOT:** required for the applicable work item and final gate.
- **SHOULD:** expected unless current repository evidence proves a smaller or safer alternative.
- **MAY:** optional and must not broaden Phase 5, weaken an invariant, or introduce speculative infrastructure.

Completion states are strict:

- **NOT_STARTED:** no Phase 5 implementation has been accepted for the work item.
- **IMPLEMENTED:** source or configuration changed, but all required executable evidence is not available.
- **VERIFIED:** every required acceptance criterion has current executable evidence.
- **UNVERIFIED:** evidence is absent, stale, interrupted, inferred only from source, or belongs to an older working-tree state.
- **BLOCKED:** a precise external or environmental blocker remains after reasonable safe attempts.

Focused tests, source inspection, typecheck, lint, build, integration, browser, accessibility, corpus, security, and performance are separate evidence classes. One class must not be relabelled as another.

No work item or phase may be reported as `DONE` while an in-scope required criterion is `FAIL` or `UNVERIFIED`. An explicitly accepted historical limitation or an outside-path baseline exception is not an in-scope Phase 5 criterion; it must remain visibly classified as `UNVERIFIED` or `FAIL`, include current unaffected-path evidence, and must never be relabelled as a passing test.

## 3. Execution rules for Luna Max

This plan is written for one root **GPT-5.6 Luna with Max reasoning** task.

Luna Max MUST:

1. Work directly as the sole investigator, implementer, verifier, and completion owner.
2. **Not call, spawn, request, suggest, or wait for any SubAgent, Antigravity, reviewer, scout, Terra, Sol, Astra, or another model.**
3. Execute `entry gate → CF-501 → CF-502 → CF-503 → integrated gate` in that order.
4. Finish one vertical slice from source through evidence and cleanup before starting the next.
5. Inspect the current source before editing; repository evidence overrides assumptions in this plan.
6. Reuse the existing private CV Match domain, scoring engine, Profile estimate, Home contracts, EN/VI catalogs, components, and `--sh-*` design tokens.
7. Preserve unrelated dirty work and adapt to existing changes instead of reverting them.
8. Use isolated PostgreSQL databases whose names contain `test`, `spec`, or `e2e` for every write-capable check.
9. Never mutate the shared `smarthire` database, stop a user-owned process, remove an unowned lock, or delete an uncertain artifact.
10. Never reset, clean, commit, push, deploy, weaken an assertion, lower a threshold, reduce the corpus, add `skip`/`only`, or change expected output merely to obtain green tests.
11. Keep failed and interrupted evidence visible until a stronger current rerun supersedes it; do not silently delete or relabel it.
12. Continue through the final integrated gate while safe in-scope work remains. A passing focused suite is not a stopping condition.

If work must stop because of an external blocker, Luna Max must report the exact blocker, completed slice, current diff, test totals, task-owned resources, and next executable command. It must use `PARTIAL`, `UNVERIFIED`, or `BLOCKED`, never `DONE`.

After two materially different safe attempts fail for the same unresolved cause, Luna Max must stop repeating the same approach, identify whether the cause is product, test, harness, environment, baseline, or plan assumption, and change strategy before editing again.

## 4. Current repository baseline

### 4.1 Dependency state

- Phase 4 is `DONE / VERIFIED`; CF-401 through CF-406 and the Phase 4 integrated gate are green on current recorded evidence.
- CF-105 human-only consequential decisions and CF-106 deterministic experience-union behavior are verified dependencies and must remain green.
- Phase 5 has not passed any integrated gate. Existing source and artifacts are inputs to this plan, not completion proof.

### 4.2 Existing capabilities to preserve

| Area                    | Current source capability                                                                                                                                                 | Phase 5 responsibility                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Private check ownership | Repository/service reads, retries, revokes, and lists by Candidate ownership with neutral denial                                                                          | Preserve and prove read/delete/retry/list isolation, including concurrent and expired/revoked cases                                     |
| Immutable lineage       | Private checks store Candidate CV and JD snapshots, versions, scoring configuration, immutable attempts, deterministic results, optional AI results, and bounded evidence | Reject missing, mismatched, stale, or invalid lineage instead of filling authoritative fields with plausible defaults                   |
| Deterministic fallback  | AI timeout can publish a limited deterministic report without inventing a hybrid result                                                                                   | Distinguish AI availability from input completeness and numeric-score eligibility                                                       |
| Home Match              | Home can compose Profile estimates and Candidate-owned private CV Match scores                                                                                            | Preserve request-private ownership and show a number only when the source is actual and eligible                                        |
| Private report          | Existing report renders score composition, requirements, gaps, evidence, source CV/JD, retry, Apply, delete, and guidance copy                                            | Make completeness prominent, remove decision-like semantics, and hide numbers when source evidence is not eligible                      |
| Human authority         | Scores are advisory and existing tests prevent score-driven stage changes                                                                                                 | Preserve across Application, Team Application, invitation, membership, ranking, and recruiter surfaces                                  |
| Retention/deletion      | Private checks have expiry/revocation cleanup; company deletion removes Job-scoped checks transactionally                                                                 | Keep lifecycle behavior behind a private-owned boundary without leaking private terms or results to employer modules                    |
| Corpus                  | A synthetic EN/VI fixture, evaluator, contract test, and retained report already exist                                                                                    | Audit the labels and evaluator, correct metric weaknesses, rerun on final source, and do not treat the retained report as current proof |

### 4.3 Partial source currently present

The dirty working tree already contains partial Phase 5-oriented changes:

- `inputSource: "CV"` and `completeness` fields in the private response contract and projection;
- Home source/completeness fields and removal of the fixed illustrative numeric panel;
- Candidate-private company-deletion cleanup behind `backend/private-data/company-deletion.ts`;
- incomplete/source notices in private Match UI;
- a 32-case, 16-pair synthetic corpus and evaluator;
- a retained corpus artifact reporting green metrics.

These changes MUST be reviewed, completed, corrected, or removed based on current behavior. Their presence does not make CF-501, CF-502, or CF-503 implemented or verified.

### 4.4 Current focused executable baseline

On 17 September 2026, the following no-database focused bundle was rerun against the current working tree:

- private Match shared/backend/frontend/security suites;
- private Match architecture boundary;
- Home Smart Match, Home model, and Trending Jobs focused tests;
- Phase 5 corpus contract test.

Result: **16 files, 52 PASS, 0 FAIL, 0 SKIP**.

This proves only the collected focused behavior. It does not prove PostgreSQL lifecycle behavior, production browser behavior, complete UI states, corpus metrics on final source, final privacy across all transports, or the integrated Phase 4–5 gate.

The retained `phase-5/evidence/cf503-private-match-corpus.json` was generated before this plan and is historical input. It must not be called a current final rerun.

### 4.5 Known gaps that this plan must close

1. Private projection currently permits bounded fallback labels and defaults when snapshot fields are absent. Required lineage must fail closed; a placeholder such as `CV`, `Selected job`, a default parser state, or a check timestamp must not make evidence look authoritative.
2. Completeness is currently derived mainly from CV parse state and `mayBeIncomplete`. It must also account for JD/parser state, required criteria, evidence availability, lineage consistency, and score eligibility.
3. `AVAILABLE`, `INCOMPLETE`, `UNAVAILABLE`, processing state, and AI limited mode are not yet one explicit presentation contract.
4. Home and report UI can still render numeric content for incomplete data. Phase 5 must use one conservative score-display rule.
5. Some high/medium/low and red/green presentation can be read as a hiring conclusion rather than document-fit guidance.
6. Profile estimates and private CV checks are different result types; current source labels them, but contract and tests must ensure they never imply equal evidence strength.
7. The retained corpus evaluator averages per-case precision/recall rather than deriving final metrics from an aggregate confusion matrix.
8. Evidence-anchor validation checks expected anchors but does not prove that every published quote and location belongs to immutable allowed input. Empty expected-anchor sets can pass vacuously.
9. Format labels must not be reported as real PDF/DOCX extraction evidence unless the production extraction boundary actually ran. The evaluator must state whether it measures extracted representations or binary document ingestion.
10. Existing corpus evidence is not a final-source rerun and cannot close CF-503 by itself.
11. Phase 5 changes touch Home; the relevant Phase 4 browser, cache, recall, privacy, and performance gates must remain green afterward.

## 5. Scope boundaries

### 5.1 Included

- CF-501, CF-502, CF-503, and the final Phase 4–5 gate.
- Candidate Profile-based estimates where rendered as Match guidance.
- Candidate-owned private CV Match create/read/list/retry/delete and immutable report projection.
- CV/JD source and version semantics, parser completeness, score eligibility, evidence anchors, and optional AI guidance labeling.
- Home Smart Match and Candidate Trending Jobs only where they present actual Profile/CV results.
- Private Match setup, processing, ready, limited, failed, report, retry, delete, and Apply journeys.
- Company/Job deletion integration only where needed to preserve private-check lifecycle isolation.
- EN/VI, light/dark, 320/375/768/1280 CSS pixels, 200% zoom, keyboard, focus, screen-reader semantics, reduced motion, non-color meaning, overflow, loading, empty, error, retry, expired, revoked, and stale-navigation states.
- Unit, contract, security, architecture, isolated PostgreSQL integration, deterministic corpus, production browser, accessibility, build, and affected Phase 4 regression evidence.

### 5.2 Excluded

- A new AI provider, prompt platform, embedding pipeline, vector database, search engine, recommendation engine, scoring engine, parser/OCR platform, queue, or global client store.
- Recruiter ranking, Candidate comparison, automatic shortlist/reject, stage change, application decision, invitation, or membership based on a score.
- Employer, Recruiter, Owner, or Admin access to Candidate private Match results.
- A redesign of Applications, Team Applications, Admin, Recruiter Workspace, CV Import, or public discovery outside a proven Phase 5 dependency/regression.
- Phase 6 notifications, messaging, or realtime work.
- A schema migration unless a failing acceptance criterion proves current persistence cannot represent the required contract. Any migration requires an expand-only design, rollback order, isolated migration proof, and explicit justification before implementation.
- Live-provider AI as a deterministic quality gate. A credentialed compatibility smoke may be optional and separately labelled.

## 6. Non-negotiable invariants

1. A numeric score is presentation, not authority. It must not mutate recruitment state or reorder an employer/recruiter decision surface.
2. Candidate private Match results remain Candidate-owned and must not appear in employer/recruiter/Admin APIs, exports, logs, searches, lists, caches, or UI.
3. Profile estimates and CV checks remain distinct. A Profile estimate must not claim CV evidence, pages, quotes, or a private check.
4. A CV result must bind to the exact confirmed Candidate CV version and immutable JD version used by the attempt.
5. Missing or mismatched lineage fails closed. The system must not substitute the latest mutable Profile, CV, Job, or JD.
6. Deterministic evidence must trace to allowed immutable input. AI prose is guidance, not source proof.
7. Preferred skills remain optional and must not be rendered or scored as required rejection criteria.
8. `LIMITED_REPORT` means AI guidance is unavailable; it does not by itself mean source input is incomplete.
9. Incomplete or unavailable input must not display a numeric score. An AI-limited report may display its deterministic number only when deterministic input completeness is `AVAILABLE`.
10. Retry creates or resumes an immutable attempt and must not mutate historical evidence or change the bound CV/JD versions.
11. Cross-account, expired, revoked, deleted, unknown, and unauthorized access use the same neutral content-free denial contract.
12. Logs, diagnostics, and artifacts must not contain CV text, evidence quotes from real users, PII, credentials, storage locators, or provider secrets.
13. Public Home caching must never contain Candidate identity, Profile signals, private check IDs, private scores, saved/applied state, or CSRF data.
14. Phase 4 discovery visibility, cache invalidation, search recall, responsive behavior, and performance budgets remain intact.

## 7. Authoritative presentation contract

Phase 5 uses two independent dimensions instead of overloading one status.

### 7.1 Input source

- **PROFILE:** a server-computed estimate using only explicitly allowed Profile signals. It must be labelled `estimate` and list the signal categories used. It has no CV quote/page evidence.
- **CV:** a Candidate-owned private check bound to an immutable confirmed CV version and immutable JD version. Evidence may be shown only from those snapshots.

The private CV Match API may remain CV-specific. Do not force Profile estimates into the private CV persistence model. Home may use a small discriminated presentation contract that keeps the two sources separate.

### 7.2 Score presentation state

- **AVAILABLE:** lineage is valid; required input parsing and deterministic criteria are sufficient; every displayed evidence item is allowed and traceable. A numeric estimate/score may be displayed with source and advisory context.
- **INCOMPLETE:** an actual result exists, but CV/JD parsing, required criteria, evidence, or lineage completeness is partial or ambiguous. Show the warning and limitations before guidance; do not display a numeric score.
- **UNAVAILABLE:** no valid actual result can be projected because source, parsing, lineage, authorization, or required evidence failed. Show no numeric score, score ring, band, contribution, or synthetic breakdown.

Processing states such as `QUEUED`, `ANALYZING`, `FAILED`, `READY`, and `LIMITED` remain separate from score presentation state.

### 7.3 Evidence and guidance

- Published deterministic evidence requires a criterion ID/version, bounded quote, valid section/page or structured location, confidence metadata, and an exact trace to the allowed immutable CV/JD input.
- Missing required evidence makes the presentation `INCOMPLETE` or `UNAVAILABLE` according to the existing parser/result contract.
- AI summary, strengths, gaps, and actions must be labelled guidance. They cannot repair missing deterministic source evidence or change score eligibility.
- Evidence confidence and coverage must not silently become score contributions unless already part of the approved deterministic scoring contract.

## 8. Dependency order and hard gates

| Order | Slice                       | Entry condition                                 | Exit condition                                                                     |
| ----: | --------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
|     0 | Phase 5 entry gate          | Phase 4 gate recorded as verified               | Current baseline, affected ownership, and resource safety recorded                 |
|     1 | CF-501 contract and privacy | Entry gate passes                               | Contract, projection, ownership, lifecycle, and isolated integration evidence pass |
|     2 | CF-502 Candidate UI         | CF-501 response/presentation contract is stable | Home/private UI, EN/VI, browser, privacy, and accessibility evidence pass          |
|     3 | CF-503 corpus               | CF-501/502 are implemented                      | Corrected deterministic evaluator and all corpus tolerances pass                   |
|     4 | Final integrated gate       | CF-501/502/503 are verified                     | Phase 4 remains green and all final gates/cleanup pass                             |

No later slice may be used to excuse a FAIL or UNVERIFIED criterion in an earlier slice.

## 9. Entry gate — current-state and safety proof

Before Phase 5 source changes, Luna Max must:

1. Read this plan, the Phase 4 integrated gate, Candidate-first index, roadmap, and current Git diff.
2. Confirm the exact Phase 5 partial files already in the dirty working tree and preserve unrelated work.
3. Map each affected route/component/service/repository/test through current source or CodeGraph.
4. Re-run the focused private Match/Home baseline and record exact PASS/FAIL/SKIP totals.
5. Classify existing broader failures as owned, caused, pre-existing unaffected, or environmental; do not rely on old classifications without checking affected paths.
6. Verify shared `smarthire` will not be used for writes and choose a namespaced isolated database for later integration/browser work.
7. Inspect process/port/lock ownership. Do not stop PID 32700 or remove its lock unless the user separately authorizes it.
8. Record the Phase 4 evidence that must be rerun because Home/private overlay source is affected.

The entry gate changes no product behavior and produces no PASS claim for CF-501–503.

## 10. CF-501 — Evidence, provenance, completeness, and private boundary

### 10.1 Required implementation

1. **Contract audit and smallest correction**
   - Keep the private API CV-specific unless current source proves a shared response is necessary.
   - Make input source, presentation state, immutable versions, parser status, scoring configuration, evidence, and guidance semantics explicit.
   - Avoid adding persistence for a derived presentation state unless an executable requirement proves it must be durable.

2. **Strict immutable lineage**
   - Validate stored CV and JD snapshots through bounded schemas before projection.
   - Require check CV/JD IDs and versions to agree with snapshot and attempt pointers.
   - Require deterministic and AI components to belong to the same allowed attempt lineage.
   - Do not fill missing authoritative values with current mutable data or plausible defaults.
   - A missing or invalid snapshot, version, parse state, or required result must derive `INCOMPLETE`/`UNAVAILABLE` and suppress the number.

3. **Completeness and eligibility**
   - Derive completeness from the union of CV parse state, JD parse state, parser provenance, required criteria availability, deterministic `mayBeIncomplete`, evidence requirements, and lineage consistency.
   - Keep AI timeout separate: a complete deterministic input with unavailable AI may remain `AVAILABLE` as a limited deterministic report.
   - Use one server-authoritative eligibility value or deterministic derivation across Home, ready screen, report, and list projections.

4. **Evidence integrity**
   - Project only bounded evidence whose quote and location trace to allowed immutable input.
   - Remove or fail closed on evidence that cannot be traced.
   - Preserve required/preferred kind and experience semantics.
   - Keep AI prose outside deterministic evidence arrays.

5. **Profile estimate separation**
   - Project only the allowed Profile signals actually used.
   - Label the result as an estimate and expose no CV version, quote, page, parser, or private-check implication.
   - If allowed Profile inputs are insufficient, derive `INCOMPLETE`/`UNAVAILABLE` and suppress the number.

6. **Ownership and authorization**
   - Prove create/read/list/retry/delete are scoped to the authenticated Candidate.
   - Cross-account, unknown, expired, revoked, and deleted IDs must remain indistinguishable.
   - No private fields may enter employer/recruiter/Admin relations, DTOs, routes, search results, exports, or logs.

7. **Private lifecycle boundary**
   - Keep company/job deletion cleanup behind a narrow private-owned function/port invoked inside the existing transaction.
   - Employer/job services may request generic Candidate-private cleanup but must not query private tables, name private Match concepts, or inspect results.
   - Preserve existing legal-hold, manifest, rollback, retry, and company deletion semantics.

8. **Logging and error projection**
   - Log only bounded IDs/codes and operational states.
   - Do not log CV/JD text, evidence quotes, Profile signals, provider prompts/responses, storage locators, or cross-account existence.

### 10.2 CF-501 acceptance criteria

- PROFILE and CV sources are explicit and cannot be confused in any Candidate response.
- Every numeric CV result binds to the exact immutable CV/JD/configuration lineage.
- Missing, stale, mismatched, partial, or failed lineage never produces a confident number.
- Every published deterministic evidence item traces to allowed immutable input.
- Required/preferred skills and required/detected experience remain semantically correct.
- AI guidance is visibly and structurally separate from deterministic proof.
- Candidate ownership and neutral denial pass for read/list/retry/delete and concurrent retry.
- Employer, Recruiter, Owner, and Admin surfaces contain no private result or discovery term.
- Company deletion preserves identical transactional cleanup and retention behavior through the private boundary.
- CF-105 and CF-106 regressions remain green.

### 10.3 Required CF-501 evidence

- Strict contract tests for PROFILE/CV and AVAILABLE/INCOMPLETE/UNAVAILABLE presentation.
- Projection tests for complete, partial CV, partial JD, failed parse, missing criteria, missing evidence, invalid snapshot, mismatched versions, stale pointers, AI timeout, active retry, and expired retry lease.
- Evidence trace tests that reject invented/out-of-snapshot quotes and invalid locations.
- Ownership/security tests for cross-account read/list/retry/delete and neutral denial.
- Architecture scans for employer/recruiter/Admin leakage.
- Isolated PostgreSQL integration for immutable lineage, retry, expiry/revocation, and company deletion rollback/success.
- Content-free log assertions.

CF-501 may be marked `VERIFIED` only after all of these evidence classes pass on the same final source state.

## 11. CF-502 — Candidate Match UI using actual evidence only

### 11.1 Required implementation

1. Remove every Candidate-facing fabricated numeric score, score ring, band, composition, strength, or gap from production source.
2. For Guest, Employer, Candidate without sufficient Profile signals, Candidate without a valid private result, and `UNAVAILABLE`, render a non-numeric explanation and an authorized CTA.
3. For a Profile estimate in `AVAILABLE`, show the numeric estimate, `Profile estimate` source wording, allowed signal categories, limitations, advisory meaning, and no CV evidence implication.
4. For a CV result in `AVAILABLE`, show the actual score, exact CV/JD source/version context, completeness, nearby evidence/limitations access, Candidate-only immutable report link, and guidance-not-decision meaning in EN/VI.
5. For `INCOMPLETE`, display the warning before guidance and suppress all numeric score, band, ring, and contribution UI.
6. For `UNAVAILABLE`, render no numeric artifacts and provide a safe retry/review/return action based on authoritative state.
7. For AI `LIMITED_REPORT` with complete deterministic input, label the deterministic result and AI unavailability separately. Do not imply a hybrid score exists.
8. Replace hire/reject-like red/green semantics with neutral information/caution/error semantics. Color must never be the only meaning.
9. Keep required and preferred skills textually and semantically distinct; a missing preferred skill must not look like a rejection criterion.
10. Preserve owner-scoped report navigation, retry, delete, Apply CTA, expired/revoked handling, and Back/Forward/direct-link behavior.
11. Reuse existing components and tokens. Do not add a second Match visualization system or UI framework.
12. Respect reduced motion and avoid score-transition animation when reduced motion is enabled.

### 11.2 Required UI states

The matrix must cover at least:

- Guest and Employer non-numeric explanations;
- Candidate with no result or insufficient Profile signals;
- available Profile estimate;
- available CV full report;
- available deterministic limited report with AI unavailable;
- incomplete CV, incomplete JD, missing criteria/evidence, and unavailable/failed parse;
- queued, analyzing, retrying, retry failure, expired, revoked, and deleted states;
- evidence-empty and long EN/VI reports;
- direct link, refresh, Back/Forward, and second authenticated tab;
- cross-account neutral denial;
- closed/expired Job Apply state.

### 11.3 CF-502 acceptance criteria

- No Candidate production component renders a fabricated number.
- Numeric presentation appears only for `AVAILABLE` actual data.
- Every visible number has source, completeness, limitations, and advisory context.
- `INCOMPLETE` and `UNAVAILABLE` render no score ring, band, contribution, or numeric match.
- Profile estimates never imply CV evidence; CV results link only to their immutable owner-scoped report.
- No copy, icon, color, ordering, or badge states that the system made a hiring decision.
- Required/preferred and evidence/guidance semantics are clear in EN and VI.
- Light/dark, 320/375/768/1280, 200% zoom, keyboard, visible focus, reduced motion, overflow, and non-color meaning pass.
- Axe serious/critical violations equal `0` for the required matrix.
- Privacy checks prove no private response appears for another Candidate or any employer/recruiter/Admin actor.

### 11.4 Required CF-502 evidence

- Home component/model tests for every source/presentation state.
- Private ready/report/list/setup tests for full, limited, incomplete, unavailable, processing, failed, evidence-empty, expired, and long EN/VI states.
- A source guard rejecting known illustrative score literals and numeric illustrative Match output in Candidate production components.
- Production-build Playwright journey and accessibility matrix using isolated fixtures.
- Direct-link, refresh, Back/Forward, second-tab, cross-account, revoked, expired, and Apply navigation evidence.
- Machine-readable browser artifacts for light/dark and viewport coverage without PII.

## 12. CF-503 — Labelled EN/VI deterministic corpus and quality gate

### 12.1 Corpus requirements

1. Reuse the existing fixture structure; do not build a dataset platform.
2. Keep the corpus synthetic, source-controlled, deterministic, and PII-free.
3. Include at least 24 cases, EN and VI, and at least eight semantically equivalent pairs. The current 32 cases/16 pairs may be retained only after label review.
4. Cover structured CV/JD text, normalized flattened PDF representation, supported structured DOCX/document representation, experience range edge cases, skill aliases/punctuation, diacritics/no diacritics, negated/weak mentions, required/preferred/missing skills, partial/failed parse, missing criteria/evidence, and invalid lineage eligibility.
5. EN/VI pairs must be semantically equivalent, not merely English skill sentences under different locale headers.
6. Format labels must describe the production adapter input actually exercised. Do not claim binary PDF/DOCX ingestion unless the production extraction path ran.
7. Label expected union months, required/preferred matches, incomplete/unavailable state, allowed evidence anchors, and score eligibility.

### 12.2 Evaluator requirements

1. Execute the same production deterministic parser/matcher adapter used by private Match.
2. Do not copy scoring or parsing rules into the evaluator.
3. Compute aggregate TP/FP/FN and derive precision, recall, and F1 from the aggregate confusion matrix. Per-case averages may be reported separately but must not be the gate.
4. Verify evidence in both directions: every required labelled anchor appears, every published quote traces to allowed immutable input, no-evidence cases publish none, and locations are valid for the declared representation.
5. Compare equivalent pairs for experience months, matched required/preferred sets, presentation state, evidence semantics, and deterministic score.
6. Emit safe per-case diagnostics using fixture IDs and bounded labels only.
7. Generate canonical JSON and Markdown under `docs/audits/candidate-first/phase-5/evidence/`.
8. A live AI smoke is optional, opt-in, credential-safe, and not part of deterministic PASS.

### 12.3 Required tolerances

- Valid experience cases: `0` month absolute error per case.
- Equivalent experience pairs: `0` month difference.
- Equivalent deterministic scores: absolute difference `≤ 1.0` point.
- Equivalent required/preferred matched-skill sets: exact equality.
- Aggregate required-skill precision and recall: each `≥ 0.95`.
- Aggregate preferred-skill precision and recall: each `≥ 0.95`.
- Neither precision nor recall may fall below the captured pre-change baseline.
- Published deterministic evidence trace validity: `100%`.
- Incomplete/unavailable classification accuracy: `100%`.
- Score eligibility accuracy: `100%`.
- Numeric score shown for `INCOMPLETE` or `UNAVAILABLE`: `0` cases.
- Corpus contains no PII, credentials, real CV text, or real Candidate identifiers.

### 12.4 CF-503 acceptance criteria

- Fixture/schema/version tests pass.
- Every tolerance passes on final production adapter source.
- Machine-readable and human-readable reports agree.
- Failed cases return a non-zero exit code and safe diagnostic IDs.
- The retained pre-plan report is replaced by a current final-source rerun; it is not silently reused.
- Phase 5-affected deterministic scoring, private Match, CF-105, and CF-106 regressions remain green. Any unrelated
  pre-existing baseline failure must remain explicitly classified as `FAIL`, have current unaffected-path evidence, and
  satisfy the baseline-exception policy in section 2; it is never reported as a passing suite.

## 13. Final integrated Phase 5 and Phase 4–5 gate

The final gate may run only after CF-501, CF-502, and CF-503 are individually `VERIFIED`.

### 13.1 Mandatory final checks

1. **Phase 5 focused bundle:** contracts, backend service/repository/projection/worker/retention, frontend Home/private Match, security, architecture, and corpus contract.
2. **Isolated PostgreSQL integration:** immutable lineage, neutral denial, retry/concurrency/expiry/revocation, and company deletion success/rollback/legal-hold behavior.
3. **CF-105/CF-106 and scoring regression:** no automatic consequential action, fixed-clock experience union, approved score arithmetic, and lineage checks.
4. **Production browser/accessibility:** Home → Match → private report → Apply; all required actors/states; EN/VI, light/dark, 320/375/768/1280, 200% zoom, keyboard/focus, reduced motion, overflow, and axe serious/critical `0`.
5. **Phase 4 regression on final source:** Home public/private snapshot security, cache warm-hit and first-read invalidation, discovery visibility/recall, responsive journey, and desktop/mobile production performance under unchanged accepted thresholds.
6. **Static/production gates:** typecheck, affected ESLint/Prettier, Prisma validation, migration sequence, production build, `git diff --check`, and final diff self-review.

### 13.2 Final acceptance criteria

- CF-501, CF-502, and CF-503 are `VERIFIED` on one coherent final source state.
- Every numeric Candidate Match is actual, eligible, sourced, versioned, and traceable.
- `INCOMPLETE` and `UNAVAILABLE` never display a numeric score.
- Private Match remains Candidate-owned and absent from employer/recruiter/Admin surfaces.
- Scores remain advisory and cannot change stage, outcome, invitation, membership, or employer ranking.
- All deterministic corpus tolerances pass.
- Phase 4 remains green after Phase 5 Home changes.
- Production build, browser, accessibility, security, architecture, isolated database, static gates, and cleanup pass.
- No required test is skipped and no failure is hidden or reclassified without evidence.

## 14. Expected impact area

This is a routing map, not permission for broad edits. Luna Max must verify ownership before modifying a file.

### 14.1 Contracts and private domain

- `web/src/shared/contracts/private-cv-match/index.ts`
- `web/src/backend/private-cv-match/private-cv-match-service.ts`
- `web/src/backend/private-cv-match/private-match-projection.ts`
- `web/src/backend/private-cv-match/private-match-worker.ts`
- `web/src/backend/repositories/private-cv-match/prisma-private-cv-match-repository.ts`
- `web/src/backend/private-data/company-deletion.ts`
- the existing company deletion transaction owner

### 14.2 Home and Candidate UI

- `web/src/backend/services/home/get-home-page-context.ts`
- `web/src/frontend/features/home/home-page-model.ts`
- `web/src/frontend/features/home/home-display-data.ts`
- `web/src/frontend/features/home/home-copy.ts`
- `web/src/frontend/features/home/components/home-smart-match.tsx`
- `web/src/frontend/features/home/components/home-trending-jobs.tsx`
- `web/src/frontend/features/private-cv-match/components/*`
- `web/src/frontend/features/private-cv-match/i18n/private-match-copy.ts`
- existing Home/private Match styles and tokens

### 14.3 Scoring, corpus, tests, and evidence

- `web/src/backend/scoring-engine/scoring-engine-adapter.ts`
- deterministic scoring contracts/policies only if a proven gap requires correction
- `web/tests/fixtures/private-match/phase5-corpus.ts`
- `web/scripts/evaluate-phase5-corpus.ts`
- `web/tests/backend/private-cv-match/phase5-corpus.contract.test.ts`
- existing private Match, Home, scoring, Application authority, security, architecture, integration, browser, and accessibility suites
- `docs/audits/candidate-first/phase-5/evidence/`

Generated Prisma clients must not be hand-edited. A schema or generated-client change is allowed only after a justified migration decision.

## 15. Verification command classes

Luna Max must resolve exact commands from current package scripts and record exit codes and totals. Required command classes include:

- focused private Match/Home Vitest bundle;
- `npm run test:candidate-application-private-match`;
- `npm run test:scoring`;
- focused CF-105 authority and CF-106 experience-union tests;
- `npm run phase5:corpus:evaluate` with the canonical report path;
- isolated PostgreSQL integration using a namespaced test database;
- production Playwright Phase 5 and affected Phase 4 Home flows;
- `npm run test:home` and affected Phase 4 cache/recall/performance gates;
- `npm run typecheck`;
- affected ESLint and Prettier;
- `npm run db:validate`;
- `npm run db:migrations:check`;
- `npm run build` against current source without stopping a user-owned server;
- `git diff --check`.

Start focused, expand according to touched risk, and run every evidence class required by the final gate. Do not blindly run unrelated suites.

## 16. Evidence contract

Canonical Phase 5 evidence must use stable names under:

`docs/audits/candidate-first/phase-5/evidence/`

Expected artifacts:

- `cf501-contract-and-privacy.json` plus a concise Markdown summary;
- `cf502-browser-light.json` and `cf502-browser-dark.json` plus concise summaries;
- `cf503-private-match-corpus.json` and `.md`;
- `integrated-gate.md` at the Phase 5 root after final closure.

Executable artifacts must record source identity, command/configuration, environment, isolated database, counts, thresholds, metrics, limitations, earlier failures, and cleanup state as applicable.

Artifacts must not contain secrets, real CV/JD/Profile content, PII, storage locators, or provider payloads.

## 17. Cleanup and repository safety

After each write-capable or browser slice, Luna Max must:

1. Stop only the exact task-owned server/process tree.
2. Drop only the exact verified task-owned isolated database.
3. Remove only task-owned env files, launchers, logs, Playwright results, and temporary fixtures.
4. Preserve user-owned PID 32700, port 3001 state, and `web/.local/next-output.lock` unless separately authorized.
5. Verify shared `smarthire` was not mutated.
6. Preserve canonical evidence and delete only superseded task-owned temporary artifacts.
7. Report anything left behind and why.

## 18. Definition of Done

Phase 5 is `DONE / VERIFIED` only when all of the following are true:

- CF-501, CF-502, and CF-503 are individually `VERIFIED`.
- The final integrated Phase 5 and Phase 4–5 gate passes.
- Every Candidate-visible number is actual, allowed, sourced, versioned, complete, and traceable.
- Profile estimates and CV checks remain distinct.
- Missing/partial/failed/mismatched evidence is `INCOMPLETE` or `UNAVAILABLE` and displays no numeric score.
- No fabricated numeric score or synthetic contribution remains in Candidate production UI.
- Private results never reach another Candidate or employer/recruiter/Admin surface.
- Scores remain advisory and have no consequential mutation authority.
- Corpus thresholds pass on final source and evaluator semantics are correct.
- Phase 4 remains green after Home changes.
- Focused, integration, security, architecture, regression, corpus, browser, accessibility, production build, typecheck, lint/format, Prisma, migration sequence, and diff checks have current evidence with exact totals.
- No required test is skipped, weakened, or hidden.
- Unrelated baseline failures are recorded accurately and proven unaffected.
- Accepted historical limitations remain explicitly `UNVERIFIED` and do not become hidden blockers when the dependency's existing gate policy accepts them.
- Shared data is untouched and every task-owned resource is cleaned.
- No commit, push, deploy, reset, clean, or user-owned process stop occurs without separate authorization.

## 19. Status ledger

Luna Max must update this table only from current executable evidence:

| Work item            | Initial status                   | Required exit state | Current blocker at plan creation                                                     |
| -------------------- | -------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| Phase 5 entry gate   | NOT_STARTED                      | VERIFIED            | Current partial source and baseline must be reconciled                               |
| CF-501               | PARTIAL_SOURCE / UNVERIFIED      | VERIFIED            | Strict lineage, completeness, eligibility, privacy, and integration proof incomplete |
| CF-502               | PARTIAL_SOURCE / UNVERIFIED      | VERIFIED            | Incomplete/unavailable numeric suppression and full browser matrix incomplete        |
| CF-503               | HISTORICAL_EVIDENCE / UNVERIFIED | VERIFIED            | Evaluator semantics and final-source rerun incomplete                                |
| Final Phase 4–5 gate | NOT_STARTED                      | VERIFIED            | Depends on CF-501–503 and Phase 4 regression rerun                                   |

Partial source or a green historical corpus artifact must not be promoted to `VERIFIED`.

### Current closure status — 2026-09-18

The initial-status table above is retained for traceability. The following replaces the stale ledger with current executable evidence:

| Work item            | Current status    | Evidence boundary                                                                                                                                                                                                                                                                                                    |
| -------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 5 entry gate   | `PASS / VERIFIED` | Phase 4 dependency is `DONE / VERIFIED`; CF-501, CF-502, and CF-503 each pass their own required current evidence.                                                                                                                                                                                                   |
| CF-501               | `VERIFIED`        | Final-source contract/projection bundle 6 files/30 tests, private UI 3/12, private regression 14/44, Home 39/104, CF-105 11/46, CF-106 3/25, isolated PostgreSQL 1/8, content-free logs, migration 97/97, and isolated DB absence all pass.                                                                          |
| CF-502               | `VERIFIED`        | Real production build/start matrix: light 16/16 and dark 16/16; each theme has 27 states x 4 viewport rows = 108 machine rows, serious/critical axe 0, 200% CSS reflow, reduced motion, keyboard/focus, overflow, EN/VI, privacy and no route mocks.                                                                 |
| CF-503               | `VERIFIED`        | Final evaluator and contract test pass on 34 cases/17 equivalent pairs; required TP/FP/FN/support = 38/0/0/38, preferred = 2/0/0/2, required/preferred precision/recall/F1 = 1/1/1, pair deterministic difference = 0, and the pre-change baseline is separately reconstructed and validated by the final evaluator. |
| Final Phase 4-5 gate | `PASS / VERIFIED` | CF-406 final-source repeatability is 6/6 with unchanged thresholds; discovery baseline is an accepted historical `UNVERIFIED` limitation; the untouched full scoring failure is an allowed outside-path baseline exception with unaffected-path proof.                                                               |

Therefore Phase 5 is reported as `DONE / VERIFIED` under the documented Phase 4 baseline-exception policy. The full scoring suite remains explicitly `FAIL` outside Phase 5, and the discovery-recall before/after comparison remains explicitly `UNVERIFIED`; neither result is hidden or reclassified.

## 20. Required final report

The implementation report must contain:

1. Final verdict: `DONE / VERIFIED`, `PARTIAL`, `FAIL`, or `BLOCKED`.
2. Root causes resolved and before/after behavior.
3. Important changed files grouped by CF-501, CF-502, and CF-503.
4. Acceptance criteria classified as PASS/FAIL/UNVERIFIED.
5. Focused, integration, security, corpus, browser, accessibility, Phase 4 regression, build, and static evidence with exact PASS/FAIL/SKIP totals.
6. Corpus metrics and thresholds.
7. Unrelated baseline failures and why they do not belong to Phase 5.
8. Remaining limitations or blockers without optimistic relabelling.
9. Database, server, port, lock, env, fixture, and artifact cleanup state.
10. Confirmation that no commit, push, deploy, reset, clean, shared-database mutation, or user-owned process stop occurred.

## 21. Luna Max execution instruction

> Implement Candidate-first Phase 5 exactly as defined in `docs/audits/candidate-first/phase-5/plan.md`. Work directly as the sole root GPT-5.6 Luna Max agent and do not call or request SubAgents or another model. Reconcile the current partial working-tree source first, then execute the entry gate, CF-501, CF-502, CF-503, and the final integrated gate sequentially. Complete each slice from root cause through source, focused tests, risk-appropriate integration/browser evidence, self-review, and task-owned cleanup before proceeding. Repository evidence overrides stale assumptions. Preserve Phase 1–4 invariants, unrelated dirty work, Candidate privacy, immutable lineage, human decision authority, and shared-database safety. Never weaken tests, reduce corpus or thresholds, use historical evidence as a current rerun, stop a user-owned service, mutate `smarthire`, commit, push, deploy, reset, or clean. Do not report `DONE` while any required criterion is FAIL or UNVERIFIED; if interrupted, report a precise resumable checkpoint and continue when the environment permits.
