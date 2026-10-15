# llm-bridge (mini-services/llm-bridge/)

## Purpose

OpenAI-compatible gateway over the upstream Dashscope coding-plan endpoint. Lets the pi coding agent (and the whole self-learning stack) talk to `kimi-k2.5` / `qwen3.7-plus` / `qwen3.6-plus` through a standard `openai-completions` provider config pointing at `http://127.0.0.1:3031/v1`.

## Ownership

- Owns: `index.ts` — the entire bridge (routing, auth injection, thinking translation, streaming, throttling, retries, request log, health probe).

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
- Model routing rules (binding):
  - Requests naming an allow-listed model pass through unchanged.
  - Requests naming anything else (unknown/legacy ids like `glm-4-plus`) are routed to `BRIDGE_ROUTE_DEFAULT`.
  - Qwen models get `enable_thinking:false` unless `BRIDGE_QWEN_THINKING=1`; a z-ai style `thinking:{disabled}` request param is translated to the same flag.
- Messages pass through verbatim — including tool-role messages and `image_url` content parts — so tool calling AND vision (VLM) work natively end to end.
- Streaming: true SSE passthrough (upstream supports native streaming) — no synthesis buffer.
- Protections: upstream auth injection, request serialization + spacing, 429/5xx backoff retries, request-log ring buffer with streamed usage capture.
- Health: `GET /health` probes the upstream and reports its status for the dashboard.

## Work Guidance

- Keep the wire format subset in sync with `pi-repo/packages/ai/src/api/openai-completions.ts` (the client that talks to this bridge) — extend both together.
- The upstream is a paid coding plan: no need to ration calls, but keep the serialization/backoff guards so bursts don't trip 429s.
- Changing routing/thinking behavior means updating this doc's Model routing rules in the same change.

## Verification

- `curl -s localhost:3031/health` → upstream healthy.
- Probe scripts at root `scripts/` (`probe_dashscope.py`, `probe_stream.py`, `probe_thinking.py`, `probe_vision.py`, `test_bridge.py`) exercise chat, SSE, thinking-toggle and base64-image paths through the bridge.
- End-to-end: a Learning Lab harness cycle completes against the bridge (see engine doc).

## Child DOX Index

(none — single-module service)
