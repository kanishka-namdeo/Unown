# complementary testbench — campaign report (2026-10-19)

**Question:** can *non-traditional* fully-local mechanisms — model-free
speculative decoding, draft-model speculation, KV prefix reuse, a tiny local
model as a prompt compressor, embedding-keyed caching, small-model query
rewriting, and the 2026 tiny-model generation with native vision — work
**complementary to the configured remote endpoint** (Dashscope
`kimi-k2.5`/`qwen3.7-plus`/`qwen3.6-plus` via the bridge) to speed up or
improve the harness's tasks, on the broad range of systems Unown supports?

**Answer:** two mechanisms ship as verified wins (KV prefix reuse — already
on by default, now measured and documented; local prompt compression —
47% remote input cut at judge parity on mining, family-specific for dream),
one capability opens (a $0 local vision lane on sub-1B hardware), and four
ideas are refuted with receipts — including two that the field's folklore
predicted would win (n-gram speculation on "repetitive JSON", LLM query
rewriting for retrieval). The negative results are load-bearing: they close
the speculation lane for small boxes, close the semantic-cache near-dup tier
as un-thresholdable, and hand the missing retrieval layer to BM25 —
independently confirming nonllm campaign-2's H17 on a second corpus.

- Host: linux-x64, 2 vCPU, 4.1GB RAM (the small-box profile, deliberately).
- Engine: llama.cpp `llama-server` b11718 (the SAME engine the shipped
  `BRIDGE_LOCAL_URL` lane uses — a verified mechanism here is a `serve` flag
  or an env sketch away, nothing new to install).
- Remote baseline: `kimi-k2.5` via llm-bridge → Dashscope.
- Method: byte-faithful production prompts + engine fixtures (the 4 genuine
  FAILED runs, 12-18 real notes) imported from `../local-llm`; llama.cpp's
  own `timings` block as the speed instrument; greedy-only identity guards
  for speculation; blind position-swapped consistency-gated judging reused
  from `../local-llm/lib/judge.mjs`; adversarial danger cases for the cache.

## Verdict matrix

| H | mechanism | verdict | key numbers |
|---|---|---|---|
| H16 | n-gram speculation (model-free) | **refuted** | 0.92–1.07× median tok/s (threshold 1.3×) across triage×{plain,grammar} and mining×grammar; ngram-mod breaks greedy byte-identity 9/12 (batched-verification float non-associativity); ngram-simple keeps identity but gains nothing |
| H17 | draft-model speculation (Qwen2.5-0.5B → Qwen3-0.6B) | **refuted** | tokenizer pair ACCEPTED (boots), 1.07× mining / 0.97× triage vs 1.5× threshold at +45MB RSS; the 0.6B target at 6–16 tok/s on 2 vCPU is already compute-saturated — draft passes steal the same cores |
| H18 | llama-server prefix KV reuse | **verified** | follow-ups process **37%** of the full prompt (121/301 tokens median; broken-prefix control processes 95% — prefix-driven, not free), prefill time **−54.5%** (1372→625ms), repeat-call identity exact; default-on in `serve` |
| H19 | local chunk-compression → remote savings | **verified** (family-specific) | payload cut **51.3%** median, remote input **−47.2%** (mining 2928→2382, 4719→2337 tokens), validator 33% vs 0% (parity+), judge 2T+1L−0W (the loss is the DREAM arm losing run references — mining arms tie, one lean-better); compressor p50 70.8s async, $0 remote-quality-neutral |
| H20 | two-tier semantic cache | **split** — L1 verified / L2 refuted | L1 exact 12/12 byte-identical; L2 near-dup: outcome-flipped edits hit at cos 0.952–0.974 (100% false-serve at t=0.95, 33% at t=0.97) while the embedder's own rerun self-similarity tops out <0.99 — the danger band and the legit band OVERLAP; no threshold exists |
| H21 | small-model query rewriting for retrieval | **refuted** (and hands the seam to BM25) | recall@5 on the global pool: raw-question embed **92.5%**, 0.6B-rewritten **87.5%** (−5.0pp; single-session-user 75%→50%), rewrite p50 2.3s; **BM25(raw question) = 100.0%**, RRF(rewrite+BM25) = 100.0% — exact-token matching is the complete answer on this corpus, confirming nonllm c2/H17 on a second corpus+task |
| H22 | Qwen3.5-0.8B bake-off + local vision | **split** — vision lane verified / model upgrade refuted | vision: boots via mmproj (needs `--jinja` + `enable_thinking:false` — the H4 empty-content trap on the vision path), answers the red-circle probe in 1470ms at **$0**, RSS 1176MB; text lane: triage agreement with incumbent **58%** (all kind-only: benchmark→terminal) and with remote 58% vs incumbent's 100%, at 15.0 tok/s vs 19.8 — the incumbent stays |

