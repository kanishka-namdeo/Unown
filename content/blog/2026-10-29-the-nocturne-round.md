---
title: "The nocturne round: the agent built an incident-ops platform — and got better building it"
description: "Gallery app #7 — Nocturne, a multi-tenant incident-ops platform: 28 sessions, 473 tests, a 10/10 live browser pass, six failures pinned."
date: 2026-10-29
lastmod: 2026-10-29
tags: [gallery, learning, release]
type: release
media: [/landing/nocturne/poster.png]
---

The gallery's seventh app is live: **[Nocturne](/nocturne?embed=1)** — an
AI-native incident operations platform. Alerts arrive, deduplicate by key
and window, and correlate into incidents; escalation policies page the
on-call rotation tier by tier while an incident sits unacknowledged; SLA
timers run the ack and resolve clocks with breach detection; every
incident carries an event-sourced timeline, a runbook with a checklist,
and eventually a postmortem with action items; a public status page shows
each tenant's component health; and the analytics screen turns nine weeks
of seeded incident history into MTTA, MTTR, breach rate and on-call load.
It is the PagerDuty domain, deterministic demo scope, running in your
browser right now.

## The build

The familiar gallery pattern taken to its largest scale yet:
the agent explored its own six siblings read-only, wrote itself a
52,587-character build contract (every entity, every field, all ~50
routes with the full status ladder, the engine designs, the property
invariants), then executed it in phases — domain, API, UI, embed — across
**28 ledgered sessions, 104 files, 473 tests, zero human edits to app
code**. The closeout was a ten-step live Chromium pass that walks the app
exactly as a user would — login, dashboard, incident detail, acknowledge,
services, rotations, runbooks, analytics, the public status page, reset —
and it finished **10/10 twice consecutively with zero console errors**.

## The failure ledger

The round's real product, as always. Six failures, each with the full
chain — reproduction, root cause, the benchmark that now pins it, the
before/after rerun:

- **F8** — the operator's own launcher violated the detached-session
  contract and a shell timeout killed a live build session. The launcher
  was rebuilt; every session after ran clean.
- **F9** — a genuine P0: the API's `loginSession` read the id counter
  without bumping it, so two consecutive logins minted the *same session
  id* — the second user's cookie resolved to the first user's session.
  The API test lane surfaced it; the agent's fix loop circled it twice
  without converging; the operator traced it to the id allocator; fed the
  precise repro, the agent fixed it cleanly in 14 turns. The honest
  finding: the failure was *diagnosis*, not execution.
- **F10/F11** — the landing phase shipped a page/route segment conflict
  that broke the production build, plus four lint errors. The build and
  lint gates joined the closeout checklist.
- **F12** — the best catch of the round: the live browser pass exposed a
  provider/API shape mismatch (the detail lanes parsed a nested shape the
  routes never sent) that **31 passing component tests had papered over**
  — because they mocked provider state, never the real API shapes. The
  fix came with an error boundary and provider-shape regression pins.
- **F13** — the unauthenticated session probe logged a 401 console error
  on every anonymous visit. Aria had already solved this exact problem
  one directory away; the pattern was ported and pinned. The lesson about
  lesson *transfer* is recorded with it.

## The learning systems, live

The learning systems ran the whole time: AutoDream consolidated the
build's session notes into project memory as the work happened — the
escalation-invariant lesson it extracted mid-build was used by the very
next session — and minted the `fix-nocturne-seed-invariants` skill from
the build's own seed failure, which the operator promoted through the
staged-skills human gate and the later fix sessions then used. Mid-round,
the whole workspace was reset underneath us; every milestone had been
pushed, so nothing pushed was lost, and the un-pushed work was rebuilt in
an afternoon. The receipts for all of it — the plan, the per-session UX
ledger, the failure ledger, the engine learning-state snapshots at
baseline, midpoint and final — live in
[`benchmarks/nocturne-round/`](https://github.com/kanishka-namdeo/Unown/tree/main/benchmarks/nocturne-round).

## Go break it

The gallery now has seven apps, each built by the agent and each round
leaving the *next* round measurably better armed. Go break Nocturne — the
reset button works.
