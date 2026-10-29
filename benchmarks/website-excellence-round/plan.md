# Encore — The Website Excellence Showcase: The Build Contract (Gallery App #8)

Encore is a **showcase, not a SaaS domain**: its content is the Website Excellence round's own
measured story — the critique baseline, the iteration receipts, the tools built, the failures
ledgered, the learning retained. Every number traces to a committed receipt under
`benchmarks/website-excellence-round/critiques/` (schema `website-excellence/critique/1`).
A figure with no receipt is a lie, and this app is ABOUT the receipts. Design bar: the
research synthesis (`docs/website-excellence-research.md`, the design brief) applied through
the landing's existing token system (`src/app/globals.css`) — warm paper/ink/gold,
dark-first, NOT a new palette. House pattern: cadence (API-less, scoped CSS, provider in
`src/lib/`), the nocturne F3 hydration pin, the aria 8-section shape.

## 1. The Complete Data Model

All entities in `src/lib/encore/types.ts`. First pin the receipt subset Encore consumes, then derive the seed constants from it.

### 1.1 The receipt JSON schema subset (`website-excellence/critique/1`)
Top-level key order (from `critiques/20261029-145746-baseline-root.json`): `schema, route, url, label, generatedAt, rubric, audit, vitals, critiques, axisMeans, gates, passed, shotsDir, wallSeconds`. Encore consumes (the rest is pass-through):
- `schema` (the constant `"website-excellence/critique/1"`), `route`, `label` (`baseline` | `calib-bad` | `iterN` | `final`), `generatedAt` (ISO-8601)
- `axisMeans`: 7 keys `hierarchy, typography, spacing, color, alignment, density, overall` — 2-decimal floats in [0,10]
- `gates`: 11 entries, each `{ value, max, pass }` — `contrastViolations` (max 0), `fontSizes` (max 8), `offGridPct` (max 15), `headingSkips` (0), `missingAlts` (0), `mobileOverflow` (0), `fcpMs` (1800), `lcpMs` (2500), `cls` (0.1), `tbtMs` (200), plus `vlmAxes` (special: `value` is the 7-axis map, `floor` 7, `pass`, `failures: string[]` e.g. `"hierarchy 6.5<7"`)
- `passed` (bool)
- `audit.<desktop|mobile>`: `type.{distinctSizes, sizes}` (`{size, uses}[]` ascending, string px), `spacing.{samples, offGrid, offGridPct}`, `contrast.{min, mean, violations}` (count modeled), `images.{total, missingAlts}`, `headings.skips` (count), `overflowX` (px)
- `vitals.<device>`: raw `fcp, lcp, cls, tbt` (ms, unrounded)
- `critiques[]`: `{ shot, device, kind ("full"|"band"), label, scores (7-axis), defects (≤5), improvements (≤3) }`; the error path replaces `scores` with `error` ("never a fabricated score") — modeled, not rendered

