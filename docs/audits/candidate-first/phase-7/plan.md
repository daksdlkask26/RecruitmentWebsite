# Candidate-first Phase 7 Plan: Candidate UI and Accessibility Consolidation

**Version:** 1.0  
**Prepared:** 20 September 2026  
**Scope:** CF-701 through CF-705, then the integrated Phase 7 gate  
**Starting point:** commit `ac17ec1efb70` on branch `audit_improvement`; Candidate-first Phase 6A is recorded as `DONE / VERIFIED`, and its uncommitted working-tree changes must be preserved  
**Dependency:** CF-201 through CF-604 are the functional foundations for this UI consolidation; CF-651 through CF-653 are conditional multi-instance work and are not a Phase 7 dependency while the current topology remains single-instance  
**Current status:** `DONE / VERIFIED` — CF-701 through CF-705 and the integrated gate have current executable evidence on one identified final source; J1–J9 passed in 3/3 desktop/mobile/true-200%-page-scale profiles (27/27 final states), the public matrix passed 10/10 state checks on the same final build, the initial 16 stale affected-suite expectations were triaged, and the final affected command is `399/399` PASS

## 1. Purpose

Phase 7 shall consolidate the Candidate-facing experience built across Phases 2 through 6A without redesigning the product or changing established business behavior.

The phase focuses on five outcomes:

1. every Candidate journey has a clear source, component, style, copy, and test owner;
2. every page exposes the states that its real contract requires, including recovery states;
3. modal and overlay behavior is correct in the actual stacking and overflow context;
4. the Candidate journeys work across the required responsive, language, theme, motion, input, and accessibility conditions;
5. current browser evidence proves the integrated experience on the final source.

The target is a coherent and verifiable Candidate UI, not a visual rewrite. Existing routes, server contracts, authorization rules, durable state, URL behavior, and data boundaries remain authoritative.

## 2. Normative language and evidence states

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative:

- **MUST / MUST NOT:** required for Phase 7 acceptance.
- **SHOULD:** expected unless repository evidence supports a smaller or safer implementation.
- **MAY:** optional and must not broaden the phase or introduce speculative infrastructure.

Completion states are strict:

- `NOT_STARTED`: no Phase 7 implementation or current execution evidence exists.
- `IMPLEMENTED`: source changed, but one or more required evidence classes are missing.
- `VERIFIED`: all acceptance criteria have current executable evidence on the final source.
- `UNVERIFIED`: evidence is missing, stale, inspection-only, interrupted, or belongs to an older source state.
- `BLOCKED`: a precise environmental or external blocker remains after reasonable safe attempts.

Component tests, accessibility checks, browser journeys, screenshots, static checks, and build evidence are separate evidence classes. One class must not be reported as another.

## 3. Execution rules and anti-over-engineering constraints

1. Execute Phase 7 in dependency order: `CF-701 -> CF-702 -> CF-703 -> CF-704 -> CF-705`.
2. Use one root Luna Max agent. Do not create subagents unless the user explicitly requests them in the active task.
3. Preserve current Candidate routes, navigation, URL state, server-rendered inputs, API contracts, authorization, persistence, and domain state unless a failing Phase 7 criterion proves a change is necessary.
4. Use the existing semantic `--sh-*` tokens, typography, `.sh-page-header`, `.sh-button`, `.sh-input`, existing status primitives, and established feature components before adding new UI primitives.
5. Treat `web/src/frontend/styles/tokens.css` as the visual token source of truth. Do not introduce a parallel theme or a new token prefix.
6. Default to **Refine**: improve hierarchy, spacing, state clarity, responsive behavior, copy, and accessibility while retaining the established flow.
7. Do not rewrite a component or stylesheet because it is large or has many lines. Refactor only when ownership, testability, or a proven defect requires it.
8. Do not add a new component library, CSS framework, Storybook installation, animation framework, visual-regression SaaS, or design-token generator for this phase.
9. Do not create a generic modal framework merely because several dialogs exist. Extract a shared primitive only after at least two in-scope overlays require the same verified behavior and the extraction reduces risk.
10. Do not portal every overlay by default. Use a portal only when the browser reproduction proves clipping, stacking, containing-block, or overlay-root requirements.
11. Do not add API fields, backend state, database columns, migrations, or placeholder production data to make a UI state easier to render. Use current props/contracts; record genuinely missing product data as a follow-up.
12. Do not hardcode visible EN/VI copy inside components. Extend the existing copy source for the owning feature when a verified copy gap exists.
13. Do not hardcode new colors, white fallbacks, shadows, or spacing in feature CSS. Use semantic tokens that already support light and dark themes.
14. Do not add decorative motion. Motion must communicate state or interaction, use existing `--sh-motion-*` tokens, and have an equivalent reduced-motion state.
15. Do not execute a full Cartesian product of every locale, theme, viewport, input type, data state, and journey. Use the risk-based coverage model in this plan while ensuring every required dimension is exercised.
16. Do not expand the phase into Recruiter, Company Owner, or Admin redesign. If an in-scope shared component changes, run the smallest relevant cross-role regression.
17. Do not modify, regenerate, synchronize, or otherwise intervene in any SpecKit artifact, template, configuration, branch, checklist, plan, or task file.
18. Do not commit, push, deploy, reset, clean, or overwrite unrelated dirty work.

## 4. Current repository baseline

### 4.1 Program and dependency state

- Phase 2 established Candidate CV import and review foundations.
- Phase 3 established application submission, tracking, timeline, and pagination foundations.
- Phase 4 established Candidate discovery across Home, Jobs, Company, and Job Detail.
- Phase 5 established transparent Candidate Match presentation.
- Phase 6A established single-instance notification and general messaging reliability.
- Phase 6B remains conditional on a future multi-instance topology. It is not required for Phase 7 under the current single-instance boundary.

Phase 7 must preserve the functional and security contracts already verified by those phases. It may improve presentation and interaction, but it must not reinterpret prior domain behavior.

### 4.2 Candidate journey inventory boundary

CF-701 must validate and refine this initial route-family inventory against the final source:

