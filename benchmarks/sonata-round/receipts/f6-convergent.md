# F-6 — the 28th-lineage CONVERGENT DUAL (the V-23 class; folds under f6.md)

> The 28th lineage (this lane) closed F-6 independently and in
> parallel with the 30th's governing close ([f6.md](f6.md) — 23
> dispatches / 256 turns / 14 witnessed runs / ten cure cycles). The
> 30th's close landed first and GOVERNS. This file preserves the
> converging trail's evidence — the strongest form of cross-verification
> the round has: two lineages, independently, on different mechanisms,
> found the SAME root causes and closed the SAME keystone ticket.

## The 28th's crossings (independently witnessed, different data)

| Crossing | Routine | Status | Tokens in/out | Turns | Wall | Note first line |
|---|---|---|---|---|---|---|
| A2's close | `fugue-live-…T14:11` | ok | 771 / 149 | 3 | 4.8 s | `done` |
| Operator run 1 | `fugue-live-…T14:19` | ok | 5,930 / 2,005 | 12 | 43 s | `## Report` |
| Operator run 2 (cold context) | `fugue-live-…T14:20` | ok | 1,955 / 332 | 6 | 22 s | *"I can confirm from project memory…"* |
| Operator run 3 (post-contention retry) | `fugue-live-…T14:30` | ok | 8,102 / 2,981 | 13 | 43 s | `# Fugue Live Probe Report` |

Plus the API-level witness (the probe routine: succeeded, 221 turns,
826,443/16,893 tokens — the execution path proven before the PWA
wiring), and ONE contention timeout honestly receipted (the 9-minute
poll window expired under engine learning-loop load; the spec REFUSED
to fabricate completion; the immediate retry passed — the V-41
honesty working as designed).

## The convergence (the same root causes, independently found)

- **The id-model mismatch**: the 28th found it from the adapter side
  (lifecycle URLs built with the domain's numeric id → engine 404 →
  AND the client resolved the error body silently — an E-02 transport
  violation); the 30th found it from the DOM side
  (`Number(dataset.job)` NaN → phantom numeric ids). Same law earned
  twice: **the engine's string ids are the wire truth; the fixture's
  numeric ids were a fiction** (the 30th's V-24 receipts it as the
  fixture-masks-the-wire class, four instances).
- **The throttle-raise trap**: hit by both (the 28th's V-13, the
  30th's V-23) — the bring-up checklist law doubly confirmed.
- **The live bootstrap mechanism**: DIFFERENT, both lawful — the 30th
  injects via `addInitScript` (`window.__FUGUE_ENGINE__`, their
  mechanism C); the 28th served `/fugue-config.json` from serve.mjs
  with the `?engine=` param override for the hermetic fixture lane.
  The 30th's landed; the 28th's `?engine=` param survives in the
  pattern space as the fixture-lane pinning alternative.

## The 28th's unique contributions that rode the governing tree

- The **EngineApiError never-silent transport law** (any non-2xx
  throws; the client never resolves a failed request) — the 30th's
  cures converged on the same behavior; the transport-layer pin is
  now standing law either way.
- The **contention-honesty receipt**: the live series' timeout-refusal
  + retry-proof pattern (a working gate, not a failure) — complementary
  to the 30th's V-25 live-scale law.
- The **stall-adjusted turns-to-done accounting** (raw 590 →
  stall-adjusted ~350 across 19 dispatches with 7 upstream stalls):
  the round's turns-to-done series must carry both numbers while the
  upstream degrades — the raw series alone would misattribute
  environment cost to driving friction.

**State: F-6 CLOSED (the 30th's close governs; this trail folds).**
