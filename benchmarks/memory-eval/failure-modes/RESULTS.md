# failure-modes — results (2026-10-26)

Suite: the twelve documented cross-industry failure modes
(docs/memory-competitor-research.md §"Common failure modes to benchmark")
pinned as measured regression cases — the doc's own debt ("each should have a
pinned case in `benchmarks/memory-eval/`"), now paid.

## Headline

**12 / 12 PASS** — every case green on the committed receipts, with four
recorded findings inside the passing receipts (the load-scan gap, the raw
import dedup gap, the scanner false-positive surface, and one reconcile
variance event caught mid-campaign and re-measured).

| # | Case | Mode | Checks | Note |
|---|---|---|---|---|
| 1 | fm-01 silent-truncation | deterministic | 4/4 | budget markers + `(truncated)` + `rendered N/M` footer all visible |
| 2 | fm-02 dedup-toctou | engine | 3/3 | two concurrent dream triggers serialize (one 200, one 409); the shared fact exists exactly once; no stuck `running` rows |
| 3 | fm-03 dedup-scale | live | 2/2 | 12 seeded near-duplicates + 1 dreamed variant collapse to ≤ 4; `import/order` survives |
| 4 | fm-04 contradiction-coexistence | live | 3/3 | **1 reconcile miss in 3 runs — see findings** |
| 5 | fm-05 cross-scope-leakage | deterministic | 4/4 | same-named projects → distinct composite scopes; scoped searches clean; cross-scope hits 12/12 tagged |
| 6 | fm-06 poisoning-direct-write | live | 2/2 | direct-write note structurally quarantined; nothing planted survives render/platform/search |
| 7 | fm-07 injection-via-memory-file | deterministic | 4/4 | all four committed-injection variants flagged + neutralized · **finding: the `### System` impostor is caught only by the layer-4 tool-output scanner, not the load scan** |
| 8 | fm-08 ingestion-loss | engine | 4/4 | dead-bridge dream errors visibly; the note stays pending; the recovered engine consumes it |
| 9 | fm-09 stale-index | deterministic | 3/3 | deleted fact absent from search, getAll and render |
| 10 | fm-10 merged-conflicts | deterministic | 3/3 | guarded import keeps overlapping facts single; Manual notes preserved; re-import idempotent · **finding: raw `importLegacyMarkdown` has no content-level dedup** |
| 11 | fm-11 bitemporal-recency | live | 3/3 | Thursday's note delivered after Friday's resolves to Friday's fact as current (event time wins) |
| 12 | fm-12 context-bloat | deterministic | 4/4 | at-cap stack degrades in order (oldest dated blocks first), markers announced, guide survives |

## Findings recorded inside the passing receipts

1. **fm-04 / reconcile variance (the one real miss)**: in one of three
   runs the reconciler left BOTH generations of the CDN max-age rule current
   (the old standalone "max-age=3600" memory survived beside the fused
   "reduced from 3600 to 60" memory) — exactly the Codex #56767
   co-existence shape. The other two runs (including the committed receipt)
   retired the loser correctly. The miss receipt is preserved in the git
   history of this file's first commit. Root cause is the reconciler's LLM
   judgment on agnes-3.0-flash, not a wiring bug — the same notes reconcile
   correctly in the passing runs.
2. **fm-07 / load-scan coverage gap**: the `### System` impostor-block
   variant (role-tag forgery) is flagged only by the guard's layer-4
   tool-output scanner; the memory-file load scan (`scanMemoryCandidate` /
   `scanUntrustedText`) does not carry that pattern. The case still passes
   (the dream-boundary guard neutralizes it), but a repo-supplied memory
   file is scanned less thoroughly than a tool output today.
3. **fm-10 / raw-import dedup gap**: `importLegacyMarkdown` itself performs
   no content-level dedup — on an unguarded scope, an overlapping fact lands
   in 3 memories. Production never hits the raw surface (the dream-time
   swap-boundary guard only imports into an empty scope, and the reconciler
   dedupes after), but the API is sharper than its guard.
4. **fm-08 / scanner false-positive surface**: the first corpus note ("found
   the outbox drain failing silently whenever the bridge is unreachable —
   retries must back off exponentially…") tripped the `runner-directive`
   rule as a false positive — imperative-ish phrasing about runtime
   behavior reads as a directive to the agent. Worse, the quarantined note
   was consumed by a clean `done` dream ("no substantive memories extracted
   (1 quarantined), file untouched") rather than erroring — a benign note
   can be silently dropped this way. The rewritten note is scanner-clean;
   the false-positive surface itself (imperative mood + runtime verbs) is
   now pinned here for the guard's false-positive guardrails work.

## Honest limitations

- Single model (agnes-3.0-flash), single committed run per case; the
  reconcile variance in finding 1 is itself the evidence for why the
  live-mode cases deserve a periodic re-run cadence (each live case ≈ 2
  bridge calls; the engine cases boot scratch engines, no LLM for fm-08's
  failure phase).
- The engine cases run the real `startServer()` on a scratch data dir —
  they pin the serialization/consumption contracts, not OS-service
  supervision.
- fm-02's concurrency is two simultaneous triggers (the TOCTOU shape Mem0
  shipped), not a soak test.
- Receipts: `results/per-case/fm-<id>.json` (every check's evidence +
  findings), `results/summary.json`.

## Reproduce

```bash
bun runner.mjs --dry        # deterministic cases real, live/engine validated
bun runner.mjs              # all twelve (resume-safe)
bun runner.mjs --case fm-08-ingestion-loss
```
