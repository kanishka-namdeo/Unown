# Ostinato usage stills — provenance

- Captured: 2026-11-04T14:39:53.682Z by `apps/ostinato/scripts/capture-usage.mjs` (O-5 chunk 1, the PWA tooling lane).
- Server: `bun apps/ostinato/serve.mjs` on scratch port 4015 (the real transpiling dev server, no build step; 4013 is the app's reserved dev port, so the capture lane takes 4015).
- Browser: headless Chromium (the e2e lane's own install), ONE FRESH context — no service worker state, no IndexedDB, no localStorage.
- Viewport: 1280x800, deviceScaleFactor 2, full-page screenshots.
- KEYBOARD-ONLY LAW: every interaction above is a `page.keyboard` press/type — zero pointer events, no `.fill()` (the K-1 zero-mouse lane extended from `e2e/ostinato-flow.spec.ts` to the capture lane).
- 01-fresh-boot.png — the honest empty state (`.ostinato-state` = "No decks yet").
- 02-palette.png — the command palette OPEN via Ctrl+K (the keyboard-first identity shot).
- 03-review.png — the review screen: deck "Terminal basics" created, card front "What does Ctrl+K open?" + progress "1 of 1".
- 04-revealed.png — the back face revealed with Space; the markdown bold "**command palette**" rendered as a <strong>. Left ungraded on purpose (the in-use state, not the done state).
- Re-runnable: `bun apps/ostinato/scripts/capture-usage.mjs [--port P]` — output overwrites the stills in place.
