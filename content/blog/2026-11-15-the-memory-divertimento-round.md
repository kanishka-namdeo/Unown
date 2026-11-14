---
title: "The Memory Divertimento round: the integrity lane, and memory you can carry"
description: Five new-wave teardowns shaped the integrity round: the review queue wired, the recall path sealed, deterministic supersession, reversible decay, export/import.
date: 2026-11-15
lastmod: 2026-11-15
tags: [memory, engine, interchange]
type: feature
media: [/landing/tui/dashboard/stills/02-memory.png, /blog/2026-11-15-the-memory-divertimento-round/the-review-queue.png]
---

The Encore round made the memory visible. This round made it *honest* —
because an in-repo audit found that three of the upgrades the field had
proven better were sitting in the codebase **half-shipped**.

The mission came in the shape we like: reverse-engineer at least five more
products and research lines, understand what they do that is *proven*
better by user experience or by measurement, then augment, fix, and
delight. The teardown landed in
[docs/TEARDOWN_2026-11-14_new-wave-memory-platforms.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/TEARDOWN_2026-11-14_new-wave-memory-platforms.md)
— five new-wave platforms none of the earlier rounds had covered — plus a
sweep of the 2025-26 papers and the consumer memory-UX field.

## What the field proved

**memU** (14.6k stars) pitches the store-verifies/agent-distills split and
a `doctor` command that *proves the loop* rather than asserting it.
**MIRIX** ships six typed stores — and its 2026-11-09 security review
fixed eleven defect classes, including deleted-memories-still-searchable
and a numeric-merge that averaged two contradictory values into one wrong
one. **Memobase** posts the round's clearest measured signal: temporal
QA at 85.05 on LoCoMo against the Mem0 store Unown runs at 55.51.
**Nemori** distills only prediction-error deltas — knowledge is what
surprised the model. And the papers: LightMem (ICLR 2026) hits 68.64% of
LongMemEval-S at ~57× token reduction; MemStrata measures
similarity-based conflict detection at **AUROC 0.59 — chance** — while a
deterministic (subject, relation, object) rule takes stale-fact errors
15-40% down to ~0%; CAMeR shows time-driven decay collapsing to zero
where use-conditioned reinforcement is the driver.

Then the audit turned inward, and the uncomfortable finding: our own v2
round had shipped the review queue as an orphan module with zero callers,
the recall path leaked superseded memories as current, and the per-type
budget had never replaced the flat cap. The field had proven all three
upgrades. We had written them and not wired them.

## The integrity lane

Three half-shipped upgrades, closed and pinned. The **review queue is now
the only write path** for model-inferred user-tier rules: a cross-project
promotion parks in a user-level inbox (`~/.unown/memory/review-queue/`,
one inbox across projects), and a human decides — `unown memory review`,
`/memory review`, the dashboard card, or the API. Approve ships to both
user tiers, but *re-verified at decision time*: re-deduped, re-guarded,
provenance naming the observing projects and the review decision.

![The review queue in the live TUI — the inbox, a discard verdict, an approve that ships, and the honest empty](/blog/2026-11-15-the-memory-divertimento-round/the-review-queue.png)

The queue in motion, from the round's live PTY verification: the inbox
listing (both candidates with their evidence), a discard-with-reason
verdict (kept for audit), an approve that ships, and the honest empty
afterwards.

The **recall path is sealed**: every search lane excludes superseded
memories by default — the soft-delete-leak class MIRIX's security review
fixed. The audit view (`--all`) shows them, badged, never bare.

And the **render budget is per-type** now: facts 40%, procedures 25%,
preferences 20%, episodes 15% of the cap, with a waterfall that returns
unused share — a single-type store keeps the old flat-cap behavior at the
same total.

## Deterministic supersession and reversible decay

The SRO layer tags each memory with its (subject, relation, object)
claim. Two live rows making claims about the same subject+relation with
different objects are a contradiction resolved *by recency alone* — no
similarity guess, because similarity measures at chance on exactly this
question. The loser takes bi-temporal stamps and stays for audit;
differing values are never merged or averaged (the MIRIX numeric-merge
class).

Dormancy is the decay lane: a live memory the render budget refuses three
consecutive times goes dormant — a badge and a reversible state, never a
deletion. One inclusion resets it; a search hit revives it.

`unown memory doctor` closes the loop the memU way: tier budgets, a LIVE
recall-seal probe (a superseded row answering a default recall bare is a
LEAK finding), the store's health, placement findings — an audit that
proves the loop per-run instead of trusting it.

## Your memory, in a file you can carry

The interchange is the round's last checkpoint, and the one the field
never proved the entering half of. ChatGPT's export proved memories can
leave in an open format; nobody proved how they *enter* another install
safely — and an import that auto-writes is the injection vector the
memory-poisoning literature keeps naming.

`unown memory export` writes a schema-v1 JSON file: every memory with its
text, type, SRO claim, last-confirmed date, provenance, supersede links
and dormancy. `unown memory import` reads one back through a trust gate
that assumes the file is hostile: document refusals never half-read a
file; per-record quarantine names the exact rule that fell; the
deterministic guard scans every line; superseded-at-origin rows never
re-import; duplicates converge instead of doubling — import the same
export twice, the second run parks nothing. And accepted records land in
the **review queue** by default, because imported content is untrusted
until a human says otherwise. `--apply` writes directly, through the same
re-guard lane, never around it.

The round shipped as a real race, too: two parallel lineages delivered
the interchange within the hour of each other. First-landing-governs (the
repo's coordination protocol); the second lineage's verified value — the
convergence dedupe, the pre-parse byte cap, honest attribution — folded
into the landed shape the same day.

## Verified like a user

The engine suite runs 5,727 green; the interchange round-trips live
against the running engine (export seven memories, import parks seven,
re-import parks zero with an honest duplicate count; a poisoned file
quarantines the attack and writes the clean rule). v0.0.66 shipped with
all fifteen release jobs green, binaries booted on six runners.

Fix what broke, prove the patterns, make it delightful — a divertimento.
The memory system now does all three.
