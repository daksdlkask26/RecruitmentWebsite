# Phase 7 keyboard-only Candidate evidence

## Result

**PASS — 3/3 Playwright profiles; 27/27 journey states.** J1–J9 completed on
production build `lAfLL8pY3Wp8U0hQYjmf2`:

| Profile   | Viewport / scale                            | Theme / motion | Result     |
| --------- | ------------------------------------------- | -------------- | ---------- |
| Desktop   | 1280x720 / scale 1                          | Light / normal | J1–J9 PASS |
| Mobile    | 375x812 / scale 1                           | Dark / reduced | J1–J9 PASS |
| 200% zoom | layout 640x360 / scale 2 / visual width 320 | Light / normal | J1–J9 PASS |

Every final state had zero serious/critical axe violations and no horizontal
overflow. Controls were reached through real `Tab` navigation and operated
with `Tab`, `Shift+Tab`, `Enter`, `Space`, arrow keys, and `Escape`.
The spec contains no `.focus()`, `.click()`, `.fill()`, `.check()`, or
`.selectOption()` shortcut.

The zoom profile uses CDP `Emulation.setDeviceMetricsOverride` together with
`Emulation.setPageScaleFactor(2)`. Scale is reapplied after navigation and
before keyboard interactions and quality assertions. Every final state asserted
`visualViewport.scale >= 1.9`; observed scale was 2.

`page.goto()` only resets the route between journeys. J3 uses a task-owned
`REVIEW_READY` draft, so this proof covers list, status, review, save, confirm,
and receipt controls without claiming the operating-system file chooser.

## Final-source identity

- Git HEAD: `ac17ec1e`
- Production build ID: `lAfLL8pY3Wp8U0hQYjmf2`
- Phase 7 source digest: `2d31ae6f97db66eeb5fc280a0bc669a1a21897b6bf21ce6a6d3c59f47b26eb8e`
  from the [24-file reproducible manifest](source-manifest.json)
- Isolated databases: `candidate_phase7_resolve_desktop_test`,
  `candidate_phase7_resolve_mobile_test`, and
  `candidate_phase7_resolve_zoom_e2e`
- Database setup: 97/97 migrations on each target; shared `smarthire` was not
  mutated

## Journey mapping

| Journey                       | Keyboard proof                                            | Result |
| ----------------------------- | --------------------------------------------------------- | ------ |
| J1 Jobs discovery/detail      | Open seeded job, Back, and reopen detail                  | PASS   |
| J2 Company discovery/detail   | Open seeded company and inspect long content              | PASS   |
| J3 CV import/review/receipt   | Edit, choose Replace, save, acknowledge, confirm          | PASS   |
| J4 Application review/submit  | Enter phone, choose CV, confirm, submit                   | PASS   |
| J5 Application history/detail | Page forward/back, open detail, inspect unavailable state | PASS   |
| J6 Private CV Match           | Open the completed report                                 | PASS   |
| J7 Notifications              | Switch filters, mark read, verify semantic read state     | PASS   |
| J8 Messaging safety/recovery  | Report, block/unblock, send, reload history               | PASS   |
| J9 Job Report overlay         | Safe initial focus, Escape, and focus return              | PASS   |

The companion CV-retention probe also passed 1/1 on the same final build:
initial focus was **Keep import**, Escape closed without deletion, and focus
returned to the trigger. Messaging block/unblock enters on **Cancel** before any
destructive confirmation.
