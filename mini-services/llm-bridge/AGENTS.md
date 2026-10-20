# llm-bridge (mini-services/llm-bridge/)

## Purpose

OpenAI-compatible gateway over the upstream Dashscope coding-plan endpoint. Lets the pi coding agent (and the whole self-learning stack) talk to `kimi-k2.5` / `qwen3.7-plus` / `qwen3.6-plus` through a standard `openai-completions` provider config pointing at `http://127.0.0.1:3031/v1`.

## Ownership

- Owns: `index.ts` — the thin serving layer (auth injection, SSE pipe, throttling, retries, request log, health probe) and `pure.ts` — the pure logic (env parsing via `loadConfig(env)`, model routing, request shaping, tool-call sanitization, completion/SSE stats, retry/backoff/spacing math), unit-tested by `pure.test.ts`.

## Local Contracts

- Environment (read from the root `.env` via symlink; defaults in parentheses):
  - `BRIDGE_PORT` (3031)
  - `BRIDGE_MODEL` — advertised default model (kimi-k2.5)
  - `BRIDGE_UPSTREAM_URL` — upstream base URL, no trailing slash (Dashscope coding-intl `/v1`)
  - `BRIDGE_UPSTREAM_KEY` — upstream bearer key (secret — lives only in `.env`, never in tracked files)
  - `BRIDGE_ROUTE_DEFAULT` — model used when a request names an unknown model (kimi-k2.5)
  - `BRIDGE_KNOWN_MODELS` — comma-separated passthrough allow-list (kimi-k2.5,qwen3.7-plus,qwen3.6-plus)
  - `BRIDGE_QWEN_THINKING` — `1` leaves qwen thinking models in thinking mode; default disables (snappier agent turns)
  - `BRIDGE_API_KEY` — optional local shared secret requiring `Authorization: Bearer <key>` on every request
  - `BRIDGE_MIN_SPACING_MS` — min ms between upstream requests (400)
  - `BRIDGE_UPSTREAM_TIMEOUT_MS` — cap on time-to-response-HEADERS per upstream attempt (180000). Bodies may stream longer once headers arrive; a stalled upstream fails fast instead of wedging callers (the engine's own timeouts are 240s, so the bridge fires first).
  - `BRIDGE_FALLBACK_URL` / `BRIDGE_FALLBACK_KEY` / `BRIDGE_FALLBACK_MODEL` — optional FAILOVER lane: a second REMOTE OpenAI-compatible endpoint (e.g. Agnes AI `https://apihub.agnes-ai.com/v1` + `agnes-3.0-flash`) that takes over when the primary cannot serve (see the failover rule below). Empty = off.
- Model routing rules (binding):
  - Requests naming an allow-listed model pass through unchanged.
  - Requests naming anything else (unknown/legacy ids like `glm-4-plus`) are routed to `BRIDGE_ROUTE_DEFAULT`.
  - Local lane: when `BRIDGE_LOCAL_URL` is set, ids in `BRIDGE_LOCAL_MODELS` (or any `local-*` id when that list is empty) are forwarded to the LOCAL upstream instead — keyless by default (`BRIDGE_LOCAL_KEY` for servers that want one), bypassing the spacing throttle, with the resolved `enable_thinking` mirrored into `chat_template_kwargs` (llama.cpp's dialect). A `local-*` id with NO `BRIDGE_LOCAL_URL` degrades onto the remote allow-list (→ `BRIDGE_ROUTE_DEFAULT`) instead of hard-failing. The qwen family check strips a leading `local-` so `local-qwen3-0.6b` gets the same thinking-off default. Local-lane requests NEVER fail over — they are already a deliberate second-endpoint routing choice.
  - FAILOVER lane (distinct from the local lane — routing vs failover): when `BRIDGE_FALLBACK_URL` is set and a PRIMARY (remote-lane) attempt fails with a failover-eligible error, the request is retried ONCE against the fallback endpoint, rewritten onto `BRIDGE_FALLBACK_MODEL` (empty = same routed id). Eligible errors (pure.ts `isFailoverError`): HTTP 429 (Dashscope's quota throttle — "hour allocated quota exceeded" — ships as 429, measured live), 402/408, 401/403 (a rejected/dead primary key IS "primary not working"), any 5xx, and message wording: quota/throttle/arrears/billing/balance/insufficient/rate-limit/too-many-requests/429/network/socket/ECONN/fetch failed/unable to connect/refused/timeout/terminated (covers providers shipping quota errors as plain 400s and Bun's connection-refused phrasing). NOT eligible: plain 400/404/409/422 schema/model errors (the same request would fail on the fallback too). The cut-in is immediate — a failover-eligible primary error short-circuits out of `callUpstream` (`failoverCandidate: true`) WITHOUT burning the 6-attempt / ~90s retry backoff. The fallback is a remote: it joins the spacing throttle and headers timeout, gets normal retry semantics, and has no second-level failover (its errors surface honestly).
  - Qwen models get `enable_thinking:false` unless `BRIDGE_QWEN_THINKING=1`; a z-ai style `thinking:{disabled}` request param is translated to the same flag.
- Messages pass through verbatim — including tool-role messages and `image_url` content parts — so tool calling AND vision (VLM) work natively end to end.
- Streaming: true SSE passthrough (upstream supports native streaming) — no synthesis buffer.
- Protections: upstream auth injection, request serialization + spacing, headers timeout per attempt (`BRIDGE_UPSTREAM_TIMEOUT_MS`), 429/5xx backoff retries, upstream failover (`BRIDGE_FALLBACK_*`), request-log ring buffer with streamed usage capture.
- Health: `GET /health` probes the primary upstream (`GET /models`, 8s timeout) on every call and reports `upstream {ok, status}`, plus — when configured — the local lane (`local`) and the failover lane (`fallback {ok, status, url, model}`, 4s timeout) along with a `failovers` counter (failovers since process start; failover-served requests carry the `fb:` prefix on the upstream model in `/v1/log` and the usage log). `upstreamKeyIsSet`, `authRequired`, `upstreamUrl`, `defaultModel`, `models` round it out — `unown doctor` and `scripts/start.ts` use these fields to surface a missing upstream key or a failing primary loudly (with the fallback's serving state) instead of letting chats fail with a bare 401.
- Stream teardown contract: `pipeSse`'s `cancel()` (client disconnect mid-stream) cancels the upstream transfer THROUGH the forwarding reader (`reader.cancel().catch(() => {})`) — `res.body.cancel()` on a reader-locked body rejects asynchronously, and that unhandled rejection crashed stream teardown under disconnect load (observed live: killed clients wedged every subsequent chat request). Never call `.cancel()` on a locked stream without swallowing the rejection.

## Work Guidance

- Keep the wire format subset in sync with `pi-repo/packages/ai/src/api/openai-completions.ts` (the client that talks to this bridge) — extend both together.
- The upstream is a paid coding plan: no need to ration calls, but keep the serialization/backoff guards so bursts don't trip 429s.
- Changing routing/thinking behavior means updating this doc's Model routing rules in the same change.

## Verification

- `cd mini-services/llm-bridge && bun test` — the full bridge suite: `pure.test.ts` (127 pure-logic unit tests), `usage.test.ts` (usage log, real temp files), `failover.test.ts` (9 hermetic serving-layer tests: spawns the REAL index.ts on an OS-assigned ephemeral port against two in-process mock upstreams — real Bun.serve on port 0, the house pattern from test/cli/helpers.ts; never fetch monkey-patching; everything on 127.0.0.1) and `vlm-smoke.test.ts` (live suite env-gated and skipped by default). CI runs this full suite (181 tests: 176 hermetic + 5 env-gated VLM skips).
- `UNOWN_VLM_SMOKE=1 [UNOWN_VLM_SMOKE_URL=http://127.0.0.1:3031] [UNOWN_VLM_SMOKE_RECEIPT=/abs/path.json] bun test vlm-smoke.test.ts` — live VLM smoke (testing-strategy.md §7 I): posts a code-generated 100×100 solid-red PNG as an `image_url` content part to `qwen3.7-plus` through this bridge and asserts a non-empty, image-grounded answer. Skipped unless `UNOWN_VLM_SMOKE=1` (default runs and CI stay offline/free); the optional receipt env var writes the raw response + usage + duration + request shape (no secrets) for `benchmarks/vlm-smoke/results/`.
- `curl -s localhost:3031/health` → upstream healthy.
- Probe scripts at root `scripts/` (`probe_dashscope.py`, `probe_stream.py`, `probe_thinking.py`, `probe_vision.py`, `test_bridge.py`) exercise chat, SSE, thinking-toggle and base64-image paths through the bridge.
- End-to-end: a Learning Lab harness cycle completes against the bridge (see engine doc).

## Child DOX Index

(none — single-module service)
