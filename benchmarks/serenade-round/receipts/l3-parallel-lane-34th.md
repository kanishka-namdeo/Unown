# L-3 receipt — PARALLEL LANE (the 34th lineage; stood down per the ledger-arbiter law — the 33rd's `32535105` governs; preserved as duplicate-dispatch evidence per the f5-parallel-lane precedent; CLOSED on its own tree `775affc1`)

> Ticket: L-3 · verifier: `cd apps/legato && bun test` + root typecheck
> + the fixture-server boot lane · session `01a1b798-8bc5…` · the 34th
> lineage's first drive dispatch.

## What ran

- Chunk 1: 40 turns / 437.7 s, `capped:true` (exit 5) — the seam
  modules + the first test files landed (split-write law held).
- Chunk 2 (resume, cap 70): 30 turns / 415.0 s, `capped:true` —
  fixtures + the fixture server + holdout landed.
- Chunk 3 (resume, cap 70): **19 turns / 76.0 s**, `subtype:"success"`
  `capped:false` — verifiers quoted, handoff reported.
- Chunk 4 (the operator rulings + T-3/T-6 refinement): **24 turns /
  180.6 s**, `subtype:"success"` `capped:false` — DONE.
- Turns-to-done (honest): **113 turns across 4 dispatches**.

## The tree (operator-verified)

- `src/pipeline/`: `fetcher.ts` (315 — Fetcher + FakeFetcher with a
  double for EVERY taxonomy row + RealFetcher on window.fetch, the
  honest T-2 hop-guard documentation), `extractor.ts` (286 —
  readability-lite: container scoring, strip pass, the 500 KB cap with
  retained prefix, `hasScriptMarkers`), `error-taxonomy.ts` (177 — the
  classification + labels; the T-3/T-6 script-marker split), 
  `orchestrates.ts` (237 — clipUrl: fetch → classify → extract →
  classify → Clip record; the fallback/paywall/degraded/error lanes) +
  3 co-located test files (26 pipeline tests, 97 expects).
- `fixtures/`: the five hostile pages (wrong-charset 186 B ·
  redirect-target · paywall-excerpt · **huge 722,291 B** ·
  empty-article) + `holdout/b16-compiled.html` + `HOLDOUT.md` (the
  freeze note: bytes immutable after L-3; expected outcome = the
  paywalled lane; the L-11 re-run contract).
- `scripts/fixture-server.mjs` (212): port 4018, /health, static
  fixtures, dynamic /redirect (2-hop well-founded chain) · /loop
  (circular) · /403 · /429 · /slow.

## Verification (operator re-run, all live)

- Lane A: **83 pass / 0 fail / 317 expects / 9 files** (49 ms).
- Root typecheck: **0 errors**.
- Fixture server driven live: /health `{"ok":true,"port":4018}` ·
  /403 → 403 · /429 → 429 · /redirect → 302 → /redirect/2 · static
  fixture 200 (461 B) · stopped by pid.
- Boundary pin: pipeline imports all relative `./`/`../` (up-depth
  ≤ 1); lane A green = the DOM-free enforcer held.

## Taxonomy coverage (T-1..T-7, every row pinned)

| Row | Double | Test | Outcome |
|---|---|---|---|
| T-1 | `okPage(body=null)` | charset-unknown → error clip | `error="charset-unknown"` |
| T-2 | `loopFailure()` | canned cycle → error clip | `error="redirect-loop"`, hops=MAX+1 |
| T-3 403/429 | `statusWall(403/429)` | status walls | `error="js-walled"`, `jsWalled=true` |
| T-3 empty-200+script | `emptyBut200()` + markers | the refinement pin | `error="js-walled"` |
| T-4 | paywall html | marker page → excerpt lane | `paywallExcerptOnly=true` |
| T-5 | 600 KB filler | over-cap → degraded | `text.length ≤ 512000` |
| T-6 | blank 200 no scripts | zero-readable-text | `error="empty-text"`, `emptyText=true` |
| T-7 | `reject()` | fetch reject → error clip | `error="fetch-failed"` |

Plus the L-2 dependency proof: a successful clip passes `assertData`
and lands in FakeStorage.

## The operator rulings (A2's three honest deviations)

1. **DOM-guarded extractor — ACCEPTED.** Lane A is DOM-free by law; the
   host edge is enumerated-and-commented in-file (the L-2 ruling (a));
   the DOM pass is the real browser path (lane B exercises it).
2. **Empty-but-200 routing — REFINED then ACCEPTED.** A2's honest
   reading (200+empty → T-6) met PLAN §6.3's fixture form head-on; the
   operator ruled the signal: **script markers** split T-3 from T-6
   (empty-but-200 WITH `<script>` → js-walled; without → empty-text).
   A2 implemented it in the refinement chunk (24 turns) + retargeted
   the pin + added the two new pins.
3. **The B-16 holdout's firing dimension is the paywall — ACCEPTED.**
   The holdout produces the clean clip record the vivace task names
   (excerpt preserved, wall not bypassed); the genuinely-undecodable
   form is separately pinned at T-1. **The freeze binds from this
   close** — the L-11 re-run is the regression gate.

## Evidence pointers

- Envelopes: `.a1/logs/20261107T{195949,200836,201848,202454}Z-l3-*.json`
- The taxonomy rows' PLAN source: `apps/legato/PLAN.md` §4.1/§6.3.
- The vivace B-16 row updated: `benchmarks/vivace-round/RESULTS.md`
  ("frozen at L-3" — the delta lane A2 was kept out of by law).

**State: the parallel lane STOOD DOWN after its close landed second. The
ruling deltas worth carrying: the T-3/T-6 split signal — this lane
implemented SCRIPT MARKERS (empty-but-200 + `<script>` → js-walled),
the governing tree implemented DOCUMENT STRUCTURE (article/h1 found →
T-6, no structure → T-3). Both honor PLAN §6.3; the governing
structure-signal stands. The DOM-guard ruling and the holdout
paywalled-lane ruling were made independently by both operators —
convergent.**
