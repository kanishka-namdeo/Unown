# Usage tracking — tokens, latency and cost

The bundled llm-bridge proxies every chat completion to your upstream. On
each request it appends one line to a persistent usage log — the TUI
dashboard's Gateway screen (`unown dashboard`) shows the live window,
`unown usage` reports over it from the terminal, and the numbers survive
restarts.

## What is logged (and what is not)

Per request: timestamp, model (requested and routed-to), prompt /
completion / cached token counts, duration, status. **Prompts and completions
are never logged** — no content, no file paths, no tool chatter: only the
counters. The log is yours, on your disk.

Default location: `<unown repo>/.run/usage-log.jsonl` (override with
`UNOWN_BRIDGE_STATE_DIR`; the fallback chain also checks `$UNOWN_HOME/bridge`,
default `~/.unown/bridge`). Rotation: at 10 MB the file moves to
`usage-log.jsonl.1` (one generation kept). Appends are crash-safe; malformed
lines are skipped and counted, never fatal.

## `unown usage`

```
$ unown usage
LLM usage — last 1 day (since 2026-10-18 10:28 UTC)

MODEL      REQUESTS  TOKENS IN  TOKENS OUT      COST  AVG LATENCY
kimi-k2.5         1      4,597           2  ~$0.0028         3.7s
TOTAL             1      4,597           2  ~$0.0028         3.7s

costs are ~estimates — verified pricing lands via `unown models verify`, or set UNOWN_PRICE_<MODEL>_IN/OUT (USD per 1M tokens)
```

| Flag | Meaning |
| --- | --- |
| `--days N` | widen the window (default 1) |
| `--model M` | one model (matches requested or routed-to id) |
| `--json` | machine-readable summary (same shape as the API below) |

Data sources, in order: the bridge's `GET /v1/usage` endpoint when the stack
is up; otherwise a direct backward tail-read of the usage log (capped at
50k lines). Running from outside the repo without the env override may not
see the bridge's file — the fallback error says exactly that.

## The API

`GET /v1/usage?days=N&model=M` on the bridge (port 3031) returns:

```json
{
  "since": 1792319306612,
  "days": 1,
  "model": null,
  "totals": { "requests": 0, "errors": 0, "promptTokens": 0, "completionTokens": 0, "cachedTokens": 0, "costUsd": 0 },
  "byModel": [],
  "byDay": [],
  "skippedLines": 0,
  "linesRead": 0,
  "truncated": false,
  "pricing": { "estimate": false, "overridden": [], "sidecarPriced": [], "unknownModels": [] }
}
```

`GET /health` additionally reports `usageLog: {file, entries}`.

## Cost resolution and pricing overrides

Each model's price resolves in this order — the first source that answers
wins, in `unown usage` and the bridge's `/v1/usage` alike (the same mirrored
resolver on both sides):

1. **Env override** — `UNOWN_PRICE_<MODEL>_IN` / `UNOWN_PRICE_<MODEL>_OUT`
   in **USD per 1M tokens**. Model id → env suffix: upper-case, `.`/`-` → `_`
   (`qwen3.7-plus` → `QWEN3_7_PLUS`). Both vars must be set — a half-override
   is ignored (an accidentally halved price is worse than an estimate).
   Overridden models are listed in `pricing.overridden`.
2. **The model-specs sidecar** (`~/.unown/agent/model-specs.json`) — verified
   vendor-published pricing the model-spec detection cascade recorded for
   the model (see [providers → model
   specs](providers.md#model-specs--detection-the-gate-the-sidecar);
   `unown models verify` re-runs detection on demand). Sidecar-priced models
   are listed in `pricing.sidecarPriced`; with no estimate-priced model in
   the window the `~` marker disappears from the table entirely.
3. **The built-in estimate table** — conservative placeholders for the
   bundled models (`kimi-k2.5`, `qwen3.7-plus`, `qwen3.6-plus`), marked `~$`
   in the table and `pricing.estimate: true` in the API.
4. **`null`** — no price data. A model with no price shows `—` and reports
   `costUsd: null`, **never 0** — an honest unknown, never a silent free
   ride. Such models are listed in `pricing.unknownModels` (override with
   `UNOWN_PRICE_<MODEL>_IN/OUT`).

```
UNOWN_PRICE_KIMI_K2_5_IN=0.55
UNOWN_PRICE_KIMI_K2_5_OUT=2.15
```

Set the vars where the **bridge** runs (`.env` — the mini-services symlink
the root `.env`), not just in your shell. The turn-meter `~$` chip in the TUI
uses the same price model (unknown models drop the cost segment — a price is
never invented).
