# The tool lifecycle report — reliability, cost, recommendations

> The PLM round's second mission deliverable (2026-10-30): the tool
> lifecycle ledger's receipts — per-tool reliability, latency, the
  engine/terminal lane split, failure classes and the underperforming-tool
> recommendations, measured over `GET /api/tools` after hours of live
> operation (engine runs + one human terminal session, all against
> Agnes). One live recommendation was minted BY the detector during the
> round — the system finding its own signal.

- [The headline census](#the-headline-census)
- [Per-tool reliability](#per-tool-reliability)
- [Failure analysis](#failure-analysis)
- [The live recommendation](#the-live-recommendation)
- [Optimisation recommendations](#optimisation-recommendations)

Related: [PLM round session log](plm-round-session.md) ·
[Process lifecycle report](process-lifecycle-report.md) ·
[PLM usage](plm.md)

## The headline census

**35 tool invocations** across both lanes, **91.4% success**. Category
census: `exec` 12 · `read` 12 · `write` 11. Every row carries the OTel
GenAI-aligned fields (name, category, purpose line, duration, success,
failure class) plus the owning process/run/session and the lane.

## Per-tool reliability

| Tool | Calls | Success | Avg | p95 | Retries | Lanes (engine/terminal) | Failure classes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `read` | 12 | 100% | 3 ms | 4 ms | 0 | 11 / 1 | — |
| `write` | 5 | 100% | 3 ms | 5 ms | 0 | 4 / 1 | — |
| `bash` | 12 | 83% | 46 ms | 158 ms | 0 | 11 / 1 | logic ×2 |
| `edit` | 6 | 83% | 4 ms | 7 ms | 0 | 6 / 0 | logic ×1 |

Read-shaped tools are perfect; exec and edit carry the round's real
failures — both `logic` class (the mint solvability run's test failures:
the agent's own output failing its verification, exactly the class the
taxonomy predicts for a working harness).

## Failure analysis

The two `bash` failures and one `edit` failure all trace to the same
engine lane: the task-mint solvability proof run on
`fix-drop-right-strict-mint`, where the agent's first implementation
failed the task's own tests, was fed the failure, and fixed it (the run
finalized SUCCEEDED — the transcript in `runs.transcript` carries the
loop). The taxonomy classified the failures `logic` (verification
failures), NOT `tool` — the tools executed fine; the agent's output did
not. That distinction is the report's headline: **the ledger separates
"the tool broke" from "the work failed"**, which is what makes the
recommendation below actionable.

## The live recommendation

Minted by `deriveToolRecommendations` from live data, unprompted:

> `bash: success 83% over 12 calls (2 failures)` —
> **→ "mine a recent failing invocation's transcript and mint a
> regression task (unown task mint)"**

Severity `medium` (above the 0.7 floor, below the 0.7 high line at 12
calls — the 8-call minimum sample floor was respected). The
recommendation is the mission's loop closing on itself: tool telemetry →
failure class → the concrete next improvement action.

## Optimisation recommendations

1. **Mine the two `logic` failures into a regression task** — the live
   recommendation above; `unown task mint` from the solvability run's
   transcript is the action.
2. **Join per-invocation cost into the ledger** — the bridge's
   `usage-log.jsonl` knows per-request cost; a per-`tool_invocations`
   cost column (currently NULL) would complete the mission's
   cost-efficiency axis. Design decision recorded, not yet landed.
3. **Retry telemetry on the terminal lane** — the terminal reporter
   records `retryCount: 0` per invocation (the agent retries at the
   model-turn level, not the tool level); a terminal-side retry counter
   would make the retry-heavy detector honest for both lanes.
4. **p95 budgeting** — `bash` p95 at 158 ms is healthy; the
   LATENCY_WARN_MS line (30 s) never tripped this round — no action
   needed, recorded as the baseline.
