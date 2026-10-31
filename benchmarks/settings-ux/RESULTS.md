# Settings-UX benchmark results (benchmarks/settings-ux/RESULTS.md)

The Settings Evolution round's Phase-9 measurement lane. Methodology and
lane definitions: [README.md](README.md). This file records the BEFORE
receipts (the round-2 M2 baseline, run `receipts/run-2026-10-31T10-16-44`
on the v0.0.50 tree, stack up, Agnes via the bundled bridge) and — once
M3/M4 land — the AFTER run and the DELTA table. Every number below is read
from the committed receipts; nothing is asserted without one.

## BEFORE — the baseline (2026-10-31, run-2026-10-31T10-16-44)

| Lane | What it measures | BEFORE |
|---|---|---|
| **BM-1** first-configuration | the five-minute test (wizard → doctor → verified reply) | **PASS** — 5.7s total, 5 steps (3 wizard Enters + doctor + reply), well under the 300s criterion. Wizard's theme step still tells users "switch any time in-session: /settings" — **false since the override** (S2-1's most user-visible symptom, captured in `bm1-wizard-theme.pane.txt`) |
| **BM-2** find-and-change | reachable changes through the hub; S2-1 probes | **5/5 reachable** (mean 5.9s/task; every write verified on disk AND in the change ledger) · **6/6 probes unreachable** — theme, steering, follow-up, hide-thinking, Mermaid, tree-filter cannot be found on any `/settings` surface (search returns fuzzy false-positives like "Default model" for "theme" — not the setting; the audit's registry absence corroborates) |
| **BM-3** search success | intent-target hit-rate, top-3 | **8/12 (66.7%)** — 8/8 catalogued targets hit (ranks 1–3); the 4 misses are the known gaps: `theme`/`dark mode` (S2-1), `spend` (S2-11 — no spend meter exists), `memory health` (S2-4 — no health card exists) |
| **BM-4** depth + coverage | browse-only depth; registry coverage | **10/10 reached**, mean **9.6 Down-presses** to an item editor (max 13 — Advanced/Tools sit deepest); coverage: **10/89 registry items settable (11.2%)**, **32 pi-selector rows unreachable** (machine count, matches the S2 ledger) |
| **BM-5** recovery paths | undo/restore/reset reachability | **5/5** — change→Recently changed→revert round-trip restores the value on disk; diff shows a real drift; kill-switch and dream-rollback rows reachable; scoped reset writes a backup (`reset-…-1.json` on disk) |
| **BM-6** six questions | the mission questions from `/settings` alone | **6/6 covered** — every question's pinned anchors render on its section surface |
| **BM-7** trust gates | risk badges, typed confirmation, the ledger | **audit OK** (89 items, 24 high-risk, zero field gaps, every settable item names its persistence) · **gate full cycle** — the high-risk write shows the typed gate, a wrong phrase cancels with nothing written, "yes" writes and lands in the ledger |

### What the baseline says

The round-1 hub held its core promises: everything catalogued is findable,
changeable, ledgered and recoverable (BM-2/5/6/7 green), and the
five-minute test passes by a wide margin (BM-1). The failures are exactly
the S2 ledger's known debts, now **measured** rather than asserted:

1. **S2-1 is the dominant regression** — 32 pi settings unreachable, the
   wizard actively misdirecting users to `/settings` for theme switching,
   and 2 of the 4 search misses.
2. **The coverage number is brutal and honest** — 10 of 89 catalogued
   items are settable from the TUI (11.2%); the rest are views/env-only.
   M3's Interface group and M4's trust batch move this number.
3. **Browse depth averages ~10 Downs** — acceptable for the long tail,
   which is why the Search row is the primary find surface (BM-2's
   search-first path needed 0 Downs); M3's escape hatch must not regress
   it.

### AFTER targets (M3/M4 must beat these)

| Metric | BEFORE | AFTER target |
|---|---|---|
| BM-2 unreachable probes | 6/6 unreachable | **0/6 unreachable** (the Interface group makes them settable) |
| BM-3 hit-rate | 8/12 (66.7%) | **≥ 10/12** (theme/dark flip; spend flips if S2-11 lands in M4) |
| BM-4 settable coverage | 10/89 (11.2%) | **interface group + trust batch raise the settable count** |
| BM-1 wizard claim | tells users /settings switches theme | the claim becomes true (or the wizard stops making it) |
| BM-2/5/6/7 greens | green | stay green (no regression) |

## Runner-caught mistakes (recorded for honesty)

The first full run caught two benchmark-authoring bugs — both are the
suite working as designed (failures leave receipts, not silence):

1. **The toggle-marker bug** — the editor's selected row renders `→ Turn
   ON`; the first toggle tasks matched `startswith("Turn ON")` and never
   hit, recording honest failures (40 Downs, no save) before the fix.
   Receipts from the fixed re-run supersede; the failure panes are kept.
2. **The no-op drift** — BM-5's diff probe first set hook-depth to 3,
   which IS the default, so the diff correctly reported "No settings
   differ"; the task now sets 5. The `bm5-diff-error.pane.txt` exhibit is
   kept as the catch's record.

## Run index

- `receipts/run-2026-10-31T10-16-44/` — the BEFORE baseline (7 lanes, 7
  lane receipts + 11 bm2 task receipts + 12 bm3 query receipts + pane
  exhibits + `summary.json`).

## AFTER — the round-2 build (2026-10-31, receipts/run-after/)

The identical pinned workload on the post-M3/M4 tree (M3: the Interface
repair + S2-20/S2-21; M4 partial: S2-13 goal extras + S2-19 dashboard
lanes). The M4 remainder (S2-7/S2-8/S2-9, and S2-11/S2-4 which would flip
the last two search misses) stays open in the S2 ledger — the misses below
are honest, not hidden.

## The DELTA table (BEFORE → AFTER)

| Metric | BEFORE (run-2026-10-31T10-16-44) | AFTER (run-after) | DELTA |
|---|---|---|---|
| BM-1 five-minute test | PASS — 5.7s, 5 steps | PASS — 6.7s, 5 steps | holds; the wizard's "/settings switches theme" claim went true-but-false → **true-and-true** |
| BM-2 reachable changes | 5/5 (mean 5.9s, disk+ledger) | 5/5 (mean 5.9s) | no regression |
| BM-2 S2-1 probes | **6/6 unreachable-from-tui** | **6/6 reachable+changed** (settings.json + ledger verified; theme switched live) | **the regression is fixed, measured** |
| BM-3 search hit-rate | 8/12 (66.7%) | **10/12 (83.3%)** | theme + dark mode hit at rank 1; `spend` (S2-11) and `memory health` (S2-4) stay honest misses |
| BM-3 catalogued-target hits | 8/8 | 8/8 | no regression |
| BM-4 browse reachability | 10/10, mean 9.6 Downs | 10/10, mean 10.5 Downs | +0.9 Downs — the Interface menu row's honest price |
| BM-4 settable coverage | **10/89 (11.2%)** | **41/120 (34.2%)** | +23.0pp — 31 Interface items with real setters |
| BM-4 pi rows unreachable | **32** | **0** (35/35 hub-mirrored, machine-counted) | **S2-1 closed** |
| BM-5 recovery paths | 5/5 | 5/5 | no regression |
| BM-6 six questions | 6/6 | 6/6 | no regression |
| BM-7 registry audit | ok — 89 items, 24 high, 0 field gaps | ok — 120 items, 24 high, 0 field gaps | holds at the larger registry |
| BM-7 typed-confirmation gate | full cycle | full cycle | no regression |

### Reading the delta

The round's two headline debts are closed with receipts: the S2-1
unreachability (32 pi settings rows lost to the override — the wizard was
actively misdirecting users) is fixed end-to-end, and settable coverage
tripled. The costs are visible and small: browse depth +0.9 Downs (the
eleventh section row), BM-1 +1.0s (the wizard's theme step now describes
a real lane). The two remaining search misses trace to two ledger items
deliberately deferred (S2-11 spend meter, S2-4 memory health card) — they
flip in a future round that lands those items, and the pinned queries are
waiting for them.

### Run index (updated)

- `receipts/run-2026-10-31T10-16-44/` — the BEFORE baseline.
- `receipts/run-after-m3/` — the M3 verification snapshots (same lanes,
  post-Interface-repair tree).
- `receipts/run-after/` — **the AFTER run of record** for this DELTA
  table (the post-M4-partial tree).

## M6 — the Phase-10 minting + the phantom-drift find (2026-10-31, receipts/run-m6-minting/)

Minting the round's three author-catches as pinned tasks produced a fourth,
real product find. Full circle: the benchmark's own authoring failures
became guards, and building the guards caught a user-facing bug the whole
round had missed.

**The find (phantom drift):** the run-after `bm5-diff` pane showed 8 drift
rows on a home nobody touched. The registry's declared `default` fields for
the interface items had been written from the pi selector's row states, not
the vendored manager's resolved values — so `/settings diff` showed, on
EVERY fresh install, phantom rows for settings the user never changed:
TUI mode (`regular` vs the deliberate out-of-box `fullscreen` term.ts
writes), Mermaid (`final` vs `streaming`), image width (80 vs 60), editor
padding (2 vs 0), clear-on-shrink (on vs off), terminal progress (on vs
off), copy-on-select (off vs on — the very item that shipped the
missing-paren catch), fullscreen exit output (`resume-hint` vs
`transcript`). Fixed in registry.ts (all 8 defaults corrected, each with
its vendored provenance comment); pinned two ways:
`test/settings-defaults-drift.test.ts` (the unit pin — every defaulted
item's `get()` must equal its declared default on an out-of-the-box home;
runs in a subprocess because some getters resolve through term.ts's
module-scope UNOWN_HOME snapshot, and an in-process pin would read an
earlier suite file's leftovers) and BM-8's phantom-drift guard (the
pane-truth pin below).

**BM-8 — author-catch guards (the lane):** 4 guards, 4/4 green,
receipts `receipts/run-m6-minting/`:

| Guard | Pins | Receipt |
|---|---|---|
| phantom-drift | on a pristine doctor-seeded home `/settings diff` must say "No settings differ from their defaults." — any phantom row fails the guard with the pane as exhibit | `bm8-phantom-diff.pane.txt` (0 rows) |
| toggle-marker | the editor's selected row must render the `→` marker as pane-truth BEFORE matching (the first benchmark run matched `startswith("Turn ON")` and never hit); then the change lands on disk AND in the ledger | marker `→ Turn OFF` rendered; `fullscreenCopyOnSelect: false` on disk; ledger entry present |
| noop-drift | target = current+offset (never equal by construction — the BM-5 first-run catch set hook-depth to its own default 3 and the diff correctly said nothing); the diff must then name the drifted key | todo widget lines 12 → 14 on disk; the diff names "Todo widget lines" |
| registry-parse | the audit's import through the real module (the missing-paren catch's net) + `bisect-registry.mjs --selftest`: the span splitter must match the real module's item count, and a synthetic missing-paren drill must be diagnosed by the bisection | audit ok; 120 spans == 120 items; the drill named `agent.capabilities` in 8 probes (~1s) |

**The no-op load-time validation** (`bm8-noop-validation.json`): 5 task
diskChecks checked against the registry's declared defaults; 1 warning —
BM-2's own `hook-depth` task (expect 3 == declared default 3) is flagged
diff-inert. It stays a warning, not a failure: a write-path task may
legitimately target the default value; the flag exists so a diff-flavored
task can never again hide in the class (the BM-5 catch was exactly that
mislabeling).

`bisect-registry.mjs` (the missing-paren diagnosis tool, minted): the
catch shipped `},` where `}),` belonged; every parser pointed at the
array's `];` and a hand bisection found the item in seconds. The tool
automates the procedure — split the registry's section arrays into item
spans (paren-insensitive on purpose: the catch class leaves braces
balanced but parens unbalanced, which is exactly when the tool is needed),
binary-search by writing candidate files to a temp name in the registry's
own directory (the real file is never touched), name the minimal failing
item. `--selftest` runs the splitter pin plus the synthetic drill every
time so the tool cannot silently rot.

### Run index (updated 2)

- `receipts/run-2026-10-31T10-16-44/` — the BEFORE baseline.
- `receipts/run-after-m3/` — the M3 verification snapshots.
- `receipts/run-after/` — **the AFTER run of record** for the DELTA table.
- `receipts/run-m6-minting/` — the BM-8 author-catch guards (4/4) + the
  no-op validation + the audit/bisect selftest receipts.