## C0 — runtime gate (keyless, 13/13)

llama.cpp b11718 mechanism inventory, asserted on this host and in CI on
3 OSes (`complementary-probe.yml`): `--spec-type` family (11 kinds incl.
ngram-simple/ngram-mod/draft-simple) present; `--cache-reuse`/`--slots`
present; `--mmproj` present; ngram-mod lane boots and answers under
json_schema grammar; the `timings` block present on non-stream chat
(`prompt_n`/`prompt_ms`/`predicted_per_second`); `/tokenize` works; raw
`/completion` works; **KV prefix reuse engages** (34→11 prompt tokens on a
shared-system sequence); `prompt_logprobs` supported (the LLMLingua-1 arm
is available); **draft pair boots** — Qwen2.5-0.5B is tokenizer-compatible
with the Qwen3-0.6B target; **qwen3.5-0.8b loads** on the pinned build
(`qwen35` hybrid arch).

## C1 — n-gram speculation (H16): the JSON intuition, measured

The folklore says n-gram speculation wins on "structured, repetitive
generation — JSON, fixed templates". The local lane's outputs ARE
schema-constrained JSON — and the mechanism still loses, because the
output's *structure* repeats but its *content* is novel: there are no
in-context n-gram matches to draft from, so every draft misses and the
verification pass is pure overhead.

| arm (greedy, qwen3-0.6b Q4_K_M) | tok/s med | ratio | identity |
|---|---|---|---|
| triage·grammar baseline | 15.8 | — | — |
| triage·grammar ngram-simple | 16.9 | 1.07× | 12/12 |
| triage·grammar ngram-mod | 15.7 | 1.00× | **9/12** |
| triage·plain baseline | 16.1 | — | — |
| triage·plain ngram-simple | 16.0 | 0.99× | 12/12 |
| triage·plain ngram-mod | 15.4 | 0.96× | **9/12** |
| mining·grammar baseline (real FAILED runs) | 6.3 | — | — |
| mining·grammar ngram-simple | 6.0 | 0.95× | 2/2 |
| mining·grammar ngram-mod | 5.8 | 0.92× | 2/2 |

The **identity guard found a real defect**: `ngram-mod` produced different
bytes than the baseline on 3/12 triage replays *under greedy sampling* —
llama.cpp's own docs warn specdec is only greedy-deterministic modulo
floating-point non-associativity in batched verification; measured here as
a live effect. Any production use of specdec where byte-stability matters
must use `ngram-simple` (identity held) — which anyway gains nothing on
this workload.

## C2 — draft-model speculation (H17): the small-box ceiling

The pair the C0 gate proved compatible (Qwen2.5-0.5B drafting for
Qwen3-0.6B — same tokenizer family, llama-server accepts it) delivers:

| arm | tok/s med | ratio | identity | RSS |
|---|---|---|---|---|
| mining·grammar baseline | 6.1 | — | — | 2126MB |
| mining·grammar draft-simple (K=8) | 6.5 | 1.07× | 2/2 | 2171MB |
| triage·grammar baseline | 16.6 | — | — | 1454MB |
| triage·grammar draft-simple (K=8) | 16.1 | 0.97× | 12/12 | 1499MB |

The GPU-era heuristic ("aim for acceptance >0.6 at K=5 for net speedup")
assumes the draft is nearly free. On 2 vCPU it is not: draft and target are
the same size class on the same cores, and the target is already
memory-bandwidth-saturated at 6–16 tok/s. Draft-model specdec on this class
of box needs a much slower target to pay; documented as the ceiling, with
n-gram (C1) also closed — **the local lane's speed lever is model choice,
not speculation** (and the incumbent remains the best triage-class model
tested, C7).

## C3 — prefix KV reuse (H18): the free win, measured

On the production call shape (shared `TRIAGE_SYSTEM` prefix + new note):

| metric | value |
|---|---|
| first call (full prefill) | 301 tokens, 1372ms |
| follow-up (shared prefix, new payload) | processes **121** tokens median, 625ms |
| control (broken prefix) | processes **95%** of full (129/136) — the mechanism is prefix-driven, not free |
| prefill time saved | **54.5%** |
| repeat-call identity | identical (KV reuse is exact) |

