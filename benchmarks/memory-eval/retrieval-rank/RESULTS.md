# retrieval-rank — results (lexical vs onnx arms, 2026-10-26)

Suite: search-ranking quality of the memory platform itself — recall@k / MRR
per query kind, conflict-recency preference, and cross-scope isolation —
with the facts seeded verbatim (no extraction LLM), so the measurement is
the embedder + ranking path in isolation.

## Headline — the embedder A/B (the H10 recall-parity gap, now measured)

| Metric | lexical (FNV-1a hash) | onnx (bge-small-en-v1.5) |
|---|---|---|
| recall@3 | 0.864 | **1.000** |
| recall@5 | 0.864 | **1.000** |
| recall@10 | 0.909 | **1.000** |
| MRR | 0.779 | **0.886** |
| mean first-gold rank | 1.50 | **1.23** |
| queries with zero results | 1 (`q-para-ci`) | 0 |
| paraphrase recall@5 | 0.75 | **1.00** |
| time-qualified recall@5 | 0.75 | **1.00** |

Per-kind tables live in each arm's `results/summary.json` (lexical: the
default results dir; onnx: `results/onnx/`). Isolation: **PASS on both
arms** — leak probes clean, structural getAll disjoint, cross-scope search
results 12/12 scope-tagged.

**The practical takeaway**: on the lexical backend, a paraphrased query
("Where do our builds run — which CI system and what hardware?") can fall
under mem0's 0.1 similarity threshold and return NOTHING, and hyphenated
tokens (`feature-flags` vs "feature flags") never match; the ONNX lane
resolves both. Any deployment that answers `/memory search` questions should
prefer the onnx lane (the engine's `auto` degrades to lexical only when
local-ml is absent — the status surface names it).

## Finding — the search layer has a recency blind spot

`conflictPreference` (rank(new version) < rank(old version) on the six
conflict queries, both versions seeded verbatim):

| arm | new-first | old-first | neither |
|---|---|---|---|
| lexical | 2/6 | 3/6 | 1/6 |
| onnx | 1/6 | **5/6** | 0 |

**Both embedders prefer the OLD side of a conflict pair** — the terse,
keyword-dense old fact ("Staging runs Postgres 14 with pg_stat_statements
loaded") sits closer to the query vector than the verbose new one ("…
after the October migration; the old cluster is decommissioned"). The search
layer cannot tell which generation of a fact is current; in production the
reconciler is the only guard (it deletes the loser — pinned end-to-end by
ops-accuracy's supersede case and failure-modes/fm-04). The exposure is the
window where both generations coexist: pre-reconcile, or after a reconcile
miss (fm-04 recorded one in three runs). A rank-time recency signal (mem0
`updatedAt` is already in the payload) is the natural fix — recorded as an
improvement opportunity, not implemented in this pass.

## Honest limitations

- 28 facts / 22 queries / 6 leak probes — small, hand-authored; the
  conflict pair set is 3 families (db, deploy, flags) × 2 sides.
- The conflict probe measures pure ranking preference between verbatim
  seeded texts (no timestamps carried by `infer:false` seeding) — it does
  not test time-aware query expansion, only which generation ranks higher.
- The lexical arm's numbers are deterministic (same seeds, same hash
  embedder); the onnx arm is deterministic given the model version —
  neither involves an LLM.
- Receipts: `results/summary.json` + `results/per-case/<query-id>.json`
  (lexical arm), `results/onnx/…` (onnx arm), `results/onnx-fallback/…`
  (the fallback-verification run from before local-ml was installed).

## Reproduce

```bash
bun runner.mjs                     # default arm (auto → lexical without local-ml)
bun runner.mjs --embedder onnx     # the semantic arm (needs local-ml installed)
bun runner.mjs --dry               # no receipts, full plumbing
```
