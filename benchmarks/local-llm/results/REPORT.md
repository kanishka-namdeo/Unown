# local-llm testbench — campaign report (2026-10-18)

**Question:** can fully-local, performance-optimized LLMs speed up / improve
Unown's learning-layer subtasks without degrading the self-improvement loop —
and can they do it across the broad range of systems Unown supports?

**Answer:** yes for the auxiliary learning lane (triage, mining, dream
consolidation — verified with quality parity and $0 marginal cost), no for
task minting, and never for the main agent brain. The integration ships as an
opt-in local lane: `BRIDGE_LOCAL_URL` + `local-*` model ids + per-subtask env
overrides. Default topology is unchanged.

- Host: linux-x64, 2 vCPU, 4.1GB RAM — deliberately the *small-box* profile.
- Remote baseline: `kimi-k2.5` via llm-bridge → Dashscope (list $0.49/M in, $2.50/M out).
- Local engine: llama.cpp `llama-server` b11718 (MIT, prebuilt, runtime CPU dispatch).
- Local models: Qwen3-0.6B / Granite-4.0-1B / LFM2.5-2.6B (Q4_K_M) + nomic-embed-text-v2-moe.
- Method: byte-faithful production prompts, real engine fixtures (4 genuine
  failed runs, 18 notes, shipped improvements), Unown's own extractJson +
  validators, blind A/B judge (position-swapped, consistency-gated).

## Verdict matrix

| H | subtask | local candidate | verdict | key numbers |
|---|---|---|---|---|
| H1 | note triage (embedding) | nomic-embed-v2-moe Q4 | **verified** | 100% agreement w/ remote, p50 **270ms**, $0 |
| H2 | note triage (generative) | Qwen3-0.6B Q4 | **verified** | 100% JSON, 100% kind+outcome agreement, p50 3.7s |
| H3 | failure mining | Qwen3-0.6B Q4 + grammar | **verified** | 100% JSON, **100% harness-validator pass** (remote: 50%), blind judge **4/4 ties**, p50 79s, $0 vs $0.010 |
| H4 | AutoDream consolidation | Qwen3-0.6B Q4 + grammar | **verified** | valid+sane next-memory, judge **tie**, 101s vs 10s (async OK), $0 |
| H5 | task minting | Qwen3-0.6B / Granite-1B | **refuted** | 50%/0% draft validity (truncation not grammar-fixable); remote also unreliable; keep remote |
| H6 | cross-platform | llama.cpp prebuilts | **verified** | 1.0-1.6s cold start; 0.6B lane 1.0-1.2GB RSS; CI green on ubuntu/macos/windows |
| H7 | local as main brain | — | **scoped out** | precedent + prefill math; agent sessions stay remote |
| H8 | integration shape | bridge local route + per-subtask env | **implemented + verified** | real `mineFailure()` over the local lane → harness-accepted result (99.8s); 970/970 engine + 106/106 bridge tests |
| H9 | miner spec compliance via remote `response_format` | kimi-k2.5 + `json_schema` | **refuted** | accepted (HTTP 200, all 3 models) but `maxLength`/`maxItems` NOT enforced → patchSpecOk 0.50 ≠ 1.00; judge 4/4 ties |

## E0 — capability probe (small box, idle)

| model | startup | RSS | gen tok/s | TTFT | prefill tok/s | json_schema |
|---|---|---|---|---|---|---|
| Qwen3-0.6B Q4_K_M (ctx 4096) | 1050ms | 1036MB | 18.0–22.8 | 166–188ms | 94.8 (127 without competing load; llama-bench pp512: 251) | ✅ |
| Granite-4.0-1B Q4_K_M (ctx 8192) | 2594ms | 2654MB | ~8–10 | 10.8s (12k-ctx dream prompt) | ~50 | ✅ |
| LFM2.5-2.6B Q4_K_M (ctx 8192) | 2059–4061ms | 3414MB | **5.9 (thrashing)** | — | — | ✅ |

**Lane-by-RAM guidance (the cross-platform answer):** the 0.6B lane fits
2-vCPU/4GB boxes (~1.2GB RSS at 12k ctx); 1B needs ~2.7GB RSS (6–8GB boxes
comfortable); 2.6B thrashes a 4GB box (5.9 tok/s) and is the lane for ≥6–8GB
machines — validated cross-OS by the `local-llm-probe.yml` GitHub matrix
(green on ubuntu/macos/windows at 3a84e37).

## E7 — remote-lane response_format (H9)

**Question:** E3's finding 2 showed the remote kimi-k2.5 violates the miner's
≤200-char patch-line spec on 50% of calls, while the local lane's json_schema
grammar makes the violation structurally impossible. Does the Dashscope
upstream accept per-call `response_format` for kimi-k2.5 — and does adopting
`response_format:json_schema` on the miner's chatJson call eliminate the spec
violations with no quality regression?

