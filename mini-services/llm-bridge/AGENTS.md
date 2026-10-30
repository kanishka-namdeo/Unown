# llm-bridge (mini-services/llm-bridge/)

## Purpose

The OpenAI-compatible gateway every agent conversation goes through: it proxies `/v1/chat/completions` (JSON or SSE) to a remote OpenAI-compatible upstream (default Agnes AI), routes model ids onto its allow-list, enforces pacing and admission lanes so engine background jobs never starve an interactive terminal session, and records a privacy-preserving usage log. `index.ts` is the serving layer, `pure.ts` the pure logic (599 lines, unit-tested in isolation), `usage.ts` the persistence.

## Ownership

- Owns: everything in `mini-services/llm-bridge/` and this doc. The upstream endpoint and every knob live in the root `.env` (delivered via symlink — see the parent doc).

## Local Contracts

**Config (from `pure.ts` `loadConfig()`; documented in `.env.example`):** `BRIDGE_PORT` (3031) · `BRIDGE_MODEL` (default `agnes-3.0-flash`) · `BRIDGE_UPSTREAM_URL` (`https://apihub.agnes-ai.com/v1`, trailing slashes stripped) · `BRIDGE_UPSTREAM_KEY` (bearer; warned at boot if unset) · `BRIDGE_ROUTE_DEFAULT` (falls back to `BRIDGE_MODEL`) · `BRIDGE_KNOWN_MODELS` (comma allow-list, default `agnes-3.0-flash,agnes-2.5-flash`) · `BRIDGE_QWEN_THINKING` (thinking passthrough, default OFF for snappy agent turns) · `BRIDGE_API_KEY` (optional local bearer) · `BRIDGE_MIN_SPACING_MS` (400) · `BRIDGE_MAX_CONCURRENCY` (3) · `BRIDGE_BACKGROUND_YIELD_MS` (45000, 0 disables) · `BRIDGE_UPSTREAM_TIMEOUT_MS` (180000, headers-only cap) · local lane `BRIDGE_LOCAL_URL`/`_KEY`/`_MODELS` · failover lane `BRIDGE_FALLBACK_URL`/`_KEY`/`_MODEL` · usage `UNOWN_BRIDGE_STATE_DIR`, `UNOWN_PRICE_<MODEL>_IN/OUT`.

**Model routing:** allow-listed ids pass through unchanged; anything else routes to `BRIDGE_ROUTE_DEFAULT`. LOCAL lane: ids in `BRIDGE_LOCAL_MODELS` (or any `local-*` id when that list is empty) go to the local server (llama.cpp/Ollama/LM Studio), keyless when `BRIDGE_LOCAL_KEY` is empty, bypassing the spacing throttle; `enable_thinking` is mirrored into llama.cpp's `chat_template_kwargs`. A `local-*` id with no local URL degrades onto the remote allow-list rather than failing. Messages pass through verbatim (tool calling AND vision work natively). The upstream `/models` catalog is probed at most every 30s and merged into the allow-list (cap 64); env-pinned ids missing from the catalog are reported as `staleKnownModels`.

