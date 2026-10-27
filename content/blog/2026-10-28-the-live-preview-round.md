---
title: "The live preview round: the landing page now runs what the agent built"
description: "Four sessions, ~200 tool calls, one fullstack app — and the landing page now runs it instead of showing a video. The category's first live agent-built demo."
date: 2026-10-28
lastmod: 2026-10-28
tags: [landing, demo]
type: feature
media: [/landing/demo/poster.png]
---

The builder round filmed the agent building an app — one prompt in, a green
test suite out, the whole thing on video. This round asks the harder
question a video can't answer: **does the artifact actually run?** The
landing page's new "Live demo" band answers it by running the app in your
browser. Not a recording of the app. The app.

<figure>
  <img src="/landing/demo/poster.png" alt="Sigil Focus — the kanban board app the agent built: four columns with seeded tasks, running live on the landing page" width="880" loading="lazy"/>
  <figcaption>The poster is a real capture of the route the band frames — the
  app boots seeded, so this is what a first-time visitor's board looks like.</figcaption>
</figure>

## What got built

**Sigil Focus** — a fullstack productivity app:

- a four-column kanban board (Backlog, Doing, Review, Done) with
  drag-and-drop cards carrying priority, labels and story-point estimates;
- a configurable pomodoro focus timer that attaches to a task and logs
  completed sessions against it;
- a stats view — 14-day SVG bar charts of tasks completed and focus minutes,
  all-time totals, and a day-streak calculation;
- localStorage-first persistence with best-effort API sync (Next.js route
  handlers for tasks, stats and a starter-template library);
- dark/light themes, a mobile layout where columns collapse to tabs, and
  keyboard shortcuts (`n`, `/`, `1`–`4`, `t`).

## How it was driven

Like a real user, not a demo script. Four sessions against the live stack
(`agnes-3.0-flash` through the bundled bridge):

1. **Build** — one prompt, the full brief; the agent planned six todos,
   scaffolded, built, tested, committed three times.
2. **Review** — a human testing pass found eight issues (a VLM design
   critique found the rest: dead vertical space, confusing empty states,
   chart cards that were mostly void); the agent fixed all eight and added
   demo-data seeding plus an `?embed=1` mode.
3. **Finish** — the review round hit its turn cap mid-work; a resume
   session verified everything and landed the commit.
4. **QA** — the agent verified its own app in a real browser: board render,
   task creation with a 201 from the API, drag-and-drop, a ticking timer,
   rendered charts. Verdict: SHIP.

The receipts: ~200 tool calls, four commits, 27 unit tests green, zero human
edits to the app's code — the full record, briefs and per-session ledgers,
is [docs/live-demo-session.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/live-demo-session.md).

## The honest engineering of embedding

An app that owns its document behaves differently from an app embedded in
someone else's. The integration surfaced (and fixed) real defects the
standalone app shipped with:

- **A hydration bug**: the embed flag was read from
  `window.location.search` inside a `useState` initializer — the server
  rendered one tree, the client another, and every `?embed=1` visit was a
  React #418 mismatch. The route now threads the flag from `searchParams`
  server-side.
- **A contrast defect**: the landing page's axe gate scans into the iframe,
  and the app's "High" priority badge read 3.85:1 on its dark surface —
  below WCAG AA. The badges moved to the -400 shades and now pass.

Both fixes live in the embedded copy with code comments; the app as the
agent wrote it is preserved untouched in the build record.

## Try to break it

The band's frame is sandboxed, lazy-mounted (an idle visit never pays the
demo's hydration cost — a poster still carries the first impression), and
has a working **reset** button (a postMessage handshake the app listens for
in embed mode) so every visitor is one click from the pristine seeded board.
There's also an **open full screen** hatch — the route is a real deployment,
and the full app (including its own header, theme toggle and API routes) is
one click away.

No other terminal coding agent ships this. Their landing pages show videos
of agents working; this one runs the working thing. [Go drag a
card.](/demo)