| Journey                  | Representative routes                                                               | Primary current source families                       | Prior functional dependency |
| ------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------- |
| Home and entry discovery | `/`, `/home`                                                                        | `frontend/features/home`, shared workspace navigation | CF-401–CF-406               |
| Job discovery            | `/jobs`, `/jobs/saved`, `/jobs/settings`                                            | `frontend/features/jobs`                              | CF-404–CF-406               |
| Job detail and apply     | `/jobs/[slug]`, `/jobs/[slug]/apply`, `/jobs/[slug]/apply/review`                   | Jobs and Candidate Applications                       | CF-301–CF-305, CF-405       |
| Application history      | `/jobs/applied`, `/jobs/applied/[applicationId]`, processing, submitted, messages   | Candidate Applications and Jobs application views     | CF-301–CF-305               |
| Company discovery        | `/company`, `/company/[companyId]`, `/company/[companyId]/apply`                    | `frontend/features/candidate-company`                 | CF-404–CF-405               |
| CV import and review     | `/profile/cv-imports`, upload detail, review, receipt                               | `frontend/features/cv-import`                         | CF-201–CF-205               |
| Candidate profile        | `/profile` and Candidate profile subroutes that directly support the above journeys | `frontend/features/profile`                           | Existing profile contract   |
| Candidate Match          | `/cv-match-check`, `/jobs/matches`, new and result routes                           | Private CV Match and Jobs Match UI                    | CF-501–CF-503               |
| Notifications            | `/notifications` and the workspace notification disclosure                          | `frontend/features/notifications`                     | CF-603–CF-604               |
| General messaging        | `/messages`, eligible participant start, block/report dialogs                       | `frontend/features/messaging`                         | CF-601–CF-604               |

Connections, people, support, authentication, Recruiter, Company Owner, and Admin routes are not automatically full Phase 7 scope. They enter only when they are part of a required Candidate journey or are affected by a shared component change.

### 4.3 Existing UI foundations to preserve

| Foundation          | Current repository evidence                                                                                                           | Phase 7 use                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Semantic tokens     | `web/src/frontend/styles/tokens.css` defines `--sh-*` surfaces, text, status, spacing, radius, shadow, typography, and motion         | Consolidate feature CSS onto existing semantic meaning; do not create a second theme                         |
| Page hierarchy      | Shared `PageHeader` and workspace header patterns already have multiple callers                                                       | Reuse where the page is an application/workspace surface; do not force marketing pages into the same pattern |
| UI primitives       | Existing buttons, inputs, panels, status pills, timelines, steppers, and empty-state patterns are present                             | Reuse or make a small shared correction when the contract is genuinely common                                |
| Localization        | Candidate Applications, CV Import, Jobs, Company, Messaging, Notifications, Profile, and Home have established copy/locale mechanisms | Fix copy through the owning copy map; preserve live EN/VI switching                                          |
| Theme               | Semantic tokens support light/dark remapping                                                                                          | Verify both themes and remove only proven feature-level violations                                           |
| Accessibility tests | Focused Vitest accessibility suites and Candidate browser specifications already exist                                                | Extend the nearest existing suite; do not build a new accessibility framework                                |
| Browser tests       | Playwright journeys exist for Candidate-first, Home, CV Import, Phase 5, and Messaging                                                | Consolidate and extend only the missing final matrix                                                         |

### 4.4 Overlay baseline

The source currently contains Candidate-relevant dialog or overlay implementations in Jobs filters/search, quick view, application confirmation, image search, CV retention, Candidate Company status, and Messaging block/report flows.

This inventory proves that overlay behavior is distributed; it does **not** prove that every overlay is broken or requires a portal. CF-703 must reproduce each selected risk in its real ancestor layout before changing structure.

### 4.5 Current evidence boundary

- Prior phase tests and artifacts prove the historical functional slices stated by their own ledgers.
- This plan creation does not rerun Candidate UI, browser, accessibility, responsive, theme, zoom, or bundle checks.
- Existing focused tests must not be presented as Phase 7 browser evidence.
- Historical failures or exceptions remain historical until reproduced on the current final source.
- Phase 7 entered at `NOT_STARTED`; the final ledger below records the current `DONE / VERIFIED` result, while preserving the entry-state evidence and the historical findings that were resolved during closure.

## 5. Scope boundaries

### 5.1 Included

- CF-701 through CF-705 and the integrated Phase 7 gate.
- Candidate-facing pages and shared components needed by the journey inventory in section 4.2.
- Loading, empty, error, success, disabled, permission, stale, retry, and long-data presentation where the real page contract supports those states.
- Page hierarchy, CTA hierarchy, copy placement, content density, responsive layout, overflow, and touch target behavior.
- Modal, drawer, popover, quick-view, filter, confirmation, and blocking overlay behavior used by Candidate journeys.
- EN/VI, light/dark theme, keyboard-only navigation, focus visibility, screen-reader semantics, zoom 200%, reduced motion, and pointer/touch interaction.
- Existing test fixture and browser harness changes required to make the Phase 7 matrix deterministic.
- A minimal before/after bundle measurement for affected Candidate entry points.
- Stable evidence under `docs/audits/candidate-first/phase-7/evidence/` and final `integrated-gate.md` after execution.

### 5.2 Excluded

- Phase 6B and all Redis, multi-instance, distributed presence, adapter, or load-balancer work.
- Phase 8 platform readiness, CSRF redesign, backup/restore, worker leases, dependency upgrades, CI redesign, and observability platform work.
- Broad Recruiter, Company Owner, Admin, authentication, legal, or marketing redesign.
- Rebranding technical identifiers, CSS token prefixes, environment variables, storage keys, schema names, or historical SmartHire references.
- New product capabilities, navigation architecture, business rules, application stages, permissions, AI policies, or scoring behavior.
- New APIs, database fields, migrations, backfills, storage formats, or event contracts unless a separate approved scope is created.
- Replacing the existing localization mechanism.
- Replacing the existing CSS/component architecture wholesale.
- Pixel-perfect redesign for its own sake.
- Any SpecKit file or workflow.

## 6. Non-negotiable invariants

