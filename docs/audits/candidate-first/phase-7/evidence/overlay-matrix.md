# Candidate-first Phase 7 overlay matrix

Source identity: `ac17ec1e`; digest
`2d31ae6f97db66eeb5fc280a0bc669a1a21897b6bf21ce6a6d3c59f47b26eb8e`  
Final build: `lAfLL8pY3Wp8U0hQYjmf2`  
Browser evidence: Playwright Chromium and axe-core 4.12.1. Public overlays,
authenticated keyboard profiles, and the CV-retention companion all used this
same final build.

## Contract matrix

| Overlay                | Source owner                                                    | Mounting decision                                                                         | Focus entry / trap / exit                                                                        | Current evidence                                        |
| ---------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Mobile filters         | `features/jobs/components/job-search-form.tsx`                  | Inline drawer                                                                             | Close button; Tab wraps; Escape closes; focus returns to Filters                                 | PASS at 320px, dark, reduced motion; axe 0; no overflow |
| Quick View             | `features/jobs/components/quick-view-panel.tsx`                 | Existing inline backdrop/panel                                                            | Close button; Tab wraps; Escape closes; arrow navigation remains; focus returns                  | PASS at 1280px; 5 focusable controls; axe 0             |
| Job Category explorer  | `features/jobs/image-search/components/global-image-search.tsx` | Portal under `document.body` to escape the sticky header/backdrop-filter containing block | Search input; Tab wraps; Escape closes; focus returns; dialog owns scrolling                     | PASS at 1280px and 200% page scale; axe 0; no overflow  |
| Image search           | `features/jobs/image-search/components/global-image-search.tsx` | Existing portal retained                                                                  | Close button; Tab wraps; Escape closes; focus returns                                            | PASS at 1280px; 2 focusable controls; axe 0             |
| Save filter            | `features/jobs/components/job-search-form.tsx`                  | Inline dialog                                                                             | Name input; Tab wraps; Escape closes; focus returns                                              | PASS at 1280px; 2 focusable controls; axe 0             |
| Apply/review           | Jobs application flow                                           | Existing flow                                                                             | Existing contract retained                                                                       | PASS through affected tests and J4                      |
| Job report             | Jobs report dialog                                              | Existing shared dialog                                                                    | Safe initial focus; Escape; return                                                               | PASS through J9                                         |
| CV retention           | `features/cv-import/components/cv-retention-actions.tsx`        | Existing inline dialog                                                                    | Initial focus **Keep import**; Tab wraps; Escape; return; deletion remains explicit              | PASS in final-build companion rerun 1/1                 |
| Team withdrawal        | `features/candidate-company/team-application-status.tsx`        | Existing inline dialog                                                                    | Cancel focus; busy Escape guard; return                                                          | PASS through authenticated harness                      |
| Messaging block/report | Messaging dialog components                                     | Existing inline paths                                                                     | Block/unblock initial focus **Cancel**; Tab wraps; Escape; return; confirmation remains explicit | PASS through J8 and affected tests                      |

## Browser-found corrections

- The Category explorer was moved to a body portal. The prior inline mount sat
  inside a sticky, backdrop-filtered header, which created a containing block
  and shifted the fixed dialog at narrow visual viewports.
- The Jobs secondary navigation now has a unique EN/VI accessible label
  (`Jobs navigation` / `Điều hướng việc làm`).
- The work-arrangement select now has an explicit accessible label, removing a
  flaky axe `select-name` failure.
- The shared `useModalA11y` contract supplies focus entry, Tab containment,
  Escape, body-scroll ownership, and focus return.

## Final public observations

The public spec passed 1/1 and logged 10/10 state checks: desktop shell, Quick
View, Category, Image Search, Save Filter, 320px dark/reduced mobile filters,
375px, 768px, active dialog at 200% page scale, and the full document after the
zoom dialog closed.

At 200% the layout viewport was 640x450, `visualViewport.scale` was 2, and
the visual viewport width was 320. The active dialog had zero axe violations
and no horizontal overflow. Because the background is intentionally dimmed
while a modal is open, the zoom axe scan was scoped to the active dialog; after
closing it, a full-document axe and overflow scan also passed.

Full machine-readable details are in [browser-matrix.json](browser-matrix.json).
