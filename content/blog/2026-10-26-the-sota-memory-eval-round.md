---
title: "The SOTA memory-eval round: four suites, one real fix, and a bill paid"
description: "How our memory system earned its numbers: gold-op ledgers, dual-embedder retrieval, a calibrated judge, twelve failure modes — and the bug they caught."
date: 2026-10-26
lastmod: 2026-10-26
tags: [memory, benchmarks, release]
type: release
media: [/landing/tui/dashboard/stills/02-memory.png]
---

Unown's four-tier memory stack — policy, project, user, local — claims it remembers. The honest question is whether the
claim survives contact with the state of the art in evaluation — so before
shipping [v0.0.22](https://github.com/kanishka-namdeo/Unown/releases/tag/v0.0.22),
we surveyed what the field actually measures (LoCoMo, LongMemEval,
MemoryAgentBench, MEME, MemBench, plus the 2026 audit literature on judge
reliability), and then built the four suites the survey said were missing.
All four ran live against the production dream pipeline. One of them found a
real bug, and this post is the record of both.

| Suite | What it measures | Result |
|---|---|---|
| ops-accuracy | gold-op ledger: ADD/UPDATE/DELETE/NOOP + MEME's Cascade/Deletion | 11/11 cases, opsF1 0.992 |
| retrieval-rank | platform search: recall@k, MRR, conflict preference, scope isolation | lexical r@5 0.864 → onnx 1.000 |
| judge-calib | the binary QA judge vs 24 gold-labeled items | agreement 20/20, FPR 0, flips 0/72 |
| failure-modes | the twelve documented cross-industry failure modes, pinned | 12/12 pass, 4 recorded findings |

The memory screen these suites keep honest — every tier versioned, every
write attributable, rollback one key away:

![the unown dashboard's memory screen: the four-tier stack, version history and one-key rollback](/landing/tui/dashboard/stills/02-memory.png)

## The suites

**ops-accuracy** scores the memory system the way the [Mem0
paper](https://arxiv.org/abs/2504.19413) scores memory operations: a
gold-op ledger of expected ADD / UPDATE / DELETE / NOOP decisions per fact,
plus the hard cases [MEME](https://arxiv.org/abs/2605.12477) showed collapse
most systems (cascade dependencies, post-deletion state). Eleven isolated
cases, one confusion matrix:
**11/11 passed, opsF1 0.992** — including the bi-temporal case, where a note
about Monday's state arrives *after* Wednesday's and the reconciler must
resolve by event time, not delivery order
([results](https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/memory-eval/ops-accuracy/RESULTS.md)).

**retrieval-rank** is the suite recall-qa couldn't be: it scores the search
layer itself (facts seeded verbatim, no extraction in the loop). The
headline is the embedder A/B the docs had never measured — the deterministic
lexical fallback finds **86.4%** of gold facts at rank 5 where the ONNX
lane (bge-small) finds **100%** — and the finding both arms share: asked to
choose between an old fact and its replacement, the search layer prefers
the *old* one five times out of six. Recency is guarded by the reconciler
alone; that's now a measured gap, not a vibe
([results](https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/memory-eval/retrieval-rank/RESULTS.md)).

**judge-calib** answers the item our own testing strategy had left open
longest: "judge calibration for every graded number." The binary
CORRECT/WRONG judge — the same protocol Mem0 and Letta's leaderboard use —
was measured against 24 gold-labeled items in eight classes
(wrong-number, wrong-entity, paraphrase, partial, both abstention
directions): **agreement 20/20, false positives 0/8, false negatives 0/8,
run-to-run flips 0/72 at temperature 0, order sensitivity 0/6**
([results](https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/memory-eval/judge-calib/RESULTS.md)).
The audit papers' judge instability simply does not reproduce on the served
tier — which unblocks a judged lane for the QA suites.

**failure-modes** pays the competitor-research sweep's explicit debt: the
twelve failure modes we documented across eleven shipped memory products
(each with the issue that proved it ships in the wild — Mem0's dedup races,
Letta's stale index, Codex's silent truncation, the bi-temporal recency
trap) are now twelve pinned regression cases. Six run deterministically
without an LLM; four drive the live dream pipeline; two boot a real scratch
engine — the TOCTOU case fires two dream triggers concurrently and asserts
the busy-mutex serializes them, the ingestion-loss case kills the bridge and
asserts the failed dream is visible and the note survives for the recovery
engine. **12/12 pass**, with four findings recorded inside the passing
receipts
([results](https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/memory-eval/failure-modes/RESULTS.md)).

## The bug the suites caught

The first ops-accuracy run failed six of eleven cases, and the receipts
separated the benchmark's bugs (three of my probe regexes were too literal)
from the system's: notes that said "backups go to the nightly S3 bucket" —
in *both* notes of the supersede case — produced no memory. The extraction
kept the headline and dropped the routine infrastructure detail, and since
extraction is the only pass over a note, the fact was gone. That is
[Graphiti #1707](https://github.com/getzep/graphiti/issues/1707)'s
silent-loss shape, measured in our own pipeline.

The fix is one sentence in the extraction contract — infrastructure facts
are named explicitly, and "a fact skipped at extraction is unrecoverable
later" — pinned by a unit test the way the repo has always pinned prompt
fixes. The receipts before and after are the evidence; opsF1 went from
0.69 on the broken run to 0.992 with the fix and the corrected probes.

## The honest residuals

The receipts also record what we did *not* fix: the reconciler missed one
contradiction pair in three runs (the failing receipt is preserved — that
variance is now a monitored regression, not an anecdote); the committed-file
load scan catches one fewer injection variant than the tool-output scanner;
and a benign note written in the imperative mood can read as a directive to
the guard. Each has its pinned case now, so each future regression is a red
test away — which is the whole point of a benchmark suite: it converts
"we believe the memory works" into "here is the receipt, and here is what
it cost."

## Run them yourself

```bash
git clone https://github.com/kanishka-namdeo/Unown && cd Unown
bun scripts/install.ts && bun run agent:start
cd benchmarks/memory-eval/ops-accuracy && bun runner.mjs
```

Every suite has a `--dry` lane that runs without an LLM, receipts are
resume-safe, and each RESULTS.md carries its own honest-limitations section
— the numbers above are the committed receipts, not the best of N.