1. Candidate authorization remains server-authoritative and fail-closed.
2. UI changes must not expose private CVs, application snapshots, messages, notifications, or match evidence to another account or role.
3. Existing durable application, match, notification, and messaging states retain their established meaning.
4. URL search/filter/pagination state and browser back/forward recovery must not regress.
5. Server-rendered and client-hydrated state must remain consistent.
6. A status must never be communicated by color alone.
7. Loading and retry UI must not create duplicate mutations or bypass idempotency safeguards.
8. Disabled and read-only controls must remain semantically distinct and explain why an action is unavailable when the user needs that context.
9. EN and VI must use the same business meaning and available actions.
10. Long translations or user-provided values must wrap, truncate with an accessible full-value path, or reflow without hiding required actions.
11. Dark mode must retain equivalent hierarchy, state meaning, and contrast.
12. Keyboard focus must remain visible and follow a logical order.
13. Overlays must preserve accessible name, focus containment where modal, Escape behavior where safe, return focus, and scroll restoration.
14. Reduced motion must not remove information or interaction feedback.
15. Existing shared components must not be changed in a way that silently regresses Recruiter, Owner, or Admin callers.
16. Tests must not be skipped, weakened, or rewritten only to match a broken implementation.

## 7. Authoritative Phase 7 UX contracts

### 7.1 Page hierarchy contract

Application and workspace pages SHOULD use the established compact page-header hierarchy:

1. optional eyebrow/context;
2. one descriptive `h1`;
3. short supporting copy where needed;
4. one clear primary action, with secondary actions visually subordinate;
5. status positioned as information, not styled as an action.

Marketing/Home sections may retain their established composition. Phase 7 must not force every page into an identical layout.

### 7.2 State contract

Each route must document only the states that can occur under its actual data and permission contract.

| State                 | Required behavior                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| Initial loading       | Stable skeleton or progress semantics; no false empty state; no layout-blocking animation                |
| Incremental loading   | Existing content remains usable when safe; the loading control exposes progress text                     |
| Empty                 | Compact by default; guided only when there is a valid next action that can produce data                  |
| Filtered empty        | Explain that filters caused no result and provide a clear reset action                                   |
| Error                 | Explain the failed operation without leaking internal details; expose a safe retry or next step          |
| Stale/reconnecting    | Preserve usable durable content, label freshness honestly, and provide or trigger authoritative recovery |
| Success               | Confirm consequential completion without relying only on color or transient animation                    |
| Disabled/locked       | Use semantic disabled/read-only behavior and short reason copy when needed                               |
| Permission restricted | Use a neutral non-enumerating message and safe navigation; do not reveal hidden resource existence       |

An impossible state must not be added simply to complete a checklist.

### 7.3 Empty-state contract

- Use a compact left-aligned empty state for a small list, card, secondary panel, or a temporary lack of items.
- Use a guided empty state only when one or two valid actions lead to real data creation or discovery.
- Do not add a search box to an empty state unless the real feature supports free search.
- Do not repeat large centered empty states in multiple panels on the same page.

### 7.4 Localization and copy contract

Any copy gap identified during CF-701 or CF-702 must be recorded before implementation with this mapping:

| Copy key / owner     | Current EN source         | Current or required VI               | Role/context                | Action                                            |
| -------------------- | ------------------------- | ------------------------------------ | --------------------------- | ------------------------------------------------- |
| Existing feature key | Exact current source text | Exact current or proposed equivalent | Candidate journey and state | Reuse, revise, or add through the owning copy map |

Rules:

- Do not replace visible strings by searching English text across components.
- Do not create a second translation store for a feature that already owns a copy map.
- Date, number, salary, and relative-time formatting must follow the active locale.
- Copy for AI suggestions or scores must remain advisory and identify unavailable/incomplete evidence honestly.

### 7.5 Theme and token contract

- New or changed production styles must use existing semantic `--sh-*` tokens.
- Feature CSS must not add new literal colors, white fallbacks, shadow values, or unscoped global overrides.
- Token additions are allowed only when a real semantic role is missing across more than one in-scope use and existing tokens cannot express it.
- A token addition requires light/dark values, affected-component evidence, and a short reason in the CF-701 inventory.

### 7.6 Interaction and motion contract

- Hover cannot be the only discovery path for an action.
- Keyboard and touch users must receive equivalent actions and status.
- Animate `transform` or `opacity` where possible; avoid layout animation.
- Pulse, shimmer, hover lift, and transition effects must stop or become non-animated under `prefers-reduced-motion: reduce`.
- Removing motion must not remove progress, selection, presence, or completion meaning.

### 7.7 Modal and overlay contract

Every modal overlay in the CF-703 inventory must have:

1. an accessible name connected to its visible title;
2. modal semantics only when interaction outside is actually blocked;
3. initial focus on a safe useful element;
4. focus containment for modal content;
5. Escape close unless the operation is intentionally non-dismissible and documented;
6. focus returned to the invoking control after close;
7. background scroll locked and restored without page jump where required;
8. no clipping behind ancestor overflow, transforms, sticky headers, or mobile browser bounds;
9. a responsive layout with reachable actions at 320 px and 200% zoom;
10. reduced-motion-compatible open/close behavior.

Destructive confirmation must not put initial focus on the destructive action unless the existing safety contract explicitly requires it.

### 7.8 Data-density contract

- Long names, company names, job titles, locations, salaries, file names, and translated labels must not overlap controls or make actions unreachable.
- Large result sets must preserve the existing pagination/load-more/cursor contract. Phase 7 must not render 1,000 complex records at once merely to satisfy a scale fixture.
- The 1,000-record case verifies layout, count/status text, incremental navigation, and interaction stability using the real bounded list behavior.

## 8. Dependency order and hard gates

| Order | Work item | Entry requirement                                    | Exit requirement                                                           |
| ----- | --------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| 1     | CF-701    | Phase 6A closure and current working tree understood | Candidate inventory, ownership, baseline, and bounded change list accepted |
| 2     | CF-702    | CF-701 inventory complete                            | Required page states implemented and focused tests green                   |
| 3     | CF-703    | Relevant state/layout ownership known                | In-scope overlays verified in real browser contexts                        |
| 4     | CF-704    | Final UI structure stable                            | Accessibility/responsive matrix passes on final source                     |
| 5     | CF-705    | CF-701–CF-704 evidence current                       | Integrated browser evidence, regression, build, and cleanup accepted       |

