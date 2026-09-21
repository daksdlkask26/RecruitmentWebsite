# Candidate-first Phase 7 UI inventory

Generated: 2026-09-21 10:14 ICT  
Source identity: `ac17ec1e`; final Phase 7 SHA-256
`2d31ae6f97db66eeb5fc280a0bc669a1a21897b6bf21ce6a6d3c59f47b26eb8e`
from the [24-file manifest](source-manifest.json)  
Final production build: `lAfLL8pY3Wp8U0hQYjmf2`

This bounded inventory records the source surface and evidence actually used
for CF-701/CF-702. Existing dirty work, SpecKit, Phase 5/6A, and Phase 6B were
kept outside the slice.

## Route and ownership inventory

| Surface           | Primary routes                           | Current source owners                                                 | Tests used in the gate                                        |
| ----------------- | ---------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| Home              | `/`, `/home`                             | `web/src/app/page.tsx`, `web/src/app/home/page.tsx`, `features/home/` | Home component/accessibility tests                            |
| Jobs discovery    | `/jobs`, `/jobs/[slug]`                  | Jobs workspace, search form, Quick View, image/category search        | Jobs component/accessibility tests plus public browser matrix |
| Job actions       | apply/review, applied, saved routes      | Jobs application, report, applied/saved components                    | Application/jobs tests plus J4/J5/J9                          |
| Candidate/company | `/company`, `/company/[companyId]`       | `features/candidate-company/`                                         | Company tests plus J2                                         |
| CV import         | CV import, review, receipt routes        | `features/cv-import/`                                                 | CV component/accessibility tests plus J3 and retention rerun  |
| Private CV Match  | `/cv-match-check`, `/jobs/matches`       | `features/private-cv-match/`                                          | Private-match tests plus J6                                   |
| Notifications     | `/notifications`                         | `features/notifications/`                                             | Notification component/accessibility tests plus J7            |
| Messaging         | `/messages`, application messaging route | Messaging and recruitment-messaging features                          | Messaging tests plus J8                                       |

## Bounded Phase 7 source slice

- Added the shared `useModalA11y` contract for focus entry, Tab wrapping,
  Escape, body-scroll ownership, and focus return.
- Applied it to Quick View, image search, Category explorer, Save filter, and
  mobile filters.
- Portaled the Category explorer under `document.body` after final-browser
  evidence showed the sticky header/backdrop-filter containing block shifted
  the fixed dialog and caused horizontal overflow.
- Corrected Jobs navigation and work-arrangement control labels found by axe;
  EN/VI navigation labels have focused assertions.
- Used existing `--sh-*` tokens for contrast fixes and retained current API,
  schema, route, and authentication contracts.
- Added a task-owned isolated database harness with strict names and an
  ownership comment. Drop refuses a database without the exact task marker.

## State matrix

| State family                       | Current evidence                                                                                  | Classification |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- | -------------- |
| Public Jobs shell and overlays     | Final-build public spec 1/1 with 10/10 state checks at 320/375/768/1280 and true 200% page scale  | PASS           |
| Authenticated J1–J9                | Desktop, mobile dark/reduced, and 200% profiles; 27/27 states, axe serious/critical 0, overflow 0 | PASS           |
| CV retention                       | Final-build companion rerun 1/1; Keep import initial focus, Escape, focus return, no deletion     | PASS           |
| Component/accessibility regression | Exact affected command: 103 files / 399 tests, 399 PASS / 0 FAIL                                  | PASS           |
| Static/build                       | TypeScript, ESLint, Prettier, 116/116 page build, and diff whitespace check                       | PASS           |

The public zoom checks used a 640x450 layout viewport with page scale 2 and a
320px visual viewport. The keyboard zoom profile used a 640x360 layout
viewport, reapplied scale 2 after navigation, and asserted the scale before
interactions and quality checks.

## Evidence references

- [Browser matrix](browser-matrix.json)
- [Minimal current-source screenshot set](screenshots/jobs-1280-en-light.jpg)
- [Keyboard-only matrix](keyboard-matrix.md)
- [Overlay contract matrix](overlay-matrix.md)
- [Bundle comparison](bundle-baseline.json)
- [Integrated decision](../integrated-gate.md)

The initial broad regression run exposed 16 stale expectations. Each is mapped
in the integrated gate; the unchanged exact command was rerun and passed
399/399. Two older, non-gating probes remain explicitly `UNVERIFIED`.
