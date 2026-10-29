# The aria round — the validation log

> The failure→root-cause→benchmark→improvement→rerun ledger, continuing the
> gallery-round lineage inherited from the Parley round (F3–F7) and before it
> the SOTA round (F0–F5) — so the aria round's entries start at **F8**: never
> patch around a failure; decide where the defect lives (Unown, the caller's
> environment, or the app under construction); fix it where it lives; create
> the regression or benchmark that would catch it; rerun the original
> workflow and record before/after evidence. An entry that ends in "no
> Unown defect" is a valid, wanted outcome — the log exists to make the
> process visible, not to manufacture fixes. Engine-level defects in the
> memory/learning core discovered during this round are also mirrored in
> the validation round's own ledger
> ([`../validation-round/validation-log.md`](../validation-round/validation-log.md))
> when they belong to it.

## Failures

---

## F8 — the pipeline deal card strands the detail view in "Loading deal…" forever
(closed: the app under construction; fixed + pinned)

- **Description.** The CP5 UI browser pass (the plan Phase 5's live
  headless-Chromium pass, `ui-pass.mjs`, step 3) clicked a pipeline deal
  card and the detail view rendered "Loading deal…" indefinitely. The same
  detail opened fine from the dashboard's at-risk list and from contacts.
- **Reproduction.** Fresh standalone production build on :3210 → login as
  the owner → Pipeline tab → click any `button[title^="adeal_"]` card →
  the view stays on "Loading deal…" forever (verified by screenshot + a
  4-run repro loop: 4/4 stuck).
- **Root cause.** `DealDetailView` reads the shared `aria.dealDetail`
  provider state but never triggers its own fetch; the dashboard
  (`dashboard.tsx:84,145`), contacts (`contacts.tsx:100`) and triage
  (`triage.tsx:62`) pre-fetch via `aria.openDealDetail(id)` before
  switching views, but the pipeline card (`pipeline.tsx:138`) only set
  local `openDealId` state. The invariant suite's `DetailProbe` primed the
  fetch itself — the test harness papered over the defect instead of
  pinning the component's contract.
- **Unown defect?** No — the defect lives in the app under construction
  (the aria UI layer). Unown's terminal sessions built it faithfully to the
  plan; the plan's Phase 3 spec did not state the detail view's fetch
  ownership, and no test pinned the no-pre-fetch path.
- **Benchmark created.** `src/components/aria/__tests__/aria-invariant.test.tsx`
  — new suite "F8: DealDetailView self-fetches when its deal is not loaded"
  (mounts the view WITHOUT a primer; asserts the deal id h2 renders).
- **Fix created.** `deal-detail.tsx` — a `useEffect` self-fetch guard:
  when `detail?.deal.id !== dealId` the view calls `openDealDetail(dealId)`
  itself; pre-fetching callers are unaffected (the guard skips the duplicate
  GET).
- **Validation evidence.** `bun test src/components/aria
  src/lib/aria src/app/aria` → **557 pass / 0 fail** (was 556; +1 pin);
  the rebuilt production bundle's UI pass went **FAIL 3 → PASS 3**, and
  the full 8-step pass runs **8/8 twice consecutively**.
- **Rerun of the original workflow.** `node benchmarks/aria-round/ui-pass.mjs`
  → 8/8 steps (runs recorded 2026-10-29, twice).
- **Retention (regression).** The F8 pin runs in the aria component suite
  on every `bun test src`; the UI pass driver (`ui-pass.mjs`) stays in the
  lane as the CP5 regression workflow.

---

## Positive validations (defects the system caught itself — recorded so the
loop's defenses are visible)

- **The browser-verification lane caught F8 on its first real
  click-through.** The 556-test suite (incl. the DetailProbe that
  unknowingly pre-fetches) never exercised the no-pre-fetch path; one
  pass of the plan Phase 5's live-Chromium workflow did. The round's
  verify-like-a-user lane is not decoration — it is the only gate that
  saw this defect class.