**Answer: accepted but not enforced — REFUTED on the decisive threshold.**
The upstream returns HTTP 200 for both `json_object` and `json_schema` on all
three routed models, and the schema demonstrably reaches the model (required
keys shape the output; `enum` is hard-enforced — a probe forced the enum value
against the prompt's explicit instruction to pick another). But the two
keywords the miner needs — `maxLength` (≤200 chars/line) and `maxItems`
(≤6 lines) — are NOT enforced (a `maxLength:10` probe returned a 137-char
string; a `maxItems:2` probe returned 5 items) — the same JSON-Schema subset
limitation as OpenAI structured outputs.

| arm (kimi-k2.5, same 4 real failed runs each) | httpOk | jsonOk | patchSpecOk | validatorPass | p50 | cost |
|---|---|---|---|---|---|---|
| baseline (production client: extractJson + corrective retry) | 100% | 100% | 0% | 0% | 7.5s | $0.0100 |
| + `json_object` | 100% | 100% | 50% | 50% | 7.3s | $0.0100 |
| + `json_schema` (strict, mining schema) | 100% | 100% | 50% | 50% | 7.8s | $0.0105 |

- **Acceptance matrix** (1 tiny probe each): kimi-k2.5 / qwen3.7-plus /
  qwen3.6-plus × `json_object` / `json_schema` — all six ACCEPTED (HTTP 200,
  no error shape; the one non-JSON probe reply was a maxTokens-64 truncation
  artifact, still accepted).
- **Blind judge** (position-swapped, consistency-gated): 4/4 ties — every
  pair flipped positions (0/4 position-consistent), i.e. the judge cannot
  distinguish the arms: no quality regression, and no quality gain either.
- **Thresholds:** json_schema accepted ✓ (httpOk 1.0); validatorPass parity ✓
  (0.50 ≥ 0.00); judge wins+ties ≥ losses ✓ (4 ≥ 0); **patchSpecOk(json_schema)
  = 1.00 ✗ — measured 0.50** (214- and 205-char patch lines survived
  `maxLength:200`). **H9 refuted** → production wiring skipped per the gate.

**Consequence:** the miner's remote-lane spec compliance stays where E3 left
it — the harness's own post-validation and the local lane's llama.cpp grammar
(which DOES enforce maxLength) remain the two working mechanisms. The whole
check re-runs in ~4 min via `node benchmarks/local-llm/runner.mjs e7-rfmt` if
the upstream's keyword support ever changes.

## Findings that change decisions

1. **KV-cache q8_0 quantization is a CPU trap.** Measured 4.4× prefill
   degradation (127 → 29 tok/s) on this box for ~235MB saved — the common
   "q8_0 KV is ~lossless" advice is GPU-tuned. The testbench keeps f16 KV +
   smaller ctx. Do not copy GPU flags onto CPU deployments.
2. **Grammar beats a frontier model at spec compliance.** Remote kimi-k2.5
   violated the miner's ≤200-char patch-line spec on 50% of calls; the
   json_schema grammar (`maxLength: 200`) makes the violation structurally
   impossible for the local model. If the remote lane ever adds
   `response_format` support per-call, the harness should use it there too.
3. **Mining prompts need ≥10k context.** Production mining prompts ran
   2245–4083 prompt tokens (+ up to 1.5k out) — a local lane configured with
   the "small" 4096 ctx silently fails on the larger transcripts (HTTP 400).
   The local lane must set ctx ≥ 10–12k (RAM cost ~1.2GB for 0.6B).
4. **Thinking models return empty `content`** unless the request carries
   `chat_template_kwargs: {enable_thinking: false}` (llama.cpp dialect) — the
   bridge now mirrors its resolved `enable_thinking` into
   `chat_template_kwargs` for local-lane requests.
5. **Async is the local lane's natural habitat.** Local p50s: triage 3.7s,
   mining 68–79s, dream ~101s (remote: 1.4s / 7.8s / 10.1s). For the
   background learning jobs (mining after a failed run, AutoDream, note
   sync) wall-clock is not on the critical path; for anything interactive
   the remote lane stays the right default. This mirrors the sleep-time
   compute pattern (Letta) and Mem0's small-model memory ops.

## Cost model (list prices)

| call | remote per call | local per call |
|---|---|---|
| note triage | ~$0.0003 (200 in / 60 out) | $0 |
| mining | ~$0.0023–0.005 (2.2–4.1k in / 330–420 out) | $0 |
| dream | ~$0.002 (4k in / 600 out) | $0 |
| mint | ~$0.004–0.0085 (incl. failed attempts) | $0 (but refuted on quality) |

At the engine's job cadence (10-min harness cycle, 30-min mint, async dream)
a fully-local auxiliary lane removes the mining + dream + triage spend
entirely and makes the learning loop operable offline.

## What shipped (f4d26a0 + docs)

- Bridge: `BRIDGE_LOCAL_URL/KEY/MODELS`, `routeRequest()`, `local-*` routing,
  keyless llama.cpp, no spacing throttle on the local lane, thinking-compat
  shim, `/health` local probe, `/v1/models` advertising — 106-test suite.
- Learning layer: `modelFor()` + `PI_MINER/DREAM/SKILLS/MINT_MODEL_ID`
  overrides at all five call sites; default topology byte-identical when
  unset — 970/970 engine tests.
- Testbench: `runner.mjs serve` (one-liner local lane), cross-platform
  provisioning, CI probe matrix.
- E6 proof: the production `mineFailure()` over the local lane returned a
  harness-accepted MiningResult in 99.8s whose patch lines matched the
  insight the engine itself later shipped for the same task.

## Not run / future work

- **H7** (local as main brain): scoped out by design — see verdict matrix.
- LFM2.5-2.6B quality-lane experiments (E1–E4) on a ≥8GB machine; the 4GB
  host could only prove the lane boots (E0) — granite/qwen carried the
  quality verdicts here.
- Remote-lane `response_format` adoption for the miner (finding 2): **run as
  E7/H9 — refuted** (accepted but `maxLength`/`maxItems` not enforced); re-run
  `e7-rfmt` if the upstream's JSON-Schema keyword support changes.
- A local-draft + remote-repair cascade for minting (H5's salvage path).
- Longer-horizon A/B: run the engine for a week with mining+dream local and
  compare improvement-ship rate + benchmark pass-rate drift vs the all-remote
  baseline (the verify-twice, canary and retention gates stay the safety net).
