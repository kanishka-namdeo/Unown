---
title: The Memory Encore round: eleven teardowns, four delight surfaces, one arity bug
description: Eleven product teardowns shaped four surfaces: freshness dates on every rule, a session-start recall line, exact-context show, a visible health card.
date: 2026-11-12
lastmod: 2026-11-12
tags: [memory, engine]
type: feature
media: [/landing/tui/dashboard/stills/02-memory.png]
---

The Recital round asked whether the memory loop *works* — and drove it like a
real user until four bugs fell out. This round asked the question that comes
after: **works, yes — but can you see it?** Does a user sitting in a fresh
session know their memory was injected? Can they see a rule going stale? Can
they answer "is my memory even loaded?" without trusting us?

To answer it honestly we went back to the field — and this time not to the
five memory platforms the Recital round tore down, but to the surfaces users
actually touch: the coding agents and the second-wave memory systems. Eleven
products, every claim sourced, in
[docs/memory-encore-round-research.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/memory-encore-round-research.md).

## What the field proved

Three findings shaped everything we shipped:

**1. The recall moment is the most-iterated memory UX in shipping agents.**
Claude Code's "Recalled 2 memories" line went through four changelog
iterations — the notice, then clickable filenames, then a verbose file list.
Windsurf, which retrieves memories invisibly, gets "I haven't seen it make
much difference" on Hacker News. Visible memory reads as value; invisible
memory reads as nothing.

**2. Freshness metadata is now table stakes.** Claude Code stamps every
memory file with a `modified` date "helping Claude reason about which
memories are fresh vs. stale". Copilot goes further: un-refreshed memories
expire at 28 days, with A/B numbers behind the discipline (+3% precision,
+4% recall for code review; +7% PR merge rate for the coding agent — their
memory system carries citations and verifies them just-in-time against the
branch).

**3. Cursor killed its Memories feature.** Auto-extracted, injected-when-
relevant, managed in a settings list — and deprecated in favor of file-based
rules. The lesson we took: whatever we automate must stay inspectable, or it
reads as creep rather than help. (The forum is now full of third-party
memory products for Cursor — the demand did not die with the feature.)

## What we shipped

**Every learned rule now carries its last-confirmed date.** The project
memory file renders `- run tests with bun test · 2026-11-09` — and past 28
unconfirmed days, `- … · 2026-09-13 · stale`. The date is honest by
construction: it is the platform's `updatedAt`, so a later dream that
re-asserts the rule refreshes it. Evidence that keeps arriving stays fresh;
evidence that stopped arriving says so. Seeds and legacy rows without a
parseable timestamp stay bare rather than carrying a fake date. The memory
guide teaches the semantics to the agent: a stale rule is weaker evidence —
verify before asserting. `PI_MEM0_STALE_DAYS` is the knob (0 turns the
marker off; dates stay).

**A session-start recall line.** One dim line at boot — `◈ memory recalled:
14 rules · v17 · dreamed 12m ago — /memory show` — printed once per process
when the project has learned rules, silent for fresh projects. Our
footer-quiet contract keeps the healthy engine state invisible, which is
right for a footer and wrong for recall: this line is the affirmative
"your memory was injected" signal, and it works with the engine down because
it reads the project's own files.

**`/memory show`.** Prints exactly what the model receives this session —
every tier's content with its provenance line, the injected guide, per-tier
char counts, and the injection-budget tail (pruned/head-truncated/OVERFLOW
named, never silent). `/learning` shows the stack's metadata; `/memory show`
shows the payload. `full` lifts the 60-line display cap — the model always
receives the full stack, only the display trims.

**The memory health card, visible at last.** The audit — last reconcile,
duplicates, supersede conflicts, live warnings — has existed since the SM-2
ticket, but only through the API and the doctor. The dashboard Memory screen
now renders it under the injection-budget meter: one quiet fact line, one
amber or rose badge per live warning. Visible audits build trust; invisible
ones read as creep.

## And the bug

The teardown's code-map pass found a real one: `engineUndreamedNotes()` in
the health card returned `(undreamedNotes ?? 0).length` — the imported
*function's* `.length`, which is its arity, always 2. The reconcile-stale
warning has been reporting a phantom "2 undreamed note(s) pending" whenever
the 7-day horizon tripped: an empty queue could never clear it, a real
backlog always read as 2. It now reports the real benchmark-lane count, with
a regression battery that uses five notes so an arity regression cannot pass
by accident.

## Verified like a user

The memory-recital benchmark re-ran live on the new code — the same
real-sessions-then-recall battery, stamps and all — and the PTY lane drove
the new surfaces through the real TUI: the recall line at boot, the exact
stack through `/memory show`, all green. The receipts ride the round log.

The honest gaps we did *not* ship, on purpose: per-fact citation metadata
(Copilot's strongest pattern — it needs an extraction-contract change that
deserves its own benchtested round) and graph retrieval over memory links
(HippoRAG 2's personalized PageRank; A-MEM's evolving note network). Both are
now on the record as future lanes with their evidence attached.

Memory that proves itself, round after round — that's the product.
