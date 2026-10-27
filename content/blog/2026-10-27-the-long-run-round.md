---
title: "The long-run round: what breaks when the agent works for hours"
description: "Eleven endurance scenarios, 150-turn buildouts, forced compaction and kill-resume torture — five layered defects fixed, ten more in the runner itself."
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

Eleven scenarios, each pinned to documented failure modes from other agents —
METR's time-horizon research, Terminal-Bench's timeout doctrine, tau-bench's
repetition-consistency metric, k6's soak methodology, and the GitHub issues
where Claude Code users watched auto-compact eat their sessions
([#105086](https://github.com/anthropics/claude-code/issues/105086)), Codex
users watch it never fire ([#14447](https://github.com/openai/codex/issues/14447)),
Gemini CLI users watch a model think in circles for hours
([#26116](https://github.com/google-gemini/gemini-cli/issues/26116)), a
Claude Code session file corrupt mid-write under a kill
([#52387](https://github.com/anthropics/claude-code/issues/52387)), and its
RSS creep while sitting idle
([#67433](https://github.com/anthropics/claude-code/issues/67433)).

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

The post-fix run: **thirteen mid-run compactions, each settling into an
in-session continuation round, 256 turns, exit 0, all seven scored features
green** (01–06 plus the store).

The transcript shows the whole story — work, warn, compact, continue — and
the session file resumes cleanly.

## The rest of the round

The marathon (ten features, one session) passed at **9/10 features** — the
one miss is a genuine agent defect the acceptance suite caught (CSV-import
skip warnings on stdout; the spec says stderr). Turn-cap and loop-guard
passed with the exit contract honest in both directions. Kill-and-resume
(three staged SIGKILLs, zero orphan survivors, the same session resumed
clean every time and finished the buildout at 8/9 acceptance), the notes
storm (six queued notes, drained with zero dead letters, the dream lane
consolidating), the 45-minute engine soak with live terminal traffic, the
governor/breaker fidelity drill, the ralph chain, the torn-write
crash-consistency drill and the idle soak round out the eleven — receipts
with verdicts, checks, and full metrics for each land under
`benchmarks/longrun/results/`.

![Mission control — the live-feed surface the endurance scenarios were observed against](/landing/tui/dashboard/stills/01-overview.png)

## The runner was not exempt

The bench scores the agent; nothing scores the bench. The resumed round
surfaced the runner itself as a long-running task with its own failure
modes, and every one of them had to be fixed before a receipt could be
trusted:

1. The **engine-boot poll** passed a null token into an endpoint that is
   token-gated by design — every engine-booting scenario failed inside the
   runner before the agent was ever stressed, at any deadline.
2. The **kill-resume verdict math** read a gate-kill's SIGKILL as a cap
   breach and hunted the session file under the bare UUID the envelope
   reports — the agent aced the torture and the receipt said fail.
3. The **ralph-chain task** omitted the persistent-store note every subset
   prompt carries — the loop shipped both features, the reviewer said ship,
   and acceptance scored 0/2 on cross-invocation tests no agent could ever
   pass.
4. The **budget-fidelity lane** watched a lane the governor never governs —
   harness-cycle runs book tokens in the RUNS table while the governed mem0
   lane sits at zero calls, so the throttle could never fire on traffic that
   never happens. The dream lane is where the governor actually lives.
5. And the **collector deadlocked on its own kill**: a signal-slain child
   keeps a null exit code, and `close` fires before `collect()` attaches its
   listener — the runner that tortures agents with SIGKILL could not
   survive one itself.
6. The **engine-soak lane** sabotaged its own thesis twice: the jobs prelude
   toggled blindly (the endpoint is a flip, and jobs default ON — the soak
   disabled the very learning jobs it meant to enable, so no dream or run
   could ever happen and `learningHappened` was false by construction), and
   the terminal-session slot never freed after `collect()` resolved, so a
   forty-five-minute soak ran one of its eight planned sessions.
7. And the **crash-consistency check** contradicted the lane's own torture:
   the torn records it injects after each kill sit mid-file forever once the
   next resume appends after them, so "only the final line may be torn"
   could never pass — the check now catches only corruption the bench did
   NOT inject, which is the real defect class all along.
8. And both **soak lanes' slope math** lied a thousand-fold: a per-second
   delta scaled by the 3,600,000 milliseconds in an hour (the idle receipt
   said 41,784,000 "KB/h" for a true +7.5 MB/h plateau), and the warmup
   skip ended before the first ten-minute job wave, whose one-time
   worker-pool step read as a phantom leak — the slope is now taken over
   the settled tail, by its own clock.
9. And the **idle lane was never idle**: the engine's boot defaults enable
   every job, so its own harness-cycle fired at the first ten-minute tick
   and ran a full fizzbuzz cycle with real bridge spend, a sandbox spawn
   and a post-run event wave — one-time allocations that stepped the RSS
   twice mid-soak and read as phantom leaks. The lane now parks the
   learning jobs state-aware (housekeeping on — the engine breathing, not
   working), and the receipt proves they sat disabled, never ran.

Ten fixes across eight lanes. The receipts under `results/` are written by
a runner that has now been killed, crashed, resumed and starved alongside
the agent it scores — resume-safety is a property it holds because it was
tested for, not by accident.

## What this round did not cover

One model, one OS, one small box, and a metered ~20-request-per-minute
upstream that is deliberately part of the stress. The soak ran 45 minutes,
not the k6-canonical eight hours — the knob exists
(`--soak-minutes`), the verdict math is duration-independent, and the
honest limitation is written down in the bench README. The next round knows
where to start.
