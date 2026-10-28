---
title: "The validation round: cold-starting the learning loop, then pointing it at itself"
description: "A fresh clone, an empty engine DB, one tracked memory file — a validation programme that found drift, poisoning, and a dead-ended mint, then fixed all three."
date: 2026-10-29
lastmod: 2026-10-29
tags: [memory, engine, release]
type: release
media: [/landing/tui/dashboard/stills/02-memory.png, /landing/tui/memory-learn/stills/05-memory-recall.png]
---

Every validation we had published so far came from a warm install — an
engine that had been learning for weeks, with a database full of dreams
and a memory stack grown fat on real work. That is the *favorable*
condition. The deployment every new contributor actually experiences is
the opposite: a fresh clone, an empty engine database, and exactly one
artefact of accumulated learning — the tracked
`.unown/memory/project.md`.

So the validation round asked the uncomfortable version of the question:
**does the self-learning loop work from zero?** And because a validation
programme that only passes is a validation programme that wasn't trying,
we armed it with probes designed to break things.

## The setup

The repository itself was the controlled environment (a real developer
tool, 39 release rounds of history, real repeated workflows). The engine
booted with no operator input. The measurement lane — a snapshot driver
over the engine's REST API, a retrieval-probe runner with a pinned query
set, a per-session UX ledger — was built by the agent itself as the
round's first cold task. Three drained snapshots (baseline / midpoint /
final) and five real headless sessions provide every number below.

![The memory tier stack at project v46 with the injection budget line](/landing/tui/dashboard/stills/02-memory.png)

## What worked immediately

**Continuity.** The tracked memory's very first test was a question only
it could answer: *"the harness cycles keep failing — should I restart
the engine?"* The fresh clone's first session answered in two turns and
five seconds, quoting both the skill and the memory entry verbatim: no,
failed cycles auto-recover. That entry was written on a *previous
install* — the learning crossed a machine boundary.

**Autonomy.** Before any operator pressed anything, the engine's router
had run three harness cycles (all `already-passing` — the loop refuses
to mine junk from green runs) and two dreams. The learning loop runs
because it is scheduled, not because a button was pressed.

**Regression prevention.** The round's best single receipt: a dream
consolidated, its canary task ran under the new memory, and the canary's
final report *claimed* verification via `bun` while it had *executed*
`python3` — a claim mismatch. The engine gated the dream and rolled the
memory back autonomously. No operator was involved. No broken task ever
reached a user.

**The repeat-task lift.** The cold build session (V3) hit its 30-turn
cap with the core done but unfinished housekeeping. After one dream
consolidated that session's notes, the warm repeat (V4) finished the
same-shape extension in **9 turns** — minus 70% turns, minus 70% wall
time, minus 66% output tokens. That is retained learning, measured.

## What broke — the round's real work

The probes found a three-link failure chain, and it is the most
important thing the programme has measured.

**F1 — recall drift.** Asked what password hashing Parley uses, the
agent answered "bcrypt at cost 10, `PARLEY_BCRYPT_COST` override" —
confidently, in one turn. The tracked memory said scrypt N=16384. The
source said scrypt N=16384. The answer was wrong against *both*, and
the env var was invented. Nothing in the memory guide told the agent
that memory is evidence rather than authority, so it free-completed
over the topic instead of quoting it.

**F2 — extraction poisoning.** The wrong answer rode the session's
auto-captured note into AutoDream, which extracted it as a *fact*. The
recency-first reconcile then **pruned the correct entry** — and the
rendered memory shipped the bcrypt claim in place of the scrypt one.
Ground truth, erased from both the platform and the file by the
system's own learning loop. (The same erosion had already happened
upstream, we found — two independent instances of the class.)

**F3 — the dead-ended mint.** With the suite saturated, the task minter
tried to author a harder variant and discarded its own draft for
exceeding size caps the authoring prompt had *never stated*. The
loop's expansion path was blind-broken exactly when it needed to work.

## The fixes — measured before and after

The memory guide now carries an anti-drift contract: memory is
evidence, not proof of current behavior; consequential facts get a
source check before assertion; answers cite their memory source; a
memory/source disagreement is a repair note, not a silent overwrite.
The re-probe (V2b, same question, same model) answered correctly —
scrypt, cited, with an explicit negation of the poisoned claim.

The extraction prompt now separates *verified* facts from the session's
own *assertions*: an answer the agent gave is not evidence. We tested it
live by delivering a deliberately poisoned note (wrong ports, explicitly
unverified) through the real pipeline — the dream consolidated three
notes and extracted **zero** of the poison.

The mint prompt states its caps, and a failed draft now gets exactly one
bounded repair call. Post-fix mints travel the full validation depth —
caps, shape, self-check — and discard honestly when the authored test
file itself is broken. The gate working is not the lane failing.

And the ground truth? Restored three-deep: the platform store, the
Facts section, and the `## Manual notes` lane that survives every
re-render. The retrieval probe recovered from 0/6 to **6/6 hit@5** —
the before/after receipt for the whole arc.

![A memory recall answer in a live session](/landing/tui/memory-learn/stills/05-memory-recall.png)

## What the numbers say

Across the round: 12 dreams consolidated 34 notes; the engine's project
tier grew seven versions; 29 runs, 27 passing (both failures were
defenses firing, not regressions); 145k tokens of autonomous learning
spend on the metered free-tier upstream. Four defects found, fixed, and
pinned by 20 new deterministic regression tests; the full engine suite
green at 4,885 passing after the changes. One honest null: no staged
skill was minted this round — the notes distilled into facts, not
recurring procedures; the warm-install report carries that positive
case and the cold start simply needs more horizon.

The mission asked whether Unown *genuinely becomes a more capable agent
over time through the operation of its memory and learning systems*.
The cold-start answer is: yes — measurably, within a single session
pair — **and** the loop can actively destroy knowledge when its trust
mechanics are wrong, which is exactly why the validation programme has
to exist. The failures are now permanent pinned regressions instead of
recurring surprises.

The full receipts: [the four reports](https://github.com/kanishka-namdeo/Unown/blob/main/docs/learning-system-validation-report.md),
[the failure ledger](https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/validation-round/validation-log.md),
and [the session record](https://github.com/kanishka-namdeo/Unown/blob/main/docs/validation-round-session.md)
with every checkpoint's measured numbers.