Do not begin broad visual edits before CF-701 establishes ownership. Do not capture final screenshots before the source is stable. If a later slice changes an earlier verified surface, rerun the affected earlier gate.

## 9. Entry gate — baseline and safety proof

Before Phase 7 implementation:

1. record branch, commit, dirty working-tree paths, Node/npm versions, browser version, and test database name where applicable;
2. preserve all Phase 6A changes and any unrelated user work;
3. confirm the current deployment boundary is still single-instance or mark Phase 6B as a separate prerequisite if topology changed;
4. enumerate Candidate route families, shared layout/components, feature styles, copy owners, tests, and known historical evidence;
5. identify which journeys require database-backed fixtures and ensure both `DATABASE_URL` and `DIRECT_URL` target the same isolated database whose name contains `test`, `spec`, or `e2e`;
6. capture representative pre-change screenshots for only the surfaces planned to change;
7. capture a deterministic pre-change bundle/build size baseline for affected Candidate entry points using existing build output; do not add a bundle-analysis dependency unless current output cannot provide a repeatable measure;
8. classify current failures as implementation, fixture/setup, environment, historical baseline, or outside scope; keep them visible;
9. record the final bounded file/change list for CF-702 and CF-703.

The entry gate is `FAIL` if the implementation begins without a route/component owner or if the test environment could mutate a shared database.

## 10. CF-701 — Inventory and ownership cleanup

### 10.1 Problem

Candidate journeys were delivered across multiple phases and feature families. The repository has shared primitives and semantic tokens, but page hierarchy, state ownership, feature CSS, copy, and overlay behavior may be distributed or duplicated. A broad rewrite would create more risk than value without a source-grounded inventory.

### 10.2 Required work

1. Build a route-to-owner inventory for the journeys in section 4.2.
2. For every route family, record:
   - server page/layout/loading/error boundary;
   - primary client component;
   - shared component dependencies;
   - feature/global stylesheet owners;
   - EN/VI copy owner;
   - data/query owner;
   - focused tests and browser journeys;
   - required Phase 7 state coverage.
3. Identify duplicate selectors, cross-feature overrides, excessive specificity, hardcoded visual values, and global styles that obscure ownership.
4. Classify each finding as:
   - keep as-is;
   - local correction;
   - shared primitive correction;
   - test/fixture correction;
   - outside scope follow-up.
5. Remove or consolidate styles only when the final rendered behavior is covered and the old selector is proven unused or superseded.
6. Record the copy-key mapping described in section 7.4 for every copy change.
7. Measure affected bundle output before implementation.
8. Produce the smallest dependency-ordered change list for CF-702 and CF-703.

### 10.3 Structural review rules

| Concern               | Preferred location                                                                    | Do not do                                                       |
| --------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Route loading/error   | Existing route-level `loading.tsx` / `error.tsx` when the state belongs to navigation | Duplicate the same route error inside multiple child components |
| Feature state         | Owning feature component/hook                                                         | Move domain state into a generic UI primitive                   |
| Shared visual pattern | Existing shared UI/layout primitive after proven repeated use                         | Create a broad abstraction from one screen                      |
| Feature styling       | Owning CSS module or established feature stylesheet                                   | Add unrelated selectors to a global catch-all file              |
| Semantic token        | Existing token file only when meaning is truly shared                                 | Add a feature-specific color as a global token                  |
| Copy                  | Existing feature copy/i18n source                                                     | Hardcode EN/VI branches in JSX                                  |
| Test fixture          | Nearest existing test helper                                                          | Create a second fixture system for Phase 7                      |

### 10.4 CF-701 acceptance criteria

- Every in-scope route family has one explicit component, style, copy, and test owner.
- Every proposed source change maps to a verified problem or acceptance criterion.
- No rewrite is justified only by file size, selector count, or personal visual preference.
- The before-change bundle baseline is repeatable.
- The plan for CF-702 and CF-703 does not require new backend/API/schema work.
- SpecKit remains untouched.

### 10.5 Required CF-701 evidence

- `evidence/ui-inventory.md` with the route/component/style/copy/test matrix.
- `evidence/bundle-baseline.json` or an equivalent stable machine-readable baseline.
- A reviewed bounded change list in the inventory.
- Current `git diff --check` and a record of pre-existing dirty paths.

## 11. CF-702 — Standardize Candidate page states

### 11.1 Problem

Different Candidate features may represent loading, empty, errors, retry, permissions, and stale data using different patterns. The goal is not identical visuals; it is consistent meaning, recoverability, and hierarchy.

### 11.2 Required work

1. Build a state matrix per route family from the actual data contract.
2. Correct missing or ambiguous loading, incremental loading, empty, filtered-empty, error, success, disabled/read-only, permission, stale, and retry states.
3. Reuse `PageHeader`, CTA hierarchy, status primitives, compact empty state, guided empty state, stepper/timeline, and callout patterns only where their semantics match.
4. Ensure retry actions are bounded and cannot submit a consequential mutation twice.
5. Preserve durable content during transient reconnect/refetch when the established contract permits it.
6. Use neutral messages for unauthorized or missing private resources.
7. Add or update copy only through the owning EN/VI source.
8. Verify long values, slow loading, no results, and permission failure in focused tests.
9. Keep Candidate Match incomplete/unavailable states honest; do not manufacture a score, ring, band, or evidence.
10. Keep messaging and notification states aligned with the Phase 6A durable recovery contract.

### 11.3 Minimum state coverage by journey

| Journey             | Required state focus                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| CV Import           | initial upload, parsing/processing, review, conflict/stale draft, recoverable failure, receipt, retention/locked actions  |
| Job discovery       | initial/incremental loading, no jobs, filtered empty, invalid/stale URL filter recovery, retry                            |
| Company discovery   | loading, empty, unavailable/hidden entity, long company data, pagination                                                  |
| Apply               | eligibility/permission, validation, uploading/processing, review, submitting, success receipt, duplicate/retry-safe error |
| Application history | empty, filtered empty, loading more, stale cursor/recovery, unavailable job context, timeline states                      |
| Candidate Match     | incomplete, unavailable, processing, retryable failure, eligible result with evidence                                     |
| Notifications       | initial loading, empty, unread/read, refetch/recovery, failed action                                                      |
| Messaging           | no conversation, selected conversation, reconnecting, history recovery, blocked/revoked, send failure                     |

