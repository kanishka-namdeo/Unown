---
title: "The spend-and-memory-health round: two honest misses become two honest cards"
description: The settings benchmark's two pinned search misses both flip — automation spend gets a meter and ceilings, memory gets a health card.
date: 2026-11-04
tags: [settings, memory, governance]
type: feature
media: []
---

The settings-ux benchmark has twelve pinned search queries — things a
user would actually type into the settings hub's search row. For two
rounds, ten of them hit and two missed, honestly: `spend` and
`memory health` missed because the features did not exist. The
benchmark's own receipt carried them as "honest misses, pinned queries
waiting." This round is what they were waiting for.

## The two gaps, as found

**Automation spend was visible per-run and bounded nowhere.** The engine
has a budget governor for its own learning jobs — 60 calls an hour, 2M
tokens a day, over-budget jobs skip with a recorded reason. But
routines — the scheduled, unattended agent runs a user creates — record
their tokens per run and nothing more. The governor's own settings row
documented the gap: automation spend "is NOT inside the engine
governor's ledger." The runaway-agent failure class is exactly here: a
routine that retries, chains, and loops overnight is a loop that costs
money while nobody watches the dashboard.

**Memory had no health surface.** The memory tier has per-item cards —
the stack, the caps, search, edit/rollback — but its maintenance pass
is fail-open by design: when the reconcile (the dedupe/retire/tighten
pass that runs inside a dream) fails both its LLM attempts, it logs a
warning and continues additive-only. The right behavior for a
maintenance pass. But nothing queryable survived the failure — the next
morning you could not ask "is my memory healthy?" and get an answer.
Duplicates and contradictions were counted nowhere; mem0's own issue
tracker documents the class (dedup that only checks exact hashes).

## What shipped

**The spend meter + ceilings (S2-11).** A pure windowed aggregation
over the runs table — per-routine and global, rolling 24h and 7d —
surfaced through the engine API, `unown routines spend`, and the hub's
new Automation spend meter card. Ceilings ride the same philosophy the
governor already drew: the engine's OWN self-initiated learning jobs
are bounded by default, while user-created routine spend is visible by
default and bounded on request — a per-routine `--spend-cap` (tokens
per rolling 24h) and a global `PI_AUTOMATION_MAX_TOKENS_DAY`, both
default OFF. Enforcement is graduated, not binary: at/over a ceiling
the dispatcher records a `spend_ceiling` skip (cap and drain time in
the reason, visible in history like a misfire skip) and leaves the
routine alone — as the window drains, it resumes on its own schedule.
A manual run-now bypasses the gate (a human asked for it) but its
tokens count toward the window. Both asymmetries are pinned.

**The memory health card (S2-4).** A pure computation: last-reconcile,
duplicate count over normalized text (case, whitespace, punctuation
folded — "Run tests" and "run  tests." are one memory), conflict count
over supersede links whose old memory still lives, and three warnings —
reconcile-failing, tier-at-cap, reconcile-stale-with-notes-pending. The
load-bearing piece is the **persistent warning lane**: the fail-open
branch now writes a durable record (a JSON sidecar in the mem0 dir)
that survives engine restarts, and any successful pass — including the
zero-op "nothing to reconcile" — clears it. The ephemeral console
warning became a queryable fact.

## The receipt

The benchmark's search lane re-ran on the landed tree: **12/12, 100%**
— `spend` at rank 2, `memory health` at rank 1. Thirty-one new pins
across both features; the full package suite at 5454/0.

One more thing the round receipts honestly: the division of labor. The
A2 agent sessions authored the bulk of both features across sixteen
budgeted chunks; the operator completed the parts the chunks left
mid-edit — including a real find: the first version of the spend gate
could loop forever, re-picking the same capped routine within a single
tick, because "the next tick re-evaluates" was implemented as
`continue` in a `while` loop. The gate test caught it. The receipts
carry every operator landing, every overclaimed FILE entry corrected
against the tree, and both deviation lessons — session contexts that
grow past a certain size degrade into re-diagnosis loops, and a
receipt's FILE claims must be tree-verified at the gate. The benchmark
was the net that made the honesty cheap.
