# Ostinato — app DOX (apps/ostinato/)

Landed from `AGENTS.draft.md` (authored by A2 ticket O-1, updated by the
operator at the round closeout 2026-11-04 per the instruction-set gate:
the draft-and-operator-land workflow; the in-session write gate is
final). Updated the same way at the R-1-e2e ticket close 2026-11-05:
A2's chunk-8 draft landed by the fifteenth lineage's operator, with the
gate's count corrections (Lane B 105 tests; the battery seven spec files /
17 tests (the 2026-11-10 re-measure; six/14 was the R-1 close) — the draft's "102"/"13 spec files" were mis-counts).

## Purpose

Ostinato is a **keyboard-first, offline-first, installable PWA for
spaced-repetition flashcards**, at `apps/ostinato/` (the second user
product under `apps/` after Coda — distinct job: decks of markdown
front/back cards scheduled by SM-2, driven entirely by the keyboard:
`j`/`k` browse, `1`–`4` grade, `/` search, `Ctrl+K` palette, `t` stats,
`d` deck settings
heatmap). Vanilla TypeScript, **zero runtime dependencies**:
`apps/ostinato/package.json` carries NO `dependencies`/`devDependencies`
fields (the Coda zero-dep law — the app's package.json is 7 lines: the
brace pair plus exactly five fields). The DOM-free domain core under
`src/domain/` (deck/card model, the SM-2 scheduler, import/export, and
`stats.ts`'s `reviewsPerDay` aggregation) sits under the UI shell
(`src/ui/`) and the persistence adapter (`src/storage/`).

## Ownership

- Owns: `apps/ostinato/**` — `index.html`, `public/`
  (manifest.webmanifest, offline.html, icon.svg), `sw.js` (app root,
  Coda contract: never under public/), `serve.mjs` (app root),
  `src/domain/`, `src/ui/`, `src/storage/`, `scripts/`
  (verify-precache.ts, capture-usage.mjs). No local `tsconfig.json` — the
  app's TypeScript rides the ROOT `tsconfig.json`'s include
  (`apps/ostinato/**/*.ts`), so root `bun run typecheck` is the app's
  typecheck gate.
- Does NOT own: root `bunfig.toml` (Lane B's happy-dom preload), the root
  `package.json`'s `ostinato:*` scripts (wired O-5), the CI `ostinato`
  job (`.github/workflows/ci.yml`, wired O-5), the benchmark lane
  `benchmarks/ostinato/` (operator-owned measurement surface; app tickets
  read RESULTS.md, never write it), the e2e specs at the repo root
  (`e2e/ostinato-*.spec.ts` + `playwright.ostinato.config.ts`), and the
  PRD/reliability matrix under `docs/` (operator lane).

## Local Contracts

- **Zero-dep law.** No dependency fields in `apps/ostinato/package.json`.
  Anything needed is vendored (Coda precedent: `public/vendor/*.mjs` +
  import map — nothing vendored to date; the app needs nothing). The CI
  `ostinato` job asserts the root lockfile hash is untouched by the app.
- **Domain purity (the Coda pair, Ostinato edition).**
  - `src/domain/boundary.test.ts` — the runtime import-graph check:
    every domain module imports only relative `./` (flat directory —
    `../` escapes and are rejected) or `bun:test`; nothing Node-specific,
    no DOM/Node globals (`DOM_GLOBS`). A breach fails the whole suite in
    both lanes.
  - **Lane A** — `cd apps/ostinato && bun test`: no `bunfig.toml` inside
    the app dir, so the root happy-dom preload does NOT apply;
    domain-purity is enforced against a genuinely DOM-free runtime.
  - **Lane B** — `bun test apps/ostinato` from the repo root: the root
    `bunfig.toml`'s preload IS active, so DOM-globally-dependent code
    would be MASKED — the compatibility form, not the purity enforcer.
  - **The DOM-guarded pin precedent (R-1-e2e):** a unit pin that
    exercises DOM-dependent UI code follows the e2e self-skip precedent
    into the unit lane — `src/ui/el.test.ts` registers ONE skipped stub
    when no DOM exists (Lane A, honest skip; the import of `app.ts` stays
    LAZY inside the else-branch, because app.ts's module bootstrap runs
    `main().catch(...)` on load and touches `document` at module scope)
    and RUNS the real pins where the DOM does (Lane B, via the root
    happy-dom preload). `src/ui/settings-modal.test.ts` (R-2) follows
    the same pattern for the settings modal's render + keyboard
    contract (app.ts exports `renderSettingsForm` +
    `handleSettingsFormEscape` + the AppState type as the pin seam).
- **The e2e battery** (O-4, +1 spec R-1-e2e, +1 spec R-2): isolated
  Playwright lane (`playwright.ostinato.config.ts` at the repo root,
  self-skip-guarded the Coda way — the root landing lane untouched by
  construction), seven spec files / 17 tests: the K-1 zero-mouse flow
  (create → review → export → import, keyboard events only), A-1 axe
  `wcag2a`/`wcag2aa` both schemes + the tab-order + Esc focus-return
  pins, O-1 offline (SW-controlled boot, offline reload, the fallback
  page), R-1 crash-resume + resize, the review trio,
  **`e2e/ostinato-stats.spec.ts`** (R-1: seeded reviews render the
  heatmap via both keyboard paths — the palette and the direct `t` —
  pinning the dialog focus-on-open, the summary line, the per-cell aria
  names, the Esc close lane with honest focus-return, and arrow-key cell
  navigation), and **`e2e/ostinato-settings.spec.ts`** (R-2: the deck
  settings modal end to end — the palette path AND the direct `d` key,
  a cap change reshaping the next session's queue 6→3 through the
  restart lane, the Esc-focus-return contract, and the axe-clean OPEN
  modal state; zero pointer events). 17 tests green at this closeout.
- **Domain model.** `OstinatoData` = plain JSON at every level (no class
  instances, no Date objects). Per-deck invariant (the Coda
  Board.taskOrder rule): a deck's `cardOrder` set-matches its cards
  exactly — no orphans, no missing entries, no duplicate ids (checked by
  `invariants.ts`'s `assertData`). Cards carry markdown `front`/`back`;
  SM-2 state rides per-card as the optional `sm2` field; the append-only
  `ReviewEvent` log (R-1) rides as `reviews` with its own invariant
  checks (unique ids, `cardId` resolves, `deckId` matches the card's own
  deck, grade 1..4, ISO strings).
- **Deck-level review settings (R-2).** `Deck.settings?: DeckSettings`
  (`newCardsPerSession?: number`, integer >= 0; absent = no cap,
  byte-identical to pre-R-2 behavior; 0 = hold all new cards) —
  validated at import (null/negative/fractional/non-number →
  `DomainInvariantError`), exported canonically only when present.
  `computeDueQueue` resolves per-deck caps AFTER the due filter: only
  NEW cards (no `sm2`) are sliced, in cardOrder order; due reviews are
  never capped; the D1 "nothing due → review all" fallback consults
  the PRE-CAP due set (capped-out new cards are never resurrected);
  the cap applies at queue-build time only (session boot/restart —
  grading never re-admits held-back cards). `setDeckSettings` is the
  domain mutation (null = DELETE the field — the byte-stability law).
  The `d` palette command (the 19th row) opens the settings modal —
  the create form's pattern reused exactly: `role=dialog` +
  `aria-modal` + a deck select (loads the selected deck's cap) + the
  cap input (empty submit = unset; invalid keeps the form open on the
  error lane) + the double-Esc discard guard + focus-in/focus-return +
  the zero-deck honest empty state; submit rides the same
  every-transition persistAll lane; the RUNNING queue is never
  rebuilt on submit.

- **The Scheduler seam.** Pure `(card, grade, now) → Card`; "now" is
  injected as an ISO-8601 string — the domain never calls `Date.now()`,
  so scheduling is deterministic and unit-pinnable. The implementation is
  the Wozniak 1990 SM-2 spacing family, cited not re-derived, pinned by
  its own tests.
- **The stats aggregation seam (R-1).** `src/domain/stats.ts`'s
  `reviewsPerDay(reviews, windowDays, today)` — pure, clock-injected
  (the "today" wall read happens at the UI edge, `app.ts`'s `appClock()`
  lane), aggregated over the last N day-keys; `src/domain/stats.test.ts`
  pins the window math, the date grammar, and the zero-count fill.
- **ImportExportPort.** `exportData` byte-stable across boots (matrix
  lane I-1 — canonical JSON, fixed key order, canonical separators),
  `importData` throws `DomainInvariantError` on any invariant breach.
- **Persistence.** localStorage + atomic writes behind the `StoragePort`
  seam (`src/storage/local-storage.ts`, outside the domain):
  temp-key-write + commit-key-swap; an interrupted save orphans the temp
  key that boot `recover()` discards. The UI persists on EVERY
  transition (the O-4 cure for B-3) — a killed mid-review session
  restores its queue and phase by construction.
- **PWA.** `sw.js` at the app root, cache `ostinato-v<N>`, the
  install-time precache of the enumerated runtime closure
  (`PRECACHE_LIST`, 19 entries), the offline fallback page,
  `clients.claim()`. The static derivation proof
  `scripts/verify-precache.ts` (the three-way disk ladder + honesty pins)
  gates drift between the list and the tree; the usage-capture lane
  `scripts/capture-usage.mjs` stills honest app states keyboard-only
  (the `public/landing/ostinato/` stills + PROVENANCE.md — the landing
  band's input).
- **The el() attribute-routing law (B-12's cure).** `app.ts`'s `el()`
  helper routes `tabindex` through the REAL-attribute branch
  (`setAttribute`) alongside `data-*`/`aria-*`: hyphenless does NOT mean
  reflected — the DOM reflection is camelCase `tabIndex`, so the
  property branch set a junk expando `e.tabindex` and the element was
  never focusable (the stats dialog's whole keyboard surface died
  silently; pinned by `src/ui/el.test.ts` + the stats spec's
  `toBeFocused()` regression pin).
- **Dev server.** `serve.mjs` at the app root, port `OSTINATO_PORT`
  default 4013: static files + on-the-fly `.ts` transpile
  (Bun.Transpiler "tsx"), the `.js`→`.ts` specifier swap for the compiled
  module graph, 127.0.0.1 only.

## Work Guidance

- New domain files must stay DOM-free: no `document.`/`window.`/
  `indexedDB`/`localStorage`/Node builtins — `boundary.test.ts` fails the
  suite on a breach.
- New model fields: plain JSON only; add the invariant to `assertData` in
  the same change.
- P1 backlog (post-freeze, per the PRD): **the stats heatmap LANDED
  (R-1 — P1 item 1 closed)**; remaining: deck-level review settings,
  CSV (Anki-style) import, in-app shortcut sheet (`?`). P2 deferred:
  accounts/cloud sync, sharing, sub-decks, cloze cards, spaced audio.

## Verification

- Lane A: `cd apps/ostinato && bun test` — 119 pass + 2 honest DOM-guard
  skips (the el pin's class) green, 0 fail (the 2026-11-10 end-user combo
  round re-measure; the standing R-2/R-1 rounds grew the battery past the
  101-test close).
- Lane B: `bun test apps/ostinato` — 121 tests green, 0 fail (the el
  pin's 4 real tests run here under the root happy-dom preload).
- App typecheck: the ROOT `bun run typecheck` (the root tsconfig's
  include covers `apps/ostinato/**/*.ts` — there is no local tsconfig).
- The e2e battery: `bunx playwright test
  --config=playwright.ostinato.config.ts` — six spec files / 14 tests,
  Chromium.
- The derivation proof: `bun apps/ostinato/scripts/verify-precache.ts` —
  19/0 PASS.
- The closeout receipts: `benchmarks/ostinato/RESULTS.md` +
  `receipts/run-20261104T181704Z/` (the fresh-clone re-run).

## Child DOX Index

- `src/domain/` (the flat directory: types.ts, ports.ts, invariants.ts,
  model.ts, ids.ts, scheduler.ts, storage.ts, io.ts,
  **stats.ts** (+ **stats.test.ts**) + their tests) — keep the directory
  flat (the boundary test's `../` escape-rejection assumes it).