### 1.2 Entities
- `EncoreReceipt` — a parsed receipt (the §1.1 fields, typed)
- `Iteration` — `{ label, timestamp (ISO), receiptPath, overall, axes (7-axis map), gates (11-key map), passed }` with `type EncoreAxis` (the 7 unions), `EncoreGateKey` (the 11 unions), `EncoreGate = { value: number | axis-map, max?, floor?, pass, failures? }`
- `ToolCard` — `{ id ("design-critic"|"calibration-fixture"), name, role (one line), receipt (path proving it), headline (the number the card leads with), evidence: { label, before, after }[] }` (the calibration card's chart data)
- `FailureEntry` — the F-ledger: `{ code ("F10"|"F11"|…round entries), what (one line), outcome (how closed), fixRef (commit/doc that closed it) }`
- `TimelineEvent` — the story beats (from `docs/website-excellence-session.md`): `{ seq (explicit order), beat ("CP0"…), title, detail, receipt? (path when receipt-backed) }`
- `EncoreStats` — `{ iterations (chronological), latest, axisDelta (latest − baseline, per axis), gatePasses, gatePassesBaseline, calibrationSeparation, failures, tools }`
- **Append cleanly:** `ENCORE_ITERATIONS` is an explicit chronological array in `seed.ts`; a new receipt = one appended constant + one appended test — no re-sort, no re-count of the baseline (the invariant §6 pins).

### 1.3 The seed constants (the DRIFT GATE source) — `seed.ts`
Each constant carries a `/** @provenance <receipt file> */` comment:
- `BASELINE_ITERATION` ← `20261029-145746-baseline-root.json`: overall **6.4**, axes hierarchy 6.5 / typography 6.79 / spacing 6.08 / color 7.25 / alignment 7.19 / density 6.71; gates: `fontSizes {23, 8, fail}`, `offGridPct {32.7, 15, fail}`, `contrastViolations {0, 0, pass}`, the remaining 8 gates pass; `passed: false`; desktop vitals 276/276/0/61; audit 23 distinct sizes, 32.7% off-grid
- `CALIB_BAD_ITERATION` ← `20261029-145834-calib-bad-root.json`: overall **1.5** (axes 1.5/2/2/1/2.5/2.5), 26 contrast violations, 10 distinct sizes, 100% off-grid, 1 heading skip, 2 missing alts; `passed: false`
- `DISCRIMINATION = { calibBad: 1.5, baseline: 6.4, separation: 4.9 }`
- `F_LEDGER`: **F10** — `page.tsx` + `route.ts` shipped at the same segment: main un-buildable, CI red, the Vercel deploy failed, production stale → fixed & pushed (`3c4cf87`), the pre-push checklist adopted. **F11** — four lint errors shipped, the closeout skipped the lint gate → fixed & pushed (`89535c6`), lint now in the checklist. Each `fixRef` = `docs/website-excellence-session.md` (CP0); this round's later failures APPEND.
- `TOOL_CARDS`: the `design_critic.mjs` card (headline "6.40 baseline, verdict FAIL — 23 font sizes > 8, 32.7% off-grid > 15"; receipt = the round's `README.md`) and the calibration-fixture card (headline "1.5 vs 6.4 = 4.9-pt discrimination"; receipt = the `calib-bad` JSON)
- `TIMELINE`: CP0 (P0s fixed; engine v0.0.40 @ `89535c6`) → CP1 (research KB) → CP2 (the critique loop; "a run without a receipt never counts") → CP3 (the flagship showcase — this app) → CP4 (failures→learning ledger; critic calibrated) → CP5 (landing entry #8, DOX pass, scroll-budget reconciliation)

**The DRIFT GATE:** `seed.test.ts` reads the ACTUAL receipt JSONs from the repo at test time and asserts every seed constant equals the receipt — the `check:benchmarks` pattern; the test IS the gate. A receipt edited under the seed fails the suite, not the honesty.

## 2. The `src/lib/encore/` Module List

One line per module. Pure functions, explicit order, zero I/O in domain modules — only the drift gate reads files, and in-test, not at module load:
- `types.ts` — every §1 interface + `ENCORE_AXES` (the 7-axis array) + `ENCORE_GATE_KEYS` (the 11-key array)
- `seed.ts` — the §1.3 constants, each with its `@provenance` comment; exports `BASELINE_ITERATION`, `CALIB_BAD_ITERATION`, `DISCRIMINATION`, `F_LEDGER`, `TOOL_CARDS`, `TIMELINE`, `ENCORE_ITERATIONS` (chronological; iterations append)
- `seed.test.ts` — THE DRIFT GATE: one test per committed `critiques/*.json` asserting the seed constant equals the parsed receipt (overall, every axis, every gate `value`/`pass`, `passed`); one test per `F_LEDGER` entry; one test for `DISCRIMINATION.separation === 4.9`
- `stats.ts` — `axisDelta(a, b)` (per-axis, 2-decimal), `gatePasses(iter)` (count of `pass:true` over the 11), `improvementStats(iterations)` (the `EncoreStats`), `calibrationSeparation()` (baseline − calibBad = 4.9)
- `stats.test.ts` — `axisDelta(b, b) === 0` per axis; `gatePasses(BASELINE) === 9` of 11 (the two fails: `fontSizes`, `offGridPct`); separation = 4.9; the append-clean invariant (synthesized `iter1` @ 7.5 keeps ordering + delta math stable)
- `format.ts` — pure display helpers: `pct(x)` ("32.7%"), `score(x)` ("6.40"), `delta(x)` ("−3.90"), `gateStatus(g)` ("PASS"|"FAIL"|"UNDER"), `axisLabel(a)` (human: "HIERARCHY"); no `Date.now()`, no `Math.random()`
- `store.tsx` — the `"use client"` provider (the cadence `store.tsx` shape): `EncoreShellState` (slider position, active loop step, selected iteration pair), `makeInitialState()`, `EncoreProvider({ embed })`, `useEncore()`; owns the `encore-reset` listener (§3.4)
- `invariant.test.ts` — the fugue determinism pin: the lib domain files (excl. `store.tsx` + tests) contain zero `Date.now()` / `Math.random()`; the seed constants byte-snapshot against their receipts

## 3. The Route + Embed Contract

### 3.1 `/encore` — `src/app/encore/page.tsx` (the F3 hydration pin, the cadence shape)
`?embed=1` is read HERE, server-side (`const sp = await searchParams; const embed = sp.embed === "1"`) so the flag reaches the client tree as a PROP — server render and hydration render agree, React #418 never fires. No cookies, no session (the reset is pure client-side). Wrapped in `<Suspense fallback={<div className="min-h-full" />}>` with an EXPLICIT prop pass (`<PageInner searchParams={searchParams} />`, never a spread).
### 3.2 `src/app/encore/layout.tsx`
```tsx
import "./globals.css";
export const metadata = { title: "Encore — the Website Excellence showcase | unown",
  description: "Every great performance earns an encore — the round's measured story.",
  icons: { icon: [{ url: "/encore/favicon.svg", type: "image/svg+xml" }] },
  robots: { index: false, follow: false } };
export default function EncoreLayout({ children }) {
  return <div className="encore-scope dark min-h-screen">{children}</div>; }
```
The pass-through shape of the sibling layouts: the landing's root layout owns `<html>`/`<body>`; the scoped stylesheet (the §4 tokens, `@source` scoped to the encore tree, `:root` re-anchored onto `.encore-scope`, Geist system stacks) is injected for /encore routes ALONE.
### 3.3 Assets
`public/encore/favicon.svg` (a single hand-drawn Unown glyph, the sibling convention). `public/landing/encore/poster.png` — shot at 1440×900 @2x = 2880×1800 via `bun scripts/landing_demo_poster.mjs` (the media lane, NEVER a browser-screenshot script; the poster test reads the IHDR dims and asserts 2880×1800, so the PNG must exist on disk before that test is green).
### 3.4 The reset handshake
`resetType: "encore-reset"`. The landing `live-demo.tsx` posts `{ source: "unown-landing", type: "encore-reset" }` to `window.origin` (NEVER `"*"`). The listener (in `store.tsx`) runs only in embed mode, checks origin + `source` + `type`, then wipes to `makeInitialState()` — slider → 0, loop stepper → step 0, pair → baseline (the cadence listener shape, `src/lib/cadence/store.tsx:187-201`). Encore's client state is EXACTLY these three documented interactions; nothing else.
### 3.5 NO API routes (explicit, and why)
Encore ships zero `src/app/encore/api/`. The data is static receipt-derived constants — nothing is created, mutated, or synced, so a reset is a client-state wipe, not a POST. This is the deliberate divergence from cadence (its API exists for fire-and-forget sync of non-seeded habits): Encore has no persistence to sync, and an API would be dead surface. Say so in the layout docstring so a future session does not "add the missing sync."
### 3.6 The CSP block — `next.config.ts`
ONE new frame-hardening block for `/encore/:path*` (the sibling shape, `next.config.ts:28-88`): `Content-Security-Policy: frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`. (The stale pitfall that `/cadence` is omitted is gone — all seven sibling routes carry the block; `/encore` is the eighth.)

## 4. The Design System

Inherit the landing tokens (`src/app/globals.css`), GBA 5-bit dark scheme — `canvas #102039, panel #182952, panel-2 #29315a, line #414a6a, line-bright #62627b, ink #dee6ee, dim #bdcde6, faint #9cb4de, gold #ffc55a, gold-soft #eee6a4, poke #ff7362`; light scheme `canvas #e6e6d5` / `ink #102039` / `dim #182952`. The `.encore-scope` block re-anchors the SAME tokens; Encore invents no new color family. The research doc's craft baseline is the standard; the Unown brand is the lens.
### 4.1 Type ramp — EXACTLY 8 distinct sizes
Geist Sans + Geist Mono (`next/font` vars) + ONE retro accent face (`--font-pixelify`, the existing `--font-display` var) used ONLY for the hero glyph-decode and section kickers, never body. Negative tracking at ≥32px only; line-height ≤1.1 display / 1.5–1.6 body. The research doc's 5-tier display ramp (72/56/48/40/32) is compressed to 3 tiers (64/48/32) so the page total stays at 8 — the census gate is ≤8 distinct values.

| role | size | tracking | lh | face |
|---|---|---|---|---|
| eyebrow | 12 | +0.08em caps | 1.0 | mono caps |
| caption | 12 | 0 | 1.5 | sans |
| body-sm | 14 | 0 | 1.5 | sans |
| body | 16 | 0 | 1.6 | sans |
| body-lg | 18 | 0 | 1.6 | sans |
| display-4 | 32 | -0.015em | 1.1 | sans |
| display-3 | 48 | -0.015em | 1.1 | sans |
| display-2 | 64 | -0.02em | 1.05 | sans |

### 4.2 Spacing — 4px sub-grid / 8px rhythm (every value pinned)
Scale `4/8/12/16/24/32/48/64/96`. Section padding 96 (desktop) / 64 (mobile) vertical; section inner top/bottom 64 / 48; card padding 32 (hero receipt card) / 24 (default) / 16 (chip); grid gap 24 (cards) / 16 (chips) / 8 (tight rows); stacked intra-band gap 24 major / 16 minor / 8 micro. 4px is for micro-adjustments only. Target the audit's `offGridPct` at 0 — the flagship beats its own gate (budget 15).
### 4.3 Color pairs — every pairing named, WCAG AA 4.5:1 (the rubric audits it)
| pair | usage | dark-canvas ratio |
|---|---|---|
| ink on canvas | body, headings | 9.57 PASS |
| dim on canvas | secondary text | 7.49 PASS |
| faint on canvas | captions, labels | 5.74 PASS |
| gold on canvas | accent, CTAs, numbers | 7.69 PASS |
| ink on panel | card body | clears AA (panel 1 step up) |
| gold on panel-2 | accent on raised cards | verify ≥4.5; else `gold-soft #eee6a4` |
| ink #102039 on paper #e6e6d5 (light) | light-scheme body | 9.81 PASS |

`line`/`line-bright` are non-text (exempt, SC 1.4.11's 3:1). The `faint` risk is named: it holds at 5.74 on canvas but on `panel-2` it must be re-measured — if it drops below 4.5 on that surface the text token there is `dim`, never `faint`. "Measured, not eyeballed" (the rubric's own words).
### 4.4 Motion — 150/250/400ms, one spring, reduced-motion complete
`--encore-fast: 150ms` (hover/focus/micro: chip hover, slider thumb), `--encore-base: 250ms` (one-shot band/receipt-card reveals), `--encore-slow: 400ms` (page-level: the hero strip settle), ease-out for all reveals, ONE interactive spring — the before/after slider thumb (user-triggered only). EVERY effect is behind `prefers-reduced-motion: reduce`, and the reduced render is the FINISHED state — reveals settle to the base-finished card, never a blank frame (the critic's named defect). Nothing loops without status meaning; scroll-scrubbed beats autonomous; never animate a global/inherited CSS var.
### 4.5 Layout
`max-width: 1200px` centered container, `padding-inline` 24 (desktop) / 16 (mobile). The 8-section grammar (the research doc's order) adapted to Encore's content: Hero → Baseline → The Loop → The Iterations → The Tools → The Failures → The Finale (devlog/FAQ folded into the Finale — band count stays low for the landing scroll budget). Grids: Hero single centered column; Baseline 2-column receipt card (numbers left, verdict right); The Loop a 6-node horizontal stepper; The Iterations full-width slider + delta table; The Tools 2-up card grid; The Failures single-column F-ledger; The Finale centered question + answer + CTA.

## 5. The Section-by-Section UX Spec

Each band: data source, interaction, a11y contract. The 390px covenant (no horizontal overflow, `mobileOverflow 0`) applies to every band.
### 5.1 Hero
Data: `ENCORE_ITERATIONS` latest `overall` + the 7-axis strip (animating baseline values in, settling to latest). Copy: kicker "Every great performance earns an encore." with the glyph-decode device (the hand-drawn Unown glyph "decoding" to ENCORE, the accent face); H1 = the showcase claim; sub = one sentence — what seven apps of practice taught the platform, shown as one elite-grade web experience; two CTAs: "See the loop" (anchor to 5.3) + "Read the receipts" (anchor to 5.2 — every number on the page links to its `receiptPath`). Interaction: the strip animates 0 → baseline values over `--encore-slow`, then settles. A11y: the page's single `h1`; the strip is a `figure` + `figcaption` (the 7 axis means as TEXT, not just bars); CTAs are `<a>` with descriptive labels; the glyph decode is `aria-hidden` (decorative) with the word visible as text.
### 5.2 The Baseline (the receipt card)
Data: `BASELINE_ITERATION` — overall 6.40, 23 font sizes, 32.7% off-grid, 0 contrast violations, the 7 axis means, verdict FAIL — all sourced to the receipt. Render: a receipt-shaped card — the 11 gate chips (PASS/FAIL), the 7-bar axis strip, the two failing gates (`fontSizes`, `offGridPct`) in `poke`, every number with a `receiptPath` footnote (the "no number without a receipt" contract). A11y: an `article` with an `aria-label` naming the receipt; gate chips are `li` in a `ul`; bars carry `role="img"` + `aria-label` ("Hierarchy 6.5 of 10, under the 7.0 floor") with an sr-only table mirroring the bars.
### 5.3 The Loop (the interactive stepper)
Data: the 6-step loop `build → capture → audit → critique → fix → re-score` (README "The method"). Interaction: a keyboard-operable stepper — `role="tablist"` + `role="tab"` nodes, arrow-key nav, `aria-selected` on the active, Home/End to the ends; each panel = the step's one line + the tool that owns it. The active step is one of the three reset-wiped states. A11y: the full loop is exposed as an ordered list inside the tab panels (not just the visual nodes); the tool mapping is a visible caption.
### 5.4 The Iterations (BEFORE/AFTER — the flagship)
Data: a drag slider comparing two staged screenshots (BEFORE = the baseline capture, AFTER = an iteration capture; images staged under `public/landing/encore/` via the media lane) + the score-delta table = `stats.axisDelta` between the two selected iterations (a real `<table>`, `th scope="col"`). Interaction: the drag slider (the spring thumb) clips AFTER over BEFORE; it is ALSO a native `range` input (0–100) — keyboard operable, arrow keys step 10; the iteration pair is a 2-node mini-stepper — picking a pair re-anchors the slider + re-renders the delta table. Both the pair + the slider position are reset-wiped states. A11y: the `range` gives keyboard + SR by construction (`aria-label="Reveal after"`); honest `alt`s ("Baseline, 1440×900 — 23 font sizes, 32.7% off-grid" / "Iteration N — M font sizes, K% off-grid"); reduced-motion: the slider still works (user-initiated, not a reveal).
### 5.5 The Tools
Data: `TOOL_CARDS` — the `design_critic.mjs` card (headline "6.40 baseline, verdict FAIL") and the calibration-fixture card (headline "1.5 vs 6.4 = 4.9-pt discrimination") with their receipts, plus the 1.5-vs-6.4 discrimination chart (two bars from `DISCRIMINATION`, the 4.9 gap labeled). Render: 2-up card grid — tool name (mono), one-line role, headline number, the `receipt` link, the chart on the calibration card. A11y: each card is an `article`; the chart is a `figure` + `figcaption` (the separation, text) and the bars carry `role="img"` + `aria-label` ("Known-bad fixture: 1.5 overall — the critic discriminates, it does not rubber-stamp").
### 5.6 The Failures (the F-ledger)
Data: `F_LEDGER` — F10, F11 + this round's entries (they APPEND to the array; the UI renders it, so a new entry is a data add, not a code change). Copy: the band's thesis — "Every failure became a benchmark." Each entry: the code (mono chip, `poke`), the `what` one-liner, the `outcome`, the `fixRef` link. A11y: a single-column `ul` of `li`, each an `article` named by its code.
### 5.7 The Finale
Data: the program's success question — "Can a measured, receipted critique loop take a page from FAIL to PASS, and prove it?" — and its answer, rendered LIVE from `ENCORE_ITERATIONS` latest `passed` (when a passing receipt lands, the answer flips with zero code change). CTA back to the gallery: "Back to the gallery" → `/` (the live-demo band) + "Read the session log" → `docs/website-excellence-session.md`. A11y: the question is an `h2`; the answer is `role="status"` (announced on load flips only, never a loop); the CTA is a single clearly-labeled link.
### 5.8 Mobile — the 390px covenant, per band
390px: single-column stack; section padding drops to 48/16; the delta table and the axis strip are engineered to FIT at 390 (no horizontal scroll — `mobileOverflow` must be 0, so overflow is a layout defect, not a feature); the before/after slider is full-width; the 6-node stepper becomes a vertical step list; the Tools grid drops to 1-up. No band may produce `mobileOverflow > 0` at 390px.

## 6. The Test Plan

Colocated, green under `bun test src`; new test files/blocks only.
### 6.1 Lib suites (`src/lib/encore/*.test.ts`)
- `seed.test.ts` (THE DRIFT GATE) — one test per committed `critiques/*.json`: the seed constant equals the parsed receipt field-by-field (overall, every axis, every gate `value`/`pass`, `passed`); one test per `F_LEDGER` entry (code named in the round log); `DISCRIMINATION.separation === 4.9`. The check:benchmarks pattern: the test IS the gate catching a receipt edited under the seed.
- `stats.test.ts` — `axisDelta(b, b) === 0` per axis; `gatePasses(BASELINE) === 9` of 11 (the two fails: `fontSizes`, `offGridPct`); `calibrationSeparation() === 4.9`; the append-clean invariant (synthesize `iter1` @ 7.5: ordering + delta math stable, baseline untouched).
- `invariant.test.ts` — zero `Date.now()`/`Math.random()` in the lib domain files (the fugue pin); the seed constants byte-snapshot against their receipts.
- `format.test.ts` — `pct(32.7)` "32.7%", `score(6.4)` "6.40", `delta(-3.9)` "−3.90", `gateStatus` PASS/FAIL/UNDER, `axisLabel` names.
### 6.2 Component suites (`src/components/encore/__tests__/`)
- `encore.test.tsx` — each band renders its receipt numbers: the hero strip 6.40 + the 7 axis means; the baseline card 23 / 32.7% / 0 contrast / FAIL + the 11 gate chips; the Tools band 1.5 / 6.4 / 4.9; the F-ledger F10 + F11; the finale question + answer.
- `slider.test.tsx` — the `range` drives the clip; `aria-label="Reveal after"`; arrow keys step 10; the two honest `alt`s.
- `stepper.test.tsx` — the 6-node loop: `role="tablist"`, arrow nav, `aria-selected`, Home/End; the pair mini-stepper re-anchors slider + delta table.
- `reduced-motion.test.tsx` — under `prefers-reduced-motion: reduce` the hero strip renders the settled values immediately (the base-finished state, NOT a blank frame), the slider is still operable, no reveal animation runs.
### 6.3 The embed/reset handshake test
With `embed=true`, a `postMessage` of `{ source: "unown-landing", type: "encore-reset" }` from `window.origin` wipes to `makeInitialState()` (slider 0, stepper 0, pair baseline); a different origin is ignored; a wrong `type` is ignored. Pin the happy-dom quirk: `window.origin` is `null`, so a handler comparing `e.origin !== window.origin` against a `MessageEvent` with `origin: null` passes the origin check unexpectedly — log both origins in the test; the shape check (`source` + `type`) keeps a bare `null`-origin message out.
### 6.4 The gallery-entry test updates (≥ 8 apps now)
- `live-demo.test.tsx` — the count pin `toBeGreaterThanOrEqual(7)` → `…(8)`; add the `encore` per-app block (the nocturne shape): `resetType "encore-reset"`, `route "/encore"`, `url "unown-nine.vercel.app/encore?embed=1"`, `poster "/landing/encore/poster.png"`, `receiptDoc` the GitHub raw link to the round's session log; the per-app reset-handshake pin (`{ source: "unown-landing", type: "encore-reset" }`, origin NEVER `"*"`).
- `built-improved.test.tsx:106-108` — the hard pin `toBe(7)` MUST move to `toBe(8)` + the last-app identity pins move to Encore ("the eighth app"). This is the drift hazard: the suite goes red the moment the eighth entry lands and this is not updated. (The lede re-numbers itself via `ordinalOf(LIVE_DEMO_APPS.length)` — no manual edit there.)
- The poster test reads `public/landing/encore/poster.png` and asserts 2880×1800 IHDR dims — the PNG must exist on disk first (the media lane, §3.3).
### 6.5 Route/page tests (the sibling style)
`src/app/encore/__tests__/page.test.tsx` (the cadence shape): the route renders with `embed=false` by default; `?embed=1` is read server-side (the F3 pin — the flag reaches the client as a prop, no hydration mismatch); the layout's `robots` is noindex; the scoped `globals.css` is imported by the layout alone. The `next.config.ts` CSP test: `/encore/:path*` carries `frame-ancestors 'self'` + `X-Frame-Options SAMEORIGIN` (the sibling-route shape).
### 6.6 The landing scroll-budget check (the e2e twin is canonical)
`e2e/landing-budget.spec.ts`: `MAX_PAGE_VH = 15.5`, `MAX_WORDS = 3750`, `MAX_BAND_VH = 3` @ 1440×900. The eighth entry must not breach them: the gallery tabs are a fixed-height horizontal scroller (the entry grows the band's content, not its height); if the word count grows, compress the lede — NEVER delete a generated number.

## 7. The Build Phase Decomposition

plan → lib → ui → [critique loop] → embed/landing, each phase one session with its verification gate. The critique loop runs AFTER the UI, BEFORE the landing — the round's own CP3: "the critique loop between phases as the QA gate."
- **Phase 1 — Plan:** this document. Gate: §1.1 pins the receipt subset; §1.3 names every seed constant with provenance; all 8 sections present.
- **Phase 2 — Lib:** the §2 modules + `seed.test.ts` (the drift gate). Gate: `bun test src/lib/encore` green (the drift gate reads the real receipts and passes); `bun run typecheck` clean.
- **Phase 3 — UI:** `src/components/encore/` (`shell.tsx`, `primitives.tsx` — Kpi, gate chip, axis bar, F chip, receipt card; one `views/` file per band; the `range` slider + the `tablist` stepper; the §6.2/6.3 suites), `src/app/encore/` (page, layout, scoped `globals.css`), `public/encore/favicon.svg`, the before/after images staged under `public/landing/encore/` via the media lane. Gate: `bun test src/components/encore` green; `bun run typecheck` + `bun run lint` green.
- **Phase 4 — The critique loop (the QA gate):** run `scripts/design_critic.mjs` on `/encore` → a NEW iteration receipt lands in `critiques/` (label `iter1`); Encore's OWN gates are now measured — target `fontSizes ≤ 8`, `offGridPct ≤ 15`, `contrastViolations 0`, `mobileOverflow 0`, VLM axes climbing toward the 7.0 floor (the round's baseline was 6.40 — the flagship beats its own objective gates; the VLM floor is the program goal). A failed gate = fix in Phase 3, re-run. Then the seed gate re-runs: the new receipt = a new constant appended to `ENCORE_ITERATIONS` + one appended `seed.test.ts` test (the gate grows, it does not rot). Gate: the receipt committed; `bun test src/lib/encore` (updated) green; Encore's objective gates within the rubric.
- **Phase 5 — Embed/Landing (its own session, per the constraint):** the `next.config.ts` CSP block; the eighth `live-demo-data.ts` entry; the two test updates (§6.4); the poster via the media lane; the gallery copy re-numbers itself. Nothing else on the landing is touched. Gate: `bun test src` green (live-demo + built-improved at 8); `bun run check:changelog` + `check:benchmarks` + `check:claims` green; the scroll budget reconciled (compress, never delete).
- **Phase 6 — Closeout:** the critique loop on `/` (confirm Encore's presence did not regress the landing's own receipt — Encore is the flagship proof, not a new baseline for the landing); the F-ledger updated with this round's failures; `docs/website-excellence-session.md` gains the Encore checkpoint. Gate: `bun run typecheck` + `lint` + `bun test src` + the e2e budget twin all green.

## 8. The Risks List (11, with mitigations)
1. **The before/after slider's a11y (P1):** a mouse-only clip with no keyboard path is a defect. **Mitigation:** the slider IS a native `range` input (§5.4) — keyboard + SR by construction; `slider.test.tsx` pins the `aria-label`, the 10-step arrow keys, and the honest `alt`s.
2. **The receipt-schema drift (P0):** a receipt edited under the seed silently lies. **Mitigation:** the seed gate (`seed.test.ts`, §6.1) reads the actual committed JSONs and asserts field-by-field equality; `@provenance` comments name the file; a new receipt grows the gate, it does not rot it.
3. **The retro-font/Geist pairing friction the baseline critique flagged (P1):** a 9th face or size breaks the type census (≤8). **Mitigation:** the accent face is a style at an existing size, not a 9th distinct value (§4.1); the Phase-4 receipt must confirm `fontSizes ≤ 8` on Encore's own audit.
4. **The landing scroll-budget pressure when the eighth entry lands (P1):** `MAX_PAGE_VH`/`MAX_WORDS`/`MAX_BAND_VH` could breach. **Mitigation:** the tabs are a fixed-height scroller — the entry grows content, not height; word growth is settled by compressing the lede, NEVER by deleting a generated number (§6.6).
5. **The honesty risk — a number without a receipt (P0):** Encore is about the receipts. **Mitigation:** every rendered number is a seed constant with a `@provenance` + a `receiptPath` link (§1.3/§5.2); the drift gate ties the constant to the JSON; the F-ledger's `fixRef` is a link, not a claim.
6. **The `faint` token on a raised surface (P1):** `faint` (5.74:1 on canvas) may drop below 4.5 on `panel-2`. **Mitigation:** the named rule (§4.3) — on `panel-2` the text token is `dim`; the Phase-4 objective audit (`contrastViolations 0`) is the gate, not eyeballing.
7. **The happy-dom `window.origin === null` quirk in the reset test (P2):** the origin check passes unexpectedly. **Mitigation:** the listener checks shape (`source` + `type`) as well as origin (§6.3); the test pins the quirk with logged origins.
8. **The poster not existing on disk (P2):** the poster test reads IHDR dims; a missing PNG is a red suite. **Mitigation:** shot by `bun scripts/landing_demo_poster.mjs` before Phase 5's tests run (§3.3).
9. **The F3 hydration pin (React #418) regressing (P1):** a future session moves the `embed` read client-side. **Mitigation:** the explicit server-side read + prop pass (§3.1) and `page.test.tsx` (§6.5) assert no hydration mismatch.
10. **The append-clean invariant breaking on the Nth receipt (P2):** a new receipt re-sorts or re-counts the baseline. **Mitigation:** `ENCORE_ITERATIONS` is an explicit chronological array; `stats.test.ts` (§6.1) pins ordering + delta math under a synthesized `iter1`.
11. **The 390px covenant overflow (P1):** a wide element (the delta table, the axis strip) produces `mobileOverflow > 0`. **Mitigation:** every band is engineered for zero overflow at 390px (§5.8); the Phase-4 mobile audit is the gate — no band may need a horizontal scroll to read.

## Constraint Compliance
- **Zero `Date.now()`/`Math.random()` in `src/lib/encore/`** (the fugue determinism contract) — enforced by `invariant.test.ts`; the data is static receipt-derived constants.
- **No API routes; no client state beyond the documented interactions** — §3.5 states this explicitly; the reset wipes exactly three: slider position, loop step, iteration pair.
- **The landing scroll budget** — Encore's entry must not grow the landing beyond its ceilings (`e2e/landing-budget.spec.ts` is canonical, §6.6).
- **Every test file colocated (`*.test.ts`), green under `bun test src`.**
- **DO NOT edit:** `.unown/**`, any AGENTS.md, the landing bands other than the gallery data + gallery copy, the existing receipts. Phase 5 is its own session and implements the landing changes there.
- **The whole plan stays under 350 lines** (this document — §1 through §8 plus this compliance block).
