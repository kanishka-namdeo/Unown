# VLM smoke through llm-bridge — results

**Question:** does the bridge's multimodal (vision) path actually work end to
end — `image_url` content parts surviving the serving layer and being *seen*
as pixels by qwen3.7-plus — or is it still only verified by the ad-hoc
`scripts/probe_vision.py`? (docs/testing-strategy.md §7 I)

Protocol: env-gated integration test
(`mini-services/llm-bridge/vlm-smoke.test.ts`, gate `UNOWN_VLM_SMOKE=1` —
skipped in every default `bun test` run and in CI). One POST to the live
bridge's `/v1/chat/completions` carrying a single user message with two
content parts: `"What color is this image? Answer in one word."` and a
data-URL `image_url` part holding a **code-generated** 100×100 solid-red PNG
(no fixtures, no new deps; chunk CRCs, IDAT round-trip and pixel values are
pinned by always-on pure tests). Run once on 2026-10-17 against
`http://127.0.0.1:3031` (bridge already authenticated via its own
`BRIDGE_UPSTREAM_KEY`; the test sets no keys).

## Result — the vision path works

Receipt: `receipt-2026-10-17.json` (raw response JSON verbatim, usage, bridge
log entry, duration, request-shape summary, PNG sha256).

| Check (asserted by the test) | Outcome |
|---|---|
| HTTP 200, no bridge `error` payload | ✅ |
| Non-empty text content in `choices[0].message.content` | ✅ `"Red"` (3 chars) |
| Answer grounded in the image (names its color) | ✅ `"Red"` |
| Usage accounting present (`total_tokens > 0`) | ✅ 91 tokens |

Three independent pieces of evidence that the image was actually *seen* as an
image, not dropped or stringified:

1. **`usage.prompt_tokens_details.image_tokens: 66`** (text_tokens 23) — the
   upstream billed the PNG as image tokens, so the multimodal part survived
   the bridge AND was routed into the model's vision encoder.
2. The one-word answer `"Red"` matches the image's sole visual property.
3. The bridge's own request log (captured in the receipt) shows the request
   served under `upstreamModel: qwen3.7-plus`, `finishReason: "stop"`,
   `promptTokens: 89` — the serving layer (routing → request shaping → retry
   chain) processed it exactly like a normal chat call, no special-casing.

Cost of the run: 91 tokens, 953 ms, one request.

## Read it honestly

- **Single-run smoke (n=1).** No repetitions, no variance, no flake-rate.
- **No scoring.** The "grounding" check is a color-naming probe on a solid
  red image — the most deterministic VLM probe available (same stimulus as
  `probe_vision.py`), but it is not an image-understanding benchmark.
- **One model.** qwen3.7-plus is the only vision-capable model in the bridge
  allow-list; kimi-k2.5 / qwen3.6-plus were not tried (they reject image
  parts upstream).
- **Non-streaming only.** The SSE path with image parts is not covered.
- **Screenshot-to-code** (the other half of §7 I) remains future work; this
  closes the image-understanding smoke.

## Re-running

```bash
# bridge must be running (bun run agent:bridge); no API keys needed by the caller
cd mini-services/llm-bridge
UNOWN_VLM_SMOKE=1 \
  UNOWN_VLM_SMOKE_URL=http://127.0.0.1:3031 \
  UNOWN_VLM_SMOKE_MODEL=qwen3.7-plus \
  bun test vlm-smoke.test.ts
# add UNOWN_VLM_SMOKE_RECEIPT=/abs/path.json to capture a fresh receipt
```

Without `UNOWN_VLM_SMOKE=1` the three live tests are skipped; only the two
pure payload-shaping tests run (offline, free).

---

## 2026-10-21 — re-run against the Agnes upstream (agnes-3.0-flash)

Same protocol and request shape, new stack: the bridge now fronts
`https://apihub.agnes-ai.com/v1` (default model `agnes-3.0-flash`,
vision-capable). Receipt: `receipt-2026-10-21.json` — same JSON shape as
`receipt-2026-10-17.json`, byte-identical stimulus (PNG sha256
`4304a53d…c1e4`), so the two runs are directly comparable.

**5/5 tests pass** (2 pure payload-shaping + 3 live), exit 0, 3.8 s wall,
one live request.

| Check (asserted by the test) | Outcome |
|---|---|
| HTTP 200, no bridge `error` payload | ✅ |
| Non-empty text content in `choices[0].message.content` | ✅ `"Red"` (3 chars) |
| Answer grounded in the image (names its color) | ✅ `"Red"` |
| Usage accounting present (`total_tokens > 0`) | ✅ 153 tokens |

Evidence the image was actually *seen* as an image (not dropped or
stringified):

1. **`usage.prompt_tokens_details.image_tokens: 64`** of 151 prompt tokens —
   the Agnes upstream billed the 100×100 red PNG as image tokens, so the
   multimodal part survived the bridge and reached the model's vision encoder.
2. The one-word answer `"Red"` matches the image's sole visual property.
3. The bridge's own request log (captured in the receipt) shows the request
   served under `upstreamModel: agnes-3.0-flash`, `finishReason: "stop"`,
   `promptTokens: 151` — routing → request shaping → retry chain processed
   it exactly like a normal chat call, no special-casing, no failovers
   (`bridgeHealth.failovers: 0`, `errors: 0`).

Cost of the run: 153 tokens, 2,114 ms, one request.

Read it honestly (deltas vs the 2026-10-17 section):

- Still **single-run smoke (n=1)**, non-streaming only, no scoring beyond the
  color-naming probe; screenshot-to-code remains future work.
- **Model is `agnes-3.0-flash`**, the only vision-capable model in the bridge's
  current Agnes catalog routing. The receipt's `caveats` array is emitted
  verbatim by the test source and still names qwen3.7-plus (the 2026-10-17
  model); the receipt's own `request.model`, `response.model` and
  `bridgeLogEntry.upstreamModel` fields are the authoritative model record —
  all three say `agnes-3.0-flash`.
- Prompt-token accounting differs between upstreams (Agnes: 151 prompt tokens
  with `image_tokens: 64`; Dashscope/qwen3.7-plus: 89 with
  `text_tokens: 23` + `image_tokens: 66`) — token counts are not comparable
  across providers, the "image was billed as image tokens" signal is.
