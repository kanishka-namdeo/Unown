# The Sigil Bazaar demo's session record

> The receipt behind the landing page's live-demo **gallery**: what the
> e-commerce round built, the three SDLC sessions that built it, what each
> stage's testing found, and the nine documented embedding patches.

- [What the app is](#what-the-app-is)
- [How it was built](#how-it-was-built)
- [The briefs the agent was given](#the-briefs-the-agent-was-given)
- [What the testing found (and fixed)](#what-the-testing-found-and-fixed)
- [The embedding adaptations](#the-embedding-adaptations)
- [Where things live](#where-things-live)

Related pages: [cadence demo session record](cadence-demo-session.md) (the
habit & streak tracker round — the gallery's third app) · [live demo
session record](live-demo-session.md) (the kanban
round — the gallery's first app) · [live-preview competitor
research](live-preview-competitor-research.md) (the round's
reverse-engineering) · [tui capture workflow](tui-capture-workflow.md) (the
capture lane the round's stills came from).

This page is the receipt for the landing page's live-demo **gallery** — the
[Sigil Bazaar](https://unown-nine.vercel.app/bazaar) app (the commerce round)
running in the visitor's browser beside
[Sigil Focus](https://unown-nine.vercel.app/demo) (the kanban round). It
records what was built, by what, in how many sessions, with what
verification, and what was changed to embed it. Every number the band prints
is defined here or in `live-demo-data.ts`'s header.

## What the app is

Sigil Bazaar — a fullstack e-commerce demo, an arcane marketplace:

- **Storefront** — 16 products across 4 categories (Runes, Sigils, Relics,
  Tomes); search, category chips, four sorts; product cards with CSS-drawn
  glyph monograms (no binary image assets), stock badges, star ratings;
  a product-detail dialog with quantity and focus trap.
- **Cart** — slide-over drawer (bottom sheet on mobile) with quantity
  steppers, per-line subtotals, tax at 8%, shipping free over $50.
- **Checkout** — a 3-step wizard (shipping with inline validation, payment
  with Luhn/expiry/CVV checks, confirmation with a generated `SB-XXXXXX`
  order id); a validation-failing pass and a passing pass were both
  verified in the QA round.
- **Orders** — history view with status chips (Processing → Shipped →
  Delivered), seeded with 8 orders over 8–12 days so analytics have data
  from day one.
- **Owner dashboard** — KPI cards, a 14-day revenue chart (inline SVG with
  Y-axis ticks), top-5 products, category mix, an inventory table with
  low-stock highlights and Restock actions.
- **API routes** — `GET /bazaar/api/products`, `GET /bazaar/api/products/:id`,
  `POST /bazaar/api/orders` (400 with field-level errors on bad input,
  429 when rate-limited), `GET /bazaar/api/orders`,
  `GET /bazaar/api/analytics`; an in-memory store seeded identically to the
  client so both sides agree.
- **Persistence** — localStorage-first; only orders created in the browser
  session sync (one fire-and-forget POST per order — never a re-post of the
  seed); corrupt stored state normalizes on read.

## How it was built

Written end-to-end by `unown` — the pi coding agent under the self-learning
layer — driven like a real user through the three SDLC rounds, on 2026-10-27
and 2026-10-28, against the Agnes AI endpoint (`agnes-3.0-flash`) through the
bundled llm-bridge. The host sandbox caps each shell at ~10 minutes, so each
round ran as chunked resume-chains of one session (a chunk closes cleanly
through the real `/quit` path — session, receipts and note delivery persist
at a controlled moment — and the next chunk resumes with `-c`); the receipts
ledger therefore counts 25 session boots for 3 phase-turns:

| Round | What happened | Tool calls* | Receipts |
|---|---|---|---|
| S1 build | plan mode: the 13-point plan, the approval overlay, then the full app: scaffold → domain layer + components → API routes → tests → curl verification, 2 commits | ~460 | 3 chunks |
| S2 review | the eight-finding verified list (order-item denormalization, seed re-sync, badge grammar) + the 48-finding VLM design critique, verified claim-by-claim, 4 commits | ~250 | 2 chunks |
| S3 QA | the browser QA pass (a real-Chromium browser subagent: every view, a failing-validation checkout, mobile layout), one real UX bug found and fixed, the SHIP verdict | ~130 | 10 chunks |

*838 `tool_call` rows total across the round's receipts
(`sigil-bazaar/.unown/receipts/*.jsonl`), including the browser subagent's
calls; 9 auto-checkpoints were written along the way.

- **Commits** (the demo repo): `0ea5eca` scaffold → `79df2c9` full app →
  `141706d`/`e865b70`/`1dc6b9e` review fixes → `7e9d232` tree →
  `1c5beda` the QA fix (the brief and the review-findings staging commits are
  the operator's).
- **Tests**: 88 green across 7 files (the brief asked for ≥40; the review
  round added 9 for the two API fixes, the QA round the last 3).
- **Files**: 35 under `src/` (10 components, 16 lib incl. 7 test files,
  9 route/layout/css).
- **Zero human edits to the app's code**: every line in the demo repo the
  agent wrote; the briefs, the findings lists and the verifications were
  the operator's.

### The briefs the agent was given

- S1: `PRODUCT-BRIEF.md` (12 numbered requirements + a binding architecture
  contract — Next.js App Router, one shell with client-side view switching,
  pure-function domain in `src/lib/bazaar`, server-side `?embed=1`, no UI
  or chart libraries, ≥40 tests, curl verification on port 4317).
- S2: `REVIEW-FINDINGS.md` (list A verified findings; list B: the VLM
  critique at `VLM-CRITIQUE.md`, to verify claim-by-claim).
- S3: the QA-round prompt (browser verification of every view, a failing
  checkout pass, mobile; SHIP/REVISE verdict).

### What the testing found (and fixed)

- **S1 (my real-user pass)**: POSTed orders carried `name=productId,
  price=0` (denormalization missing — the API computed totals from the
  catalog but snapshotted nothing); every fresh load re-posted all 12
  seeded orders (14 POSTs per visitor — duplicates server-side); the cart
  badge said "1 items". A rebuild under a running server also left the
  production chunks 500ing — the verify flow now always restarts.
- **S2**: all three fixed with tests; the VLM critique yielded contrast,
  hierarchy and a11y fixes across all views (the app's own `WARN` token
  was bumped twice for AA).
- **S3 (the agent's browser QA)**: the checkout confirmation closed too
  fast (placeOrder closed the wizard before the confirmation could read) —
  found, fixed, re-verified in the browser pass. Verdict: **SHIP**, with
  the honest follow-ups noted (no server-side id-dedup — the client's
  synced-ids guard mitigates; chart tooltips only via the SVG `<title>`;
  mobile spot-checked at desktop width).

## The embedding adaptations

The app as **built** is untouched in the demo repo. The copy embedded at
`/bazaar` carries nine documented host-integration patches (each with a
code comment at the site):

1. **Scoped stylesheet** (`src/app/bazaar/globals.css` + `layout.tsx`) —
   the standalone app's `:root`/`html`/`body` rules would restyle the
   landing's shared elements; the tokens re-anchor onto a `.bazaar-scope`
   wrapper, `@source` keeps the Tailwind pass off the landing's trees, and
   the Geist webfonts became system stacks (one route must not ship a
   second font download).
2. **Frame reset channel** (`store.tsx`) — an embed-only `message` listener
   (`{source: "unown-landing", type: "bazaar-reset"}`) wipes the persisted
   store and reseeds, powering the band's Reset button; origin-checked and
   shape-checked (never a bare `postMessage` trust).
3. **Sync re-pointed** (`store.tsx`) — the standalone app's `/api/orders`
   becomes `/bazaar/api/orders` under the landing's routes.
4. **Seed versioning** (`persistence.ts`) — a `seedVersion` tag so a new
   demo seed reaches returning visitors (stale-tagged storage reseeds).
5. **Theme scope** (`shell.tsx`) — the theme toggle flips the scope
   wrapper's classes, not `documentElement` (the landing owns `<html>`).
6. **API rate limit** (`api/orders/route.ts`) — the public POST gets a
   per-IP fixed-window counter (10/min, per-lambda-instance semantics,
   GETs untouched).
7. **No future-dated seeds** (`seed.ts`) — found by the integration test
   pass at 00:04 UTC: same-day seed orders at fixed times-of-day dated the
   seed into the future after midnight; a same-day time still ahead of now
   is dated yesterday at the same time.
8. **Hooks before the early return** (`product-detail.tsx`) — the standalone
   app shipped `useState` below `if (!product) return null`, a
   rules-of-hooks violation (the hook list changes across renders of the
   same instance); the qty state resets through an effect keyed on the
   product id. The landing's lint gate caught it.
9. **The latest-ref sync moved into an effect** (`store.tsx`) — the
   standalone app assigned `productsRef.current` DURING render ("Cannot
   access refs during render"); the sanctioned pattern syncs it in an
   effect — for event handlers (the only readers) the post-render timing
   is equivalent. Also the landing's lint gate.

Plus the landing-side hardening this round shipped for BOTH demos: CSP
`frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` on the demo routes
(`next.config.ts`), the reset handshake pinned to `window.origin` (never
`"*"`), and the sandbox attribute trimmed of `allow-modals` (neither app
uses native modals).

## Where things live

- The app: `src/app/bazaar/` (route + API routes), `src/components/bazaar/`,
  `src/lib/bazaar/`, `public/bazaar/favicon.svg`.
- The landing band (the gallery): `src/components/landing/live-demo.tsx` +
  `live-demo-data.ts` (both apps' receipt numbers), pinned by
  `src/components/landing/__tests__/live-demo.test.tsx`.
- The posters: `public/landing/bazaar/poster.png`, captured by
  `scripts/landing_demo_poster.mjs` (now shoots every app in the gallery in
  one pass) from the running `/bazaar` route.
- The build repo (with the agent's receipts ledger) is preserved outside
  this repository at `sigil-bazaar/` in the build environment; the receipt
  counts above derive from `.unown/receipts/*.jsonl` there.
- The round's TUI captures (PTY lane, pane-truthed) are preserved in the
  build environment at `download/unown-round-captures/{s1-build,s2-review,
  s3-qa}/`; the blog post embeds three of them.
