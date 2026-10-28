# The Cadence demo's session record

> The receipt behind the landing page's live-demo **gallery**: what the
> habit & streak tracker round built, the eleven agent sessions that built
> it, what each stage's testing found, and the ten documented embedding
> patches.

- [What the app is](#what-the-app-is)
- [How it was built](#how-it-was-built)
- [What the testing found (and fixed)](#what-the-testing-found-and-fixed)
- [The embedding adaptations](#the-embedding-adaptations)
- [Where things live](#where-things-live)

Related pages: [Sigil Bazaar session record](bazaar-demo-session.md) (the
commerce round — the gallery's second app) · [Sigil Focus session
record](live-demo-session.md) (the kanban round — the gallery's first app) ·
[tui capture workflow](tui-capture-workflow.md) (the capture lane the
round's stills came from).

This page is the receipt for the landing page's live-demo **gallery** — the
[Cadence](https://unown-nine.vercel.app/cadence) app (the cadence round)
running in the visitor's browser beside
[Sigil Focus](https://unown-nine.vercel.app/demo) (the kanban round) and
[Sigil Bazaar](https://unown-nine.vercel.app/bazaar) (the commerce round).
It records what was built, by what, in how many sessions, with what
verification, and what was changed to embed it. Every number the band
prints is defined here or in `live-demo-data.ts`'s header.

## What the app is

Cadence — a fullstack habit & streak tracker, a deterministic seed:

- **Dashboard** — check-off toggles for every habit (streak chip per habit,
  current / best / on-track metrics); a "N of M done" progress line;
  empty state when no habits.
- **Per-habit heatmap** — a 52-week × 7-day grid (`role="grid"`,
  `role="cell"`); each cell's swatch carries the date in its `title`
  attribute; the intensity legend shows the 5-level scale.
- **52-week stats chart** — `toWeeklyBars` (one `WeeklyBar` per ISO week,
  trailing 52 weeks) rendered as an inline SVG (`role="img"`, 52+
  `<rect>` bars); target line from the habits' weekly targets.
- **Habit CRUD** — name + glyph + frequency (daily or weekly with 1–7
  target); form validates in real time (submit disabled until valid;
  empty-name guard); a `Probe` component confirms no mutation on
  invalid submit.
- **Theme** — a dark / light toggle (`.cadence-scope` wrapper, not
  `<html>`, so an embedded demo cannot restyle the host page); the shell's
  header shows the "live demo" tag when `embed=true`.
- **Keyboard shortcuts** — `1`/`2`/`3` for views, `t` for theme, `?` for
  the help overlay (focus trap + Escape close).
- **API routes** — `GET /cadence/api/habits`, `POST /cadence/api/habits`
  (400 with field-level errors on bad input, 429 when rate-limited);
  `GET /cadence/api/checkoffs`, `POST /cadence/api/checkoffs` (400 on
  unknown habit / bad date / 400-date cap; 201 upsert, idempotent).
- **Persistence** — in-memory store seeded deterministically (no clock,
  no `Math.random`); localStorage with `SEED_VERSION` tag; the store's
  single-commit effect fires on user actions and is spied by the test
  suite to prove the commit path works.

## How it was built

Written end-to-end by `unown` — the pi coding agent under the self-learning
layer — driven through seven rounds, on 2026-10-28, against the Agnes AI
endpoint (`agnes-3.0-flash`) through the bundled llm-bridge. The host
sandbox caps each shell at ~10 minutes, so each round ran as a chunked
resume-chain of one session; the receipts ledger therefore counts 11 boots
for 9 phase-turns:

| Round | What happened | Receipts |
|---|---|---|
| Plan | `--plan` mode: a 14 KB numbered plan; approval overlay | 1 boot |
| Lib | Domain layer: `types.ts`, `seed.ts`, `streaks.ts`, `stats.ts`, `validation.ts`, `persistence.ts` (62 tests) | 1 boot |
| API | Route shells: `habits/route.ts` + `checkoffs/route.ts` (87 tests total) | 1 boot |
| UI | 10 UI component files + `format.ts` helpers: `shell.tsx`, `dashboard.tsx`, `habit-card.tsx`, `habit-form.tsx`, `heatmap.tsx`, `stats-chart.tsx`, `stats-band.tsx`, `habits.tsx`, `primitives.tsx` (96 tests total at round close) | 1 boot |
| E2E | Live browser E2E over CDP: check-off → streak recalculates live, CRUD form, heatmap 364 cells, stats 52 bars, embed reset `postMessage` wiped the created habit | 2 boots |
| Review | `/review` TUI round: 6 reviewer subagent boots; findings fixed | 1 boot |
| Drill | `/checkpoint` / `/undo` / `/commit` drill through the real TUI | 1 boot |
| Landing | The review-fix + integration session (this round's Part A + B) | 1 boot |
| Re-review | `/review` again after the fixes: no P0/P1; the two P2s below | 1 boot |

*1,381 `tool_call` rows total across the round's receipts
(`.unown/receipts/*.jsonl`) — 11 agent sessions, 15 boots, including the
9 reviewer-subagent boots; 6 auto-checkpoints were written along the
way.

- **Commits**: `94d7cb1` → `6dbb439` → `286ffba` → `513dfc5` →
  `b0429a3` → `be450e2` → `008d206` + this round's close.
- **Tests**: 96 green across 8 files (5 lib + 2 api + 1 component).
- **Files**: 30 under `src/` (11 components incl. 1 test file, 12 lib
  incl. 5 test files, 7 route/layout/css incl. 2 api test files).
- **Zero human edits to the app's code**: every line in the demo repo the
  agent wrote; the briefs, the findings lists and the verifications were
  the operator's.

### What the testing found (and fixed)

- **E2E (the agent's browser pass)**: the per-habit detail panel was
  unreachable (the tab click did not navigate to the right view) and the
  habit cards had no keyboard affordance. Both fixed before the QA pass.
- **`/review` round**: the missing `force-dynamic` export (GET responses
  would freeze forever in a Vercel production build), the tautology test
  (`todayKey(AS_OF_DATE) === "" ? "" : "done"` — replaced with a real pin
  against the seeded state at the fixed `asOf` date), the unbounded
  `rateBuckets` Map (a spoofed-header flood could grow it without limit —
  a hard cap now bounds the map; the per-IP bound itself remains the
  acknowledged honest limit it always was, mirroring the bazaar pattern),
  and the in-place mutation of the seeded `entries` array (copy-on-write
  plus a 400-date cap). All four fixed.
- **The re-review** (after the fixes): no P0/P1 security issues; 2 of 3
  reviewers honestly marked failed (timeout — the range grew past the
  subagent wall clock). Its two P2s: the rate-limit key caveat (the
  pre-existing bazaar pattern, documented above) and a receipt-drift
  catch — this record's own test-file breakdown was wrong, which is what
  triggered the recount you are reading. Both resolved at round close.
- **A real Unown bug found along the way**: the `/review` TDZ crash in
  the merge step (`labels[i]` referenced before `labels` was declared —
  commit `b0429a3`). Found live by the round's pty-lane TUI pass (the
  crash ate a completed review's verdict), fixed in the agent source
  with the computation extracted into two pure functions, and
  regression-pinned in `pi-repo/packages/self-learning/test/
  review.test.ts`.

## The embedding adaptations

The app as **built** is untouched in the demo repo. The copy embedded at
`/cadence` carries ten documented host-integration patches (each with a
code comment at the site):

1. **Embed param read server-side** (`page.tsx`) — `?embed=1` is read
   server-side so the flag reaches the client tree as a PROP; the server
   render and the hydration render agree, React #418 never fires.
2. **Reset listener** (`store.tsx`) — an embed-only `message` listener
   (`{source: "unown-landing", type: "cadence-reset"}`) wipes persisted
   state and reseeds; origin-checked and shape-checked (never a bare
   `postMessage` trust).
3. **CSP headers block** (`next.config.ts`) — the `/cadence/:path*`
   source gets `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`
   (the same hardening as `/demo` and `/bazaar`).
4. **Gallery entry + copy** (`live-demo-data.ts` + `live-demo.tsx`) — the
   cadence app joins the two existing entries; the band's copy changed
   from "Two apps, live. Pick one." to "Three apps, live. Pick one.";
   the switcher's tab row renders a third pill.
5. **Test pins** (`__tests__/live-demo.test.tsx`) — the data-file test
   asserts ≥ 3 apps with distinct routes, posters, reset types and
   receipt docs; a new pin verifies the cadence reset posts
   `{source: "unown-landing", type: "cadence-reset"}` with the pinned
   origin.
6. **Poster** (`public/landing/cadence/poster.png`) — captured by
   `scripts/landing_demo_poster.mjs` from the running `/cadence` route;
   1440×900 @2x (2880×1800 IHDR).
7. **Receipt doc** (this file) — the full session record, mirroring
   `bazaar-demo-session.md`'s structure.
8. **AGENTS.md paragraph** (`src/components/landing/AGENTS.md`) — the
   band-5 paragraph now lists three apps, three reset types, and three
   rate-limited POST routes.
9. **README rows** (`README.md`) — the docs table gains a cadence row
   after the bazaar row; the "Landing page" prose paragraph extends to
   three apps.
10. **Copy-on-write + cap** (`checkoffs/route.ts`) — the in-place
    mutation of `seededEntries[habitId]` was replaced with a new-array
    copy-on-write; a 400-distinct-date cap rejects further POSTs with
    `400 {"error": "habit history full"}`.

## Where things live

- The app: `src/app/cadence/` (route + API routes),
  `src/components/cadence/`, `src/lib/cadence/`,
  `public/cadence/favicon.svg`.
- The landing band (the gallery): `src/components/landing/live-demo.tsx`
  + `live-demo-data.ts` (all three apps' receipt numbers), pinned by
  `src/components/landing/__tests__/live-demo.test.tsx`.
- The posters: `public/landing/cadence/poster.png`, captured by
  `scripts/landing_demo_poster.mjs` from the running `/cadence` route.
- The build repo (with the agent's receipts ledger) is preserved outside
  this repository at the cadence build environment; the receipt counts
  above derive from `.unown/receipts/*.jsonl` there.
- The round's TUI captures (PTY lane, pane-truthed) are preserved in the
  build environment; the blog post embeds three of them.
