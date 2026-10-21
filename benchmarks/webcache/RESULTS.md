# webcache results — baseline → perf layer (before/after)

Two receipts, one environment (bun 1.3.14, linux x64, 2 CPUs, warm page cache,
full sample scale):

- **baseline**: `results/webcache-bench-1792496271356-baseline.json` (commit `f8f3f07`)
- **after**: `results/webcache-bench-1792498403463-after.json` (the perf layer:
  in-memory index + hot-entry memo + SWR + rename-only cache writes)

All numbers below are read straight from the receipts; every raw sample ships
inside them. 17/17 assertions pass on the after-receipt.

## Headline (before → after)

| What | Before | After | Change |
|---|---|---|---|
| `webCacheStats` on a 20,000-entry store (the dashboard polls this every 8 s, event-loop-blocking) | **49.9 ms** p50 | **0.003 ms** p50 | ~16,000× between rebuilds |
| Eviction sweep, 20,000 entries, idle | 47.9 ms | 0.002 ms p50 (max 0.16 ms over 200 consecutive sweeps) | ~24,000× |
| Dashboard poll-loop, 30 consecutive stats over 5k entries | 311.9 ms total | 12.9 ms total (12.74 ms of it = the one index rebuild) | 24× |
| Hit latency, 48 KB page payload | 0.211 ms | **0.001 ms** (memo) | ~200× |
| Hit latency, 192 KB payload (the cap) | 0.764 ms | ~0.0005 ms | ~1,500× |
| Hit latency, 2.5 KB search payload | 0.020 ms | 0.001 ms | 20× |
| e2e warm search hit (through `runWebSearch`) | 0.029 ms | 0.013 ms | 2.2× |
| zipf s=1.0 hit latency (workload realism) | 0.025 ms p50 | 0.010 ms p50 | 2.5× |
| Cross-process first hit (fresh process) | 0.58 ms | 0.70 ms | unchanged class (disk, no memo in a cold process) |
| Stale re-ask (the new SWR path) | — | 101.4 ms provider call → **0.88 ms** serve, next identical call fresh | 115×, RFC 5861 |

The index pays one full scan per rebuild (root switch, 60 s reconcile, or
`UNOWN_WEB_CACHE_INDEX_MS=0` exact mode) — measured at 1k/5k/20k entries in
the after-receipt's `statsRebuildMs` cells; that is the old per-poll cost,
now paid once per minute instead of every 8 seconds.

## An attribution corrected by the data

The baseline RESULTS table attributed the amortized-put tail
(p50 0.13 ms / p99 15.7 ms) to the 1/8-probability eviction sweep. The
after-receipt disproved that attribution cleanly, and the record is corrected
here rather than papered over: the after run shows the **same tail**
(14.99 ms p99) while 200 consecutive sweeps on the identical 5k store measure
**0.002 ms p50 / 0.16 ms max**, and a quiet-box re-run of the same cell shows
**zero** samples above 5 ms. The tail is environmental CPU contention on this
2-core container (the dev stack shares it), and it lands at roughly the sweep
probability by coincidence. The receipts' raw samples are what make this
correction checkable — the sweep cost claim that survives is the direct one:
sweep-at-20k went from 47.9 ms to 0.002 ms.

## Per-op anatomy (after; baseline cells in the baseline receipt)

