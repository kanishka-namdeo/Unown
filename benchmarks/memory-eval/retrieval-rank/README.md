# retrieval-rank — search-ranking quality of the memory platform (recall@k, MRR, conflict preference, scope isolation)

The question it answers: **does the platform's own search return the right
memories, in the right order?** — the retrieval layer recall-qa deliberately
bypasses (recall-qa injects the rendered memory as a system message and never
scores `platform.search`). **NO LLM anywhere**: the corpus facts enter an
isolated mem0 scope verbatim through the production seeding path
(`importLegacyMarkdown` of a rendered bullet list, one `- ` bullet per fact,
kind `seed`, `infer:false`), and the queries run against `platform.search`, so
the suite measures the EMBEDDER + ranking path in isolation — mem0's hybrid
`scoreAndRank` (cosine + BM25 + entity boost, threshold-filtered). The whole
suite is deterministic given the embedder: it runs fully in CI, with no bridge
and no receipts required to see real numbers (`--dry` is the full run minus
receipt writes).

## What it measures

| Step | What happens |
|---|---|
| 1. seed | Both scopes wiped + reseeded from scratch every run: `projectScope("rr-main")` gets the 28 corpus facts, `projectScope("rr-foreign")` gets the 4 foreign-scope facts (aurora-billing, including a deliberately gateway-adjacent one). Seeding is `seedScope` → `importLegacyMarkdown` of a bullet list — exactly production seeding, verbatim `infer:false`, no extraction round. Integrity is asserted: every fact must import as exactly one memory, with a 1:1 fact-id → memory-id text map (`idMap` in the summary receipt). |
| 2. queries | Each of the 22 queries runs `platform.search(q, main, 10)`; the ranked top-10 (memory ids, fact ids, scores, verbatim texts) is the per-query receipt. |
| 3. metrics | Per query: **recall@3/5/10** (any gold fact in the top-k — LongMemEval's turn-level gold-evidence recall@k, arXiv 2410.10813), **MRR** (1/rank of the first gold hit; 0 when absent from the top-10), and for conflict queries **conflictPreference** — rank(gold/new side) < rank(conflictGold/old side), Zep's needle-in-timeline conflict probe (arXiv 2501.13956), with ties/absent outcomes recorded. Aggregates per kind (exact / paraphrase / time-qualified / conflict / distractor): recall@5 + MRR. |
| 4. isolation | The cross-scope contract from Mem0 #5439 / Graphiti #2065/#2066: (a) leak probes — a MAIN-scope search must never surface the foreign facts listed in `mustNotReturn` within its top-10; (b) structural — main `getAll` never contains foreign facts and vice versa; (c) cross-scope — `searchAcrossScopes` over both scopes for a port query must return results TAGGED with their source scope (`scopeTags` presence). |

**Hard pass criteria** (asserted in every run, including `--dry`): seeding
integrity (28 + 4 facts, 1:1 idMap) and scope isolation (leak probes, structural
checks, cross-scope tagging); plus every query must execute. recall@k / MRR /
conflictPreference are **measurements, not gates** — the receipts are the point,
and RESULTS.md is hand-written from them (the repo's convention for graded
numbers).

**Two embedder arms** (the H10 local-embedder recall-parity question, now
measured on the mem0 search path itself — cf. `benchmarks/local-llm` H10 and
`benchmarks/nonllm` N1):

- default — whatever `PI_MEM0_EMBEDDER` resolves to (`auto` → lexical when the
  local-ml lane is absent; the degradation is recorded as `autoDegraded`).
- `--embedder onnx` — bge-small-en-v1.5 via the local-ml lane. If the platform
  cannot come up onnx (local-ml not installed), the run does NOT fail: it
  records `embedderFallback: true` (plus the boot error) in every receipt and
  completes on the lexical lane. The onnx arm keeps its own scratch root so the
  two vector spaces never churn through the boot-time reindex pass.

## Corpus

`corpus.json` — hand-authored, project-memory-shaped facts for a fictional
gateway project (28 facts: ports, endpoints, rate limits, CI, tooling
conventions, three old/new conflict pairs, a distractor pool) plus a foreign
scope (`aurora-billing`, 4 facts) with 2 leak probes. 22 queries stratified
over 5 kinds: exact 5, paraphrase 8, time-qualified 4, conflict 3, distractor 2.
The gold/conflictGold sides follow the corpus storyline: gold = the current
fact, conflictGold = the superseded one.

- sha256: `45545d1155ce86fa4b7c225d8d72dfd8df5d223107ae8e090b88cad38204e308`
- provenance: hand-authored for this suite (the corpus file's `storyline` field
  carries the methodology citations); regenerate = edit `corpus.json` by hand —
  there is no upstream dataset to sample.

## Run

```bash
bun runner.mjs --dry                 # full run minus receipt writes (real numbers, no bridge)
bun runner.mjs                      # full corpus (resume-safe; <1 s — no LLM anywhere)
bun runner.mjs --limit 3            # first 3 queries only
bun runner.mjs --case q-conf-flags  # single query
bun runner.mjs --fresh              # ignore this arm's existing per-query receipts
bun runner.mjs --embedder onnx     # the onnx arm (records embedderFallback:true when local-ml is absent)
bun runner.mjs --embedder onnx --dry # dry smoke of the onnx arm incl. the fallback path
```

No bridge required (no LLM call exists in this suite). Scratch env (set before
the package import, never the live engine state):
`PI_SELFLEARNING_DATA=/home/z/my-project/scratch-mem/retrieval-rank/data`,
`PI_SELFLEARNING_DB=.../db/retrieval-rank.db`, `PI_MEM0_DIR=.../mem0`; the onnx
arm uses `.../retrieval-rank-onnx/…` instead. Scopes: `projectScope("rr-main")`
+ `projectScope("rr-foreign")`, wiped and reseeded at the start of every run
(fresh memory UUIDs each seed — ranks, not ids, are the stable artifact).

## Receipts

- `results/per-case/<query-id>.json` — the full ranked top-10 (memory id, fact
  id, score, verbatim text), per-gold ranks, recall@3/5/10, MRR, and for
  conflict queries the `{rankNew, rankOld, outcome, preference}` detail; plus
  the embedder arm record (`requested`, `backend`, `embedderFallback`).
- `results/summary.json` — seeding integrity (counts + `idMap` +
  `foreignIdMap`), the isolation checks (leak probes with their top-10 fact
  lists, structural results, the cross-scope result set with scope tags), the
  metrics (overall recall@3/5/10 + MRR + meanFirstGoldRank, per-kind recall@5 +
  MRR, conflictPreference outcomes), the corpus sha256, and the platform info.
  Only a FULL run writes the summary — `--case`/`--limit` debug runs write
  per-query receipts but never touch it.
- Resume: a query with an existing error-free receipt from the same embedder
  backend is skipped unless `--fresh` (the suite is deterministic, so a resumed
  aggregate equals a fresh one). `--fresh` clears only this arm's per-case dir.
- Model scoping: this suite's "model" is the **embedder backend label**
  (`lexical` / `onnx`), because no LLM is ever called. A run whose label differs
  from the one recorded in the legacy `results/summary.json` writes to
  `results/<label>/` instead of clobbering (the quality-axes pattern); a
  fallback run labels itself `onnx-fallback` so it never passes for an honest
  lexical run. `PI_MODEL_ID` is recorded for provenance only.

## Honest limitations

- **n=22 queries over 28 facts in one fictional domain** — statistical
  direction, not a leaderboard row. Every verdict is auditable from the
  per-query receipt (the raw ranked texts are kept verbatim).
- **The lexical embedder is keyword-class similarity, not semantic** —
  paraphrase recall understates what a semantic embedder would achieve. That is
  the point of the two arms: the H10 recall-parity gap between the lexical and
  onnx (bge-small) lanes, measured on the production search path.
- **mem0's 0.1 semantic threshold filters results before ranking finishes** —
  a query whose gold fact embeds below threshold returns it never (e.g.
  q-para-ci on the lexical arm returned an empty result set). This is the
  production path's real behavior, kept verbatim, not papered over.
- **conflictPreference has no temporal signal**: both sides of each conflict
  pair are seeded in ONE import (no distinct timestamps exist on the
  `infer:false` path), so the metric measures the pure text/ranking preference.
  Zep's needle-in-timeline probe (arXiv 2501.13956) additionally exercises
  recency weighting — that dimension needs timestamps the seeding path does not
  carry. Measured on the lexical arm: the old-side texts are shorter and more
  keyword-dense, so they often OUTRANK the new side (2/6 new-first) — an honest
  embedder artifact, not a ranking bug.
- **The oracle is closed-world**: all 28 main-scope facts are gold candidates
  and the corpus is tiny, so recall@10 is an upper bound vs a real project's
  thousands of memories (render caps and reconcile pruning do not engage at
  this scale — those are quality-axes' and ops-accuracy's axes, not this one).
- The cross-scope check asserts **tag presence**, not per-scope coverage: a
  result being tagged matters; which scopes made the top-12 is recorded, not
  asserted.
