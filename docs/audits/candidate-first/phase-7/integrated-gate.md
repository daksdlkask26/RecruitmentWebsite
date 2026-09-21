# Candidate-first Phase 7 integrated gate

**Decision: DONE / VERIFIED.**

The final production build `lAfLL8pY3Wp8U0hQYjmf2` passed the public overlay
matrix, desktop/mobile/200% keyboard profiles, and the CV-retention companion
rerun. J1–J9 passed in 3/3 profiles and 27/27 final states. Public evidence
passed 1/1 with 10/10 logged state checks. The exact affected regression
command passed 103/103 files and 399/399 tests.

Final source identity:
`2d31ae6f97db66eeb5fc280a0bc669a1a21897b6bf21ce6a6d3c59f47b26eb8e`
from the [24-file manifest](evidence/source-manifest.json).

## Gate decision

| Work item                      | Decision            | Current executable evidence                                                            | Open required work |
| ------------------------------ | ------------------- | -------------------------------------------------------------------------------------- | ------------------ |
| CF-701 inventory/baseline      | PASS                | UI inventory, reproducible source manifest, final bundle measurement                   | None               |
| CF-702 shared UI/accessibility | PASS                | Shared modal contract; focused tests; final public/authenticated axe checks            | None               |
| CF-703 overlay contract        | PASS                | Public 10/10 states; CV retention 1/1; authenticated report/withdrawal/messaging paths | None               |
| CF-704 responsive/keyboard     | PASS                | 320/375/768/1280; light/dark; reduced motion; true page scale 2; J1–J9 keyboard-only   | None               |
| CF-705 regression/build        | PASS                | 103 files / 399 tests; TypeScript; ESLint; exact formatting; 116/116 build; diff check | None               |
| Integrated Phase 7             | **DONE / VERIFIED** | All required evidence above uses the final source/build identity                       | None               |

Phase 6B remains skipped by the approved boundary and was not modified.

## Corrections required before closure

Three audit weaknesses were fixed before accepting the gate:

1. The isolated-DB helper now accepts only
   `candidate_phase7_<token>_(test|spec|e2e)`, quotes identifiers safely,
   marks a newly created database with
   `nextgen-careers:candidate-first:phase7:task-owned:v1`, refuses existing
   targets, and refuses DROP when the marker does not match. Its unit suite is
   11/11 PASS.
2. Public overlays were rerun after the final source changes on the same build
   as authenticated evidence. The earlier cross-build provenance claim is no
   longer used.
3. The 200% profile now applies CDP page scale 2, reapplies it after navigation
   and before interactions/assertions, and verifies
   `visualViewport.scale >= 1.9`. Observed scale was 2.

The final public run also found and resolved three acceptance blockers:

- Category Explorer now portals under `document.body` so the sticky
  header/backdrop-filter containing block cannot shift the fixed dialog.
- Jobs secondary navigation has unique EN/VI accessible labels.
- Work arrangement has an explicit accessible select label.

## Browser evidence

| Dimension     | Current proof                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Public        | 1/1 Playwright spec; 10/10 checks covering shell, five overlays/responsive states, and zoom dialog/document scans       |
| Keyboard      | J1–J9 PASS at 1280x720 light, 375x812 dark/reduced, and layout 640x360 with page scale 2                                |
| Zoom          | Public layout 640x450, visual scale 2, visual width 320; authenticated layout 640x360, visual scale 2, visual width 320 |
| Accessibility | Public axe violations 0; 27/27 authenticated states serious/critical violations 0                                       |
| Layout        | No horizontal-overflow failures in the final public or authenticated matrix                                             |
| CV retention  | 1/1 final-build rerun; initial focus Keep import; Escape; focus return; no deletion                                     |

The public zoom scan checks the active dialog while the background is
intentionally dimmed, then closes the dialog and scans the full document. Both
checks passed. Details are in
[browser-matrix.json](evidence/browser-matrix.json),
[keyboard-matrix.md](evidence/keyboard-matrix.md), and
[overlay-matrix.md](evidence/overlay-matrix.md).

## Regression triage

The first exact affected-suite run reported 383 PASS and 16 FAIL. These were
stale assertions against the current source. No assertion was weakened and no
test was skipped.

|    # | Stale expectation                     | Contract-aligned correction                         |
| ---: | ------------------------------------- | --------------------------------------------------- |
|    1 | Multiple confirmation checkboxes      | Use exact primary confirmation label                |
|    2 | Old pipeline labels                   | Use New, Offer, Offer declined, Needs details       |
|    3 | Capitalized Change Stage              | Match current Change stage accessible name          |
|    4 | Removed movement markers              | Assert shared requestStageChange contract           |
|    5 | Removed refresh constant              | Assert current cache/version contract               |
|    6 | Old list/kanban ownership             | Assert current candidates region and ranking owner  |
|    7 | Completed 3                           | Use Terminal 3                                      |
|    8 | Load more applications                | Use bounded Next page control                       |
| 9–12 | Old Select CV copy in four tests      | Match Select a CV from Profile                      |
|   13 | Workspace shell lacked query provider | Render with required QueryClientProvider            |
|   14 | Old Applied receipt copy              | Use Application submitted                           |
|   15 | Old report trigger/validation copy    | Use Report this job and current validation guidance |
|   16 | Old report success phrase             | Use neutral Report submitted status                 |

Final unchanged command result: **103 files passed; 399 tests passed; 0
failed**.

## Static, build, and bundle evidence

- TypeScript: PASS.
- Targeted ESLint: PASS.
- Exact Phase 7 formatting set and audit JSON/Markdown: PASS.
- Next production build: PASS, 116/116 pages.
- `git diff --check`: PASS.
- Final bundle: 8,815,460 total bytes; 5,308,072 JS; 1,643,174 CSS;
  counts unchanged at 202/119/34.
- Baseline delta: +5,539 total (+0.06%), +5,040 JS (+0.10%), +499 CSS
  (+0.03%).

The build retained two known dynamic-filesystem tracing warnings. They did not
fail the build and were not introduced by this Phase 7 slice.

## Safety and cleanup

- Only `candidate_phase7_resolve_desktop_test`,
  `candidate_phase7_resolve_mobile_test`, and
  `candidate_phase7_resolve_zoom_e2e` were used; 97/97 migrations applied to
  each. Shared `smarthire` was not mutated.
- All three database targets were dropped only after exact marker validation
  and then confirmed absent. The measured `web/.next-phase7-final` artifact was
  removed, together with the final task-owned Playwright result marker. Ports
  3141–3145 were confirmed released; no user-owned process was stopped.
- Fifteen untracked interim-build PNGs (5,864,942 bytes) were replaced with
  five current-source JPEGs (193,197 bytes). The supplemental screenshot run
  passed 1/1 on a separate production build of the same Phase 7 source digest;
  the [browser matrix](evidence/browser-matrix.json) records its build ID,
  isolated database, viewport/locale/theme coverage, and per-file hashes.
  Its database, server, build, temporary code, and Playwright marker were
  cleaned after capture.
- Existing dirty work was preserved. No commit, push, deploy, reset, clean,
  SpecKit change, or Phase 6B change was performed.

## Explicit non-gating boundaries

Two legacy probes remain `UNVERIFIED`: the old registration/mail-capture CV
consent setup and the removed visitor `Sign in to apply` path. Neither belongs
to the Phase 7 acceptance matrix; their status is not converted to PASS.
