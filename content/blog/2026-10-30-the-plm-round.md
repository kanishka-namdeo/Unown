---
title: "The PLM round: unown now tracks itself as processes"
description: "A 12-state machine for every engine activity, governed tool invocations, a recovery ledger — and the machine caught its own wiring bugs live."
date: 2026-10-30
lastmod: 2026-10-30
tags: [plm, observability]
type: feature
media: [/blog/2026-10-30-the-plm-round/processes-screen.png, /blog/2026-10-30-the-plm-round/tools-screen.png]
---

The premise of the round: an agent system that wants to improve itself has
to know what it is doing — not at the anecdote level ("a dream ran at
some point") but at the ledger level. Every job execution, every sandboxed
run, every terminal session, every tool call, every failure and every
recovery becomes a first-class record with a state machine behind it.
Then the system runs on itself, and the receipts get measured.

## The state machine that bites its own wiring

Twelve states — CREATED, PLANNED, QUEUED, RUNNING, WAITING, BLOCKED,
RETRYING, VALIDATING, SUCCEEDED, FAILED, ABANDONED, ARCHIVED — with every
legal edge in one table. Transitions are events: each edge appends a row
to an append-only journal, history is never edited, terminals are sticky
(a zombie's late finalize is a no-op), and nothing bypasses an edge.

That last clause is not aspirational. The first live run of the new code
found the engine log saying:

```
[plm] refusing process transition …: CREATED → RUNNING is not a legal edge
```

The router's job wiring had taken the shortcut; the machine refused;
successful jobs were finalizing as ABANDONED-with-a-success-outcome. The
fix walks the honest path — the scheduler pick-up is a real QUEUED state —
and a pinning test now asserts the full four-transition chain so the
regression can't return silently. A second live catch followed: a
recovery row carrying `category=infrastructure` with `action=retry`, two
taxonomies mixed in one row, because the text-derived plan had overridden
the explicit producer category. Fixed and pinned the same hour.

## Tool calls became governed executions

Every tool invocation — engine lane and terminal lane — lands in a ledger
with OTel GenAI-aligned fields: name, category, purpose, duration,
success, failure class, owning process. The dashboard's new Tools screen
turns that into per-tool reliability rows (success rate, avg/p95, retry
load, the engine/terminal lane split) plus recommendations with concrete
fix lines. By the end of the round the detector had minted its first live
finding on real data:

> `bash: success 83% over 12 calls (2 failures)` → *"mine a recent
> failing invocation's transcript and mint a regression task"*

The failures themselves were classified `logic` — the agent's output
failing its own verification during a task-minting solvability run — not
`tool`. That distinction is the point: the ledger separates "the tool
broke" from "the work failed", which is what makes the recommendation
actionable.

## Failures become classified recoveries, not log lines

A nine-category taxonomy (tool, planning, context, logic, memory,
dependency, model, infrastructure, workflow) classifies every observed
failure into a deterministic plan — root cause, action, retryability —
and the ledger walks planned → executed → validated. A job that finishes
well after a failure validates its own recovery row; a repeat failure
ages the attempt and exhausts honestly at three. Even the boot-time
orphan healing participates: an interrupted engine's stuck processes are
healed state-aware (running work → FAILED, parked work → ABANDONED) and
the heal itself is recorded end-to-end — the round's live recovery score
reads 100% over exactly the event the restart produced.

## Checkpoints, replay, and proof chains

Every engine-run finalize writes a validation checkpoint carrying the
replay contract (objective, prompt, tool invocation shapes, verify
outcome); replay runs compare against them and record matched or
diverged. And the learning-attribution ledger now requires a proof chain
for every claimed improvement — failure, improvement, benchmark, before
and after scores, retention on a rerun, regression check — with the
honest null when nothing has shipped yet: this round's ledger is empty
because the harness found every task already passing, and an empty
proof-required ledger is the honest state, not an embarrassment to be
padded.

## Where to look

`unown dashboard` → the new **Processes** screen (accelerator `0`) drills
into any process's full transition history; **Tools** carries the
reliability rows; **Recovery** grew the engine scorecard; the **Learning
Lab** got the attribution footer. The engine API grew
`/api/plm`, `/api/processes`, `/api/tools`, `/api/recovery`,
`/api/checkpoints` and `/api/learning/attribution`. Everything is
telemetry-only — `UNOWN_PLM=0` disables every new write and the agent
behaves identically either way.

The receipts: [the session log with the validation ledger](https://github.com/kanishka-namdeo/Unown/blob/main/docs/plm-round-session.md),
[the process lifecycle report](https://github.com/kanishka-namdeo/Unown/blob/main/docs/process-lifecycle-report.md),
[the tool lifecycle report](https://github.com/kanishka-namdeo/Unown/blob/main/docs/tool-lifecycle-report.md)
and [the research pass behind the design](https://github.com/kanishka-namdeo/Unown/blob/main/docs/plm-competitor-research.md).
