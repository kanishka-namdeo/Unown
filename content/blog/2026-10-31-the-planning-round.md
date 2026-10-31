---
title: "Plan Mode V2: the round where unown learned to actually plan"
description: "A scored plan file, an approval gate, and two mechanical convergence lanes took plan mode from zero plans produced to 100/100 — with receipts."
date: 2026-10-31
lastmod: 2026-10-31
tags: [planning, benchmark, release]
type: feature
media: []
---

Plan mode was unown's weakest surface — and we knew it because we measured it.
This round rebuilt it around one idea: **a plan is an artifact with a quality
bar, not a paragraph that happens to end a turn.** The result, on the same
task, model, endpoint and turn cap: **0 plans produced at v0.0.48 → 3/3 plans
at a mean score of 100/100** with Plan Mode V2.

## How it works now

Planning has a workflow with teeth:

1. **EXPLORE** — read-only tools, budget-aware. At 50%, 75% and 100% of the
   planning-turn budget (default 15 model calls, never more than 60% of a
   `--max-turns` cap), the context escalates from "wrap up exploration" to
   "write the plan NOW".
2. **CLARIFY** — questions only the user can answer, batched; never anything
   the code could have answered.
3. **DRAFT** — the agent writes the plan to `.unown/plans/<slug>.md` with the
   new `plan_write` tool — the **only writable path** while planning. The file
   is the artifact: diffable, editable in `$EDITOR`, compaction-proof.
4. **CRITIQUE** — `plan_write` **scores the plan 0-100** on seven dimensions
   (objective, context, approach, steps, risks, verification, clarity) and
   tells the model exactly what is missing. The model iterates until the
   score clears the threshold (default 70). Same plan in, same score out —
   no LLM judge, reproducible receipts.
5. **EXIT** — `exit_plan_mode` opens the approval gate: **execute with
   auto-accepted edits**, **execute with per-edit approval**, **edit the plan
   in $EDITOR** (re-scores, re-asks), or **keep planning** with feedback that
   goes straight back to the model. Approval converts the steps into todo
   tasks, titles the session, and hands the plan to execution.

Around the workflow: Shift+Tab cycles default → acceptEdits → plan;
`/plan <description>` seeds the objective; `--plan-model <id>` runs a
stronger model for planning and the session model for execution (the
*opusplan* lane); ACP editors (Zed) can switch a live session into plan mode;
every approval, rejection and completion leaves a learning note for AutoDream.

## Why: the two failure modes we had to fix mechanically

The honest part. Our first V2 attempt kept the convergence rules as prompt
instructions — and the free-tier model ignored them completely:

- **The exploration spiral** — a 25-turn run that was 15 greps, 7 reads, 7
  bash calls and zero plan calls. Instructions don't converge weak models;
  the **turn budget** does.
- **The narration stop** — worse: the model would end its turn with "Now let
  me look at how settings.json's `theme` key is consumed…" and the run would
  *complete*, plan-less, exit 0. A text-only turn ends the agent run — so
  plan mode now **re-triggers the turn** (max 3 nudges) until the plan file
  exists or the model genuinely asks you something.

Both gaps were reproduced live, filed in the
[Planning Gap Register](https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/plan-mode/GAP-REGISTER.md)
(P-01…P-17b, each with reproduction, root cause, regression test and fix),
and closed with the lanes above. The register also records what we
deliberately did not build and why — no headless auto-approval (the gate is
the safety property), no plan DAGs (flat steps + todos match what agents
actually execute).

## Receipts

- Benchmark before/after with per-task JSONL:
  [`benchmarks/plan-mode/RESULTS.md`](https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/plan-mode/RESULTS.md)
  — baseline: two runs, zero plans, the second at a 45-turn cap; after: 3/3
  at 100/100, every step file-annotated, 4 risks with mitigations per plan.
- The gap register:
  [`benchmarks/plan-mode/GAP-REGISTER.md`](https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/plan-mode/GAP-REGISTER.md)
- The competitor research behind the design (Claude Code plan files and
  ExitPlanMode, Gemini's plan approval and Pro→Flash routing, Roo's
  architect mode, OpenHands' PLAN.md schema, Aider's architect/editor split):
  [`docs/plan-mode-competitor-research.md`](https://github.com/kanishka-namdeo/Unown/blob/main/docs/plan-mode-competitor-research.md)
- Usage and behavior contracts:
  [`docs/usage.md`](https://github.com/kanishka-namdeo/Unown/blob/main/docs/usage.md) ·
  [`docs/BEHAVIOR.md`](https://github.com/kanishka-namdeo/Unown/blob/main/docs/BEHAVIOR.md)

The pt-1 plan the benchmark produced is worth reading on its own: it found
the real theme APIs in the vendored TUI (`getAvailableThemesWithPaths`,
`InteractiveThemeController`, `ThemeSelectorComponent`) and cited
line-accurate reuse points — a plan you could hand to a developer untouched.

One last thing worth recording: the release gate refused this round's own
tag. Cutting v0.0.50 tripped the release workflow's CI-green gate — two of
the round's own lanes were red on the tagged commit (a Windows-only path
assertion in the new plan-mode end-to-end test, and the landing page's
scroll budget, breached by the release rail's newest stop) — and the
workflow refused to build a single artifact until both were fixed. A
release that does not clear the repository's own gates does not exist;
this one now does, with the catch in the changelog.