### 11.4 CF-702 acceptance criteria

- Every real required state in the approved matrix has visible, semantic, EN/VI behavior.
- No impossible checklist-only state is added.
- Empty-state type matches the user’s real next action.
- Consequential retry cannot duplicate the mutation.
- Permission UI does not reveal private resource details.
- Status is not conveyed by color alone.
- Focused component/accessibility tests for changed states pass.
- Existing functional contracts from Phases 2–6A remain green in affected suites.

### 11.5 Required CF-702 evidence

- State matrix appended to `evidence/ui-inventory.md` or stored as one adjacent stable artifact.
- Focused test command, exact pass/fail/skip counts, and affected files.
- Representative rendered evidence for each corrected state family; do not capture every trivial variation.

## 12. CF-703 — Modal and overlay correctness (F25)

### 12.1 Problem

Static source shows multiple Candidate-relevant overlay implementations, but source inspection alone cannot prove clipping, stacking, focus, scroll, or viewport behavior. F25 must be reproduced against real ancestors and corrected locally.

### 12.2 Required work

1. Inventory only overlays reachable from the in-scope Candidate journeys.
2. For each overlay, record its trigger, ancestor overflow/transform/position context, stacking context, mount location, close contract, and focus behavior.
3. Reproduce at 320 px, 375 px, 1280 px, 200% zoom, light/dark, keyboard-only, and reduced motion according to the risk matrix.
4. Correct local CSS/markup first when sufficient.
5. Move an overlay to an existing overlay root or portal only when browser evidence proves the need.
6. Preserve controlled state, form values, validation, pending actions, and return-focus behavior through any structural move.
7. Verify nested sticky headers, mobile virtual-height constraints, long EN/VI copy, validation errors, and destructive confirmation.
8. Add a shared modal primitive only when repeated behavior and affected callers are fully understood and the blast radius is covered.

### 12.3 Required overlay inventory

At minimum, CF-703 must triage the Candidate-reachable examples in these families:

- Jobs filter/search and mobile filter overlays;
- Job quick view and report flow;
- Apply confirmation or review overlays;
- Image-search consent/progress/result overlays where reachable;
- CV retention/deletion confirmation;
- Candidate Company application/status confirmation;
- Messaging block and report dialogs.

An item may be marked `NO_CHANGE_REQUIRED` only after executable browser evidence, not inspection alone.

### 12.4 CF-703 acceptance criteria

- No in-scope modal is clipped, hidden behind another stacking context, or rendered with unreachable controls.
- Modal focus enters, remains contained, and returns to the trigger.
- Escape, cancel, outside interaction, pending, and destructive behavior match the documented contract.
- Background scrolling and restoration work without page jump.
- Accessible name, role, description, and error announcement are correct.
- 320 px and 200% zoom retain reachable primary and cancel actions.
- Reduced motion preserves the interaction without decorative animation.
- Portal use is limited to overlays with evidenced need.

### 12.5 Required CF-703 evidence

- Overlay inventory and verdicts in `evidence/overlay-matrix.md`.
- Browser checks for each changed overlay and each `NO_CHANGE_REQUIRED` high-risk overlay.
- Focus-order/return-focus evidence and screenshots only for representative or failing cases.
- Focused overlay component and accessibility test counts.

## 13. CF-704 — Accessibility and responsive matrix

### 13.1 Purpose

CF-704 verifies the final Phase 7 structure across all required dimensions without creating an impractical Cartesian test suite.

### 13.2 Required dimensions

| Dimension     | Required values                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Viewport      | 320, 375, 768, 1280 px                                                                                                |
| Zoom          | 200%                                                                                                                  |
| Locale        | EN and VI                                                                                                             |
| Input         | keyboard-only, pointer, touch-sized controls                                                                          |
| Accessibility | focus visible, label/name/role/value, heading/landmark order, appropriate live status, non-color state                |
| Theme         | light and dark wherever the application supports them                                                                 |
| Motion        | normal and `prefers-reduced-motion`                                                                                   |
| Data          | long person/company/job/location/salary/file values, empty data, and bounded navigation across a 1,000-record fixture |

### 13.3 Risk-based coverage model

Use these tiers:

- **Tier A — every primary Candidate journey:** 375 px and 1280 px, EN and VI distributed across runs, keyboard completion, automated accessibility scan, light/dark distributed across runs.
- **Tier B — layout extremes:** 320 px, 768 px, and 200% zoom across representative high-density journeys: discovery/filter, application form/review, application history, messaging, and one overlay-heavy flow.
- **Tier C — specialized conditions:** reduced motion, long content, empty state, and 1,000-record bounded navigation on the journeys that own those risks.

Coverage rules:

1. Every required dimension must appear in at least one current browser run.
2. Every Tier A journey must be completed by keyboard on at least one viewport.
3. Every changed shared component must be checked in each role/context materially affected by the change.
4. EN and VI must each cover at least one narrow and one wide viewport.
5. Light and dark must each cover at least one form-heavy and one data-heavy journey.
6. Automated accessibility scans supplement but do not replace manual keyboard, zoom, focus, and screen-reader-semantic checks.

### 13.4 Accessibility acceptance criteria

- No critical or serious automated accessibility violation exists in an in-scope final browser run.
- All primary actions and recovery paths are keyboard reachable and operable.
- Focus is visible and not obscured by sticky elements or overlays.
- Heading and landmark structure communicates page hierarchy.
- Form controls have stable accessible names, errors, required state, and descriptions.
- Dynamic status uses `status`/`alert` semantics only when appropriate and does not create noisy duplicate announcements.
- Touch targets remain operable at narrow widths.
- At 200% zoom, content reflows without two-dimensional scrolling except for a genuinely tabular region that exposes an accessible alternative.
- Light and dark themes preserve required contrast and non-color cues.
- Reduced motion retains all information and actions.

