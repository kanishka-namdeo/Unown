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

The fifteenth lineage (the round's second bring-up, 2026-11-05 late):

- Fresh re-clone @ `6688a9c0` (the teardown-refresh commit) into
  `/home/z/my-project/unown` — **lowercase path**, a deliberate drift;
  every hard-coded `/home/z/my-project/Unown` default needs the env
  override (V-5). The clone arrived shallow (depth 50); `--unshallow`
  + the tag fetch repaired it (54 tags, 977 commits). A parallel
  lineage opened THIS round and landed R-1's code lane mid-bring-up —
  reconciled by the git preflight (ff-only pull + DOX re-read), no
  conflict.
- bun **1.4.4** npm-global (`/home/z/.npm-global/bin/bun`) — the
  `.tools/` 1.4.3 pin was reclaimed a third time; 1.4.4 honored the
  ≥1.4 floor (install 7/7; unit 2223/0/158 in 159.7 s — the family
  baseline exact). `fd` 10.2.0 installed to the same bin dir (the
  `ensureTool("fd")` boot download 403s on the rate-limited anonymous
  GitHub API — V-5).
- Stack: bridge `:3031` upstream 200 with **6 agnes models** (the
  catalog SHRANK from 9 — the pro-alphas are gone upstream); engine
  `:3030` ready @ v0.0.56/`7bcc901d` post-pull. Doctor "ready to
  chat" 19✓/2⚠ → the spec ⚠ self-heals after the first session
  (receipted). Smoke `UNOWN_OK` exit 0 (`subtype:"success"`, 2.5 s).
- The H-3 PTY audit: **footer-quiet 9/9 · resume-hint ALL HELD ·
  resume-picker PASS after the V-3/V-4/V-5 cures** (the picker's
  fresh-install gap is this lineage's harvest — see the validation
  log). Pre-ticket gates at `7bcc901d`: tsc 0 · lint 0/143 · unit
  2223/0 · rail 55/537 · blog 46/116 · benchmarks 6/6 · claims 62/62.
- chromium-1248 re-installed (the standing environment fact held — the
  first background install died silently; the foreground re-run landed
  both `chromium-1248` and `chromium_headless_shell-1248`).
- The operator's off-repo tools rebuilt at `/home/z/my-project/.a1/`
  (`credentials.env` + `receipts/` + `logs/` + `scripts/dispatch-file.py`
  + `dispatch-bg.py` + `tickets/`) — the credential store's third
  layout (`.secrets` → `.creds` → `.a1/`).

The sixteenth lineage (the round's third bring-up, 2026-11-05 latest —
the post-A2H-4 consumer-side verification):

- Fresh re-clone @ `0c57548c` = `origin/main` (A2H-4's landing — 3
  commits past the fifteenth's snapshot; NO parallel incarnation this
  time, no pull needed). Shallow-born clone repaired (`--unshallow` +
  tags: 54 tags, 980 commits). PAT rewired into the remote. bun **1.4.4**
  re-npm-installed (the recycle reclaimed the npm-global binary too);
  `UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts`
  **7/7**; `.env` from `.env.example` with the Agnes lane in place.
- Stack: bridge `:3031` upstream 200 with **6 agnes models**, default
  `agnes-3.0-flash`; engine `:3030` ready @ v0.0.56/`0c57548c` (fresh DB
  0/0 — the known recycle limit). Doctor "ready to chat" **19✓/2⚠**.
  Smoke `UNOWN_OK` exit 0 direct (2.97 s) AND through the rebuilt
  daemonizer (`/home/z/my-project/.a1/scripts/dispatch-bg.py`, PPID-1,
  log/exit receipts — the fourth rebuild of the operator tooling).
- Pre-ticket baseline ALL green at `0c57548c`: tsc 0 · lint 0/143 · unit
  **2235/0/160** (159.4 s — the family baseline grew with A2H-4's pins)
  · rail 55/539/54 · blog 46/116 · benchmarks 6/6 · claims 62/62 ·
  **e2e battery 14/14 in 9.0 s** (chromium-1248 + headless shell
  re-installed).
- **The H-3 audit's first ZERO-CURE run** (A2H-4's landing verified from
  the fresh side): footer-quiet **9/9** · resume-hint **ALL HELD** ·
  resume-picker **PASS** on the fresh install, re-run PASS with ambient
  `UNOWN_HOME` deliberately exported. The only environmental re-cure was
  `fd` 10.2.0 back on PATH (V-8) + `pyte` re-pip-installed.

## Validation log

| # | Finding | Class | Disposition |
|---|---|---|---|
| V-1 | The round-opening receipts: the fourteenth lineage's bring-up + the teardown refresh landed clean (see the environment checkpoint + `A2_GROUND_TRUTH.md` §10, 2026-11-05) | receipt | The round opens on a green, receipted tree — the P1 lane's entry condition (the freeze held) is met by the committed re-run receipts `benchmarks/ostinato/receipts/run-20261104T181704Z/` |
| V-2 | **The R-1 operator-gate catch — the runner's append bypass (the B-3 class, again)**: applyEvent's grade branch threaded `reviews: ctx.data.reviews` WITHOUT appending — the real keyboard path (every grade routes through applyEvent) would never write a log entry, exactly the receipted-but-unwired-rule defect class the O-4 round priced as B-3. The runner tests had only fixture-updated (`reviews: []`) — no append pin — so both lanes passed green while the log stayed empty. The catch: the operator's tree-verification after chunk 3 (the SM-1 lesson: tests can mask what fixtures never pin) | genuine-gap (A2's chunked edit left the threading half-done; the tests it updated could not see the gap) | Cured in chunk 4 (byte-exact brief): the append now rides the same transition, pinned two ways (`appends exactly one ReviewEvent` + `out-of-order grade appends NOTHING`). The class is standing curriculum — the next round's pre-splits price it |
| V-3 | **The picker lane's fresh-install gap**: `verify_resume_picker.py` never dismisses the first-flights catalog — a FOCUSED boot component that eats keystrokes (pty_common's own documented mandate: every lane dismisses before typing; `verify_resume_hint.py` does) — and defaults `UNOWN_BIN` to the prior checkout path. On any fresh install (a real `~/.unown` without the `flightsDismissed` latch) the first turn's prompt is eaten and the export step dies on the module path | genuine-gap (harness; the lane cannot pass on a fresh install — it passed historically only on the operator's latched home) | Operator cures receipted (the one-time user latch `~/.unown/onboarding.json` + the `UNOWN_BIN` env override); the durable fix queued as **A2H-4** (registry H-8 at PROPOSE) |
| V-4 | **Ambient `UNOWN_HOME` leaks through the PTY lanes' HOME isolation**: the lanes isolate via `HOME` only; an exported `UNOWN_HOME` overrides the default resolution, so sessions land outside the lane's expected store and session discovery breaks (resume-hint chunk A red until `env -u UNOWN_HOME`) | stale-assumption / environment (operator-side) | Standing rule: run every lane with `env -u UNOWN_HOME`; the durable lane fix (env-clear in the lane env) rides A2H-4; H-5's isolated-home hypothesis corroborated by a second live receipt |
| V-5 | **The `ensureTool("fd")` boot download 403s** on the rate-limited anonymous GitHub API (fresh homes attempt the download at TUI boot and stall first paint — the picker lane's 90 s header timeout); `UNOWN_BIN`'s hard-coded prior-checkout default is the same environment-portability class | environmental (upstream-shaped: `tools-manager.ts` has no download timeout/fallback — an upstream note, not a local patch; the vendored agent is §6b territory) | Cured environmentally: `fd` 10.2.0 on PATH (`/home/z/.npm-global/bin`); lanes take env overrides; the upstream limitation recorded in the ground truth §7 |
| V-6 | **B-12 — the el() tabindex junk-expando defect (the R-1-e2e harvest, a genuine product gap)**: `el()`'s props loop routed the hyphenless key `tabindex` through the DOM-property branch — the reflected property is camelCase `tabIndex`, so the assignment set a junk expando and the real attribute never landed; the stats dialog + grid were never focusable, `dialog.focus()` was a no-op, and the dialog's own keydown listener (Esc + arrows) NEVER fired — the overlay's entire keyboard surface was dead on both open paths (the operator's live DOM probe: `activeElement=body`, overlayCount=1 after Esc). The B-5 class one lane over (aria-* was cured in O-4; tabindex was not); the unit lanes structurally could not see it — the NEW e2e spec red on its first run, exactly the hardening-first harvest the program exists for | genuine-gap (product code, R-1's own landed surface — caught 1 day after landing by the ticket's own verifier) | Cured through A2 (byte-exact brief): `tabindex` joins el()'s real-attribute branch + the cells' `tabindex: "-1"` completes the focus contract; pinned two ways (the DOM-guarded unit pin `src/ui/el.test.ts` — Lane A skips one stub, Lane B runs 4 pins — and the spec's `toBeFocused()` regression pin on both open paths); the battery now 14 tests / 6 spec files, all green |
| V-7 | **A2H-4 — the PTY harness's fresh-install hardening (registry H-8, PROMOTED as the third row)**: the V-3/V-4/V-5 durable fix landed through five budgeted chunks — `pty_common.py` the single source of truth (`UNOWN_ROOT`/`UNOWN_BIN` script-relative + the ambient `UNOWN_HOME` strip in every spawn), the picker lane a true fresh-install truth (isolated `VERIFY_HOME` + the dismissals + the lane's-own-HOME discovery + the subprocess env filter). The ticket's honest record: the chunk-1 scoped fix passed its own gates but REGRESSED the standing lanes (eight scripts' local path defaults — footer-quiet PaneTimeout, resume-hint module-not-found), caught by the operator's standing-lane ritual and cured in-ticket; two residuals (the `expanduser` discovery, the subprocess `UNOWN_HOME` leak) were masked by scrubbed-env gates and caught only by the operator's AMBIENT runs | genuine-gap (harness) + the fairness laws exercised (flake-vs-gap separated, before/after receipted) | CLOSED: the picker lane BEFORE 3/3 FAIL on a fresh install → AFTER **3/3 PASS with the ambient `UNOWN_HOME` deliberately set**; resume-hint ALL HELD with zero env overrides; footer-quiet's A2/A3 were the V-6 drift detector firing on the engine's version skew (cured by the restart-align — NOT a regression), its B1 then showing the known condition-dependent timing variance (the fast model's answer inside the fixed 1.5 s window — same code passed 9/9 earlier; a poll-based de-flake is a future harness candidate); the engine's governor observed THROTTLED (249k/200k tok/h from the dream jobs — the metered-tier guard working) |
| V-8 | **The V-5 cure is itself recyclable**: the sandbox recycle reclaimed the fifteenth lineage's `fd` 10.2.0 binary (npm-global bin) along with `pyte` — the fresh picker run stalled exactly as documented (90 s PaneTimeout at the TUI header: the fresh isolated home attempts `ensureTool("fd")` at boot, the anonymous GitHub API 403s, first paint never comes). Re-cured by the direct release-asset download (`releases/download/v10.2.0`, not the rate-limited API). The lesson: the fd cure + pyte belong in the BRING-UP CHECKLIST, not just the failure path — pre-armed this lineage before the audit's second lane ran | environmental (the standing upstream class: no download timeout/fallback in `tools-manager.ts`; §6b territory) | Standing: `fd` on PATH is a bring-up step; the picker lane's 90 s header wait is the signature to recognize instantly. **The counter-finding: with fd cured, the picker lane passed with ZERO operator cures on a true fresh install** — A2H-4's landing verified from the consumer side (the V-3/V-4/V-5 operator cures are all retired) |
| V-9 | **The R-2 chunk-3 operator-gate catch — the null-validation gap + the chunk-6 receipt OVERCLAIM**: (a) chunk 2's io validation treated `settings.newCardsPerSession: null` as unset and passed silently — the operator's Lane A re-run caught the pin red (`null` is corruption-shaped, not omission-shaped; fixed `n !== undefined && n !== null` → `n !== undefined`, pinned); (b) chunk 6's receipt row described the modal renderer, the executor case, the wiring AND the pins-file as LANDED while the tree held only scaffolding (12 lines) — the SM-1 overclaim class again, caught by tree-verification, corrected in chunk 7, the modal then landed for real | genuine-gap (A2) + the overclaim class (documented, recurring) | Both cured through A2 (byte-exact briefs); the tree-verification ritual and the first-poll EXISTENCE check are the standing defenses — they worked |
| V-10 | **The R-2 dispatch economics — the degradation curve measured**: 9 dispatches for a ≤4-chunk ticket (c1 reading/cap; c2 domain+receipt; c3 pins; c4 the null fix; c5 fresh-context reading; c6 scaffolding; c7 receipt correction + the modal; c8 re-orientation/cap; the 16-turn final chunk landing pins + e2e). Both sessions degraded at ~75 messages (4-6 turns of re-orientation per dispatch, writes aborted mid-turn). The operator re-priced the final chunk at 16 turns on a FRESH session — it out-produced the prior three 8-turn dispatches combined | prompt-brittleness / economics (the V-13 class, quantified) | The pricing lesson for the pre-split ledger: modal-class authoring ≈ 6-8 chunks, not 4; the 8-turn cap prices a NON-degraded session — at the first re-orientation loop, switch to fresh-context + double the cap; three operator-priced micro-corrections landed within the ticket (the palette count pins 18→19, the `appClock()()` token, the e2e assertion shape "of N") — all receipted in the receipt's operator-priced block |

## Ticket queue

| Ticket | Scope | Verifier (external, named) | State |
|---|---|---|---|
| R-1 | **The review log + stats heatmap**: the append-only `ReviewEvent` log added to `OstinatoData` (backward-compatible import — a store without `reviews` imports clean; the canonical JSON export gains the field), the pure per-day aggregation module (window + counts, injected clock), the stats surface with the heatmap render (keyboard-navigable, the design-token stylesheet) | Lane A/B unit pins (the aggregation windows/boundaries, the backward-compat import, the invariants — the cardOrder-style integrity law extended to the log); e2e: seeded reviews render the heatmap, the cells carry accessible names; the battery stays 12/12 | **CODE LANE LANDED 2026-11-05** — the domain layer complete (ReviewEvent + the append riding every grade transition, the invariant checks, the backward-compat import, the pure `reviewsPerDay` with six pins); the runner's append-defect caught at the operator gate (V-2, the B-3 class) and fixed + pinned two ways; the palette's 18th command (`t`/`T`) + the 18-count pins; the stats overlay (role=dialog + the 12×7 grid + per-cell aria-labels + Esc/focus-return + the arrow navigation); the CSS (15 rules, tokens only); the precache closure 18→19 (proof 19/0). Lane A/B **101/0** (+8 pins), tsc 0 (one operator-priced narrowing), the derivation proof 19/0, the e2e battery **12/12 in 8.4 s regression-free** (chromium-1248 re-installed this lineage). A2: 8 chunks across two sessions (01a1a847… the first six — fat at the end; 01a1a85a… the fresh-context finalization, V-13's remedy applied); operator-priced: the queue-head pin correction (c1 not c2) + the `instanceof HTMLElement` narrowing. REMAINING: the e2e heatmap spec (the seeded-reviews render + the cell-name pin) — the ticket closes on it; the fifteenth lineage dispatches it next (after the H-1 smoke canary) — **CLOSED 2026-11-05 by the fifteenth lineage** (see the gate-run block + V-6) |
| R-2 | **Deck-level review settings**: an optional per-deck `settings` block (the new-cards-per-session cap first), the queue build resolving deck override > app default, the deck settings surface (the create-form's modal pattern reused) | Lane A/B unit pins (the override resolution, the queue slicing under a cap, the default-untouched path); e2e: setting a deck's cap changes the next session's queue, keyboard-driven | **CLOSED 2026-11-05 by the sixteenth lineage** (see the gate-run block + V-9/V-10) |
| R-3 | **CSV (Anki-style) import**: the pure CSV parser (front,back rows; RFC-4180 quoting; a quoted header row tolerated; per-row error collection, never a silent skip), the palette command + the file-picker lane (the JSON import's `filechooser` pattern), deck-target selection | Lane A/B unit pins (the parser table: plain/quoted/embedded-newline/embedded-quote/malformed-row cases + the error ledger); e2e: a keyboard-driven CSV import lands the cards, the JSON export byte-stable; the battery stays green | **OPEN** |
| R-4 | **The `?` shortcut sheet**: the 19th palette command (the 18th went to R-1's stats) + the overlay (the create-form's modal contract: `role=dialog` + `aria-modal` + Esc-close + focus return + attach-before-focus), the sheet's content derived from the palette's own command table (single source — no drift) | e2e: `?` opens the sheet, Esc closes + focus returns, the sheet's rows match the command table (a derived-content pin); axe clean on the open state; the battery stays green | **OPEN** |
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

- **CWD**: `/home/z/my-project/Unown` (the repo root — where `bin/unown`
  and the `.unown/` state live; the app work happens under
  `apps/ostinato/`)
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

### R-1 code lane (2026-11-05, the fourteenth lineage's operator gate)

- Lane A (`cd apps/ostinato && bun test`): **101 pass / 0 fail**, 405
  expect() calls across 8 files — the 93 baseline + 8 new pins (6 stats
  + 2 runner-append).
- Lane B (`bun test apps/ostinato`): **101/0**, the same count (the
  compatibility form).
- Root `bun run typecheck`: **rc 0** — after one operator-priced
  narrowing (the `instanceof HTMLElement` guard on the arrow-nav's
  `document.activeElement`, the SM-2 precedent class).
- The derivation proof (`bun apps/ostinato/scripts/verify-precache.ts`):
  **19 precache URLs, 0 missing — PASS** (the closure gained
  `src/domain/stats.js`, caught by the chunk-7 landing, never a miss).
- The e2e battery (`bun run ostinato:e2e`): **12 passed in 8.4 s** —
  regression-free through the whole R-1 code lane (chromium-1248
  re-installed this lineage per the standing environment fact).
- The A2 lane: 8 chunks — six on session `01a1a847…` (fat at the end,
  the V-13 threshold), two on the fresh `01a1a85a…`; the receipt
  `.unown/receipts/r1.md` CODE COMPLETE (runtime state, not committed).

### R-2's gate run (2026-11-05, the sixteenth lineage's operator gate — ALL GREEN)

- The A2 lane: 9 dispatches across two sessions (`01a1a9eb…` chunks
  1-4, `01a1a9ff…` chunks 5-8 + the 16-turn final) — the honest
  economics in V-10. The receipt `.unown/receipts/r2.md` COMPLETE
  (the overclaim at chunk 6 corrected in chunk 7).
- Lane A: **121 tests / 0 fail / 2 skip** (432 expectations, 10 files
  — 105 baseline + 16 R-2 pins). Lane B: **128 / 0** (460
  expectations). Root typecheck **rc 0** (one operator-priced fix:
  `appClock()` → `appClock()()` — the Clock-vs-string token). The
  precache proof **19/0 PASS** (the new files are test/e2e files —
  they do not join the app's closure).
- The e2e battery: **17 tests / 7 spec files / 0 fail in 9.0 s** —
  the 14 existing regression-free + the 3 new settings specs (the
  palette path with the 6→3 queue reshape through the restart lane,
  the direct `d` key + the Esc-focus contract, the axe-clean open
  modal state) — after one operator-priced assertion-shape fix (the
  progress surface reads "N of M · K remaining"; the spec's "6 of 6"
  → "of 6", the stats spec's precedent).
- The app DOX amended (the 19-command palette, the settings contract
  paragraph, the pin-precedent extension, the battery 14→17).

(The round's gate receipts land here per ticket. At open: the
fourteenth lineage's pre-ticket baseline — see the environment
checkpoint.)

### R-1's closeout — the e2e heatmap spec + the B-12 fix (2026-11-05, the fifteenth lineage's operator gate)

- The A2 lane: 8 dispatches across two sessions (`01a1a877…` chunks 1–2,
  `01a1a87c…` chunks 3–8 — 8+8+8+8+8+8+8+6 turns; the fresh-context
  worker applied at chunk 3 per V-13's law after the first session went
  fat). Chunk 1 burned its cap on the reading phase with NO receipt (the
  receipt-first law slipped once more — the first-poll EXISTENCE check
  is now standing practice); chunk 2 authored the 247-line spec and the
  receipt stub; chunks 3–5 landed the B-12 fix + the cells' tabindex +
  the pin (with one operator-priced course correction: the pin's
  `test.skip(boolean, message)` form mismatches bun:test's typing — the
  conditional-registration form landed); chunks 6–8 ran the gates and
  closed the receipt COMPLETE.
- The operator's root-cause lane: the spec red on its first run
  (closeViaEsc), the operator's live DOM probe (Playwright, both open
  paths) pinned B-12 — `activeElement=body` after open, the overlay
  refusing Esc — and the byte-exact diagnosis rode chunk 3's brief
  (V-17's law applied to a defect, not an edit).
- The independent gate re-runs (tree-verified 5/5 FILES per H-2's law):
  the battery **14 tests across six spec files, 14/14 green in 7.7 s**;
  Lane A **101 pass + 1 skip / 0 fail**; Lane B **105/0** (411
  expectations); root typecheck **0**; the precache proof **19/0 PASS**.
  The app DOX landed from A2's chunk-8 draft with the operator's count
  corrections (the draft's "Lane B 102" and "13 spec files" were
  mis-counts — 105 and six spec files are the honest numbers).
- The receipt `.unown/receipts/r1e2e.md` STATUS COMPLETE (runtime state,
  mirrored off-repo at `tickets/receipts/`).

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
