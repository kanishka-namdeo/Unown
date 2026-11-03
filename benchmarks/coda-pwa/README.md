# Coda PWA benchmark — installability + offline-load timing (benchmarks/coda-pwa/)

The doc-truth round's T2 measurement lane: flips the PT-5 plan's honest
"not measured" PWA null
(`benchmarks/plan-mode/results/run-2026-11-02-pt5/pt-5-plan.md`) with a
real receipted measurement of the REAL app (`apps/coda/`) — installability
recorded as data (the criteria the e2e lane asserts, now measured), plus
offline boot-from-cache timing against the online baseline.

Not a landing-page-feeding suite (the six-track feed contract in
`benchmarks/AGENTS.md` stands — no `TRACKS` entry in
`scripts/landing_benchmarks.mjs`); the round's story ships through
`RESULTS.md` here, the receipt under `receipts/`, and the changelog rail.

## What is measured

Two measurements, one script (`run-pwa-bench.mjs`), one run, no model
traffic, no endpoint spend:

**(a) Installability inventory** — the criteria `e2e/coda-offline.spec.ts`
asserts today, recorded as data:

- manifest fetch: `GET /public/manifest.webmanifest` → status (must be 200);
- required fields present: `name`, `icons`, `start_url`, `display`;
- icon inventory: every manifest icon listed with its `sizes` + actual
  fetch status (each must 200);
- service worker: registered AND controlling
  (`navigator.serviceWorker.controller !== null` after `waitForFunction` —
  the e2e lane's own criterion; the app's `sw.js` `activate` does
  `clients.claim()` so the FIRST load is already controlled), plus the
  registration's scope + active script URL;
- display mode: the manifest's `display` value;
- `beforeinstallprompt`: a 3 s probe, RECORDED, never a hard fail —
  headless Chromium doesn't reliably fire it (the plan's P1 pitfall, the
  e2e spec's own soft-gate).

Verdict: pass/fail + the full inventory JSON.

**(b) Boot timing — offline vs online** — N fresh-context runs each
(default N=5, `--runs N`):

- **Online baseline**: fresh context → `goto /` → wait the app's real
  ready marker (`#coda-status` → `"Ready."`, the same signal
  `e2e/coda-offline.spec.ts` waits on) → wait SW controller. Wall-clock
  from the `goto` trigger to Ready.
- **Offline**: the SAME fresh context, after the online boot + SW
  control, `context.setOffline(true)` → `page.reload()` → wait `"Ready."`
  again — the exact sequence the e2e offline spec performs. Wall-clock
  from the `reload` trigger to Ready. This is the boot-FROM-CACHE time:
  the navigation is answered entirely from the SW's precache.
- Report **median + min/max** per phase over N, and the median
  offline−online delta.

Honesty: both are medians over N with N stated; the receipts carry every
sample plus the in-page `PerformanceNavigationTiming` (DOM-content-loaded /
load event) as a cross-check; the offline number is a cache-served boot,
the online one is a cold dev-server boot — the dev server transpiles `.ts`
on the fly, so absolute ms are environment-specific; the DELTA (offline
faster than cold-online) is the PWA signal.

## Environment (stated in every receipt)

Headless Chromium (Playwright) inside the operator's container, app
served by its own `apps/coda/scripts/serve.mjs` (bun-only transpiling
dev server) on a scratch port (default 4099), IndexedDB fresh per
context. No network access to anything except `127.0.0.1`.

## Run

From the repo root (no stack needed — no bridge, no engine, zero endpoint
spend):

```bash
bun benchmarks/coda-pwa/run-pwa-bench.mjs            # N=5, port 4099
bun benchmarks/coda-pwa/run-pwa-bench.mjs --runs 10  # more samples
bun benchmarks/coda-pwa/run-pwa-bench.mjs --port 4101 --runs 5
```

Exit 0 = installability hard criteria all pass; 1 = a hard criterion
failed (manifest fetch, required fields, icons, or SW controlling).
`beforeinstallprompt` is record-only and never fails the run.

## Receipt shape

`receipts/run-<ts>/`:

- `installability.json` — the (a) inventory: verdict, every check's
  raw value, the icon inventory.
- `timing-online.json` + `timing-offline.json` — the (b) samples
  (per-run wall ms + in-page navigation timing + the phase method
  string).
- `summary.json` — the run envelope: environment block (with the
  honesty caveats), both receipts' figures, the delta, verdict,
  hard-fail list.

`RESULTS.md` is hand-written from the committed receipts (house rule —
never the other way round); each RESULTS figure carries its receipt
path + N.

## Registration

`benchmarks/RESULTS.md` master index entry + this lane's README/RESULTS.
No `scripts/landing_benchmarks.mjs` TRACKS entry (not a landing feed);
`bun run check:benchmarks` stays green without modification.
