# The Chaconne PRD

> **Status: APPROVED 2026-11-06** — selected per the directive's §0.9
> procedure (scored against three alternatives; the receipt and the
> pre-registered failure classes live in
> [the benchmark round](../benchmarks/rondo-round/README.md)); the approval
> ruling is recorded in [the round log](rondo-round-session.md). A chaconne
> is a musical form built on a repeating ground line, endlessly varied —
> the runner loop is the ground, the recipes are the variations.

One-line purpose: the PRD for **Chaconne**, the Rondo round's DRIVE-track
application — the production build that doubles as A2's capability stress
test.

**Mini-TOC**

- [The one-paragraph vision](#the-one-paragraph-vision)
- [Why this app](#why-this-app)
- [Users and jobs](#users-and-jobs)
- [Scope](#scope)
- [Non-goals](#non-goals)
- [Hardening-first mapping](#hardening-first-mapping)
- [Edge cases the PRD names up front](#edge-cases-the-prd-names-up-front)
- [Success criteria](#success-criteria)
- [Related pages](#related-pages)

## The one-paragraph vision

**Chaconne** (`apps/chaconne/`) is a keyboard-first, self-hosted
browser-recipe runner: compose a browser flow once — navigate, click,
fill, select, wait, assert, extract, screenshot — and it repeats on
demand or on a schedule, capturing screenshots, extracted values and an
honest run log for every execution. Recipes run against **fixture pages
in every test lane** (deterministic, offline-verifiable), the run history
is crash-safe (atomic writes, the Ostinato law), the artifacts are
content-addressed (sha256-pinned), and the whole surface is operable
without a mouse and installable as a PWA. It is the repo's fourth user
product (after Coda, Ostinato and the proposed-but-unapproved Tempo),
built to the house pattern with one deliberate extension: a runner
process — which is exactly the exposure the §0.9 selection bought.

## Why this app

- **Weakness-driven, not comfort-driven** (the §0.9 rule): the vehicle
  forces A2 to confront the repo's live open defect classes — browser
  flow resilience (#43 fill_form iframe race, #44 screenshot handling),
  process/service lifecycle (#30 kin), concurrency and long-horizon
  planning (a 12-ticket build in one repo) — while Tempo, the parked
  alternative, would have been the third app of the same zero-service
  pattern (Exposure 1, no augmentation headroom).
- **Real-world, not a toy**: recurring browser checks and form flows are
  a proven self-hosted category (n8n, Browserbase, Huginn); a
  single-binary version with fixture-verified determinism is genuinely
  useful to a small team.
- **Benchmark-friendly**: every defect class mints a deterministic
  verifier — a fixture-page repro, an artifact hash pin, a crash-resume
  case — the Failure → Benchmark reflex has somewhere to land on every
  lane.
- **The learning lanes get a real workload**: 12+ A2 sessions in one
  repo is exactly what tiered memory, AutoDream consolidation and skill
  minting exist for; the round receipts whether they actually helped
  (the §6c plan in the round log).

## Users and jobs

- A developer or ops engineer who re-checks the same internal page or
  fills the same form weekly and wants it captured, repeated and
  diffable instead of hand-done.
- Jobs: compose a recipe once → run it now or on a schedule → see the
  run history with screenshots and extracted values → export/import the
  library byte-stably.

## Scope

**P0 (the shippable core)**:

1. The model: recipes (named, ordered steps) and step kinds — `goto`,
   `click`, `fill`, `select`, `wait`, `assert-text`, `assert-element`,
   `extract`, `screenshot`; run records (status, timings, artifacts,
   error taxonomy); validation on every boundary; integer IDs; canonical
   JSON export (byte-stable, the Ostinato canonicalization law).
2. The runner: executes a recipe against a page with per-step and
   per-run caps (max steps, wall clock), produces artifacts
   (screenshots + extracted values + a run log), writes run records
   atomically (temp-key + commit-swap), and reports an honest error
   taxonomy (step-failed, selector-not-found, timeout, invalid-recipe).
3. The recurring loop: schedules per recipe (one-shot, interval), a
   misfire policy (missed-while-down → skip-and-record, never
   silent-double-run), run-history dedup.
4. The surface: a keyboard-first web app — recipe list/create/edit,
   run history, artifact viewer (screenshot + extracted values), command
   palette, honest empty/loading/error states; vanilla TypeScript,
   zero dependencies (the house law), localStorage persistence with
   atomic writes and corrupt-store recovery.
5. The verification lane: every test runs against LOCAL fixture pages
   committed under the app's test fixtures — no live-network test ever
   runs in CI; artifact sha256 pins; a fake-page adapter for the unit
   lane.
6. The PWA: offline-complete shell, installable, precache with a static
   derivation proof (`apps/chaconne/scripts/verify-precache.ts`).
7. The product surface: a landing band with real usage captures, a docs
   page (`docs/chaconne.md`), a README section, a CI gate entry
   (`chaconne:test` + `chaconne:e2e`).

**P1 (post-freeze candidates)**: cron-expression schedules, screenshot
diffing against a baseline, recipe folders/tags, CSV export of extracted
values, a `?` shortcut sheet.

**P2 (explicitly deferred)**: cloud sync, accounts, team flows, captcha
handling, live-network monitoring claims, native mobile.

## Non-goals

- No accounts, no telemetry, no cloud — self-hosted, local-first.
- No dependency additions to `apps/chaconne/` beyond the house's
  zero-dep law; the RUNNER may import the repo-root playwright (the
  exact mechanism is C-0's first ruling, operator-approved).
- No live-network E2E claims — the battery's honesty depends on
  fixture-page determinism.
- No WebKit/Firefox/mobile claims in P0 — Chromium-desktop is the
  honest scope (the Ostinato precedent); the others stay `[U]` in the
  matrix.

## Hardening-first mapping

| Directive lane | Chaconne coverage |
|---|---|
| keyboard-only workflows | the K-1 law: create a recipe → run it → open artifacts, zero pointer events, an e2e spec pins it |
| tab order + focus recovery | axe wcag2a/2aa both schemes; the tab-order pin; Esc focus-return on every overlay |
| modal open/close, escape handling | the recipe editor's modals on the create-form contract (role=dialog, aria-modal, attach-before-focus) |
| command palette flows | the palette (Ctrl+K) with every P0 action reachable |
| scrolling, list navigation, selection states | the run history's grouped lists; arrow navigation; selection semantics pinned |
| empty states | no recipes / no runs / no artifacts / failed run — honest panels, never blank |
| loading states | the runner's live progress (step N of M, elapsed) with an honest intermediate state |
| interrupted tasks, crash recovery | crash-mid-run resume (the run record's committed-prefix law), corrupt-store recovery, the kill/resume e2e |
| terminal resize handling | the responsive lane re-run at 3 viewport classes |
| cross-session consistency | the import/export round-trip pin (byte-stable canonical JSON) |

## Edge cases the PRD names up front

A step timing out mid-run (the run record must show the committed
prefix), a selector matching nothing (selector-not-found, not a hang), a
fill on an iframe-hosted field (the #43 class — the runner must verify
the value landed), a screenshot of a page taller than the viewport, a
run killed and resumed mid-recipe, a schedule misfire after machine
sleep (skip-and-record), a recipe edited while a run is in flight (the
run snapshots its recipe version), artifact-name collisions
(content-addressed names), canonical export with unicode recipe names,
import of a future-schema recipe (rejected with a dry-run report, never
a partial import), the offline boot with pending schedules (no silent
catch-up storm). Each becomes a unit pin or an e2e case in the ticket
that ships the feature — named here so no ticket discovers them late.

## Success criteria

- The app ships and is served (the landing gallery band + the PWA
  served from the repo's site), the full battery green: Lane A/B unit,
  tsc, lint, the zero-dependency check on the app dir, the precache
  derivation proof, the e2e battery (K-1 zero-mouse, A-1 axe both
  schemes, O-1 offline, R-1 crash-resume, resize, the byte-stable
  round-trip, the fixture-page runner battery).
- The engagement's own bars: turns-to-done trending down across the
  C-tickets; every harvested defect converted to a pinned regression;
  the learning mechanisms receipted (§6c); the §0.9 predicted failure
  classes reconciled against what actually happened (no
  retroactive story-telling).
- Honest scope stated on the landing surface (Chromium-desktop-only P0,
  fixture-page test honesty).

## Related pages

- [The Rondo round log](rondo-round-session.md) — the owning round
- [The Rondo benchmark round](../benchmarks/rondo-round/README.md) — the
  §0.9 selection receipt + the baseline
- [The Ostinato PRD](ostinato-prd.md) — the house pattern this follows
- [Coda](coda.md) · [Ostinato](ostinato.md) — the sibling products
