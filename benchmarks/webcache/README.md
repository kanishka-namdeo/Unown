# webcache — web results store benchmarks

Performance + correctness receipts for the web results store
(`pi-repo/packages/self-learning/src/webcache.ts`) and its wiring into
`web_search` / `webfetch` / `fetch_url` (`src/websearch.ts`).

Run it any time:

```bash
bun scripts/webcache-bench.mjs                     # full suite (~1 min)
bun scripts/webcache-bench.mjs --quick             # 0.2x sample counts (CI smoke)
bun scripts/webcache-bench.mjs --only e2e,coalesce # scenario subset
bun scripts/webcache-bench.mjs --label after       # receipt suffix (before/after A/B)
```

Receipts land in `results/webcache-bench-<ts>[-<label>].json` and carry every
raw latency sample (no hand-copied numbers anywhere on the landing page or in
RESULTS tables — regenerate from the receipt).

## What it measures

| Scenario | Question it answers |
|---|---|
| `primitives` | per-op latency anatomy: hit/miss/put/refresh/touch by payload class (S ≈ 2.5 KB search, M ≈ 48 KB page, L ≈ 192 KB cap) and store size (200/2k/20k), plus the CPU share of JSON round-trip vs sha256 |
| `scan` | the O(N) paths: `webCacheStats` (the dashboard polls `/api/webcache` every 8 s) and `webCacheSweep`, plus a 30-call poll-loop simulation over 5k entries — each call is event-loop-blocking sync fs inside the engine |
| `e2e` | the full call path through `runWebSearch`/`fetchPageContent` against a local mock provider (searxng shape; ETag/Cache-Control page): cold→warm speedup, 304 revalidation, and provider-call counts |
| `coalesce` | thundering herd: 64 concurrent identical searches must cost exactly 1 upstream call (origin-call counting is the coordinated-omission-safe way to measure request collapsing — the counter cannot lie about herd size); 64 distinct and 64 `noCache` are the controls |
| `zipf` | workload realism: 6,000 requests over 1,000 keys, zipf s=1.0 (the standard web-workload shape), hit rate + hit/miss latency split, estimated provider time saved vs an uncached control |
| `xproc` | cross-process persistence (the reason the store exists): a fresh child process reads an entry the parent stored — first hit, second hit, miss |
| `memory` | bounded growth: RSS delta across a 5,000-entry populate and a 15,000-read sweep |

## Methodology

- **Percentiles, never just means** — p50/p95/p99/max per cell (the sweep
  hiccups this track exists to expose live in the tail, exactly where means
  hide them; same reason RocksDB's db_bench reports p50–p99.99).
- **Warmup discarded** (first 20% of samples) — JIT and page-cache warmup are
  measurement noise.
- **Warm page cache, stated in every receipt** — dropping caches needs root;
  cold numbers are strictly worse and we do not pretend otherwise.
- **Provider-call counting** for coalescing/e2e assertions — immune to the
  coordinated-omission failure mode of latency-only herd measurements.
- **Assertions inside the receipt, gating the exit code** — the harness is a
  correctness + perf check in one pass; CI can run `--quick` and fail on any
  broken invariant (coalescing counts, cross-process visibility, memory bound).
- **Population writes entry files directly in the store's exact on-disk
  format** (same payload checksum, same two-pass bytes accounting, same atomic
  rename) instead of calling `webCachePut` — `webCachePut`'s amortized
  eviction fires a full directory scan on ~1/8 of writes, which would make a
  20k population O(N²). Measured put cells still go through the real
  `webCachePut`.

## Environment honesty

Receipts record runtime (bun/node version), platform, CPU count, sample
scale, and the git commit. Local receipts on this overlay-fs container are
warm-cache numbers on fast sync storage — filesystem-dependent costs (fsync
latency in particular) are cited from their primary sources in
`docs/web-results-store.md` rather than generalized from one box.
