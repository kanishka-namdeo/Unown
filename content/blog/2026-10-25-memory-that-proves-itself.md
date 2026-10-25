---
title: The memory that proves itself before it ships
description: How Unown turns session notes into four-tier project memory, why the files stay plain markdown, and what the engine verifies before keeping any of it.
date: 2026-10-25
tags: [memory, engine]
type: feature
media: [/landing/tui/memory-learn/memory-learn.mp4, /landing/tui/memory-learn/memory-learn.webm, /landing/tui/memory-learn/stills/01-fresh-session-v0.png, /landing/tui/memory-learn/stills/02-task-done.png, /landing/tui/memory-learn/stills/03-note-recorded.png, /landing/tui/memory-learn/stills/04-second-session-learned.png, /landing/tui/memory-learn/stills/05-memory-recall.png, /landing/tui/memory-learn/stills/06-lesson-applied.png]
---

Every coding agent you have used is a goldfish. Unown's founding bet is that this is fixable without magic: write down what actually happened, consolidate it under supervision, and refuse to keep anything a fresh sandbox has not proven. This post walks the whole lane — note to memory to next session — with the real captures.

## The lane in one pass

The reel below is a real two-session run, captured from the actual TUI (the same audited footage the landing page's capability dex ships):

<video controls muted playsinline width="880" poster="/landing/tui/memory-learn/stills/01-fresh-session-v0.png">
  <source src="/landing/tui/memory-learn/memory-learn.mp4" type="video/mp4"/>
  <source src="/landing/tui/memory-learn/memory-learn.webm" type="video/webm"/>
</video>

A fresh session, a task done, a note recorded — then a *second* session that starts already knowing the lesson:

![The second session opens with the learned memory already injected](/landing/tui/memory-learn/stills/04-second-session-learned.png)

That second banner is the whole product. Everything else in this post is the machinery that makes it trustworthy instead of spooky.

## The four-tier stack

Memory in Unown is **files on disk, re-read for every session** — the terminal agent never opens a database, and anything you can inspect you can `cat`. The stack is four tiers, ordered by authority:

| Tier | File | Who writes it | What it is for |
|---|---|---|---|
| 0 · policy | `~/.unown/memory/policy.md` | you (ops / enterprise) | non-negotiable guardrails; a built-in default applies when absent |
| 1 · project | `.unown/memory/project.md` | AutoDream | verified project practice — the tier this post is mostly about |
| 2 · user | `~/.unown/memory/user.md` | you | global preferences across projects |
| 3 · local | `.unown/memory/local.md` (gitignored) | you, freely | scratch overrides that never leave the machine |

Most-specific-wins, with `local.md` holding the final say on a conflict and the policy tier as the floor every session keeps. Each file is labeled with its authority when presented to the agent, so the model knows which voice outranks which.

## The note — what a session actually hands over

Every session ends by handing the background engine a note. The note is not a transcript dump: it is a structured artifact (the same template the landing page's loop band renders as a literal, gated against the source that writes it) — what the task was, what was attempted, what worked, what failed, and anything worth keeping. The template lives in the engine's terminal hooks, so a note's shape is a contract, not a vibe.

![The note is recorded at session end — structured, not a transcript dump](/landing/tui/memory-learn/stills/03-note-recorded.png)

## AutoDream — consolidation with a guardrail habit

The `auto-dream` job (every 10 minutes, plus a wake-up when notes pile up) runs the consolidation pass:

1. **Quarantine or admit** — structurally flagged notes never reach the extraction LLM at all.
2. **Extract** — admitted notes go through the platform pipeline as atomic, deduplicated, scoped memories. (Since 2026-10-22 the engine underneath is the open-source Mem0 platform running in-process; the swap decision, the options table and the receipts are in the repo.)
3. **Reconcile recency-first** — contradictions resolve toward the most recent evidence, and an invalidated rule may not appear anywhere as current practice.
4. **Render deterministically** — the project tier file is rewritten in the familiar topic sections, capped at a bullet budget, never deleting hard-won rules to save space.

Since the platform swap, the project tier's file is a deterministic *render* of engine-side memories — so there is exactly one database in the loop, it lives in the engine's data directory, never inside your project. The file you commit stays plain markdown.

## The proof — nothing is kept until a sandbox says so

The step that separates this from "vibes-based memory": consolidated rules are **verified before they are kept**. The harness round-trips candidate memories through fresh sandboxed runs — and the landing page's own claim line is the contract: *refuses to keep any of it until a fresh sandbox has proven it twice*. The quality axes of that verification (interference, forgetting, staleness, contradiction) are measured with committed receipts, and the numbers the landing page prints are read from those receipt files — a figure with no receipt prints as "not measured" and never as a guess.

## Rollback, because memory that cannot be un-written is a liability

Every consolidation is versioned in the engine database. The dashboard's Memory screen shows the full history with one-key rollback and a per-version diff against its predecessor — "what did that dream change?" is a lookup, not a by-eye comparison of two dumps. Your project's memory file being plain markdown means restoring any state is a paste, and the next dream re-renders from platform state.

## Try it

The whole lane runs locally against any OpenAI-compatible model:

```bash
unown setup      # point it at a model
unown            # work; end the session — the note is written
unown memory     # read the tiers yourself
```

The memory tier files are in your repo and your home directory. Cat them. Diff them. Put the policy tier under source control and watch the guardrails hold.
