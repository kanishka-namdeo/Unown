---
title: "The observability round: can you read your agent's state in 60 seconds?"
description: "A mission panel, a 60-second brief, a recovery card, receipts-only confidence and an ambient learning feed — the round the terminal learned to explain itself."
date: 2026-10-30
lastmod: 2026-10-30
tags: [observability, tui]
type: feature
media: [/landing/tui/observability-round/stills/01-mission-panel.png, /landing/tui/observability-round/stills/03-auto-brief.png, /landing/tui/observability-round/stills/04-recovery.png, /landing/tui/observability-round/stills/06-brief.png]
---

The mission was one sentence: *a developer should be able to leave the terminal for 30 minutes, return, and understand what happened, why it happened, what decisions were made, what was learned and what remains — within 60 seconds.* Everything unown already had — the turn meter, the engine state machine, the receipts ledger, an eleven-screen dashboard — was machinery. What the round found, auditing every surface against the seven questions (objective, task, progress, blockers, risks, confidence, next action), was that the machinery was strong and the **narrative** was missing: nothing pinned the objective on screen, ordinary turns had no progress signal, failures scrolled away, and learning lived behind the dashboard door. The full audit — 22 flagged ambiguities, eight benchmark tasks, a nine-level information architecture — is committed as [the TUI observability audit](https://github.com/kanishka-namdeo/Unown/blob/main/docs/tui-observability-audit.md); the field research behind it compared nine systems from Claude Code to OpenHands.

## The mission panel

A compact panel above the editor now pins the session's objective — an active `/goal` wins, else the `/mission` pin, else the session's own auto-title (the first prompt finally echoes as the mission it becomes). Below it, one status row: the derived progress meter (plan steps while executing a plan, else todo completion, else an honest `○ no tracked steps` — never a fabricated percentage), the confidence chip, and the session cost/time rollup. Fresh learning events and composed risks get their own rows only when they exist.

![The mission panel: the pinned objective, the progress meter, the confidence chip](/landing/tui/observability-round/stills/01-mission-panel.png)

## The 60-second brief

The old auto-recap was activity-shaped: *"3 turns, 14 tool calls."* The new brief is state-shaped. Return after an idle gap and the next prompt gets eleven lines that answer everything: `mission / happened / changed / last / why / conf / risks / learned / session / remains` — deterministic, no LLM on the prompt path. `/brief` renders it on demand and adds the decision miner: one pass through the side-question lane that names what the agent decided and why, never entering the transcript, receipts or AutoDream's mining.

![The auto-brief on return: eleven lines, every question answered](/landing/tui/observability-round/stills/03-auto-brief.png)

The trust test measured the headline claim honestly: after an 11-minute real idle window, the returning pane answers all five questions in one screenful — and the `learned:` line reported a dream that actually happened while away (`project memory advanced v4 → v5`), because the engine kept learning with nobody watching. The receipts are committed as [pane dumps](https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/observability/RESULTS.md) — the pane is truth.

## /recovery: failures with their fixes

Every ended tool call is classified once — tool error, verify failure, permission denial — from the producers' own markers. `/recovery` composes them worst-first with the engine state and dead letters, **each row carrying its repair path** (`/undo n`, `/engine`, the dead-letter directory), and the footer shows `✗ N to fix · /recovery` whenever anything needs attention. A clean session gets the clean bill — the card is also where you check that nothing broke. The dashboard gained the same answer at mission-control scale: a twelfth screen, Recovery, composing failed jobs, failed runs and recent denials from the existing screens' own data.

![The recovery card: every attention item with its fix path](/landing/tui/observability-round/stills/04-recovery.png)

## Confidence is receipts-only

`conf ✓ / ◐ / ✗` is computed from the session's own ledger — tool errors, verify failures, denials — never from the model grading itself. Any verify failure reads low; 1–2 errors or a blocked action reads medium with the drivers named next to the chip. The rules are pinned by tests, and the OB-8 lane verified live that a real `[auto-verify]` failure flips the chip within the same screen.

## The learning feed, ambient

Dreams shipped, memory versions, harness improvements and consolidated notes now land in-session: a `✦` chip counts unseen events, the panel carries the freshest, `/feed` shows the session's learning history with ages, and the brief reports what was learned inside the away window. The sources are the engine-status probe's existing dream-news gate plus a five-minute overview diff — zero new engine load. And the round's own benchmark caught the honest bug here: events landed in the ring but the chip only painted at the next turn — an idle session learned in silence. The fix (a push-listener that repaints the moment an event lands) is pinned and verified painting itself, live, in the OB-1 receipts.

## The dogfood ledger

The round used unown to improve unown, and three real defects fell out, each root-caused, pinned and fixed in-round: the persisted-digest `unknown` tools (stored entries carry `name`, the digest read `toolName`); the silent idle feed above; and the overview diff reading flat keys the engine nests under `kpis`. A fourth finding corrected the benchmark itself — kill the engine and the supervisor's gated auto-start *heals* it, narrating `memory engine online — learning resumed`; the contract is narration, never silence.

## What ships in it

The mission panel, `/mission`, the auto-brief, `/brief`, `/recovery` + the health chip, `/feed` + the feed chip, receipts-only confidence, the telemetry rollups, the dashboard's Recovery screen, 56 pinning tests, the PTY capture/benchmark/trust lanes, and the round's records — the audit, the competitor scorecard, the five user journeys, the trust & transparency report and [the UX principles card](https://github.com/kanishka-namdeo/Unown/blob/main/docs/unown-ux-principles.md). One lane is deferred honestly: fleet outcomes in the brief needs the FleetManager bridge, recorded as the next build.

![The on-demand brief with the decision miner](/landing/tui/observability-round/stills/06-brief.png)
