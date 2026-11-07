# NOTES-F4 — Fugue ticket F-4 (PWA shell + job authoring)

## Spike verdict (PLAN §7 unknown #2)

**The proxy path is CONFIRMED.** The spike booted the PWA shell
(`serve.mjs` on 4015) with the compose lane rendering one live job
through the `RestAdapter` proxy path against the F-3 fixture server
(`runner/fixture-server.ts` on 4130, CORS-pinned): the browser-side
`RestAdapterClient` injects straight into the F-2 `EngineAdapter`
seam, and one live fixture automation crosses the app boundary and
renders in the grouped list — no hidden second hop, no crash, no
blank. Re-running the same lane with the runner stubbed out (the
`RestAdapterClient` throws `EngineDown` on the probe) degrades the
app to the honest `engine-down` panel + the `FakeEngineAdapter`
shadow lane; the shell still renders (never a crash, never a blank).
The pinned proof is `src/ui/app.test.ts` (the `F-4 spike`
describe-block: live lane + degraded lane + EngineDown taxonomy
pin), run green in Lane A. The `FakeEngineAdapter` remains the
unit-lane double; the live lane is e2e-only by the F-3 design, and
this confirms the proxy contract holds without cutting it. No seam
change was required — the F-1..F-3 surfaces were used as-is.

## Deviations

- `src/ui/app.ts` guards the every-transition `persistAll` in
  `boot()` with a try/catch: the unit lane (Lane A, no DOM preload)
  has no `localStorage` global, so `createLocalStorageAdapter()`'s
  empty-object fallback StorageLike would otherwise throw on
  `save()`. The guard is the O-1 honest-degradation pattern (never a
  crash, never a blank) and keeps `boot`/`render`/`persistAll`
  drivable from the DOM-free lane; the browser host's real
  localStorage satisfies the seam in the live lane.
- The palette + compose DOM wiring (`renderPalette`, `main()`)
  landed in `src/ui/app.ts` this chunk rather than a separate
  module, because the brief's chunk budget pinned the five UI
  modules; the palette command table + filter semantics and the
  compose-draft validation + the five-kind `draftToScheduleSpec`
  mapping live in their own DOM-free modules (`palette.ts`,
  `job-editor.ts`) with co-located tests, and the DOM overlay
  render is the app.ts kin (the ostinato `renderPalette` pattern).

## Seam-change requests

None. The F-1..F-3 surfaces (`src/domain/**`, `src/adapter/**`,
`runner/**`) were used as read-only; no seam change was forced.

## Edges not covered (handed to F-5/F-8)

- Live run-now / pause / resume / skip / snooze wiring against a
  real engine (the F-6 live lane).
- Export/import IO battery + schema-gate e2e (F-8).
- The a11y axe battery (F-9): light+dark, tab order, Esc
  focus-return are not yet re-pinned in the fugue lane.
