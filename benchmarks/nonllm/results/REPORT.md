# nonllm testbench — campaign report #1

**Date:** 2026-10-18 · **Bench:** `benchmarks/nonllm` (H9–H15 registry) ·
**Host:** linux-x64, 2 vCPU / 4GB · **Remote baseline:** kimi-k2.5 via llm-bridge
(Dashscope) · **Corpus:** 85 real session notes (two engine generations: 65
benchmark + 20 terminal; outcomes 61 passed / 4 failed), 6 memory tiers, 12
dreams — all captured read-only from the live engine.

The question this campaign answers: **how much of Unown's learning layer can
run on fully-local, non-LLM components — and is it worth it?** Executive
answer up front: the retrieval/triage/dedup/ranking seams all verify, at
marginal cost ≈ 0 and 15–40 ms latencies; recency is actively harmful for
dream-input ranking; wholesale extractive compression trades quality for
tokens while activation-ranked hybrid curation wins on both.

## Verdict table

| Hyp | Claim | Verdict | Key numbers |
|---|---|---|---|
| H9 | ONNX encoders run everywhere Unown runs (Bun + Node, 3-OS CI) | **VERIFIED** | bge-small p50: linux 13–15 ms, win 28 ms, mac-arm 39 ms; rerank 1–2 ms/pair everywhere; RSS peak ≤ 363 MB; Bun:Node ratio 1.0 |
| H10 | Local embedding kNN triage ≥ remote quality at ~0 cost | **VERIFIED** | kind acc: bge 94.1% / MiniLM 97.6% vs remote 91.8% (macro-F1 .910/.966 vs .894); outcome acc bge 98.5%, **failed-recall 1.00**; p50 16 ms vs remote 1318 ms (82×), $0 |
| H11 | MinHash-LSH dedup at µs cost; embeddings confirm the hard cases | **VERIFIED** | structural near-dups: 100% recall @ 0.18 ms/doc (estMAE 0.020); paraphrases: MinHash 25% vs cosine 100% (avg cos 0.974); union lane F1 0.962 |
| H12 | 23M cross-encoder reranks retrieval like the remote at ~ms/pair | **VERIFIED** | task-relevance: Spearman ρ 0.559, **top-5 overlap 1.00** vs remote, 15 ms/pair; bi-encoder ablation ρ 0.588/top-5 1.00 — cosine suffices at pool ≤ 20, CE is the bigger-pool tool |
| H13 | Park/Hou activation scoring ≈ remote importance, zero LLM | **VERIFIED** | ρ 0.567 (full) / 0.486 (no-recency); top-5 overlap 0.43; 40 notes scored in ~1 s embedding + 3 ms math; **recency-only ρ −0.106…−0.203 (harmful)** |
| H14 | LexRank dream-input curation: ≥35% token cut, no material quality loss | **PARTIALLY VERIFIED** | compress-all: 33.2–34.9% cut, judge leans full (dropped technical detail); **hybrid (N4-ranked head full + tail compressed): 19.9% cut, judge leans CURATED** (coverage 4.5 vs 4.0, structure 5 vs 4) |
| H15 | Integration = pre-processors around unchanged LLM calls | **DESIGN VALIDATED** (by N5-hybrid end-to-end; no Unown code changed yet) | hybrid lane = dedup + activation ranking + tail compression, all local |

Raw receipts: `results/<run>/` (gitignored); the CI probe artifacts (3 OSes)
for run **39142263790** carry the per-platform N0 JSONs.

## N0 — runtime gate (H9): GREEN everywhere

| platform / runtime | bge-small p50 | MiniLM p50 | rerank p50/pair | RSS peak |
|---|---|---|---|---|
| linux-x64 · node 24.21 (local) | 15 ms | 7 ms | 2 ms | 291 MB |
| linux-x64 · bun 1.3.14 (local) | 15 ms | 14 ms | 2 ms | 363 MB |
| linux-x64 · node 22 (CI) | 13 ms | 9 ms | 11 ms | ~190 MB |
| darwin-arm64 · node 22 (CI) | 39 ms | 19 ms | 32 ms | ~166 MB |
| win32-x64 · node 22 (CI) | 28 ms | 16 ms | 8 ms | ~138 MB |

All H9 thresholds pass with 6–16× headroom (embed p50 ≤ 250 ms, rerank ≤
25 ms/pair, RSS Δ ≤ 400 MB). transformers.js 4.3.1 + onnxruntime-node 1.30.0
prebuilds loaded on every combo; Bun 1.3.14 runs the native backend at Node
parity (the bun#18079 class of regression is gone). Cold loads (weights
downloaded) 3.5–5.3 s; warm loads 0.4–2.2 s.

