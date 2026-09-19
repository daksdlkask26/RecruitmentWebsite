# CF-405 production browser matrix — light

- Run date: 2026-09-18
- Theme: `light`; applied `data-theme` and `color-scheme`: PASS
- Command: `$env:CF405_COLOR_SCHEME='light'; node scripts/phase5-run-isolated.mjs npx.cmd playwright test -c playwright.phase4.config.ts`
- Environment: task-owned `next start` from isolated `.next-phase5-final-20260918`, `http://127.0.0.1:3003`, isolated `candidate_phase5_final_20260917_e2e_test`
- Matrix: 320 / 375 / 768 / 1280 CSS px
- Result: **16 passed, 0 failed, 0 skipped** (4 accessibility, 12 journey; four viewport projects)
- Axe serious/critical: **0**
- 200% zoom, keyboard/focus, reduced motion, overflow, EN/VI, revoked/expired navigation race: **PASS**