**Admission lanes (the M2 starvation fix):** at most `BRIDGE_MAX_CONCURRENCY` in-flight upstream attempts, held headers-to-body-end. Two lanes: `interactive` (humans) vs `background` (engine learning jobs). Signaling: `x-unown-lane` header wins; else a bearer token of exactly `bridge-background` (mem0's client cannot set custom headers). Background is capped at `MAX_CONCURRENCY - 1` slots (one always reserved for interactive) AND new background admissions yield entirely for `BRIDGE_BACKGROUND_YIELD_MS` after any interactive arrival (re-armed per arrival; already-admitted streams are never cancelled). Spacing (`BRIDGE_MIN_SPACING_MS` between upstream request starts) applies to remote + fallback lanes only. Bounded queue (`MAX_CONCURRENCY * 8` waiting) → 503 "admission queue saturated".

**Retry and failover:** retry `MAX_ATTEMPTS 6`, backoff `min(3s·2^(n-1), 45s)` + jitter, on 429/5xx/network-ish errors. When `BRIDGE_FALLBACK_URL` is set and a primary attempt fails failover-eligible (deliberately broader than retryable: quota/billing/rate-limit/timeout wording included; NOT plain 400/404 schema errors), the request is retried ONCE against the fallback endpoint with the model rewritten to `BRIDGE_FALLBACK_MODEL`. Local-lane requests never fail over. A failover is a remote: it joins spacing, gets normal retries, has no second-level failover.

**Degenerate-completion guard:** upstream 200s with zero work product (empty SSE streams or empty JSON bodies) are retried once transparently; a repeat is an honest 502. Streamed frames are HELD until the first content/tool-call/reasoning frame.

**Endpoints:** `GET /v1/models` (OpenAI list shape; entries carry the upstream's spec fields when it publishes them — `max_model_len`, `max_completion_tokens`, `architecture.input_modalities`, the DeepInfra precedent — so the agent's endpoint-catalog detection lane sees the upstream's truth) · `GET /health` (alias `/v1/health` — probes primary/local/fallback upstreams, reports `lanes` incl. `lastInteractiveAt` which the engine's `--idle-only` routines read, `failovers`, `degenerate`, `staleKnownModels`, `modelSpecs` (the upstream catalog's specs by id) and `learnedSpecs` (context limits upstream 400s revealed — `parseContextLimitError` mirrors pi's overflow catalog for the NUMBER; pass-through requests only, learned once per change into `model-specs-learned.json` in the state dir, surfaced never auto-applied: `unown models verify` records them agent-side)) · `GET /v1/usage?days=N&model=M` · `GET /v1/log` (ring buffer, last 200) · `POST /v1/chat/completions` (errors map to `{error:{message,type:"bridge_error",code}}`).

**Usage log:** one JSONL line per proxied completion in `.run/usage-log.jsonl` (`ts, model, upstreamModel, stream, promptTokens, completionTokens, cachedTokens?, durationMs, status, error?, lane?`) — **no prompts/messages/tool payloads ever written**. Rotation at 10MB to a single `.1` generation. Price resolution: env override `UNOWN_PRICE_<MODEL>_IN/OUT` (both required) → the model-specs SIDECAR (`~/.unown/agent/model-specs.json`, verified vendor-published costs detection recorded, suffix-matched on bare ids) → built-in estimates for the Dashscope trio; unpriced models cost `null`, never 0; the summary's `pricing.sidecarPriced` lists sidecar-priced models (their costs carry no `~` in `unown usage`); cached tokens billed at full input rate (conservative). Appends never throw to the chat path.

## Work Guidance

- Changing admission, routing or failover behavior updates `pure.ts` (pure) or `index.ts` (serving) accordingly and pins the behavior in `pure.test.ts` / `failover.test.ts` — `pure.test.ts` documents the deliberate QUIRKS; keep its comments true.
- A default-model or allow-list change also moves root "User Preferences" and the landing page's model copy (`check:claims` gates the page literals).
- The lane semantics are a product guarantee (engine yields to humans at BOTH the request level here and the scheduler level in the engine) — never weaken one side without the other.

## Verification

- `cd mini-services/llm-bridge && bun test` — the full suite: `pure.test.ts` (139 pure unit tests incl. the catalog-spec extraction + context-limit error patterns), `usage.test.ts` (real temp files, the learned-specs round-trip + the sidecar price source), `failover.test.ts` (9 hermetic tests spawning the real index.ts against two in-process mock upstreams), `specs.test.ts` (5 hermetic serving tests: the /v1/models spec passthrough, /health modelSpecs/learnedSpecs, the learn-once rule, routed-teaches-nothing, id-only-stays-id-only), `vlm-smoke.test.ts` (env-gated `UNOWN_VLM_SMOKE=1` live VLM proof; receipts to `benchmarks/vlm-smoke/results/`). CI's bridge job runs it (243 tests).
- Live: `curl -s localhost:3031/health` → `ok:true` with `upstream.ok:true`; a degenerate/failover behavior change re-verifies `/health`'s counters after a driven request.

## Child DOX Index

(none — flat directory)