### 13.5 Responsive acceptance criteria

- No required text or action is clipped at 320, 375, 768, or 1280 px.
- Long EN/VI and user data do not overlap adjacent controls.
- Mobile navigation, filters, forms, lists, and dialogs remain reachable without hidden fixed controls.
- Desktop hierarchy does not collapse into oversized hero treatment on workspace pages.
- Bounded 1,000-record fixtures use the real pagination/load-more behavior without freezing or rendering the complete corpus at once.

### 13.6 Required CF-704 evidence

- `evidence/browser-matrix.json` containing journey, viewport, zoom, locale, theme, motion, input, data profile, result, failure reference, and source commit/diff identity.
- Automated accessibility output with exact violations and affected selectors.
- Manual keyboard/focus/zoom checklist for the primary journeys.
- Representative screenshots for each viewport, locale, and theme dimension; avoid redundant near-identical captures.

## 14. CF-705 — Final browser evidence

### 14.1 Required primary journeys

The final browser gate must cover these Candidate outcomes on final source:

1. enter through Home or direct discovery, search/filter Jobs, open a Job Detail, and recover browser back/forward state;
2. browse Company results and open Company Detail with long data;
3. upload/import a CV, observe processing/recovery, review, and reach a receipt using isolated fixtures;
4. apply to a job through review and receipt without duplicate submission;
5. open Application History, inspect a timeline/detail, exercise pagination/load-more, and handle an unavailable live job context;
6. open Candidate Match states, including incomplete/unavailable and an eligible evidence-backed result;
7. open Notifications, distinguish unread/read without color alone, and recover after refetch/reconnect;
8. open General Messaging, select or start a conversation, send/recover history, and exercise one access-revocation or block state;
9. complete representative modal/overlay interactions by keyboard and return focus correctly.

### 14.2 Browser evidence rules

- Run against the actual application and production-like route composition, not isolated component markup only.
- Use deterministic task-owned accounts and data in an isolated database.
- Preserve prior phase authorization and privacy assertions.
- Record viewport, locale, theme, motion, data profile, route, steps, and result for every case.
- Save a trace for failures or nondeterministic behavior; screenshots alone are not sufficient diagnostic evidence.
- Do not claim a journey pass if a required step was mocked away, skipped, manually bypassed, or verified only by DOM injection.
- Existing historical screenshots may illustrate context but do not count as current final evidence.

### 14.3 Regression and build gate

After the final UI change:

1. run focused tests for every changed feature;
2. run affected accessibility suites;
3. run the integrated Candidate browser matrix;
4. run typecheck, relevant lint, formatting/diff checks, and production build;
5. rerun prior-phase focused gates only where the changed source can affect them;
6. measure bundle output with the same method used at CF-701 entry;
7. inspect the final diff for unrelated changes, hardcoded copy/colors, weakened tests, and SpecKit changes.

### 14.4 Bundle acceptance

- Report before/after bytes for affected entry points using the same build mode and method.
- A size change is not automatically a failure; explain material growth and tie it to a required behavior.
- Do not add a dependency solely to reduce or explain a negligible bundle delta.
- Unexpected material growth must be investigated before Phase 7 is marked verified.

### 14.5 CF-705 acceptance criteria

- Every required primary journey has current final-source browser evidence.
- The CF-704 matrix has no unresolved required failure.
- Focused, accessibility, static, and build gates pass, or a precise outside-scope baseline exception is retained without weakening Phase 7 assertions.
- Bundle comparison is recorded and explained.
- No shared or production database was mutated.
- Task-owned processes, ports, fixtures, databases, screenshots, traces, and temporary env files are cleaned or retained intentionally as documented evidence.

## 15. Final integrated Phase 7 gate

Phase 7 may be marked `DONE / VERIFIED` only when all statements below are true:

1. CF-701, CF-702, CF-703, CF-704, and CF-705 are individually `VERIFIED` on the same final source.
2. Candidate can complete every primary journey with keyboard-only interaction.
3. EN and VI do not break layout or change business meaning.
4. Required states have labels or structure beyond color.
5. 320, 375, 768, 1280 px and 200% zoom have current evidence.
6. Light/dark and reduced-motion behavior have current evidence.
7. Overlays satisfy focus, stacking, scroll, accessible-name, and responsive contracts.
8. The browser evidence matrix is complete and traceable.
9. Prior Candidate functional, authorization, privacy, and recovery behavior did not regress.
10. Static/build gates and cleanup pass.
11. No SpecKit file changed.

If one required class is unavailable, the verdict is `PARTIAL` or `UNVERIFIED`, not `VERIFIED`.

## 16. Expected impact area

### 16.1 Shared UI and layout

Potential impact is limited to existing Candidate-used primitives such as:

- `web/src/frontend/components/layout/page-header.tsx`;
- `web/src/frontend/components/ui/` established primitives;
- `web/src/frontend/styles/tokens.css` only if CF-701 proves a missing shared semantic token;
- workspace layout/navigation only when a Candidate journey defect is reproduced there.

Shared edits require explicit caller review and targeted cross-role regression.

### 16.2 Candidate feature ownership

Expected feature families include:

- `web/src/frontend/features/home/`;
- `web/src/frontend/features/jobs/`;
- `web/src/frontend/features/candidate-company/`;
- `web/src/frontend/features/candidate-applications/`;
- `web/src/frontend/features/cv-import/`;
- Candidate-facing Profile and private match features;
- `web/src/frontend/features/notifications/`;
- `web/src/frontend/features/messaging/`.

The inventory, not this list, determines the final changed files.

### 16.3 Route boundaries

Route-level changes should be limited to current Candidate pages, loading/error boundaries, and test-only fixture hooks needed to reproduce real states. Do not move routes or change public URLs during UI consolidation.

### 16.4 Tests and evidence

Prefer extending:

- existing feature component tests;
- `web/tests/frontend/accessibility/` suites;
- existing Candidate-first, Home, CV Import, Phase 5, Job, Notification, and Messaging Playwright journeys;
- current test helpers and isolated Candidate fixture system.