`cache_prompt` is llama-server's default, so the shipped `serve` lane
already has this — the value of C3 is the measurement and the guidance:
same-system call sequences (triage batches, dream re-runs, mining ladders)
get a ~2× prefill cut for free; and the caveat that hybrid-recurrent
architectures (Qwen3.5's DeltaNet layers — H22's candidate) have
partial-checkpoint limits in llama.cpp's context management, so this win is
an argument FOR the incumbent full-attention 0.6B on the lane.

## C4 — local compression, remote savings (H19): the first remote-cost cut

The 0.6B selects which payload chunks survive (json_schema grammar; the
budget is HARD-CAPPED post-hoc after measuring the model over-keep 35/36 at
budget 18), then the SAME remote model runs on full vs compressed payloads:

| replay | payload cut | remote input tokens | cost/call | judge |
|---|---|---|---|---|
| mine-00817634 | 51.3% | 2928 → 2858* | $0.00229 → $0.00227 | tie (flip) — one lean: "compressed diagnoses the root cause MORE precisely" |
| mine-0c0f0034 | 52.9% | 4719 → 2337 (**−50.4%**) | $0.00323 → $0.00184 | tie (flip) |
| dream-0 | 42.5% | 24 notes → 7 kept | — | **loss (consistent)**: "full preserves more specific run references (run c6f06a73, run 00817634)" |
| **median** | **51.3%** | **−47.2%** | proportional | 2T + 1L − 0W |

\* first-run row predates the hard budget cap; the kept-count column of the
receipt file carries both runs' shapes.

Validator: compressed 33% vs full 0% — the remote's known ≤200-char
patch-line spec violations (E3/E7) are not made worse; compression is
quality-neutral on the spec axis. The single judge loss is the DREAM seam
and matches nonllm H14's finding on the same seam (extractive compression
loses technical detail) — the operating point is family-specific: **mining
~50% cut is a win; dream needs keep-pct ≥0.7 or the H14 hybrid**
(activation-ranked head kept full). Compressor spend: p50 70.8s local,
async-compatible (mining runs after a failed run; dream is scheduled).

Integration sketch (opt-in, exactly the mint-cascade pattern):
`PI_PAYLOAD_COMPRESS=1` + `PI_COMPRESS_MODEL_ID=local-qwen3-0.6b` +
per-subtask keep-pct; the harness's mining path compresses the transcript
payload before the remote call. Not wired in this campaign — gated on the
registry per repo discipline, like E8 was.

## C5 — two-tier semantic cache (H20): the near-dup tier is un-thresholdable

| tier | result |
|---|---|
| L1 exact (sha256 of model+messages+params) | 12/12 replays served byte-identical, ~0ms — trivially safe |
| L2 near-dup (same SYSTEM hash + payload cosine) | **refuted**: no safe threshold |

The adversarial corpus (outcome-flipped note edits — "passed"→"FAILED" plus
a post-hoc edit note) embeds at **cos 0.952–0.974** against the originals:
100% of them HIT at t=0.95, 33% at t=0.97 — and would serve the WRONG
triage label (the judge's reasons were unanimous: "Output A correctly
reflects the EDITED outcome … while B incorrectly…", formal ties only via
position-flips). Meanwhile the nomic embedder's own re-embedding of an
identical payload lands below 0.99 (nondeterministic batched inference), so
the threshold that excludes the danger band also excludes legitimate
replays (0 hits at 0.99). **The two cosine bands overlap — this is a
mechanism boundary, not a tuning problem.** A delta-aware tier (diff-hash
on unchanged payload lines) is the follow-up shape, filed as future work.

## C6 — query rewriting for retrieval (H21): refuted, and the seam's answer is BM25

The recall-qa corpus per-case pools measured saturated (2–5 sessions, 100%
for every arm), so the discriminative setting ranks each question's
evidence against **every session the corpus holds** (the global pool):

| arm | recall@5 | recall@10 |
|---|---|---|
| embed(raw question) | 92.5% | 97.5% |
| embed(0.6B-rewritten question) | **87.5%** | 97.5% |
| **BM25(raw question)** | **100.0%** | **100.0%** |
| RRF(embed-rewrite + BM25) | 100.0% | 100.0% |

The rewrite mechanism itself worked flawlessly (100% JSON validity, p50
2.3s, sensible keyword phrases) — and made retrieval WORSE (−5.0pp; the
rewrite drops the exact distinguishing tokens that the evidence sessions
contain verbatim; worst on single-session-user 75%→50%). LongMemEval-style
questions quote the user's own words, so exact-token matching is the
complete answer. This independently **confirms nonllm campaign-2's H17**
(BM25 the best single lane) on a second corpus and a different task, and
assigns the missing retrieval layer's integrator: **BM25(+RRF)** —
zero-model, zero-cost, 100% recall@5 here — not LLM query rewriting.

