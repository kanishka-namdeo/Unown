---
title: The Recital round: benchtesting memory as a real user
description: We drove the agent like a user on real work, then watched its own memory fail four different ways — and reverse-engineered five memory products to fix it.
date: 2026-11-11
lastmod: 2026-11-11
tags: [memory, engine, release]
type: feature
media: [/landing/tui/dashboard/stills/02-memory.png]
---

Every memory benchmark we had tested the machinery. The dream-side
plumbing, the poison defenses, the consolidation quality axes — all fed
synthetic notes into a pipeline and measured what came out. This round's
directive asked for the thing none of them measure: **benchtest the memory
system driving the agent like a real user on complex tasks and complex
scenarios.**

So that is what we did. A real scratch project with a planted bug — a CSV
parser that breaks on quoted fields. A real debugging session where the
agent actually fixes it. A knowledge update: strict date validation, new
render widths. A reversal: drop the strict rule, state a comment-style
preference, record a dated switch. Then fresh sessions asking questions
only memory can answer — against a fresh clone with no memory as the
control. Five probes, LongMemEval's five abilities, judge-free scoring.

Warm — the memory-injected arm — scored **3/5**. The two failures opened
four bugs, and the four bugs opened a teardown of five other memory
products that had already solved each one.

## The four ways a memory system can quietly fail you

**The reconcile pass deleted fresh evidence.** The extraction step
correctly minted the relaxed date rule; the reconcile verdict then deleted
BOTH sides of the contradiction — the old strict rule *and* the new
replacement — leaving the project's memory with no date rule at all. Ask a
fresh session about the current contract: "no information." Mem0 v3
solved this by making extraction ADD-only; Cognee watermarks entries as
consolidated-exactly-once. Our fix is a deterministic guard: a reconcile
DELETE on a memory born in the current batch is rejected — the
just-learned carrier of current state survives to the next pass.

**Extraction dropped stated conventions.** "Comments in sentence case, no
trailing periods" — stated by the user, applied across the codebase,
verified by tests. Never became memory. The extraction prompt had a lane
for pitfalls and workflows and infrastructure, none for *an instruction
every future session must follow*. CoALA's taxonomy calls this procedural
memory; it is now a first-class extraction target.

**Answer-only sessions polluted memory.** This one we found by accident:
after the QA battery, the auto-dream consolidated the QA sessions' own
exit notes. The warm arm's honest abstention — "No comment style is
specified" — became permanent project convention: *"no comment style is
mandated."* The negation of a real requirement. A cold session's
hallucinated date-validation "contract" became that project's first
memory. An answer with zero tool calls is unverified model output; it now
never rides a note.

**The reconciler invented history.** A merged temporal marker carried a
fabricated "previously stated as a future switch" clause — history the
memories never stated. Markers now cite only what the memories themselves
say.

## The indicator

The fresh-evidence guard works silently, which is a problem of its own —
"the system protected your just-learned rule" is exactly the moment worth
showing. So it shows: the dashboard's Dreams screen renders **⛨ N
protected** in emerald when the guard holds, the dream rows record the
count, and the live feed carries it.

## The proof

Post-fix, the same battery on a fresh project: **warm 5/5** — the current
date contract recalled from memory, the preference recalled, the dated
switch recalled, honest abstention where memory holds nothing. The cold
arm still hallucinates confident "contracts" and bizarre comment rules —
which is the memory's value made visible, not a scoring artifact.

The battery is now a permanent suite —
[`benchmarks/memory-recital/`](https://github.com/kanishka-namdeo/Unown/tree/main/benchmarks/memory-recital):
real sessions, real dreams, warm-vs-cold recall, plus edge probes for
concurrent sessions, QA-note contamination, and the engine-down outbox
arc. Its baseline run *is* the bug report; its green run is the receipt.

The full teardown — Mem0 v3, Zep/Graphiti, Letta MemFS, Cognee,
LangChain/LangMem — is in
[the round's records](https://github.com/kanishka-namdeo/Unown/blob/main/docs/TEARDOWN_2026-11-11_five-memory-systems.md).
The field converged on the same invariants from five directions; now
Unown's receipts say the same thing from a sixth.