**Engineering note (found + fixed during this campaign):** ms-marco-MiniLM in
transformers.js is a SINGLE-LOGIT classifier — the `text-classification`
pipeline softmaxes the 1-element logit vector and returns LABEL_0 = 1.0 for
*everything* (verified: pizza-vs-query scores 1.0 through the pipeline, while
the raw logit is −11.19). The bench now runs the tokenizer + model directly
and sigmoids the raw logit. Anyone reranking with this model in JS hits this.

## N1 — embedding triage (H10): local beats remote on kind, matches on outcome

Ground truth = the engine's own rows (`notes.kind`, `runs.status`), so the
remote model is measured, not defining truth. LOO kNN (k=5, cosine):

| lane | kind acc | kind macro-F1 | outcome acc | failed-recall | p50/note |
|---|---|---|---|---|---|
| bge-small kNN | 0.941 | 0.910 | **0.985** | **1.00** | 16 ms |
| MiniLM kNN | **0.976** | **0.966** | 0.938 | 0.25 | 10 ms |
| remote kimi-k2.5 (TRIAGE prompt) | 0.918 | 0.894 | 1.000 | 1.00 | 1318 ms |

Both local lanes beat the remote on kind (the remote drifts to "other" on
template-heavy notes). bge-small is the all-round lane: it catches all 4
failed-run notes (the minority class that matters most for dream input) —
MiniLM misses 3 of 4. Cascade margin 0.15: 100% coverage at 0.941 (bge) /
99% at 0.988 (MiniLM) — a deferral cascade would be essentially free.
Cost: $0 vs ~$0.01 per 85-note sweep (remote).

## N2 — near-dup detection (H11): zero-model tier + embedding tier are complementary

Seeded corpus: 14 base notes → deterministic perturbations (drop-sentence,
shuffle, append-noise, drop-line) + 8 **remote-model paraphrases** (the hard
case) + 28 true negatives → 66 labeled pairs.

| lane | best F1 | ms/doc | notes |
|---|---|---|---|
| MinHash-128 (est ≥ 0.40) | 0.877 | **0.18** | 100% recall on ALL structural classes; paraphrase recall 0.25 |
| bge cosine (≥ 0.85) | 0.962 | 23.6 | 100% paraphrase recall (avg cos 0.974) |
| union (minhash ≥ 0.5 OR cos ≥ 0.92) | **0.962** | 23.8 | the production shape |

estMAE of MinHash vs exact Jaccard: **0.020** (threshold ≤ 0.05). The LSH
"confirm" composition (LSH candidacy then cosine) measured **0.781** — a
negative result worth keeping: banding candidacy (~0.63 threshold) filters
out the paraphrases the second stage exists to catch. Union, not funnel.
Boundary observation: same-task-family re-run notes sit at cos 0.85–0.92 —
for dream input those ARE the duplicates worth collapsing (label noise, not
model error).

## N3 — retrieval reranking (H12): top-5 agreement 1.00 at 15 ms/pair

Query = a real benchmark task prompt; pool = 6 memory-tier sections + 14
recent notes (20 candidates).

| lane | Spearman ρ vs remote | top-5 overlap | p50 |
|---|---|---|---|
| ms-marco cross-encoder | 0.574 | **1.00** | 34 ms/pair amortized (mixed pool) · 10 ms/pair (uniform notes) |
| bge bi-encoder cosine | 0.554–0.588 | 1.00 | ~24 ms/doc |

