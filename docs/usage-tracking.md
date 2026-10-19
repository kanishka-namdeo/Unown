# Usage tracking — tokens, latency and (estimated) cost

The bundled llm-bridge proxies every chat completion to your upstream. On
each request it appends one line to a persistent usage log — the dashboard's
Gateway tab shows the live window, `unown usage` reports over it from the
terminal, and the numbers survive restarts.

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

costs are ~estimates — set UNOWN_PRICE_<MODEL>_IN/OUT (USD per 1M tokens) to pin exact prices
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
  "pricing": { "estimate": false, "overridden": [], "unknownModels": [] }
}
```

`GET /health` additionally reports `usageLog: {file, entries}`.

## Cost estimates and pricing overrides

Shipped prices for the bundled models are **estimates** (marked `~$` in the
table, `pricing.estimate: true` in the API) — list prices move; pin yours
with per-model env vars in **USD per 1M tokens**:

```
UNOWN_PRICE_KIMI_K2_5_IN=0.55
UNOWN_PRICE_KIMI_K2_5_OUT=2.15
```

Model id → env suffix: upper-case, `.`/`-` → `_` (`qwen3.7-plus` →
`QWEN3_7_PLUS`). Unknown models report `costUsd: null` (not 0 — an honest
unknown), and are listed in `pricing.unknownModels`. Overridden models are
listed in `pricing.overridden` and the estimate marker disappears.

Set the vars where the **bridge** runs (`.env` — the mini-services symlink
the root `.env`), not just in your shell.
