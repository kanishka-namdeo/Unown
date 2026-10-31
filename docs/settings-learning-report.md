# The Settings round's learning report — the five mechanisms, validated on the round's own minting work

> The Phase-10 deliverable for round 2 of the Settings Evolution mission:
> did Unown's learning machinery actually identify weaknesses, learn from
> failures, and retain the improvements while this round ran? Every claim
> below cites a receipt from THIS round (the receipts live in the engine's
> DB, the benchmark suite's run dirs, and git); null results are kept as
> findings.

- [The five mechanisms, one-line verdicts](#the-five-mechanisms-one-line-verdicts)
- [1 — Tiered memory](#1--tiered-memory)
- [2 — The self-improving harness](#2--the-self-improving-harness)
- [3 — Task minting](#3--task-minting)
- [4 — AutoDream](#4--autodream)
- [5 — Agent skill generation](#5--agent-skill-generation)
- [The round's three product finds](#the-rounds-three-product-finds)
- [Failures and honest nulls](#failures-and-honest-nulls)
- [What was NOT validated](#what-was-not-validated)

Related: [the round's session log](settings-evolution-session.md) (M6, the
checkpoint trail) · [the suite's RESULTS](../benchmarks/settings-ux/RESULTS.md)
(BM-8, the guards) · [the round-1 precedent](unown-learning-report.md).

## The five mechanisms, one-line verdicts

| # | Mechanism | Verdict | The receipt that proves it |
|---|---|---|---|
| 1 | Tiered memory | **Validated** — the dogfood project's memory carried the round's learnings to v4 and the dream's render pruned responsibly | dream `project-e02884a0` (4 notes in, 2 entries added, 1 pruned); project.md re-render "110/112 · 2 oldest pruned at render (cap 110; hard-won rules immune)" |
| 2 | Self-improving harness | **Honest quiet** — 15 cycles, all `already-passing`; zero improvement patches this round; the round's real fixes came from the operator lane | `/api/cycles`: 15 × "already-passing baseline passed — no improvement needed" |
| 3 | Task minting | **Validated, operator-side** — the round's three author-catches minted as the BM-8 guard lane; the engine mint: honest skip (no failed runs to mine) | BM-8 4/4 guards, receipts `run-m6-minting/`; `runMintJob`'s "no unmined failed runs and the suite is not saturated — nothing to mint" |
| 4 | AutoDream | **Validated, twice over** — the engine's autonomous loop dreamed all round (engine-scope memory v22 → v27), and the round's own notes were consolidated the moment they were posted | engine dreams v22–v27 (the suite-run notes); the trigger → `a0d7e76c` + `project-e02884a0` at 13:55–13:57Z |
| 5 | Agent skill generation | **Validated — the full lifecycle in one round** | `pin-settings-defaults`: dream-minted → staged → operator-verified → promoted through the product's own inbox, ledgered `"via": "/settings staged-skills inbox"` |

## 1 — Tiered memory

**What the round asked of memory.** The dogfood project (this repo) entered
the round with project memory at v3 (the render the keyboard round's
commits carried). The round posted four terminal notes (the phantom-drift
find, the three-catches minting, the receipts-before-claims discipline, the
sandbox environment lesson) via the engine's documented ingestion lane
(`POST /api/notes {content, project_path}`).

**What the dream did with them** (dream `project-e02884a0`, 2026-10-31
13:57Z): 4 notes in, 2 entries added, 1 pruned — the project memory moved
v3 → v4, and the re-render's footer is the honesty receipt:
"rendered 110/112 memories via Mem0 (backend: lexical) · 2 oldest pruned
at render (cap 110; **hard-won rules immune**)". The new entries are real
distillations, not echoes — e.g. the extracted rule of thumb: "a declared
default is a contract against the real resolver; always pin it in a test or
it will drift", and the bisect procedure verbatim enough to re-derive the
tool.

**The cap behaved as designed**: the render pruned the 2 oldest entries
(the predecessor environment's stalest facts) while the render's immunity
clause held the "Manual notes" lane and the hard-won rules (the Parley
scrypt fact survived another re-render — restored by hand 2026-10-29 after
two erasures, now carried by every render since).

## 2 — The self-improving harness

**The honest quiet, receipted.** The engine ran its regression suite all
round; `/api/cycles` shows 15 cycles, every one
"already-passing baseline passed — no improvement needed" and zero
improvement rows. The harness did not manufacture improvements from a
passing suite — the same discipline round 1 recorded. The suite's own runs
(all six tasks passing, the minted-task cap untouched) are why: the
harness's real gap appears only when a run fails, and this round's runs
did not.

**Where the round's real fixes came from instead:** the operator lane —
the three product finds below were caught by building the Phase-10
artifacts, fixed by hand, and pinned by tests. That is the honest split:
the harness improves the ENGINE's agent; the operator's improvement loop
is the benchmark suite, and this round it caught three product defects the
engine's own runs never would have (they are UI-contract bugs, not
agent-competence bugs).

## 3 — Task minting

**The operator-side minting (BM-8).** The round's three authoring failures
became the suite's fourth lane — one guard per catch, plus the guard the
minting work itself produced:

| The catch (round 2, M2/M3) | The minted guard (M6) |
|---|---|
| the toggle-marker bug — the driver matched `startswith("Turn ON")` and never hit the selected row's `→` marker | the toggle-marker guard: the `→` marker asserted as pane-truth BEFORE matching; a change driven through it, disk + ledger verified |
| the no-op drift — BM-5's probe set hook-depth to 3, which IS the default, so the diff correctly said nothing | the noop-drift guard: target = current+offset (never equal by construction); the diff must then name the drifted key; plus a load-time validation flagging every task whose `diskCheck.expect` equals the item's declared default (BM-2's own hook-depth task is flagged — honestly kept as a warning, not a failure) |
| the missing paren — `},` where `}),` belonged; every parser pointed at the array's `];` | `bisect-registry.mjs`: the span splitter (paren-insensitive on purpose — the catch class is exactly the one that breaks paren-aware scanning), the binary search over candidate temp files, the selftest that drills a synthetic catch every run (named `agent.capabilities` in 8 probes, ~1s) |

**The engine-side minting: an honest skip.** `runMintJob` had no unmined
failed runs and the suite is not at its active-minted cap but not
saturated-passing either — the job's answer was "nothing to mint". No
engine task was minted this round; recording that as the null it is.

## 4 — AutoDream

**The engine's autonomous loop, all round.** While the round worked, the
engine dreamed the suite-run notes into the engine-scope project's memory
(v22 → v27 across the round's sessions — the mapLimit/dropRight/CSV/FizzBuzz
learnings the suite's tasks keep re-teaching). No operator intervention: the
router's dream-check job fired, consumed, rendered.

**The round's own dream (the manual trigger, mirroring the auto-dream job
exactly).** Four notes posted; `POST /api/dreams/run` with
`pendingNotes: 8`; the engine dream took the 4 benchmark notes
(`a0d7e76c` → engine memory v27) and `runProjectDream()` consolidated the
4 terminal notes into the dogfood project (`project-e02884a0` → v4). The
whole path is receipted in `/api/dreams` and the memory-version chain.

**The review-mode gate held — and gated us.** The first trigger run
skipped the project lane: a parked dream existed for the project from an
earlier session, and the gate is UNCONDITIONAL on pending existence. The
operator's resolution was to approve/discard through the product's own
inbox (`/settings` → Learning), after which the project dreamed. The gate
worked as designed: a parked dream is a review the user owes, and turning
review mode off does not auto-ship what was parked.

## 5 — Agent skill generation

**The full lifecycle, one round, every step receipted:**

1. **Minted by the dream**: the project dream (the same
   `project-e02884a0` consolidation) minted `pin-settings-defaults` into
   `.unown/skills-staged/` — a real procedure distilled from the round's
   notes ("use when adding or changing declared settings defaults …
   pin in a subprocess test").
2. **Staged, inert by design**: staged skills never auto-load; the inbox
   exists precisely so a human decides.
3. **Operator-verified**: the skill's claims were checked against this
   round's receipts — every one of them true (the subprocess pin exists
   and passes; BM-8's phantom-drift guard reports 0 rows; the provenance
   comments are in the registry).
4. **Promoted through the product's own UI**: the drive opened the hub →
   Learning → Staged skills inbox, and the promotion landed on disk AND
   in the change ledger — `{"actor":"user","itemId":"learning.skills-staged",
   "before":"staged","after":"promoted","via":"/settings staged-skills inbox"}`.
   The earlier round's staged skill (`add-new-subproject-skeleton`) was
   Skipped in the same inbox session: its promotion is that round's
   operator call, not this round's.

## The round's three product finds

All three were found by building the Phase-10 artifacts; none were on the
S2 ledger; each shipped with its fix and its pin in the same M6 commit:

1. **Phantom drift (8 interface items)** — the registry's declared
   `default` fields were written from the pi selector's row states, not
   the vendored settings-manager getters, so `/settings diff` showed 8
   phantom "drifted" rows on EVERY fresh install. Found by reading the
   run-after `bm5-diff` pane while designing the no-op guard; fixed in
   `registry.ts` (all 8, with vendored provenance comments); pinned by
   `test/settings-defaults-drift.test.ts` (the subprocess pin) and BM-8's
   phantom-drift guard (the pane-truth pin).
2. **Nine dead action lanes** — the hub's item editor dispatched on
   `choice.startsWith("Run")` but pushed action labels verbatim, so nine
   action items (`opens the staged-skills list`, `opens the pending-diff
   list`, `reads the engine's routine list`, …) selected-and-did-nothing.
   Found when the promotion drive's Enter on the inbox row was silently
   ignored; fixed by `actionOptionLabel()` (every action label normalised
   into the `Run: …` shape); pinned in `settings-hub.test.ts` (the action
   dispatch contract, all action items, forever).
3. **The inbox dialogs overflowed** — the staged-skills inbox passed a
   2,500-char preview (and the pending-dreams inbox a 3,000-char diff) as
   the dialog title; the option rows rendered off-screen and the dialog
   was unusable. Found when the promotion drive could not see or select
   any option; fixed by clamping both previews to 600 chars with a
   pointer to the full text; verified by the same drive completing the
   promotion end to end.

## Failures and honest nulls

- **The harness's quiet** (mechanism 2): 15/15 cycles already-passing, 0
  improvements. A null with a receipt, kept as the finding.
- **The engine mint's skip** (mechanism 3): nothing to mint — no failed
  runs this round.
- **The pin's first full-suite run failed** before the subprocess
  rewrite: `agent.addon-todo-lines` read 33 (an earlier suite file's
  leftovers through term.ts's module-scope `UNOWN_HOME` snapshot) — the
  failure was the FIND: the pin now runs in a subprocess with a pristine
  home, and the incident is why the pin's header documents the snapshot
  class. The lesson is in the project memory.
- **BM-2's hook-depth task is diff-inert** (expect 3 == declared default
  3): flagged by the M6 load-time validation, kept as a warning — a
  write-path task may legitimately target the default; the flag exists so
  diff-flavored tasks can never hide in the class again.

## What was NOT validated

- **The harness's improvement lane** produced no patch this round (the
  suite never failed) — its correctness remains pinned by the prior
  rounds' receipts, not this round's.
- **Memory-lift** (does project memory measurably improve later rounds'
  work?) — not measured this round; the standing twice-reproduced null
  from round 1 stands (memory buys procedure and efficiency, not
  correctness).
- **The digit quick-select in the hub's own select dialogs**: the
  promotion drive observed the per-skill inbox dialog rendering options
  UNNUMBERED where the plan approval gate renders them numbered — the
  two dialogs ride the same `ctx.ui.select` lane, so the divergence is
  real but unexplained. Recorded as an open question for the keyboard
  lane; NOT a claim either way.
- **`add-new-subproject-skeleton`'s promotion**: deliberately not decided
  this round — it stays in the inbox, inert, awaiting its own operator
  review.
