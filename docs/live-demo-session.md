# The live demo's session record

This page is the receipt for the landing page's **live demo** band — the
[Sigil Focus](https://unown-nine.vercel.app/demo) app running in the visitor's browser. It records what
was built, by what, in how many sessions, with what verification, and what
was changed to embed it. Every number the band prints is defined here.

## What the app is

Sigil Focus — a fullstack productivity app:

- **Kanban board** — four columns (Backlog, Doing, Review, Done), drag-and-drop
  cards, per-card priority / labels / story-point estimate, search.
- **Focus timer** — a configurable pomodoro (25/5 default) that attaches to a
  task and logs completed focus sessions against it.
- **Stats** — 14-day SVG bar charts of tasks completed and focus minutes, an
  all-time totals row, and a day-streak calculation.
- **Persistence** — localStorage-first (the app works with no backend), plus
  Next.js API routes (`/demo/api/tasks`, `/demo/api/stats`,
  `/demo/api/templates`) exposing the same operations server-side with a
  best-effort client sync.
- **Polish** — dark/light themes, mobile layout (columns collapse to tabs),
  keyboard shortcuts (`n` new task, `/` search, `1-4` column jump, `t` theme).

## How it was built

Written end-to-end by `unown` — the pi coding agent under the self-learning
layer — driven like a real user, in four sessions on 2026-10-27/28, against
the Agnes AI endpoint (`agnes-3.0-flash`) through the bundled llm-bridge:

| Session | What happened | Tool calls | Active span |
|---|---|---|---|
| 1a | Plan + scaffold + core lib (killed early by the host sandbox) | 23 | 53s |
| 1b | Resumed (`unown -c`): full app build, scaffold→features→tests, 3 commits | 84 | 606s |
| 2 | Review round: 8 findings from real-user testing + VLM design critique | 89 | 525s |
| 3 | Finisher (session 2 hit its turn cap mid-work): verify + commit | 4 | 40s |

A fifth session (38 calls + a 33-call browser subagent) ran the QA round —
the agent verified its own app in a real browser (board render, add task,
drag-drop, timer tick, stats charts) and shipped a SHIP verdict.

- **Commits** (the demo repo, `agent-demo/`): `df7676d` scaffold → `44dca80`
  full app → `fc593bc` tests → `c6ff4df` review fixes.
- **Tests**: 27 assertions-green unit tests across 4 files (stats,
  persistence, templates, demo-data) — converted from the agent's vitest
  imports to the repo's `bun:test` when integrated.
- **Files**: 30 source files (8 components, 11 lib modules + tests, 3 API
  routes, layout/page/CSS).
- **Zero human edits to the app's code**: every line the agent wrote in the
  demo repo, the agent wrote. The brief (below) and the verification were
  human; the code was not.

### The brief the agent was given (session 1)

> Build me a fullstack productivity app called "Sigil Focus" in this
> directory. It will be showcased as a live interactive demo on a marketing
> site later, so the UI must work standalone in a browser (client-side
> persistence) while still being a genuine fullstack app. *(…10 numbered
> requirements: kanban + DnD, pomodoro, stats, localStorage-first + API
> routes, themes, shortcuts, vitest tests, a11y, verification with build +
> tests + production server boot.)*

Session 2's brief was the eight-finding review round (board layout,
empty states, stats card sizing, footer contrast, view-tab hierarchy,
favicon 404, demo-data seeding + reset, `?embed=1` mode).

## The embedding adaptations

The app as **built** is untouched. The copy embedded at `/demo` carries four
documented host-integration patches (each with a code comment at the site):

1. **Hydration-safe embed flag** (`use-app-store.ts` + `app/demo/page.tsx`) —
   the standalone app read `window.location.search` inside a `useState`
   initializer: server render said `embed=false`, client said `true`, and
   every `?embed=1` visit was a React #418 hydration mismatch. The route now
   threads the flag from `searchParams` server-side. *(Found live the moment
   the landing page first iframed the route.)*
2. **Scoped stylesheet** (`app/demo/globals.css`) — the standalone app's
   `html`/`body` element rules would restyle the landing's shared elements;
   the embedded copy scopes them to a `.sigil-scope` wrapper, and
   `@source` directives keep its Tailwind pass off the landing's trees.
3. **Frame reset channel** (`use-app-store.ts`, `persistence.ts`) — an
   embed-only `message` listener ({source: "unown-landing",
   type: "sigil-reset"}) wipes the persisted store and reseeds the demo
   board, powering the section's "reset" button.
4. **Sync opt-out in embed mode** (`use-app-store.ts`) — the in-memory
   server store boots empty, so a client-seeded board's best-effort PUT sync
   could only 404 into the embedder's console; the frame skips the sync
   (localStorage remains the source of truth) while the standalone `/demo`
   route keeps the full sync story.

Plus one adaptation in `app-shell.tsx`: `AppShell` accepts an optional
`initialEmbed` prop (threaded by the route) — the no-prop call is unchanged.

## Where things live

- The app: `src/app/demo/` (route + API routes), `src/components/sigil/`,
  `src/lib/sigil/`, `public/sigil/favicon.svg`.
- The landing band: `src/components/landing/live-demo.tsx` +
  `live-demo-data.ts` (the receipt numbers), pinned by
  `src/components/landing/__tests__/live-demo.test.tsx`.
- The poster still: `public/landing/demo/poster.png`, captured by
  `scripts/landing_demo_poster.mjs` from the running `/demo` route.
- The original build repo (with the agent's receipts ledger) is preserved
  outside this repository at `agent-demo/` in the build environment; the
  receipt counts above are derived from
  `.unown/receipts/2026-10-27*.jsonl` there.