Latency engineering receipt (three shapes, all measured): per-pair calls —
15 ms/pair linux but **30 ms/pair on darwin-arm64 CI** (tokenization + session
overhead per call); one padded batch — 90 ms/pair amortized on heterogeneous
docs (every pair pays the longest doc's padding); **length-sorted chunks of 8**
(the shipped shape) — 10 ms/pair uniform, 34 ms/pair mixed, amortizing
overhead without padding waste. Every remote scoring call it replaces: ~5.6 s.

Both local lanes reproduce the remote's ENTIRE top-5 injection set. The
bi-encoder ties the CE at this pool size (20 docs) — the CE's extra pairwise
precision is for larger pools/longer docs; at Unown's current scale, cosine
+ optional CE confirm is the economical shape.

**Negative control (kept honest):** against consolidation-VALUE judgments
(importance), the relevance-trained CE measures ρ **0.158** vs bi-encoder
0.436 — relevance ≠ importance; importance is N4's lane. Reranking is for
retrieval, activation scoring is for curation.

## N4 — activation scoring (H13): ρ 0.57, and recency is harmful here

Fully non-LLM score (0.995^h recency × embedding relevance-to-goal ×
log-frequency + structural heuristics) vs remote 1–10 importance ratings on
40 notes, two independent runs:

| component | run 1 ρ | run 2 ρ |
|---|---|---|
| full activation | **0.456** | **0.567** |
| no-recency variant | 0.486 | 0.486 |
| recency only | **−0.203** | **−0.106** |
| relevance only | 0.364 | 0.391 |
| frequency only | 0.381 | 0.325 |
| structural only | 0.290 | 0.452 |

The field's default (Park-2023 recency decay) is **anti-correlated** with
what the production model values: dream input curation prizes durable
failure lessons over fresh routine passes. The recommended Unown recipe
weights relevance + frequency + structure and drops recency to a tiebreaker.
Cost after embeddings: 3 ms for 40 notes (zero LLM calls).

## N5 — dream-input curation (H14): the hybrid is the win

AutoDream replayed (byte-faithful prompt, remote production model): full
notes vs compressed, blind position-swapped judge on the resulting NEXT
MEMORY.

| mode | prompt-token cut | judge outcome |
|---|---|---|
| compress-all (top-2 sentences, floor 0.35 / 0.20) | 33.2% / 34.9% | leans full — dropped technical detail (LRU pattern truncated, CSV line-endings lost) |
| **hybrid (N4-ranked: top-30% notes full, tail compressed)** | **19.9%** | **leans curated** — "eliminates redundant note references, tightens descriptions, removes duplicate CSV notes" (coverage 4.5 vs 4.0, structure 5 vs 4) |

All lanes structurally valid (JSON ok, sane length, injection scan clean).
Every judge verdict in every N5 run was position-inconsistent → tie by the
consistency gate; the lean directions above are from the judges' reasons and
criterion scores. Compress-all is a token-budget dial with a real quality
price; the activation-ranked hybrid is the shape that wins on both axes —
and it is exactly H15's proposed integration.

## What this means for Unown (no changes made yet — per the gate)

The verified, ready-to-integrate lanes (H15, all as pre-processors around
unchanged LLM calls, each behind its own env flag):

1. **PI_TRIAGE=knn** — bge-small kNN triage, margin-defer to the LLM (N1).
2. **PI_NOTE_DEDUP=union** — MinHash bucket at µs/doc + cosine confirm (N2).
3. **PI_MEMORY_RANK=activation** — no-recency activation scoring for dream
   input ordering and budget selection (N4); optional cross-encoder confirm
   for retrieval pools > 20 (N3).
4. **PI_DREAM_CURATE=hybrid** — top-30% full + LexRank tail (N5).

None of these replace an LLM call; they shrink/order/dedup the inputs. The
generative stays remote (or on the local-llm lane per H1–H8). Integration
proceeds only after a shadow-mode replay against the live engine, per the
registry guards.

## Open items

- ONNX-vs-GGUF embedding bake-off (llama.cpp `/v1/embeddings` vs in-process
  ONNX) — deferred; the in-process lane is already 15 ms/note with no
  server to manage, so the burden of proof is now on the GGUF lane.
- SetFit fine-tune on ~24 hand-labeled notes to push kind/outcome further
  (research says 8–16 labels/class is enough) — next campaign, if triage
  needs more than kNN gives.
- The "other" note kind has no exemplars in either corpus generation —
  production kNN must defer "other" to the LLM by design (margin guard).

## Campaign #1 rerun verification (2026-10-18, this session)

The full `node runner.mjs all` campaign re-run on a fresh clone + fresh
`bun install`/`build:offline` (host: linux-x64, 2 vCPU / 4GB, node 24.21,
bridge live against the Dashscope coding plan) reproduced every headline:

| metric | campaign #1 (committed) | rerun |
|---|---|---|
| N0 bge-small embed p50 | 13–15 ms | 15–16 ms |
| N0 rerank p50/pair | 10–11 ms | 10–25 ms (fresh cache) |
| N1 bge kind acc / macro-F1 | 0.941 / 0.910 | 0.941 / 0.910 |
| N1 outcome acc / failed-recall | 0.985 / 1.00 | 0.985 / 1.00 |
| N2 embedding best F1 | 0.962 | 0.962 |
| N3 CE Spearman / top-5 | 0.574 / 1.00 | 0.574 / 1.00 |
| N4 full activation ρ | 0.456 / 0.567 | 0.456 (run 1) |
| N5 hybrid token cut | 19.9% | 19.9% (judge tie, leans curated — same as #1) |

Raw receipts: `results/2026-10-18-18-14-linux-x64/` (gitignored, per
convention). The registry verdicts stand; the bench is reproducible
end-to-end from a clean clone.

## Campaign #2 — research-driven extensions (H23/H24/H25)

**Date:** 2026-10-18 (same host + bridge) · **Driver:** the online research
digest (`research/nonllm-sota-digest.md` — 12 searches + 9 page fetches;
raw artifacts in `download/research/raw/`) — ranked shortlist: an Ettin
reranker A/B, BM25+cosine RRF fusion, and a tiny injection-classifier
shadow lane. Registered as H23/H24/H25 before any run; verdicts after.

| Hyp | Claim | Verdict | Key numbers |
|---|---|---|---|
| H23 | Ettin-17m reranker beats ms-marco on the retrieval seam at comparable CPU cost | **VERIFIED** | Spearman vs remote: **ettin 0.646** vs ms-marco 0.555 (same run, same pool); top-5 overlap 1.00 both; 45 vs 34 ms/pair (fp32, chunk-8); inter-lane ρ 0.826; sanity pair 8.05 vs −3.25 logits |
| H24 | BM25 + cosine RRF fusion ≥ cosine-only vs remote helpfulness | **VERIFIED** | fused top-5 1.00 (== cosine); BM25-only **ρ 0.716 — the best single-lane number of the campaign** (cosine 0.609); 1.0 ms for the whole 20-doc pool; complementary top-5 disagreement (RRF precondition holds) |
| H25 | Tiny ONNX injection classifier adds signal as a shadow guard | **REFUTED (for integration)** | poison ladder 5/10 @t=0.5, 0 benign FPs (caught base64 0.999 + code-fence 0.975 — contra the literature); MPBench recall 0.14 / F1 0.241 (≪ 0.60); **zero marginal catches over the production guard (10/10, 0/50 planted)**; +224 MB RSS, 114 ms/case — real signal, no value-add, not wired |

### N6 — the Ettin lane (H23): three traps found, worked, documented

The Ettin family is the 2026 sentence-transformers-maintainer reranker line,
Apache-2.0, and the 17m card benchmarks directly against our incumbent. Three
real engineering traps surfaced before any ranking number was trustworthy:

1. **The ONNX artifact gap.** `onnx/model.onnx` exports the BASE encoder —
   session outputs are `['last_hidden_state']`, config architectures is
   `["ModernBertModel"]`, and the classification head lives in the
   sentence-transformers module chain
   (1_Pooling[cls] → 2_Dense[256→256, GELU] → 3_LayerNorm → 4_Dense[256→1]).
   Through transformers.js, `AutoModelForSequenceClassification` returns
   `logits === undefined` and silently mislabels the hidden states as
   `attentions` — the same silent-mislabel class as the ms-marco single-logit
   softmax trap. Fix: run the base encoder (`AutoModel`), reconstruct the
   head in pure JS from the repo's safetensors (~263 KB, CLS pooling).
   Anyone reranking with Ettin in JS hits this.
2. **safetensors `data_offsets` are BYTE offsets.** Reading them as element
   offsets (`s*4`) parses byte-0 tensors correctly by luck and reads pool
   garbage for every other tensor (NaN logits). This was the actual
   head-NaN bug.
3. **Node pooled-Buffer aliasing.** Files < ~4 KB are allocated inside
   Node's shared 8 KB pool; a `Float32Array` view over `buf.buffer` silently
   aliases stale memory once the next small `readFileSync` reuses the pool
   (weights that re-parse differently on every run, denormals, 48.98 M
   spikes — while the file's sha256 stays perfect). Fix: always copy the
   tensor data out.

Result: a fully working Ettin-17m lane at 45 ms/pair fp32 — **+0.091
Spearman over the incumbent for 1.3× latency and +194 MB RSS**. Production
note recorded in the verdict: swap the CE confirm lane when a q8 Ettin
artifact ships; the q8 ms-marco incumbent stays the default today.

### N7 — the fusion lane (H24): BM25 alone is a finding

With Lucene-default BM25 (k1=1.5, b=0.75, naive lowercase-alphanumeric
tokenizer, no stemming, no stopwords) the surprise is the single-lane row:
**ρ 0.716 vs remote helpfulness — better than every neural lane measured on
this pool** (ettin 0.646, cosine 0.609, ms-marco 0.555). Short coding-task
prompts and note text share exact tokens, so the lexical signal is strong
on this domain. BM25-only top-5 was 0.80 (it misses the paraphrase tier);
RRF fusion (k=60) carries it back to 1.00 at µs cost. The disagreement
analysis shows genuinely complementary top-5s — the RRF precondition the
research digest warned about. Pure TS, zero deps: the cheapest verified
lane in the registry.

### N8 — the classifier shadow (H25): honest negative

The ungated tiny-ONNX classifier (testsavantai; the better-known protectai
models are HF-gated:auto — rejected for keyless first-run) catches 5/10
poison-ladder notes at t=0.5 with 0 benign FPs — including the base64 and
code-fence variants the literature predicted it would miss — but recall
collapses to 0.14 on the long office-domain MPBench contexts, and the
production guard already catches everything the classifier does. Two more
artifact traps documented in guardcls.mjs: `model_max_length: 1e30` (HF
placeholder) lets sequences run past the 512-token position table (ONNX
broadcast error at `/bert/embeddings/Add_1`) — pin `max_length: 512`
explicitly; and the ONNX lives at repo root, not `onnx/` (subfolder:"" +
model_file_name:"model"). The lane is NOT wired: no marginal safety for
its memory + latency price.

### Cross-platform status of the new lanes

`node runner.mjs probe2` (keyless: ettin base + head + classifier all
download from the HF hub) is wired into the CI probe workflow
(`nonllm-probe.yml`) on the 3-OS matrix with first-pass generous thresholds
(lane ≤ 200 ms, RSS ≤ 500 MB, sanity discrimination required) — to be
tightened after the first 3-OS receipt lands, per the repo's calibration
discipline. Local linux-x64: ettin 12 ms/pair, classifier 4 ms/case, both
discriminating, RSS peak 400 MB combined.

> **Renumber note (2026-10-18):** campaign #2 was originally registered as
> H16–H18 (commit 3db9083). A parallel session landed the complementary
> testbench (48f5378) claiming H16–H22 for campaign 3 in the same window,
> so campaign #2 is renumbered **H23/H24/H25** to keep the program-level
> hypothesis sequence unambiguous: local-llm H1–H11, nonllm H9–H15 +
> H23–H25, complementary H16–H22. Content and verdicts unchanged.

## H15 closed: the integration shipped (2026-10-18, opt-in)

The registry's gate held until every condition was current: H9 verified on
all three CI OSes (runs 39142263790 + 39156669131 — the latter including the
campaign-2 lane probe) plus local Bun/Node, H10–H14 evidence standing, and
the campaign-#1 rerun reproducing every headline. Then:

- `pi-repo/packages/self-learning/src/localml.ts` — the lanes in the engine:
  MinHash-union dedup, no-recency activation ranking, hybrid curation
  (all call-time env flags, all off by default, `PI_LOCAL_ML=shadow` as the
  runtime shadow-mode-replay mode; bus channel `lane:dream`).
- `pi-repo/packages/self-learning/local-ml/` — the OPTIONAL ONNX embedding
  sub-package (bge-small q8): not a workspace member, install-on-demand,
  guarded dynamic import; absent = symbolic-only lanes, dream never fails.
- Both dream paths (benchmark `runDream` + terminal `runProjectDream`) run
  the lanes before prompt assembly; guard banners derive from ORIGINAL note
  rows; dedup-dropped notes are still consumed (marked dreamed).
- Pinned by `test/localml.test.ts` (17 tests, incl. byte-identity when
  unset and shadow-mode identity); engine suite 1257/1257.

The live cutover recommendation: run `PI_LOCAL_ML=shadow` against a real
engine for a few dream cycles first (the `lane:dream` events carry the
per-lane deltas), then flip to `live` per lane. kNN triage (H10) remains
bench-verified only — see the H15 verdict for why.

### The live shadow-mode replay (2026-10-18, the registry's final gate)

Against the RUNNING engine (live bridge → Dashscope, real auto-dream router
job, 8 undreamed notes incl. a seeded base + append-noise near-dup pair):

```json
{"mode":"shadow","embedder":"bge-small q8 (transformers.js + onnxruntime-node)",
 "dedup":{"pairs":1,"dropped":1,"via":"minhash+cosine-union"},
 "rank":{"reordered":true,"scoresTop":0.617},
 "curate":{"notes":7,"compressed":2,"tokensBefore":539,"tokensAfter":487}}
```

The `lane:dream` bus event (SSE receipt) proves every layer end-to-end: the
optional local-ml sub-package loaded IN-PROCESS through the guarded dynamic
import on a live engine, the embedding tier ENGAGED (`via:
minhash+cosine-union`, not minhash-only), the seeded near-dup was detected,
the would-be reorder and compression were computed — and the dream completed
(`done`) on the byte-identical original prompt. Receipt:
`results/h15-live-shadow/receipt.json` (gitignored raw dir).
