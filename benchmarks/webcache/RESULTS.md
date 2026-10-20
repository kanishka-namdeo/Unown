# webcache results — baseline (pre-optimization)

Receipt: `results/webcache-bench-1792496271356-baseline.json`
(bun 1.3.14, linux x64, 2 CPUs, warm page cache, full sample scale,
commit `f8f3f07`, 2026-10-20). All numbers below are read straight from the
receipt; every raw sample ships inside it.

## Headline

| What | Number |
|---|---|
| Warm search hit vs cold provider call | **130.1 ms → 0.029 ms (4,479×)** |
| 304-revalidated fetch vs cold fetch | **65.5 ms → 0.040 ms** |
| 64 concurrent identical searches | **exactly 1 upstream call** (all 64 correct answers) |
| zipf s=1.0 workload (6k req / 1k keys) | **86.1% hit rate**, est. **28.0 s** of provider time saved |
| Cross-process hit (fresh process, entry stored by parent) | **0.58 ms** first, 0.07 ms second |
| Store disabled (`UNOWN_WEB_CACHE=0`) | **0 ms** — the off-switch is free |
| Assertions | **10/10 passed** |

## The two real costs the baseline exposed

1. **`webCacheStats()` is an O(N) full-directory scan the dashboard polls
   every 8 seconds** — and it is synchronous, so each poll blocks the engine's
   event loop for the whole scan:

   | entries | stats p50 | sweep (idle) p50 |
   |---|---|---|
   | 1,000 | 2.1 ms | 2.0 ms |
   | 5,000 | 10.6 ms | 10.0 ms |
   | 20,000 | **49.9 ms** | **47.9 ms** |

   Poll-loop simulation (30 consecutive calls, 5k entries): 312 ms total,
   13.1 ms worst call — pure event-loop blockage that grows linearly with
   store size.

2. **The amortized eviction sweep taxes the write path's tail**: a `put` on a
   5k-entry store has p50 = 0.13 ms but **p99 = 15.7 ms / max = 26.6 ms** —
   the 1/8-of-writes full scan landing exactly where means don't show it.

## Per-op anatomy (p50 / p99, ms)

| Cell | p50 | p99 |
|---|---|---|
| hit S@200 / S@2000 / S@20000 | 0.020 / 0.015 / 0.016 | 0.067 / 0.067 / 0.076 |
| hit M@200 | 0.211 | 0.318 |
| hit L@200 | 0.764 | 1.376 |
| read (no touch) M@200 | 0.190 | 0.440 |
| touch M@200 | 0.001 | 0.006 |
| refresh (304) M@200 | 0.672 | 1.334 |
| miss (empty store) | 0.001 | 0.003 |
| miss (absent key @20k) | 0.001 | 0.007 |
| put M (clean) | 1.092 | 2.227 |
| put S (amortized @5k) | 0.127 | **15.702** |
| event append | 0.004 | 0.015 |
| disabled lookup / get | 0 / 0 | 0.001 / 0 |

Store size does not affect hit latency (sharded O(1) lookup confirmed:
20k entries hit as fast as 200). Payload size does — and the CPU cells
attribute it: for the 192 KB class, JSON round-trip (0.58 ms) + sha256
(0.64 ms) are each ~75–85% of an entire hit — i.e. the parse-then-rehash
read path dominates large-entry hits.

## Memory

5,000 × 48 KB puts: RSS +97.9 MB (transient serialization garbage, GC'd);
15,000-read sweep: **−1.7 MB** — no read-path leak.

## What the baseline justified changing

Measured here + the prior-art record in `docs/web-results-store.md`:

1. an in-memory index so stats/sweep stop scanning the disk
   (Chromium SimpleCache / WebKit approximate-size model),
2. a bounded memoization layer for hot entries (cacache's own answer to
   verify-on-read cost),
3. recency in RAM instead of a `utimes` metadata write per hit,
4. rename-without-fsync cache writes by default with a durability opt-in
   (cacache's write model; the memory tiers keep their fsync).

The `--label after` receipt in this directory measures the same cells on the
optimized store; RESULTS-at-a-glance live at the bottom of this file.
