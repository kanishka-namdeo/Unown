# Chaconne usage stills — provenance

- Captured: 2026-11-06T15:47:37.529Z by `apps/chaconne/scripts/capture-usage.mjs` (the C-11 post-A2H-14 REAL-RUNNER refresh (the round's last ticket, driving the app's own recipe 1 through the live runner and bridging its disk store into the app lane — the V-41 seam proven live; the C-10 seeded default remains re-runnable without the flag)).
- Server: `bun apps/chaconne/serve.mjs` on scratch port 4015 (the real transpiling dev server; 4014 is the app's reserved dev port, so the capture lane takes 4015). NO live network — the seeded document's fixture URL is local (127.0.0.1:4014), and the capture drives the app shell only.
- Browser: headless Chromium (the e2e lane's own install, repo-root `@playwright/test`), ONE FRESH context per still — no service worker state, no IndexedDB, no localStorage leftovers.
- Viewport: 1280x800, deviceScaleFactor 2, full-page screenshots.
- Seeds: the REAL RUNNER'S OWN record — recipe 1 (the dynamic.html demo: wait/assert-element/extract/screenshot) executed through `bun apps/chaconne/runner/index.ts run 1 --base-url …` into a scratch data dir, its disk store's canonical document (`loadAll()` + `JSON.stringify`) bridged into the app lane's localStorage — the V-41 post-A2H-14 proof that runner-produced artifact names (single-token exts: `json`, `log`, `png`) pass the PWA domain's `assertData`. The stills therefore exercise the REAL artifact-name bridge that the seeded C-10 convention kept latent.
- KEYBOARD-ONLY LAW: every navigation is a `page.keyboard` press — the app's own direct keys ("1"/"2"/"a"/"A" via the palette.ts COMMAND_KEY_DISPATCH, arrows for run-row focus, Ctrl+K for the palette). Zero pointer events, no `.fill()`.
- Schemes: light + dark via the context's colorScheme (the CSS's @media (prefers-color-scheme) branch, the C-9 both-schemes lane).
- 01-empty-boot-light.png — the honest empty state (".chaconne-state" = "No recipes yet", the never-blank law).
- 02-recipe-list-light.png — the recipes route with the seeded recipe row ("E2E a11y seed recipe (v1)" + "1 step" + the "ok" badge).
- 03-run-history-light.png — the runs route (the "2" key): the recipe-grouped history with the seeded run row, arrow-focused.
- 04-artifact-viewer-light.png — the artifact route (the "a" key on the focused run): the screenshot panel + the extracted-values panel.
- 05-palette-light.png — the command palette OPEN via Ctrl+K (the 11-command enumeration, filter-as-you-type, the keyboard-first identity shot).
- 06-empty-boot-dark.png / 07-recipe-list-dark.png — the same two states under prefers-color-scheme: dark.
- Re-runnable: `bun apps/chaconne/scripts/capture-usage.mjs [target-dir] [--port P] [--smoke]` — the stills overwrite in place.
