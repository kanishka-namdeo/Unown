---
title: "The cadence round: a habit tracker, a real bug in unown, and a three-app gallery"
description: "One round, every SDLC stage: planned, built, browser-QA'd, reviewed twice — and the review caught a TDZ crash in unown itself. Three apps live."
date: 2026-10-28
lastmod: 2026-10-28
tags: [landing, demo]
type: feature
media: [/blog/2026-10-28-the-cadence-round/dashboard.png, /blog/2026-10-28-the-cadence-round/heatmap.png, /blog/2026-10-28-the-cadence-round/stats.png, /landing/cadence/poster.png]
---

The commerce round asked whether the agent could carry a whole SDLC for one
app. This round asked the full version: **can it do that twice in a row —
while the tools it needs hold up under a real user?**

Short answer: the app shipped. A real bug in unown surfaced and got fixed
along the way. The gallery now frames **three** agent-built apps.

## What got built

**Cadence** — a fullstack habit & streak tracker at `/cadence`:

- a today view of check-off rows: per-habit streak chips, on-track state,
  a completion ring, and a "N of M done" line that moves as you click;
- a per-habit 52-week heatmap (364 cells, five intensity levels, dates on
  hover) with current/best streak, 30-day rate and total check-ins;
- habit CRUD with real inline validation (name bounds, 1–7 days-per-week,
  one-char glyph) — the server re-validates everything;
- a weekly stats view: KPIs, a hand-rolled SVG bar chart of 52 weeks, and
  a per-habit table;
- the same serverless-safe persistence as the other two apps: a
  deterministic seed (mulberry32, fixed integer, explicit clock — client
  and server agree byte-for-byte), a `SEED_VERSION`-tagged localStorage
  override, and an embed-only reset channel.

96 tests across 8 files pin the domain math — streak edges at
year boundaries, ISO-week alignment, seed determinism, validation tables,
persistence corruption paths.

![The Cadence dashboard — check-off rows with streak chips](/blog/2026-10-28-the-cadence-round/dashboard.png)

## How it was driven

Like the bazaar round, but longer — eleven agent sessions, every stage a
feature:

1. **Plan** — `--plan` mode produced a 14 KB numbered plan (file-by-file,
   lib-first build order, a per-file test plan, and a risk table for the
   flash-tier model doing the writing — including "keep components under
   250 lines" and "no `_v2` file variants"). The turn cap hit mid-plan
   honestly (`error_during_execution`, exit 1), the session resumed, the
   plan landed in one turn.
2. **Build** — domain lib first (62 tests), then store + API routes +
   route shell (87 tests), then the UI (96 tests). The todo tool tracked
   every phase; the verify lane typechecked after each file; the note
   tool fed the engine, and the engine dreamed memory between sessions.
3. **Browser QA** — the agent drove the app it had just written through a
   real Chromium over CDP: checked a habit off and watched the streak tick
   2 → 3 and the header count 4 of 6 → 5 of 6, created "Evening walk"
   through the real form, counted the heatmap's 364 cells and the chart's
   52 bars by `eval`, then flipped to `?embed=1` and fired the landing
   page's reset `postMessage` — the created habit vanished, the six
   seeded habits returned. It found a real bug doing this: the habit
   detail panel was unreachable (a click handler never wired), fixed
   live with keyboard affordances added.

![The per-habit heatmap — 52 weeks by 7 days](/blog/2026-10-28-the-cadence-round/heatmap.png)

## The part where unown itself broke

The round's `/review` — three parallel reviewer subagents over the whole
diff — completed, and then **crashed**: `Cannot access 'labels' before
initialization`. A temporal-dead-zone bug in the merge step: `labels[i]`
was used inside `results.map(...)` three statements before `const labels`
was declared. Every review, on any repo, lost its verdict at the last
moment — the pure-function tests couldn't see it because they cover
`review.ts`, not the command wiring that shipped the bug.

Found live, fixed the same day: the computation now lives in two pure
functions (`reviewerLabels`, `parseReviewerOutputs` — labels exist
before any use, structurally), with regression tests pinning the label
order and the results-pairing. The re-review ran clean end-to-end.

The first review's verdict was an honest **DO-NOT-SHIP** — the frame
headers and the gallery entry were missing (they were the next phase).
The re-review after the fixes: no P0/P1 security issues. Its one
substantive catch: a receipt-number drift in the session record — the
reviewer checked the receipts against the prose, found the test-file
breakdown wrong, and the recount you are reading is the result. That is
the loop working.

## The gallery

The live-demo band now frames three apps — **Sigil Focus** (`/demo`),
**Sigil Bazaar** (`/bazaar`) and **Cadence** (`/cadence`) — one persistent
iframe, `src` swapped on the switcher, receipt chips that swap with the
tab, a per-app reset, and a poster-first lazy mount so an idle visit
never pays the hydration cost. The new entry's chips are the round's own
receipts: 11 sessions, 1,381 tool calls, 30 files, 96 tests, 8 commits,
10 embedding adaptations — every number with its source in
[the session record](https://github.com/kanishka-namdeo/Unown/blob/main/docs/cadence-demo-session.md).

The frame-hardening headers ship with the route (`frame-ancestors 'self'`
+ `X-Frame-Options: SAMEORIGIN`), the API routes are `force-dynamic`
(a production build would otherwise freeze the first GET forever — the
review caught that too), and the review's other findings are all fixed:
the rate-limit map is capped, the checkoff writes are copy-on-write with
a 400-date bound, a tautology test got a real pin.

![The stats view — 52 weeks of bars plus per-habit KPIs](/blog/2026-10-28-the-cadence-round/stats.png)

## Try to break it

Visit the [landing page](https://unown-nine.vercel.app/#live-demo), pick
the Cadence tab, check a habit off twice (unchecking is the point), create
a habit with a 300-character name (the form and the server both say no),
open a heatmap, then hit reset — the world you broke goes away, the seed
comes back. No other terminal coding agent ships one live agent-built app
on its landing page. This one ships three.