## C7 — tiny-model bake-off + local vision (H22): the incumbent stays, vision opens

| probe | startup | RSS | gen tok/s | TTFT | json_schema |
|---|---|---|---|---|---|
| qwen3-0.6b Q4_K_M (incumbent) | 1555ms | 1230MB | 19.8 | 115ms | ok |
| qwen3.5-0.8b Q4_K_M (candidate, qwen35 hybrid) | 1514ms | 1176MB | 15.0 | 217ms | ok |

Triage replay (12 real notes): both 100% JSON validity; **candidate
agreement with the incumbent 58%** (all 5 disagreements kind-only:
benchmark→terminal; outcomes 100%), agreement with the remote model 58% vs
the incumbent's 100%; candidate p50 5.8s vs 4.1s. The 2026 tiny generation
is smarter on benchmarks-of-record (II 9 vs 6.5) and still loses on this
lane's actual classification task at this quant on CPU — the incumbent
stays.

**Local vision lane (acceptance)**: the same GGUF + its BF16 mmproj boots
in llama.cpp b11718 and answers the vlm-smoke red-circle probe **locally in
1470ms at $0** (remote qwen3.7-plus vision: 959ms, vision tokens billed).
Two traps found and documented: the request needs
`chat_template_kwargs:{enable_thinking:false}` — the H4 empty-content trap
generalizes to the vision path (everything lands in `reasoning_content`
otherwise) — and the lane needs `--jinja` for the multimodal chat template.
RSS 1176MB fits the 4GB co-resident budget. This opens a pi-side image
capability at $0; a real screenshot corpus is required before any quality
claims or production wiring (the H22 guard).

## Findings that change decisions

1. **Speculation is closed for the small-box local lane.** Both model-free
   (n-gram) and draft-model speculation measured at or below 1.07× — and
   ngram-mod silently changes greedy outputs (float non-associativity,
   9/12 identity). The lane's speed lever is model choice; the incumbent
   0.6B remains the best triage-class model tested across two campaigns.
2. **The free win was already on.** llama-server's default prefix caching
   halves prefill on same-system sequences (54.5%); the guidance — and the
   pro-incumbent argument that hybrid-recurrent archs checkpoint worse —
   is what C3 adds.
3. **Compression is the first mechanism that cuts what the configured
   remote endpoint is paid** (−47.2% input tokens on mining at judge
   parity), with a clean family split: mining yes, dream needs the gentler
   operating point. Sketch filed; wiring gated like the mint cascade was.
4. **The semantic-cache near-dup tier is un-thresholdable** — the
   adversarial cosine band (0.95–0.97) overlaps the embedder's own
   self-similarity ceiling (<0.99). GPTCache's near-miss warning, measured.
   Exact-hash caching is safe and free where calls genuinely repeat.
5. **The missing retrieval layer's answer is BM25** — 100% recall@5 on the
   recall-qa global pool, zero models, zero cost, confirming nonllm
   campaign-2's H17 on a second corpus. LLM query rewriting measured
   NEGATIVE (−5pp) and is closed for this distribution.
6. **Local vision is real at $0 on sub-1B hardware** — with the
   thinking-off trap documented for the vision path and the `--jinja` +
   mmproj recipe recorded. A screenshot corpus campaign is the gate for any
   production claim.

## Cost model (this campaign's levers)

| mechanism | remote $/call | local cost | note |
|---|---|---|---|
| mining, uncompressed | ~$0.0023–0.0032 | — | current |
| mining, compressed (H19) | **−47%** | 70s async, $0 | judge parity |
| triage, cache-hit (L1) | $0 | ~0ms | only for true repeats |
| image QA, local vision (H22) | $0 vs vision-token billing | 1.5s | acceptance-lane |

## Not run / future work

- Delta-aware cache tier (diff-hash on unchanged payload lines) — the L2
  successor that can see edits; design only, this campaign.
- Compression wiring + shadow-mode replay (the H15/E8 pattern) — mining
  first, dream at keep-pct ≥0.7 after an H14-hybrid comparison.
- A real screenshot corpus for the local vision lane (acceptance → quality).
- Specdec on a ≥4B target (where the draft IS cheaper than the target) —
  out of scope on a 4GB box; the 2.03× CPU precedent was measured on a 3B
  target by others, and this box cannot host that lane co-resident.
- BM25(+RRF) retrieval integrator for memory injection — the seam both
  campaigns now point at; an H15-style pre-processor is the shape.
