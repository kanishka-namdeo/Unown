# Coda usage stills — provenance

- Captured: 2026-11-03T06:55:51.461Z by `apps/coda/scripts/capture-usage.mjs` (T3, the doc-truth round).
- Server: `bun apps/coda/scripts/serve.mjs` on scratch port 4098 (the real transpiling dev server, no build step).
- Browser: headless Chromium (the e2e lane's own install), fresh context — no service worker state, no IndexedDB.
- Viewport: 1280x800, deviceScaleFactor 2, full-page screenshots.
- 01-fresh-boot.png — the app at its real ready marker (`#coda-status` = "Ready."), seeded state, before any user data.
- 02-in-use.png — after the e2e spec's own interactions: New note ("Welcome to Coda", saved to "Saved.") + Add task via the pre-armed one-shot dialog lane ("Task created.").
- Re-runnable: `bun apps/coda/scripts/capture-usage.mjs [--port P]` — output overwrites the stills in place.
