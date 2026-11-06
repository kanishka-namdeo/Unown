# Chaconne usage stills — provenance

- Captured: 2026-11-06T14:45:59.928Z by `apps/chaconne/scripts/capture-usage.mjs` (C-10, the product-surface lane; the Ostinato `apps/ostinato/scripts/capture-usage.mjs` precedent ported).
- Server: `bun apps/chaconne/serve.mjs` on scratch port 4015 (the real transpiling dev server; 4014 is the app's reserved dev port, so the capture lane takes 4015). NO live network — the seeded document's fixture URL is local (127.0.0.1:4014), and the capture drives the app shell only.
- Browser: headless Chromium (the e2e lane's own install, repo-root `@playwright/test`), ONE FRESH context per still — no service worker state, no IndexedDB, no localStorage leftovers.
- Viewport: 1280x800, deviceScaleFactor 2, full-page screenshots.
- Seeds: the e2e specs' own localStorage document shape (`e2e/chaconne-a11y.spec.ts` SEED_DATA, verbatim — one recipe + one run, the PWA-grammatical content-addressed artifact names; the runner's multi-dot extract-report names stay in the disk store and never cross into the app lane, the C-6 workaround convention).
- KEYBOARD-ONLY LAW: every navigation is a `page.keyboard` press — the app's own direct keys ("1"/"2"/"a"/"A" via the palette.ts COMMAND_KEY_DISPATCH, arrows for run-row focus, Ctrl+K for the palette). Zero pointer events, no `.fill()`.
- Schemes: light + dark via the context's colorScheme (the CSS's @media (prefers-color-scheme) branch, the C-9 both-schemes lane).
- 01-empty-boot-light.png — the honest empty state (".chaconne-state" = "No recipes yet", the never-blank law).
- 02-recipe-list-light.png — the recipes route with the seeded recipe row ("E2E a11y seed recipe (v1)" + "1 step" + the "ok" badge).
- 03-run-history-light.png — the runs route (the "2" key): the recipe-grouped history with the seeded run row, arrow-focused.
- 04-artifact-viewer-light.png — the artifact route (the "a" key on the focused run): the screenshot panel + the extracted-values panel.
- 05-palette-light.png — the command palette OPEN via Ctrl+K (the 11-command enumeration, filter-as-you-type, the keyboard-first identity shot).
- 06-empty-boot-dark.png / 07-recipe-list-dark.png — the same two states under prefers-color-scheme: dark.
- Re-runnable: `bun apps/chaconne/scripts/capture-usage.mjs [target-dir] [--port P] [--smoke]` — the stills overwrite in place.