| Cell (p50 / p99, ms) | after |
|---|---|
| hit S@200 / M@200 / L@200 (memo path) | 0.001 / 0.001 / ~0.0005 |
| hit M with memo off (the disk path = baseline's hit cell) | 0.188 / 0.273 |
| read (raw `webCacheGet`, no freshness/memo) M@200 | 0.191 / 0.312 |
| touch (RAM recency now — was a utimes metadata write) | ~0 / 0.002 |
| refresh (304 revalidation, rewrite entry) M@200 | 0.343 / 1.805 |
| miss (empty / absent@20k) | 0.002 / 0.002 |
| put M (clean) | 0.736 / 2.016 |
| put S (amortized @5k) | 0.106 / *see the correction above* |
| event append | 0.004 / 0.013 |
| disabled store (lookup / get) | 0 / 0 |

## e2e / coalescing / SWR / zipf / xproc / memory (after)

- e2e search: cold **129.1 ms → warm p50 0.013 ms (10,225×)**; fetch:
  cold 64.2 ms → 304-revalidated p50 0.018 ms.
- Coalescing: 64 concurrent identical searches = **exactly 1** upstream call
  (asserted); 64 distinct and 64 `noCache` = 64 (controls).
- SWR (new): stale search serves in **0.88 ms** marked `refreshing`, exactly
  1 background refresh, next identical call a fresh `hit` (asserted); the
  fetch twin serves in 0.94 ms with the `· stale — refreshing in background`
  marker visible to the model.
- zipf s=1.0 (6,000 requests / 1,000 keys): **86.6%** hit rate, est.
  **28.0 s** of provider time saved.
- xproc: a fresh process reads a parent-stored entry in **0.70 ms**
  (asserted `found` + payload intact).
- memory: 5,000 × 48 KB puts +97.9 MB RSS (transient serialization garbage);
  15,000-read sweep **−4.7 MB** — no read-path leak (asserted).

## What changed in the store (design record: docs/web-results-store.md)

1. **In-memory index** `{key → bytes, lastUsed}` (Chromium SimpleCache model):
   stats/eviction answer from RAM; one scan per root-switch/60 s reconcile;
   `UNOWN_WEB_CACHE_INDEX_MS=0` is the exact always-scan mode. Stats carry
   `index: {mode, ageMs, approximate}` so the dashboard/CLI label the
   approximation instead of presenting it as a count.
2. **Hot-entry memo** (cacache's own memoization shape: 500 entries / 50 MiB /
   3 min, `UNOWN_WEB_CACHE_MEMO*` knobs): hot keys skip disk + parse + sha256
   entirely while honoring their own entry TTL.
3. **RAM recency** — the per-hit `utimes` metadata write is gone (Chromium
   `UseIfExists` rule; the same write-amplification Linux built
   `lazytime`/`relatime` to avoid, unreadable on NTFS/FAT anyway).
4. **Cache writes are tmp+rename without fsync** (the cacache write model;
   `UNOWN_WEB_CACHE_DURABLE=1` restores the double-fsync). The memory tiers
   keep their fsyncing writer — a lost learning note is gone forever, a lost
   cache entry is a refetch.
5. **Stale-while-revalidate** (RFC 5861): stale-in-window entries answer
   instantly — marked `· stale — refreshing in background` — while a detached
   single-flighted refresh restores freshness; `UNOWN_WEB_CACHE_SWR=0`
   restores blocking semantics. Fetches WITH validators keep their exact
   blocking 304 path (and its stale-if-error fall-through) unchanged.
6. Events feed: stats reads a 128 KiB tail instead of the whole feed.

---

## 2026-10-21 — fresh full-scale run on the current stack (receipt `webcache-bench-1792596608242.json`)

Environment per receipt meta: bun 1.4.3, linux x64, 2 CPUs, full sample scale,
git `43c89b7`, warm page cache — with the dev stack (llm-bridge :3031 +
engine :3030, Agnes upstream) live on the same box during the run, i.e. the
noisy-neighbour case rather than a quiet box.

**17/17 in-receipt assertions passed, exit 0.** Every headline class from the
after-receipt reproduces at full scale on this box:

| Cell | 2026-10-21 run | committed after-receipt |
|---|---|---|
| `webCacheStats` 20k-entry store | 0.005 ms p50 (max 0.009 ms) | 0.003 ms p50 |
| eviction sweep idle (1k/5k/20k) | 0.001 ms p50 | 0.002 ms p50 |
| poll-loop, 30 stats calls over 5k | 15.4 ms total | 12.9 ms total |
| hit S/M/L @200 (memo path) | 0.001 / 0.001 / ~0 ms p50 | 0.001 / 0.001 / ~0.0005 ms |
| hit M with memo off (disk path) | 0.084 ms p50 | 0.188 ms p50 |
| put M (clean) | 0.494 ms p50 | 0.736 ms p50 |
| e2e warm search (through `runWebSearch`) | 131.79 ms cold → 0.010 ms p50 (**12,567×**) | 129.1 → 0.013 ms (10,225×) |
| e2e fetch 304 revalidation | 64.2 ms cold → 0.014 ms p50 | 64.2 → 0.018 ms |
| coalescing (64 identical searches) | exactly **1** origin call (asserted) | same |
| SWR stale search serve | 0.721 ms, marked `refreshing`, 2 provider calls, next call fresh `hit` (all asserted) | 0.88 ms |
| zipf s=1.0 (6,000 req / 1,000 keys) | **86.05%** hit rate, est. 27.9 s provider time saved | 86.6%, 28.0 s |
| cross-process first hit (fresh process) | 0.554 ms, payload intact (asserted) | 0.70 ms |
| memory (5,000 × 48 KB puts → 15,000-read sweep) | +31.4 MB RSS puts / +4 MB read sweep — no read-path leak (asserted) | +97.9 MB / −4.7 MB |

The known environmental tail reproduces exactly as documented in the
correction section above: `put_S_amortized@5k` p50 is 0.201 ms but p99
38.2 ms / max 71.9 ms here — CPU contention on this 2-core container shared
with the live dev stack, landing at roughly the amortized-sweep probability,
while the direct sweep cells (idle sweeps at 1k/5k/20k) stay at 0.001 ms p50.

Raw samples for every cell ship inside the receipt, per the README
methodology (no hand-copied numbers).