Create a Phase 7 browser specification only when it coordinates the integrated matrix more clearly than duplicating logic across older suites.

## 17. Change-structure review gate

Before accepting each slice, review the diff using this table:

| Question                                                     | Required answer                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Does every changed file map to one Phase 7 criterion?        | Yes, or remove/defer it                                                  |
| Is the behavior owned at the narrowest correct layer?        | Route, feature, shared primitive, token, copy, or test owner is explicit |
| Was an abstraction introduced from only one use case?        | No, unless required for safety and justified                             |
| Did UI work change domain/API/schema behavior?               | No; otherwise stop and create a separate approved scope                  |
| Were EN/VI changes made in the owning copy source?           | Yes                                                                      |
| Do new styles use semantic `--sh-*` tokens?                  | Yes                                                                      |
| Does a shared edit have affected-caller tests?               | Yes                                                                      |
| Was a portal added without browser clipping evidence?        | No                                                                       |
| Were tests weakened, skipped, or narrowed to hide a failure? | No                                                                       |
| Were any SpecKit files changed?                              | No                                                                       |

## 18. Test strategy

### 18.1 Focused component and accessibility tests

For each slice:

1. run the nearest component tests before editing to establish a current baseline;
2. add coverage for the reproduced state or interaction;
3. implement the smallest correction;
4. rerun the focused test and adjacent accessibility test;
5. run affected prior-phase tests when the source overlaps their contract.

### 18.2 Browser verification

Browser checks must use the actual route and ancestor layout. Component-only rendering cannot close overlay, responsive, zoom, navigation, hydration, or route-recovery criteria.

At minimum, record:

- browser and version;
- route and fixture identity;
- viewport and zoom;
- locale, theme, and reduced-motion setting;
- input mode;
- expected and observed result;
- trace/screenshot reference for failures;
- cleanup result.

### 18.3 Accessibility verification

Use both:

- automated rule checks for detectable violations; and
- manual checks for keyboard order, visible focus, focus restoration, zoom/reflow, status announcements, meaning, and touch usability.

An automated zero-violation result is not sufficient by itself.

### 18.4 Data profiles

Use deterministic profiles:

- empty;
- one item;
- typical page;
- long EN/VI/user-provided values;
- permission-restricted/unavailable;
- recoverable error or stale state;
- 1,000 records exercised through the real bounded pagination/load-more contract.

Do not copy production PII into fixtures or evidence.

### 18.5 Suggested command classes

Exact commands must be derived from the affected feature and recorded in evidence. Expected classes include:

```powershell
npm run typecheck
npm run lint
npm run build
npm run test:job-board
npm run test:candidate-first
npm run test:candidate-application-private-match
npm run test:notifications
npm run test:messaging
npm run test:candidate-first:e2e
```

Do not run every broad suite after every small edit. Run focused checks per slice, then the integrated set at CF-705.

## 19. Evidence contract

The stable Phase 7 evidence set should remain small:

```text
docs/audits/candidate-first/phase-7/
  plan.md
  integrated-gate.md
  evidence/
    ui-inventory.md
    bundle-baseline.json
    overlay-matrix.md
    browser-matrix.json
    keyboard-matrix.md
    source-manifest.json
    screenshots/
```

Rules:

- Screenshots and traces are retained only if they add decision value and match
  the final source. Fifteen interim-build PNGs were replaced with five small
  current-source JPEGs covering 320/375/768/1280, EN/VI, light/dark, and 200%
  page scale; their build ID and hashes are in `browser-matrix.json`.
- Machine-readable evidence must parse successfully.
- Evidence must record timestamp, source identity, environment, command, exact pass/fail/skip counts, and cleanup.
- Secrets, tokens, session identifiers, message contents, private CV contents, and PII must not appear in artifacts.
- If an expected artifact provides no decision value, omit it and explain the equivalent evidence location in `integrated-gate.md`.

## 20. Data, API, migration, compatibility, and rollback

### 20.1 Default decision

Phase 7 is UI consolidation. The default decision is:

- no schema change;
- no migration;
- no backfill;
- no API expansion;
- no event-contract change;
- no change to Candidate authorization or ownership.

If a real UI requirement lacks backend data, mark it `UNVERIFIED` or create a separate proposed work item. Do not invent client-side truth.

### 20.2 Compatibility

- Existing URLs and query parameters remain compatible.
- Existing server-rendered props and hydration boundaries remain compatible.
- Existing EN/VI preference behavior remains compatible.
- Existing light/dark preference behavior remains compatible.
- Existing automation selectors should be preserved unless they encode an incorrect semantic contract; selector changes require test updates based on behavior, not convenience.

### 20.3 Rollback

Keep changes slice-local so a visual/state correction can be reverted without reverting prior functional phases. Shared primitive changes must be small and separable. Do not make rollback depend on data deletion or schema reversal.

## 21. Repository, environment, and cleanup safety

1. Preserve the existing dirty Phase 6A working tree.
2. Before editing, record paths already modified or untracked.
3. Do not use reset, clean, bulk restore, or checkout-overwrite operations.
4. Use only task-owned isolated test databases; set both database URLs to the same safe database.
5. Use task-owned ports, processes, accounts, files, and fixtures.
6. Do not stop or delete a resource with uncertain ownership.
7. Remove only task-owned temporary env files and runtime resources after verification.
8. Retain evidence intentionally; remove screenshots/traces that contain sensitive data.
9. Finish with `git status`, `git diff --check`, JSON parsing, link checks, and verification that SpecKit has no diff.

## 22. Risk register

