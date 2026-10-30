# The Unown Trust & Transparency Report

> The verdict up front: **the 60-second contract holds, measured.** In the
> trust test's live session, a returning developer reads one screenful —
> the brief — and learns the objective, what happened, what was changed,
> what the agent decided (on demand), what was learned while away, what it
> cost, the confidence level and what remains. The round's measured
> confusions were design bugs, and each became a fix with a pinning test —
> three found and closed inside the round itself. What remains open is
> recorded with its reason, not hidden.

- [Method](#method)
- [The 60-second measurement](#the-60-second-measurement)
- [How the five questions are answered](#how-the-five-questions-are-answered)
- [The trust signals, surface by surface](#the-trust-signals-surface-by-surface)
- [Confusion points found — and closed](#confusion-points-found--and-closed)
- [What is deliberately NOT shown](#what-is-deliberately-not-shown)
- [Open items, honestly](#open-items-honestly)

Related pages: [the observability round session record](observability-round-session.md) · [the TUI observability audit](tui-observability-audit.md) · [the benchmark results](../benchmarks/observability/RESULTS.md) · [the competitor research](observability-competitor-research.md) · [the user journeys](observability-user-journeys.md)

## Method

The mission's primary success metric — *"a developer should be able to leave the terminal for 30 minutes, return, and understand what happened, why it happened, what decisions were made, what was learned and what remains, within 60 seconds"* — is not a vibe; the round measured it. The trust test (`scripts/tui-capture/pty_trust_test.py`) drives a real session in this repo through a real multi-step task (the model actually works: todos tracked, file written, verified), a real idle window (11 minutes on the real clock — crossing the engine's 5-minute overview poll and one real AutoDream consolidation), checkpoints captured at three random mid-idle moments, and a return prompt. The pane is truth: every assertion runs on the literal screen text, and the receipts are committed under [`benchmarks/observability/receipts/`](../benchmarks/observability/RESULTS.md). The 30-minute window was compressed to 11 real minutes for round budget; every mechanism it exercises (the idle threshold, the probe cadences, the dream) ran on its real clock.

## The 60-second measurement

The return receipt (`receipts/trust-return-brief.pane.txt`, verbatim):

```
── brief · back after 11m ──
mission: Create Trust Test Checkpoint File (auto)
happened: 1 turn · 5 tool calls · todo×3, write, bash
changed:  notes/ob-round-trust.md
last:     Done. - Created `notes/ob-round-trust.md` with the single line...
why:      /brief mines the decisions when you want them
conf:     high — no failures this session
learned:  project memory advanced v4 → v5 (8m ago)
session:  12m · 17.4k in / 322 out
remains:  nothing open — the last turn settled
```

Eleven lines, one screen, every question answered — and the `learned:` line
is the load-bearing one: **the engine actually dreamed during the away
window** (memory v4 → v5 while nobody watched), and the brief reports it.
The unattended checkpoints (taken at random moments during the idle window)
show the ambient screen holding the state without any user action: mission
pinned, progress `▕████████▏ 1/1`, `conf ✓`, and the learning event painting
itself (`✦ project memory advanced v4 → v5`) — the idle session is never
silent about its own learning.

## How the five questions are answered

| The mission's question | The surface that answers it | Receipt |
|---|---|---|
| What is happening? | The mission panel (objective, progress, confidence, current activity) + the verb spinner | ob1-ambient-composite |
| Why is it happening? | `/brief`'s decision miner (the /btw side lane) + the confidence drivers row; the auto brief points at it honestly | trust-return-brief |
| What changed? | The brief's `changed:` row + `/diff` + the receipts ledger (unchanged, the round composes rather than replaces) | trust-return-brief |
| What was learned? | `learned:` in the brief + `/feed` + the `✦` chip/panel line | ob5-live-lane-feed |
| What remains? | `remains:` — always the brief's last line, never empty, built from open todos, remaining plan steps and the worst risk | trust-return-brief |

## The trust signals, surface by surface

- **Confidence is receipts-only.** `conf ✓ / ◐ / ✗` is computed from the session's own tool errors, verify failures and denials — never from the model grading itself. The drivers are named next to the chip; the rules are pinned by tests (any verify failure or ≥3 errors = low; 1–2 errors or any block = medium).
- **Failure carries its fix.** Every `/recovery` row names its repair path — `/undo n`, `/engine`, the dead-letter directory — and the footer carries `✗ N to fix · /recovery` whenever anything needs attention. A clean session gets the clean bill, not silence.
- **Degraded modes narrate themselves.** The engine state machine toasts transitions (down → up fired `memory engine online — learning resumed` in the OB-4 receipt — the auto-heal is narrated, never silent); dead letters explain themselves; a refused auto-start reports BLOCKED instead of spawning over a foreign engine.
- **Numbers stay honest.** Cost rides the `~` estimate marker; the brief's session row reuses the `/usage` attribution exactly; unknown prices stay unknown. Progress is derived (plan steps, todo completion) or honestly absent (`○ no tracked steps`) — never a fabricated percentage.
- **Learning is visible where it happens.** Dreams, memory versions, improvements and note consolidation land in-session (chip → `/feed` → the dashboard's deep screens), each with the source named on the card.

## Confusion points found — and closed

The round's own dogfood loop found three real defects, each closed inside the round (failure → root cause → pin → fix — the full receipts in [the benchmark results](../benchmarks/observability/RESULTS.md)):

1. **"Unknown tools in the digest"** — every restored-session digest printed `unknown` per tool call. Root cause: persisted entries carry `name`, the digest read `toolName`. Fixed + pinned.
2. **"The idle session learned in silence"** — dream events landed in the ring but the chip painted only at the next turn. Root cause: no repaint path on engine-loop pushes. Fixed with the push-listener + pinned; verified live in the OB-1 composite receipts.
3. **"The overview diff saw nothing"** — the feed's diff read flat payload keys the engine does not use. Root cause: the counters nest under `kpis`/`notes`. Fixed against the live payload + pinned with the real shape.

A fourth finding corrected the benchmark itself, not the product: OB-4 expected a permanent down-state, but the supervisor's gated auto-start heals a refused engine — the honest contract is narration of whichever path happens.

## What is deliberately NOT shown

Trust is also about restraint. The round rejected (reasons in [the competitor research](observability-competitor-research.md)): sound packs; USD budget stop-with-continue (the governor already enforces ceilings with a breaker — a second interactive budget would duplicate it with a weaker contract); queued-message implicit approval (weakens the permission model); a doom-loop ask-gate (the loop guard already aborts deterministically — an ask-gate would reintroduce interactive prompts into unattended runs). Raw logs stay where they were — reachable through `ctrl+o`, the dashboard transcripts and the receipts — never promoted into the ambient surfaces; the panel and the brief are summaries, per the information architecture's placement law.

## Open items, honestly

- **OB-7 (fleet outcomes in the brief)** — deferred: the brief composes session-level facts; per-child rows need the FleetManager bridge (the same pattern as the todo bridge). The live fleet widget and `/tasks` cover per-child state today. First build of the next iteration.
- **The decisions line on the auto brief is a pointer** (`/brief mines the decisions`) — the LLM lane is deliberately off the prompt path; a returning user who wants the why runs `/brief` (one keystroke) and gets the mined decisions. This is the documented trade: zero latency on the prompt path, one command for depth.
- **The full 30-minute window was measured at 11 real minutes** — the threshold mechanism is identical; the receipt records the compression. A 30-minute wall-clock run is a follow-up for the next long-session budget.

