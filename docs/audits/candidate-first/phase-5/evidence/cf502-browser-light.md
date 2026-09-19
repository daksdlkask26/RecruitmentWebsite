# CF-502 browser evidence - light theme

Verdict: **PASS**

Phase classification: **VERIFIED independently; phase-wide gate recorded separately**.

- Production Playwright: 16 expected, 0 unexpected, 0 flaky, 0 skipped.
- Machine rows: 108/108; states: 27/27; each state requires one row for each viewport.
- Viewports: 320x720, 375x812, 768x900, 1280x900.
- Quality rows: axe serious/critical 0; overflow 108/108; keyboard/focus 108/108; reduced motion 108/108; 200% CSS reflow 108/108.
- Production build: true; build output: .next-phase5-final-20260918-rerun; DB: candidate_phase5_final_20260917_e2e_test; route mocks: false.
- Exact command: node scripts/phase5-run-isolated.mjs npx.cmd playwright test --config=playwright.phase5.config.ts.
- The JSON retains every machine row and every validation error; a failed or incomplete run is not promoted to PASS.
