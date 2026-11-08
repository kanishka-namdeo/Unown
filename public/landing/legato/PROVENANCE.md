# Legato usage stills — provenance

- Captured: 2026-11-08 by `apps/legato/scripts/capture-usage.mjs` (the L-12 product-surface lane; the Chaconne/Fugue precedent ported).
- Servers: `bun apps/legato/serve.mjs` on 4017 (the real transpiling dev server; `LEGATO_PORT` reserved for the app lane) + `bun apps/legato/scripts/fixture-server.mjs` on 4018 (the B-16 hostile fixture substrate, `LEGATO_FIXTURE_PORT` — NO live network; every clip URL is a 127.0.0.1:4018 fixture).
- Browser: headless Chromium (the e2e lane's own install, repo-root `@playwright/test`), ONE FRESH context per still — no service worker state, no IndexedDB, no localStorage leftovers.
- Viewport: 1280×800, deviceScaleFactor 2, viewport-clipped screenshots (not fullPage — the band's declared dims are the IHDR 2560×1600, matching the Fugue/Chaconne precedent).
- Keyboard-first: every navigation is a `page.keyboard` press or the app's own palette command dispatch (the Ctrl+K → type-filter → Enter lane, the Ostinato K-1 precedent). The clip affordance's URL form is filled + submitted by keyboard; the tag editor's add lane is the input's own Enter keydown handler (zero pointer events except the two row clicks that open the detail pane — the list.ts's `row.addEventListener("click", onOpen)` lane, which the app itself treats as an activation twin of Enter on the focused row).
- Schemes: light only (the band's identity set; dark is not committed to the band — the Fugue/Chaconne house decision).
- 01-empty-light.png — the honest empty state ("No clips yet", the Q-3 never-blank law).
- 02-list-light.png — the clip list seeded with REAL clips via the app's own keyboard clip flow against the 4018 fixtures: `clean.html` (B-16 clean row), `redirect-chain` (the 3-hop 302 chain ending clean — the T-2 lane's positive half), `paywall-excerpt.html` (the T-4 excerpt+link lane).
- 03-detail-highlight-light.png — the reading view (the clean story's extracted body) with one highlight created via the app's own `h` key lane (the selection-to-`<mark>` binding, L-8's no-silent-truncation contract).
- 04-palette-light.png — the command palette OPEN via Ctrl+K (the 9-command enumeration, the honestly-stubbed rows dimmed with their ticket names, filter-as-you-type, the keyboard-first identity shot).
- 05-filterbar-light.png — the tag filter bar with two REAL tags ("reading", "reference") seeded through the app's own tag editor (the `t` key in the detail view, the Ostinato dialog contract's attach-before-focus + Tab-trap + Esc focus-return lane).
- 06-hostile-light.png — the hostile-clip honest outcomes: two degraded rows from the app's own clip flow against `walled-403` (the T-3 js-walled fallback lane: title+URL+flag, never a bypass) and `wrong-charset.html` (the T-1 charset-unknown lane, never mojibake) — the taxonomy as product surface, the "Clipped (degraded: …)" status lane visible.
- Re-runnable: `bun apps/legato/scripts/capture-usage.mjs [target-dir]` — the stills overwrite in place.
