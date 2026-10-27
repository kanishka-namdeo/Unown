---
title: "The long-run round: what breaks when the agent works for hours"
description: "Nine endurance scenarios drove Unown through 150-turn buildouts, forced compaction and kill-resume torture — five layered defects found and fixed."
date: 2026-10-27
lastmod: 2026-10-27
tags: [release, stress, memory]
type: release
media: [/landing/tui/dashboard/stills/01-overview.png]
---

The subagent stress round drove breadth. The browser stress round drove
hostility. The round nobody had run yet was **duration** — what happens to a
coding agent when a single task takes a hundred and fifty turns, when the
context window fills mid-task, when the process is killed mid-work and
resumed, when the engine runs its learning loop for the better part of an
hour with terminal traffic feeding it.

That round ran on 2026-10-27. This post is the record, including the part
where a five-layer defect chain came apart in our hands, one calibration run
at a time.

## The testbench

`benchmarks/longrun/` ships a fixture built for duration: **ledgerlog**, a
tiny expense-ledger CLI with a ten-feature staged buildout — category
filters, CSV round-trip, monthly summaries, budgets, an undo stack, an audit
journal, recurring templates, and finally a versioned persistent store with
a migration path. Implementing all ten in one session is a genuine
80–150-turn task: context accumulates, tool results pile up, compaction
becomes load-bearing.

Scoring is anti-tamper by construction: the acceptance suite belongs to the
bench, never enters the agent's workspace during the session, and is copied
in only at scoring time. The agent cannot see, edit, or delete what grades
it.

Nine scenarios, each pinned to documented failure modes from other agents —
METR's time-horizon research, Terminal-Bench's timeout doctrine, tau-bench's
repetition-consistency metric, k6's soak methodology, and the GitHub issues
where Claude Code users watched auto-compact eat their sessions
([#105086](https://github.com/anthropics/claude-code/issues/105086)), Codex
users watch it never fire ([#14447](https://github.com/openai/codex/issues/14447)),
and Gemini CLI users watch a model think in circles for hours
([#26116](https://github.com/google-gemini/gemini-cli/issues/26116)).

## Finding LR-1: the cap that contradicted itself

The smallest scenario found the first defect in seventeen seconds. Run
`unown -p "…" --max-turns 8` and let the cap land mid-tool-work: stderr said
*"--max-turns 8 reached — the answer so far stands"*, and then, two lines
later, *"the run ended without an answer."* Both from us. In the same
transcript.

The deeper problem was underneath: pi's print mode prints nothing at all
when a run's last message is the aborted one — so the documented contract
"**a cap with an answer is still exit 0**" was unreachable. Every mid-work
cap exited 1 with an empty result, and automation callers lost the partial
answer entirely.

The fix has two halves: the cap-time note no longer promises an answer the
exit path hasn't computed yet, and the exit path now recovers the last
*settled* assistant text — a capped run exits 0 carrying its real partial
answer, with `capped: true` and `capped_answer_recovered: true` in the
envelope so callers know exactly what happened.

## Finding LR-2: the compaction that never came

The compact-thrash scenario shrinks the model's context window to 40k
tokens and asks for six features plus the persistent store. The pre-fix
result was a corpse:

```
turn 15: stop=length  out=82    ← the output budget, clamped to nothing
turn 16: stop=length  out=1     ← the retry: a 1-token empty completion
         error: the run ended without an answer (exit 1)
```

The root cause is architectural: **pi checks auto-compaction only at
agent_end and pre-prompt.** A 150-turn buildout is ONE agent loop — there is
no boundary at which compaction is ever checked. The context grows into the
window, the output budget is clamped to scraps, and the run dies as what
looks like an upstream fault.

The engine has had its own mid-run curve since M3.7. The terminal lane had
nothing. Five calibration runs later, the terminal twin shipped with every
layer of "why didn't that work" fixed:

1. **The curve** — warn at 70%, compact at 85%, evaluated in
   *reserve-aware* space (`window − reserve`), because the output-clamp
   death zone starts at `window − reserve`, which for a small window sits
   *below* the plain 85% mark.
2. **The continuation** — pi's `compact()` is stop-the-world by design (it
   aborts the loop; `prompt()` refuses submissions during compaction), so
   `cmdPrint` now orchestrates: compaction settles, then an honest
   "continue exactly where you left off" round is submitted *in the same
   session*. The transcript keeps every completed turn and stays resumable.
3. **No abort at the hard limit** — a single large tool result can jump the
   context from 72% to 116% in one turn, leapfrogging the 85% bucket;
   aborting there kills runs pi's own overflow recovery saves. Any ≥85%
   decision compacts and continues.
4. **`keepRuntimeAlive`** — `runPrintMode`'s exit path always disposed the
   runtime, and dispose aborts in-flight compaction. A one-line
   backwards-compatible pi patch makes the caller own the dispose. (This
   one hid for a full calibration run: self-learning resolves pi through
   `dist/`, so the patch sat invisible in `src/` until a rebuild.)
5. **Watchdog guards** — the print hard-exit re-arms while a compaction is
   in flight, and a new `agent_start` cancels any armed exit timer: a
   running turn is not "finished".

The post-fix run: **nine mid-run compactions, every one followed by a
continuation round, 150 turns, exit 0, every committed feature intact.**
The transcript shows the whole story — work, warn, compact, continue — and
the session file resumes cleanly.

## The rest of the round

The marathon (ten features, one session) passed at **9/10 features** — the
one miss is a genuine agent defect the acceptance suite caught (CSV-import
skip warnings on stdout; the spec says stderr). Turn-cap and loop-guard
passed with the exit contract honest in both directions. Kill-and-resume,
the notes storm, the 45-minute engine soak with live terminal traffic, the
governor/breaker fidelity drill and the ralph chain round out the nine —
receipts with verdicts, checks, and full metrics for each land under
`benchmarks/longrun/results/`.

![Mission control — the live-feed surface the endurance scenarios were observed against](/landing/tui/dashboard/stills/01-overview.png)

## What this round did not cover

One model, one OS, one small box, and a metered ~20-request-per-minute
upstream that is deliberately part of the stress. The soak ran 45 minutes,
not the k6-canonical eight hours — the knob exists
(`--soak-minutes`), the verdict math is duration-independent, and the
honest limitation is written down in the bench README. The next round knows
where to start.
