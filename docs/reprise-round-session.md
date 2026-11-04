# The Reprise round — session log

> **Status: OPEN 2026-11-05** — opened by the fourteenth lineage. The
> P1 continuation round of the Ostinato engagement: the hardening freeze
> held (12/12, committed re-run receipts), and the PRD's P1 backlog now
> ships through A2 tickets under the SAME freeze law — the battery stays
> green through every ticket, or the ticket is not done. The vehicle is
> the shipped app: **Ostinato**, the keyboard-first offline-first
> spaced-repetition flashcard PWA at `apps/ostinato/` (the round's
> namesake returns — a reprise). Planned by [the Ostinato
> PRD](ostinato-prd.md) (its P1 lane), the app contract owned by
> [`apps/ostinato/AGENTS.md`](../apps/ostinato/AGENTS.md), the benchmark
> suite at [benchmarks/ostinato/](../benchmarks/ostinato/README.md).

One-line purpose: the round's resumable checkpoint log — mission, operator
decisions, validation log, ticket queue, gate receipts.

**Mini-TOC**

- [Mission](#mission)
- [Operator decisions](#operator-decisions)
- [Environment checkpoint](#environment-checkpoint)
- [Validation log](#validation-log)
- [Ticket queue](#ticket-queue)
- [R-1 dispatch brief](#r-1-dispatch-brief)
- [Gate run](#gate-run)
- [Capability utilization report](#capability-utilization-report)
- [Resume instructions](#resume-instructions)
- [Related pages](#related-pages)

## Mission

The engagement directive stands (STABILISE A2 × HARDEN A2 × PROVE IT).
The Ostinato round proved the P0 thesis — the app exists, hardened,
receipted, shipped to the landing page. This round is the PRD's own P1
lane: **stats heatmap, deck-level review settings, CSV (Anki-style)
import, the in-app shortcut sheet (`?`)** — four user-facing features,
each shipping under the freeze law below. The round's success test is
unchanged from the parent engagement: every verifier external, A1 never
writes app code, every genuine failure feeds the failure→benchmark
reflex, and the shipped battery never regresses.

**The freeze law (inherited, load-bearing)**: every ticket's gate
includes the FULL e2e battery green (12 specs at open, growing as P1
features add their own), Lane A/B unit lanes green, app tsc 0, the
zero-dep law intact (lockfile-hash assert), and the
`verify-precache.ts` derivation proof PASS — the precache closure
grows with every new module, and the proof's drift line is the catcher
(the O-5 17→18 lesson). A ticket that breaks any of these is not done.

## Operator decisions

Dated 2026-11-05, this round-opening session:

- **Round = the PRD's P1 backlog, whole.** Scope: the four features as
  R-1..R-4 + the R-5 closeout. P2 stays explicitly deferred (accounts,
  cloud sync, sharing, sub-decks, cloze, audio) — no scope creep.
- **The schema-compat law**: R-1 adds the review-event log to
  `OstinatoData` — the import/export wire shape must stay backward
  compatible (a store without `reviews` imports clean; the canonical
  JSON export gains the field, byte-stable by the same canonicalization
  law). The import lane's round-trip pin extends to the new field.
- **Version-bump policy (inherited)**: Unown's `package.json` bumps only
  when Unown itself changes; app-round commits ride `## [Unreleased]`.
- **Pre-split pricing** (the amendment ledger, applied):
  schema-bearing authoring ≈ 6 chunks (R-1); plain authoring ≈ 4 (R-2,
  R-3 — R-3's parser table may price +1); the overlay class ≈ 2–3 (R-4);
  the closeout's landing-amendment class ≈ 7–8 (R-5 — the band's pinned
  battery figure grows with the new specs, so the drift-pin suite +
  `ostinato-data.ts` + a fresh committed re-run receipt are all in
  scope, the fourteenth-amendment precedent).
- **Queue discipline**: the standing items (S2-7/S2-8/S2-9, the
  S2-3/S2-16 L-pair, S2-22, the injection-scanner ML classifier, the
  delegation reuse axis, OB-7, the landing queue, the term.ts follow-up,
  the release-monitor routine's first weekly run 2026-11-08, the #30
  live-hang capture) stay queued in [SESSION.md](SESSION.md) — this
  round opens the P1 lane only; the next queue forms at the teardown.

## Environment checkpoint

The fourteenth lineage (this round's opening lineage), 2026-11-05:

- Fresh re-clone @ `a83336f4` = `origin/main` (the Ostinato round's
  close commit); the teardown-refresh commit `6688a9c0` (the ground
  truth + the capability matrix re-verified) pushed clean — no parallel
  incarnation this time.
- bun **1.4.3** project-local at `/home/z/my-project/.tools/bun-linux-x64`
  (re-downloaded — `.tools/` sits outside the recycle's kept set; the
  42 MB curl+unzip is the standing bring-up tax, V-2's survival claim
  falsified twice). **PATH-first resolution required** for the install
  gate: `resolveBun()` scans PATH before `process.execPath`.
- Install **7/7** (`UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1`), `.env`
  duplicate-free with the Agnes lane IN PLACE, stack up: bridge `:3031`
  upstream **200** with **9 agnes models** (the list grew from 6),
  engine `:3030` ready @ v0.0.56/`a83336f4` (fresh DB 0/0 — the known
  recycle limit), doctor "ready to chat" **20✓/2⚠** (model-spec +
  LSP, the honest first-session pair), smoke `UNOWN_OK` exit 0 direct.
- Pre-ticket baseline ALL GREEN at `a83336f4`: tsc 0 · lint 0
  errors/143 warnings · unit **2223/0** across 158 files (160.4 s) ·
  check:docs ok · rail **55 stops/535 entries/54 dated** · blog
  **46 posts/116 tags** · benchmarks 6/6 · claims **62/62**.
- Playwright note (the standing environment fact): the sandbox's
  ms-playwright cache ships `chromium-1200` only; playwright 1.64.1
  demands `chromium_headless_shell-1248` — `bunx playwright install
  chromium` is a required step before any e2e lane on a fresh lineage.

## Validation log

| # | Finding | Class | Disposition |
|---|---|---|---|
| V-1 | The round-opening receipts: the fourteenth lineage's bring-up + the teardown refresh landed clean (see the environment checkpoint + `A2_GROUND_TRUTH.md` §10, 2026-11-05) | receipt | The round opens on a green, receipted tree — the P1 lane's entry condition (the freeze held) is met by the committed re-run receipts `benchmarks/ostinato/receipts/run-20261104T181704Z/` |

## Ticket queue

| Ticket | Scope | Verifier (external, named) | State |
|---|---|---|---|
| R-1 | **The review log + stats heatmap**: the append-only `ReviewEvent` log added to `OstinatoData` (backward-compatible import — a store without `reviews` imports clean; the canonical JSON export gains the field), the pure per-day aggregation module (window + counts, injected clock), the stats surface with the heatmap render (keyboard-navigable, the design-token stylesheet) | Lane A/B unit pins (the aggregation windows/boundaries, the backward-compat import, the invariants — the cardOrder-style integrity law extended to the log); e2e: seeded reviews render the heatmap, the cells carry accessible names; the battery stays 12/12 | **OPEN** |
| R-2 | **Deck-level review settings**: an optional per-deck `settings` block (the new-cards-per-session cap first), the queue build resolving deck override > app default, the deck settings surface (the create-form's modal pattern reused) | Lane A/B unit pins (the override resolution, the queue slicing under a cap, the default-untouched path); e2e: setting a deck's cap changes the next session's queue, keyboard-driven | **OPEN** |
| R-3 | **CSV (Anki-style) import**: the pure CSV parser (front,back rows; RFC-4180 quoting; a quoted header row tolerated; per-row error collection, never a silent skip), the palette command + the file-picker lane (the JSON import's `filechooser` pattern), deck-target selection | Lane A/B unit pins (the parser table: plain/quoted/embedded-newline/embedded-quote/malformed-row cases + the error ledger); e2e: a keyboard-driven CSV import lands the cards, the JSON export byte-stable; the battery stays green | **OPEN** |
| R-4 | **The `?` shortcut sheet**: the 18th palette command + the overlay (the create-form's modal contract: `role=dialog` + `aria-modal` + Esc-close + focus return + attach-before-focus), the sheet's content derived from the palette's own command table (single source — no drift) | e2e: `?` opens the sheet, Esc closes + focus returns, the sheet's rows match the command table (a derived-content pin); axe clean on the open state; the battery stays green | **OPEN** |
| R-5 | **The closeout**: the battery figure refresh (12 specs → N, the fresh committed re-run receipt), the landing band's figure + drift-pin suite + `ostinato-data.ts` caveats moved together (the fourteenth-amendment precedent — scroll-budget re-measured ONLY if the band's text grows), `docs/ostinato.md` P1 sections, the README surface, the CHANGELOG entry + rail, the round's blog post, the graduation (SESSION.md rotation + the ground-truth teardown refresh + the matrix) | The full gate set + the fresh-clone re-run receipts under `benchmarks/ostinato/receipts/`; check:blog; the audit lane PASS | **OPEN** |

**EFFORT_BUDGET**: R-1 ≤6 chunks · R-2 ≤4 · R-3 ≤5 · R-4 ≤3 · R-5 ≤8 —
each chunk ≤8 turns (`--max-turns 8`), fresh session per ticket
(the standing economics), byte-exact continuation briefs on every
resume (V-17's law), the receipt-first law from chunk 1 (the
incremental-receipts lesson: the receipt exists and is maintained from
the FIRST chunk, not mid-ticket).

## R-1 dispatch brief

(The prompt-economy header, the O-1 pattern — the full brief is
authored at dispatch time from this skeleton.)

- **CWD**: `/home/z/my-project/Unown/apps/ostinato`
- **Contract**: read `AGENTS.md` (the app's DOX) + the PRD's P1 lane +
  `src/domain/types.ts` (the `OstinatoData` shape) BEFORE the first
  edit; the zero-dep law; the every-transition persistence law (the
  review log appends ride the SAME `persistAll` transition — B-3's
  lesson: a receipted-but-unwired rule is a defect).
- **Deliverables**: `src/domain/types.ts` (+`ReviewEvent`), the
  aggregation module (pure, injected clock), the UI surface, Lane A/B
  tests, the e2e spec extension.
- **Verifiers named above; the operator re-runs every lane at the gate.**

## Gate run

(The round's gate receipts land here per ticket. At open: the
fourteenth lineage's pre-ticket baseline — see the environment
checkpoint.)

## Capability utilization report

(The closeout's §7 report lands here at R-5.)

## Resume instructions

1. `export PATH=/home/z/my-project/.tools/bun-linux-x64:$PATH`
2. `cd /home/z/my-project/Unown` — verify the tree is at or past the
   round-opening commit; `git fetch origin --tags --prune` + ff-only
   pull if a parallel lineage moved `main`.
3. Stack: `bun run agent:start` (bridge :3031 + engine :3030; mortal
   across recycles); health: `curl -s localhost:3031/health`.
4. Doctor: `bun bin/unown doctor` — expect "ready to chat" (2 ⚠ honest).
5. Before any e2e lane: `bunx playwright install chromium` (the
   chromium-1248 environment fact).
6. Dispatch: the double-fork daemonizer pattern, log-file + exit-file
   receipts; **pin the session on every continuation** (`--session
   <id>` — V-12's law).
7. Pre-dispatch: the H-1 smoke canary (`UNOWN_OK`, exit 0).
8. This log owns the round state; `A2_GROUND_TRUTH.md` owns capability
   truth; [SESSION.md](SESSION.md) owns the index.

## Related pages

- [The Ostinato PRD](ostinato-prd.md) — the P1 lane this round ships
- [The Ostinato round log](ostinato-round-session.md) — the parent round
- [The app docs](ostinato.md) · [The app DOX](../apps/ostinato/AGENTS.md)
- [The benchmark suite](../benchmarks/ostinato/README.md)
- [SESSION.md](SESSION.md) — the running index
