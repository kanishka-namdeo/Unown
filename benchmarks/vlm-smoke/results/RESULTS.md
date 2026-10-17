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
