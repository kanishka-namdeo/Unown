---
title: The todo unification round: why you saw two to-do lists in plan mode
description: The plan-steps widget and the seeded Todos panel both mounted after approval. This round made them one list — verified live, with receipts.
date: 2026-10-31
lastmod: 2026-10-31
tags: [planning, tui, verification]
type: feature
media: [/blog/2026-10-31-the-todo-unification-round/03-plan-approval-overlay.png, /blog/2026-10-31-the-todo-unification-round/04-plan-executing-one-list.png, /blog/2026-10-31-the-todo-unification-round/05-plan-step-done-overlay-flipped.png, /blog/2026-10-31-the-todo-unification-round/06-settled.png]
---

The bug report was one sentence: *"why am i seeing two to-do lists in the
plan mode?"* The honest answer took a root-cause pass to write — because
both lists were real, both were ours, and each had been shipped by a
different round without knowing the other existed.

## What you were seeing

Plan Mode V2 (the planning round) ends in an approval dialog. On approval,
the approved steps were rendered as a legacy `plan-steps` widget above the
editor — `[ ] step` lines advanced by `[DONE:n]` tags. But gap P-06 had
also shipped a plan→todo bridge: approval *seeded* the V2 todo overlay with
the same steps. Two widgets, two keys, both `aboveEditor`, stacked. The
seed hook shipped without retiring the old widget.

Three more defects rode along: the `todo` tool was still available *while
planning* (nudging the model to build a second list mid-plan — Codex
rejects `update_plan` in plan mode with an explicit error for exactly this
reason); seeding *appended* instead of replacing, so approving plan B
stacked it on plan A inside one panel; and the seeded panel only mounted
after the model's first `todo` call — popping in late, next to the list it
duplicated. `[DONE:n]` tags and todo flips never synced, so the footer chip
could disagree with the visible list.

## The rule the fix enforces

We checked what every serious agent does before writing a line: OpenAI
Codex rejects the todo tool in plan mode at the tool layer; Gemini CLI's
plan-mode allowlist excludes `write_todos`; Claude Code keeps the task list
one live surface and never renders the plan as a second checklist. The
consensus is one sentence: **the plan is a user-approved proposal artifact,
the todo list is live execution state — exactly one progress surface may be
visible at a time, and the handoff happens once, atomically, at approval.**

So now:

- The seeded **Todos panel is the ONE checklist above the editor**. The
  legacy `plan-steps` widget is retired — it survives only as the fallback
  for a todo addon disabled via `/addons`, and the two can never be
  mounted in one process.
- Approval **replaces** the foreground list: ids rewind, one replayable
  seed entry lands, and approving a second plan never stacks it on the
  first. The panel mounts at the approval moment, not after the model's
  first `todo` call.
- The `todo` tool is **off the plan-mode toolset** while planning, and the
  overlay suspends while the PLAN chip is on — a leftover list never sits
  next to the plan's checklist. Your data is kept; approval or leaving
  plan mode brings it back.
- Progress has **two input paths that are the same list**: a `[DONE:n]`
  tag flips the matching seeded todo; a hand-driven todo flip completes
  the matching plan step. The footer chip, the mission panel and the
  panel always agree — and `/resume` reconciles both directions before
  the first paint.

![The approval dialog — the plan's checklist appears once, and nothing is seeded behind it](/blog/2026-10-31-the-todo-unification-round/03-plan-approval-overlay.png)

![Execution: the seeded Todos panel is the one checklist above the editor, with the plan chip in the footer](/blog/2026-10-31-the-todo-unification-round/04-plan-executing-one-list.png)

## Verified like a user

Eleven new tests pin the contract through widget-capture assertions (the
`plan-steps` widget never mounts while the addon is live; approval mounts
the seeded `unown-todos`; re-approval replaces; tags flip todos; todo
flips complete steps; resume reconciles both directions). But the headline
got more than that: a live PTY session drove the real TUI against the real
model — `/plan` on, a real task, the approval dialog, execution, settle —
and checked the literal pane text at every step. Then it checked the
session file, because panes are timing-dependent and truth isn't: the seed
entry count, the rewound ids, and the final agreement between the plan
state and the todo state on every matching step. **Fifteen checks, all
green** — including the one that matters most: no `[ ] ` plan-steps row
ever appears.

The lockstep evidence is the part we're proudest of. In the live run the
model used *both* input paths — `[DONE:1]`, then `[DONE:2] [DONE:3]`, plus
its own `todo` updates — and the plan state and the todo state advanced in
perfect lockstep, entry for entry, ending in the completion gate firing
with all steps done.

![After [DONE:n]: the flipped rows in the overlay, one list, no second checklist](/blog/2026-10-31-the-todo-unification-round/05-plan-step-done-overlay-flipped.png)

![The settle: the completion toast over the one list](/blog/2026-10-31-the-todo-unification-round/06-settled.png)

One honest note from the verification runs: the model is allowed to *add*
tasks mid-execution (the todo list is live state, not a prison), so the
overlay can legitimately show a task the footer chip doesn't count — the
chip tracks the *approved plan's* steps. That's not a desync; that's the
difference between an artifact and a workspace.

The receipts — findings F1–F6, milestones M1–M7, and the resumable session
log — live in
[the session doc](https://github.com/kanishka-namdeo/Unown/blob/main/docs/plan-mode-todo-unification-round-session.md);
the regression lane is
[`scripts/tui-capture/verify_todo_unification.py`](https://github.com/kanishka-namdeo/Unown/blob/main/scripts/tui-capture/verify_todo_unification.py).
