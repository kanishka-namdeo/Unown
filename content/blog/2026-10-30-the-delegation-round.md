---
title: "The delegation round: every spawn now says why"
description: "Unown 0.0.46: the why field, the delegation audit ledger, four specialist agents, and a measured 76→79 with the runaway-scout shape dead — receipts inside."
date: 2026-10-30
lastmod: 2026-10-30
tags: [subagents, observability]
type: release
media: [/landing/tui/dashboard/stills/delegation.png]
---

The most common complaint about subagents in the field is not that they
exist — it is that they are **unaccountable**. Claude Code's own tracker
has a measured 2.41B-token run where 71% of subagent tokens burned after
each agent's 80th step, and a user asking the agent to *state its premises
before delegating so I can correct early*. GitHub shipped a
trajectory-analysis-driven delegation fix and measured tool failures down
23%. The field knows delegation quality is the gap; almost nobody
instruments it.

This round, Unown did. **Every spawn now carries its reason.**

## What shipped

**The `why` field.** Every `task` call takes one line — *why you are
delegating this instead of doing it inline, and what you expect back*. It
is not decoration: it rides the tool result, the async ack, the fleet
delivery, `task_control status` and `/tasks`, it lands in the fleet
journal, and it reaches a new `delegations` table the dashboard renders.
In the after-benchmark the model stated it unprompted on 12 of 13 spawns:
*"Parallelism: user wants the count in the background while answering a
question inline."* That is the premises-before-delegation ask, answered.

**The audit ledger.** Both lanes' terminal spawns become records — why,
turns, tokens, tool calls, wall clock, outcome — in a per-session ledger
(`/delegation` card + footer chip), a cross-session engine aggregate
(`unown delegations`, the dashboard's new **Delegation** screen), and the
durable journal. Verdicts are receipts-only: a blocked or timed-out run is
*not worth it* by its own status, a clean run reports facts, and an
expensive one (≥100k tokens) is flagged for audit — never judged on vibes.

**The runaway is dead.** The baseline caught a scout burning **104 turns,
596k tokens and 111 tool calls on one question**, killed only by the 300 s
wall clock — the exact shape Claude Code issue #106025 measured in
production. The read-only agents now ship turn caps (24/24/40), and in the
after-run that lane finished in 43 s with all three scouts clean. Child
token spend fell 62%; total workload spend fell 54%.

**Four specialist agents.** `debug` (read-only, hypothesis-driven
root-cause diagnosis), `test` (baseline → write → re-run, completion
guarded), `security-reviewer` (severity tiers with exploit preconditions
and an INSUFFICIENT CONTEXT verdict), `documenter` (verified file:line
references, never invents APIs) — plus two project agents that audit
Unown itself: `delegation-auditor` and `benchmark-curator`.

## The receipts

The round ran a ten-axis benchmark on the live agent, before and after,
with every number receipt-backed
([the full delta table](https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/delegation-round/RESULTS.md)):

| Axis | 0.0.45 | 0.0.46 |
|---|---:|---:|
| User explainability | 56 | **92** |
| Progress visibility | 55 | **100** |
| Delegation quality | 86 | 84 |
| Overall | 76 | **79** |

The benchmark also caught three more failures during the round itself —
the print envelope shipping the interim answer on async deliveries, the
benchmark's own load saturating the dream trigger, and a benchmark session
mutating the working tree against the anti-tamper rule — each reproduced,
root-caused, fixed or honestly recorded in
[the F26–F38 ledger](https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/delegation-round/validation-log.md).
One new behavior is recorded, not hidden: the model sometimes over-retries
a delegation (five reviewer spawns for one review ask). That is the top
candidate for the next round, and it is exactly what the
`delegation-auditor` polices in production.

The honest limitations stand: n=1 per lane on a metered upstream, a
keyword-heuristic handoff score, author-scored rubric axes. The receipts
are committed so every number can be hand-audited.

## Why it matters

Delegation is the leverage move in agentic coding — a fresh context for
the work that would drown the parent's window. But leverage without an
audit trail is a bet you cannot price. With `why` on every spawn, a ledger
that answers *what did it cost and how did it end*, turn caps that kill
the runaway shape, and specialists with contracts instead of personas,
delegation becomes a decision you can inspect — during the run, after the
run, and a month later in `unown delegations`.
