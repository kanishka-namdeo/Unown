# Fugue usage stills — provenance

- Captured: 2026-11-07T18:09:37.885Z by `apps/fugue/scripts/capture-usage.mjs` (the F-10 product-surface lane; the Ostinato/Chaconne precedent ported).
- Servers: `bun apps/fugue/serve.mjs` on scratch port 4016 (the real transpiling dev server; 4015 is the app's reserved dev port, so the capture lane takes 4016 per the PLAN §5 ruling) + `bun apps/fugue/runner/fixture-serve.mjs` on 4130 (the F-3 fixture engine, the canned contract-pinned JSON the e2e lane drives — NO live network; the capture drives the app shell against the fixture only, the F-6 live lane is off-peak and operator-witnessed, not a capture lane).
- Browser: headless Chromium (the e2e lane's own install, repo-root `@playwright/test`), ONE FRESH context per still — no service worker state, no IndexedDB, no localStorage leftovers.
- Viewport: 1280x800, deviceScaleFactor 2, full-page screenshots.
- Keyboard-first: every navigation is a `page.keyboard` press or a palette command click (the app's own keyboard surface — the Ctrl+K palette over the learning routes, the arrow-navigated job rows). The compose dialog is opened via the palette's "New job" command (the app's own P0 path), not a pointer click on a button.
- Schemes: light only (the band's identity set; the chaconne set is light-only for the band, dark optional and not committed).
- 01-jobs-light.png — the boot/jobs route with the fixture engine's two automation rows (the "Engine jobs" lane).
- 02-compose-light.png — the compose dialog OPEN (the P0 authoring: prompt/schedule/mode/model/timezone/misfire/spend-cap with validation).
- 03-runs-light.png — the runs route (the grouped run history over the fixture's canned runs).
- 04-dreams-light.png — the dreams journal (the AutoDream consolidation log, the five-status badge vocabulary).
- 05-memory-light.png — the memory view (the tiers + the health card: backend, model, memory count, duplicates, conflicts).
- 06-skills-light.png — the skills view (the engine's DB skills, the honest empty state in the fixture lane, + the staged queue through the read-only /skills-staged route + the promote hint as TEXT).
- 07-manual-notes-light.png — the Manual-notes editor (the lane label, the budget meter, the over-cap marker surface — the one hand-edit lane into .unown/memory/project.md's ## Manual notes section).
- 08-palette-light.png — the command palette OPEN via Ctrl+K (the full 15-command enumeration, filter-as-you-type, the keyboard-first identity shot).
- Re-runnable: `bun apps/fugue/scripts/capture-usage.mjs [target-dir] [--port P] [--smoke]` — the stills overwrite in place.