| Risk                                      | Signal                                                                                    | Control                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| UI consolidation becomes redesign         | Navigation, branding, information architecture, or business copy changes without a defect | Default to Refine and require a criterion for every changed file       |
| Shared component regression               | Recruiter/Owner/Admin callers change after a Candidate fix                                | Review callers and run targeted cross-role regression                  |
| CSS cleanup changes cascade unexpectedly  | Distant pages shift after selector removal                                                | Inventory ownership, remove incrementally, and compare affected routes |
| Portal introduced unnecessarily           | Overlay structure changes without reproduced clipping                                     | Require real ancestor browser evidence first                           |
| Accessibility scan gives false confidence | Axe passes but focus/zoom flow fails                                                      | Combine automated and manual evidence                                  |
| Matrix explodes                           | Full Cartesian suite becomes slow and brittle                                             | Use Tier A/B/C risk-based coverage                                     |
| Translation breaks layout                 | VI or long data overlaps controls                                                         | Pair narrow/wide runs with both locales and long-value fixtures        |
| Theme fix hardcodes light colors          | Dark mode loses contrast/hierarchy                                                        | Use semantic tokens and run both themes                                |
| Retry duplicates mutation                 | User retries apply/upload/action after ambiguous response                                 | Preserve idempotency and test pending/retry behavior                   |
| Large fixture freezes UI                  | 1,000 items rendered at once                                                              | Exercise real pagination/load-more boundary                            |
| Browser evidence is stale                 | Screenshots belong to older source                                                        | Record source identity and recapture after final changes               |
| Phase 6A work is overwritten              | Dirty files overlap Messaging/Notifications                                               | Preserve existing diff and edit only after ownership review            |

## 23. Time and execution estimate

The work should be managed by scope, not a fixed calendar promise:

| Slice  | Relative effort | Main uncertainty                                                     |
| ------ | --------------- | -------------------------------------------------------------------- |
| CF-701 | Medium          | Breadth of route/style/copy ownership and current baseline drift     |
| CF-702 | Medium–High     | Number of real missing states after inventory                        |
| CF-703 | Medium          | Which overlays reproduce F25 in real layouts                         |
| CF-704 | High            | Browser matrix, keyboard, zoom, theme, locale, and fixture stability |
| CF-705 | Medium–High     | Integrated reruns, evidence normalization, and cleanup               |

Do not estimate implementation volume before CF-701 finishes. If CF-701 finds no defect in an area, verify it and leave it unchanged.

## 24. Phase 7 Definition of Done

- [x] Entry baseline and dirty-worktree record captured.
- [x] CF-701 route/component/style/copy/test ownership inventory completed.
- [x] Before-change bundle baseline recorded.
- [x] CF-702 real page-state matrix implemented and verified.
- [x] Empty states use compact/guided patterns according to context.
- [x] EN/VI copy changes remain in owning copy maps.
- [x] CF-703 overlay inventory reproduced and resolved or verified unchanged.
- [x] Modal focus, Escape, return focus, scroll, stacking, and responsive behavior pass.
- [x] CF-704 required viewport, zoom, locale, input, theme, motion, and data dimensions pass.
- [x] Candidate primary journeys are keyboard completable.
- [x] Status meaning is available beyond color.
- [x] No critical/serious automated accessibility violation remains in required runs.
- [x] CF-705 final browser journeys pass on final source.
- [x] Focused regressions pass; the initial 16 stale affected-suite expectations were mapped, corrected to the current contracts, and the final affected command passes `103 files / 399 tests`.
- [x] Typecheck, relevant lint, build, formatting/diff checks pass.
- [x] Before/after bundle result recorded and explained.
- [x] Evidence parses, links resolve, and sensitive data is absent.
- [x] Task-owned runtime/database/fixture cleanup passes.
- [x] Existing Phase 6A and unrelated dirty work is preserved.
- [x] No SpecKit file changed.
- [x] `integrated-gate.md` classifies every required criterion as `PASS`, `FAIL`, or `UNVERIFIED`.

## 25. Final status ledger

| Work item          | Status            | Current evidence                                                                                                                                                              | Next gate                                                     |
| ------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Entry gate         | `VERIFIED`        | Isolated PostgreSQL target created, 97/97 migrations applied, final build and dirty-worktree baseline recorded                                                                | None                                                          |
| CF-701             | `VERIFIED`        | Current route/component/style/copy/test inventory and before/after bundle baseline in `evidence/`                                                                             | None                                                          |
| CF-702             | `VERIFIED`        | Smoke, Phase 3, CF-301, CF-502, CV recovery, notification, messaging, company and bounded-list browser evidence                                                               | None                                                          |
| CF-703             | `VERIFIED`        | Public 10-state final-build overlay matrix plus authenticated report, withdrawal, CV retention and messaging focus journeys                                                   | None                                                          |
| CF-704             | `VERIFIED`        | 320/375/768/1280, 200%, EN/VI, light/dark, reduced motion, keyboard, pointer and touch-sized evidence; final 27 states have axe serious/critical = 0 and no overflow          | None                                                          |
| CF-705             | `VERIFIED`        | Final authenticated J1–J9 matrix is 3/3 profiles and 27/27 states; regression/build/static/cleanup gates reconciled in `integrated-gate.md`                                   | None                                                          |
| Integrated Phase 7 | `DONE / VERIFIED` | All required evidence classes pass on reproducible source digest `2d31ae6f97db66eeb5fc280a0bc669a1a21897b6bf21ce6a6d3c59f47b26eb8e`; final affected command is `399/399` PASS | Phase 6B remains skipped by scope/topology and is not changed |

## 26. Required final report

The Phase 7 completion report must state:

1. result and reproduced root causes;
2. behavior before and after;
3. important files changed, grouped by owner;
4. CF-701 through CF-705 status;
5. exact test and browser pass/fail/skip counts;
6. viewport, locale, theme, motion, input, zoom, and data coverage;
7. before/after bundle evidence;
8. any outside-scope baseline failures or unverified items;
9. cleanup status for database, accounts, processes, ports, env files, screenshots, and traces;
10. confirmation that existing dirty work was preserved and SpecKit was untouched.

Do not report the phase as complete from screenshots, component tests, or automated accessibility scans alone.

## 27. Execution instruction

When implementation is authorized, Luna Max should execute this plan directly as one root agent, one dependency-ordered slice at a time. Start with current repository evidence, adapt stale assumptions to the actual source, make the smallest justified change, verify the relevant failure and regression paths, record evidence, clean up task-owned resources, and continue until the integrated Phase 7 gate is genuinely satisfied or a precise blocker remains.

Do not create subagents. Do not modify SpecKit. Do not commit, push, deploy, reset, clean, mutate a shared database, or stop user-owned processes without explicit authorization.
