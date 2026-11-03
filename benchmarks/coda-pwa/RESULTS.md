# Coda PWA — results (benchmarks/coda-pwa/RESULTS.md)

> **The PT-5 plan's honest PWA null is measured, not guessed.**
> Installability PASS (manifest 200, all 4 required fields present, 3/3
> icons fetched, SW controller active, display=standalone) and
> offline boot-from-cache **91 ms median** vs the online baseline
> **175 ms median** (both N=5, the 84 ms median delta is the PWA
> signal — a SW-precached boot is ~48% faster than the cold dev-server
> boot on the same host). Every figure below carries its receipt path +
> N; the method + caveats are binding, see [README.md](README.md).

- [Environment](#environment)
- [Installability](#installability)
- [Boot timing — online vs offline](#boot-timing--online-vs-offline)
- [Reproduction](#reproduction)

## Environment

| What | Value |
|---|---|
| App under test | Coda (`apps/coda/`), the repo's local-first notes + task-board PWA |
| Server | `bun apps/coda/scripts/serve.mjs` on scratch port 4099 (the app's own transpiling dev server; the lane boots it — no stack needed) |
| Browser | headless chromium (Playwright 1.64.1), the e2e lane's own browser |
| Run | `receipts/run-2026-11-03T06-14-57-955Z/` (2026-11-03, the doc-truth round's T2) |
| N | 5 timing runs per phase (`--runs N` to change) |
| Node | v26.3.0 · linux x64 |
| Model traffic | none (zero endpoint spend — the lane is pure browser + local files) |

Caveats (verbatim from the receipt's environment block):

- Headless chromium in the operator's container — timings are
  machine-dependent and comparable run-to-run on the same host only.
- The dev server transpiles .ts on the fly (Bun.Transpiler); a
  production minified build would be faster — the offline/online DELTA
  is the signal, the absolute ms are the environment's.
- IndexedDB is fresh per context; no warm-start between timing runs.

## Installability

From `receipts/run-2026-11-03T06-14-57-955Z/installability.json`:

| Criterion | Measured | Verdict |
|---|---|---|
| `GET /public/manifest.webmanifest` | **200** | PASS |
| Required fields (`name`, `icons`, `start_url`, `display`) | all present, 0 missing | PASS |
| `display` | `standalone` | PASS |
| Icon inventory | 3 icons: `icon.svg` (any), `icon-192.png` (192x192), `icon-512.png` (512x512, maskable) — **3/3 fetched 200** | PASS |
| SW registration | `scope=http://127.0.0.1:4099/`, active script `…/sw.js`, `navigator.serviceWorker.controller` **active** | PASS |
| `beforeinstallprompt` | **not observed** in headless (3 s probe) | record-only (soft-gated — the plan's P1 pitfall; never a hard fail) |

**Overall verdict: PASS** (0 hard fails in the receipt).

## Boot timing — online vs offline

From `receipts/run-2026-11-03T06-14-57-955Z/{timing-online.json,timing-offline.json}`:

| Phase | N | Median | Min | Max | What it measures |
|---|---:|---:|---:|---:|---|
| Online baseline | 5 | **175 ms** | 169 ms | 212 ms | fresh context → `goto /` (cold, dev-server transpile) → wait `#coda-status` `"Ready."` → wait SW controller |
| Offline boot-from-cache | 5 | **91 ms** | 87 ms | 110 ms | the SAME context, after SW control → `context.setOffline(true)` → `page.reload()` → wait `"Ready."` — the whole boot answered from the SW's precache |
| **Delta (offline − online), median** | — | **−84 ms** (offline ~48% faster) | — | — | the PWA precache's measured effect on boot time |

The in-page `PerformanceNavigationTiming` cross-check (per sample in the
receipt) shows `DOM content loaded` around 43–74 ms (online) and 43–52 ms
(the offline range) with `load` event 44–74 ms — the Ready marker lands
after the IDB boot on top of the load event, which is what the wall-clock
wallMs numbers above measure.

## Reproduction

```bash
# from the repo root (no stack needed — zero endpoint spend):
bun benchmarks/coda-pwa/run-pwa-bench.mjs            # N=5 default, port 4099
bun benchmarks/coda-pwa/run-pwa-bench.mjs --runs 10  # more samples
bun benchmarks/coda-pwa/run-pwa-bench.mjs --port 4101
```

Exit 0 = every hard installability criterion passed; 1 = a hard criterion
failed. The method + criteria + caveats are binding:
[README.md](README.md).
