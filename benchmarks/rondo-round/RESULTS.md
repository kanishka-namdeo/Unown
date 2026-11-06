# The Rondo round — RESULTS

One-line purpose: the PROVE track's evidence package — the before/after
pairs the round's tickets landed, honestly labelled (single-run claims
stay single-run, nulls stay nulls, the 2–6 pp noise band respected).
Baseline table: [README.md](README.md) (tree `18e4a98a`, 2026-11-06, the
eighteenth lineage's Phase 0). Status: **FINAL at the DRIVE-complete
tree `4a531894` (C-1..C-11 all closed) + the twenty-fifth's cross-machine
verification** — the round's closeout receipts (the every-3 review, the
§7 cycle, the §0.9 reconciliation) land on top of this file.

## 1. The DRIVE track — the vehicle shipped, gate by gate

**Chaconne** (`apps/chaconne/` — a keyboard-first browser-recipe runner)
landed C-0..C-10 through A2, every ticket operator-gated and most
cross-machine verified:

| Gate lane | Baseline (`18e4a98a`, pre-round) | Now (C-10 + A2H-14 merged) | Receipt |
|---|---|---|---|
| Unit battery (root) | 2258 / 161 files, **1 fail** (V-4) | **2366 / 0 fail / 174 files** (+108 tests, +13 files) | [c1..c10 receipts](receipts/) + the queue rows |
| Lane A (app unit, DOM-free) | — (app did not exist) | **114 pass / 5 skip / 0 fail** (18 files) | C-1..C-10 + A2H-14 (+1 the cross-host pin) |
| Lane B (app unit, happy-dom) | — | **157 / 0** | C-3..C-10 |
| Chaconne e2e battery | — (app did not exist) | **20/20, ×2 consecutive on the merged tree (19.1 s / 19.0 s)**; ×3 incl. a CI=1 cold boot at C-9; 12 consecutive at C-8 | [c6](receipts/c6.md) · [c8](receipts/c8.md) · the C-9/C-10 queue rows |
| Typecheck / lint | 0 / 0e-143w | **0 / 0e-143w** (unchanged through 12 tickets) | every operator gate |
| The five check gates (docs/changelog/blog/benchmarks/claims) | 55 stops/540 · 46/116 · 6/6 · 62/62 | **56 stops/544 · 46/116 · 6/6 · 62/62** — all ok with the new docs/chaconne.md + the v0.0.57 rail | the C-10 close + the merged-tree verification (V-42) |
| The CI surface | — | **the `chaconne` job: 10 steps (the ostinato pattern), ci.yml valid at 20 jobs; the `chaconne:dev`/`test`/`e2e` root scripts run green from root** | the C-11 close + the twenty-fifth's cross-check |
| Landing surface | — | the ChaconneSection band (7 real stills, IHDR-pinned, **the post-fix refresh driving the REAL runner through the fixed bridge — the V-41 seam proven live**), docs/chaconne.md + the RUNBOOK section, the README rows, the capture lane with the `--runner` mode | the C-10/C-11 queue rows |

The honest scope statement: **Chromium-desktop-only** (Safari/Firefox/
mobile untested, stated on the landing band and the docs page — never
claimed as cross-platform).

## 2. The dispatch-economics ledger (§4/§8 — turns per ticket)

The engagement's cost question: did driving A2 get cheaper? The ledger,
per ticket (A2 turns as dispatched, operator gates excluded):

| Ticket | Scope | A2 turns | Failure classes hit (the lessons that fed later briefs) |
|---|---|---|---|
| C-0 | the architecture plan (read-only) | 11 | none (the cleanest shape) |
| C-1 | the domain core | 27 | V-11 preamble-stop, V-12 cap taxonomy, V-13 landing reconciliation |
| C-2 | the runner v1 | 65 | V-18 the fake-clock spiral (the operator's structural decision), V-19 |
| C-3 | the web app shell | 33 | none — the ordered-write brief pattern, adopted into the playbook |
| C-4 | the recurring loop | 57 | the convergent-dual standdown (V-26) |
| C-5 | assertions + artifacts | 63 | one gate catch (the precache forward-reference), fixed in one round |
| C-6 | the e2e battery lane 1 | 87 | the bare-`bun test src` engine-fixture pickup (V-27), B-20 caught (A2H-12) |
| C-7 | the resilience battery | 89 | V-35 (the operator's own drift-test revert, caught by A2's pin) |
| C-8 | import/export | ~135 | the filechooser race flake (12-13/14 cold cross-runs) — the C-8 flake-fix lane, V-39 |
| C-9 | the accessibility battery | ~74 | V-32(b) cap overspend ×2, the V-38 provider flip window (tolled) |
| C-10 | the landing band | ~92 (46 the twenty-second's close + the twenty-fifth's stood-down chunk 1) | V-40 (the output-token ceiling → the split-write law), the convergent dual (V-42) |
| C-11 | the runbook + CI gate + capture refresh | **165 (ONE dispatch — the round's first single-dispatch ticket; the 8-turn chunk budget blown 20×, the cap gate firing post-hoc)** | the MISSING-LAW finding: EFFORT_BUDGET is advisory to the model — a mid-run turn-budget HOOK filed as an augment candidate |
| A2H-9 | the encore test isolation | ~40 (2 lineages, convergent) | the substring-filter blind spot |
| A2H-10 | the dream noise filter (Unown core) | 24 + the operator's priced completion | V-15: the template-literal syntax rider, the pins-first completion |
| A2H-12 | the dead isMain guard | ~24 | one out-of-scope edit self-caught mid-flight |
| A2H-13 | the V-30 reconciliation | 56 | the latent stale-seed defect caught at A2's own gate |
| A2H-14 | the V-41 cross-host fix | 40 (5 dispatches, the V-40 era) | the cap-continuation pattern; the §3.7 operator-derivation lane |

**The honest reading**: turns per C-ticket did NOT monotonically fall —
the battery-heavy tickets (C-7/C-8) cost more than the shell tickets
(C-3), and the round's later chunks paid the V-38/V-40 provider-ceiling
tax (split writes + cap continuations). What DID improve measurably:
(a) **first-chunk landing rate for well-briefed scopes** — C-3 (33
turns, zero failures) and C-5 (63, one catch) on the ordered-write brief
pattern adopted at C-3; (b) **the operator's brief quality** — the
V-11/V-18 preamble and spiral classes vanish after C-2; (c) **the
failure→brief reflex** — every genuine-gap failure class (V-27, V-30,
V-35, V-39, V-40, V-41) converted into either a ticket or a standing
brief law within one ticket of occurring.

## 3. The AUGMENT track — the paired deltas, honestly

| Hypothesis | Lifecycle state | The evidence |
|---|---|---|
| H-8 (the resume-hint grammar) + H-9 (the resume picker) | **PROMOTED** | The retention receipts on the full post-recycle sandbox: `verify_resume_hint` ALL ASSERTIONS HELD (the exit-hint grammar + verbatim copy-paste resume on both session kinds), `verify_resume_picker` 3 consecutive PASS + 1 honest transient — [h-retention-r24.md](receipts/h-retention-r24.md) |
| H-10 (the browser-resilience skill) | STAGED, paired runs executed — **an honest NULL** | n=3/arm on the frozen post-C-7 tree, the skill the only variable: the firing surface never occurred (the fixture's race is benign by construction), completions 1/3 vs 1/3, flake 0.0 both arms — no delta claimable; the instrument (the paired-run harness) is the cargo — [h10-paired-runs.md](receipts/h10-paired-runs.md) |
| H-11 (the dispatch helper's hang-class taxonomy) | CANARY (22/0 round dispatch runs; the V-39 GUARD-KILL class added) | The round's own dispatch traffic — the helper ran every C-7..C-14-era dispatch |
| H-12 (the continuation-brief generator) | CANARY 2/2 | A genuine V-12 capped chunk → the 3,972-char byte-exact brief → the resumed session completed the H-10 gate-design artifact in 7 more turns, zero operator correction — the V-15 pins demonstrably riding into the output's own verdict line |

## 4. The rerun-green receipts (the cross-machine verifications)

Every major landing was independently re-verified on a second tree: C-1
(V-14, quadruply), C-3 (V-25), C-4+C-5 (V-28), C-6 (the twenty-fourth's
sixth-tree battery), C-7+A2H-13 (V-36, triply), C-9 (the twenty-third,
14:25 UTC), C-10 (the twenty-third, 15:32 UTC), A2H-14 (the
twenty-third's cross-check `38492e94`), the C-10+A2H-14 **merged
tree** (the twenty-fifth's joint verification — V-42: nobody else had
verified the band and the fix together), and **C-11 (the twenty-fifth,
16:05–16:10 UTC: every number exact — `chaconne:test` 114p/5s/0, root
2366/0/174 at 158.7 s, `chaconne:e2e` 20/20 at 18.5 s, the five gates,
ci.yml valid at 20 jobs, the 7 stills' real-runner PROVENANCE)**. The
round's fleet: **at least eight independent trees** ran the battery
green.

## 5. The genuine-gap harvest (the §5 reflex — failures → benchmarks)

Six failure classes converted into standing seams this round: the
substring-filter law (A2H-9), the artifact-name cross-host grammar
(V-30 → A2H-13 → **V-41 → A2H-14**, the round's deepest catch — a latent
defect in a CLOSED ticket's landing, invisible to three gate shapes,
surfaced only by the real-runner capture lane), the e2e cold-boot
amendment (C-8), the spec-pin law for provider flips (V-38), the
split-write law for output ceilings (V-40), and the prompt-guard law
(V-39). Each carries: the frozen repro, the fix at the named layer, the
pin that makes regression loud, and the receipt.

## 6. What stays OPEN at this compilation

- **C-11 — CLOSED** (`4a531894`, cross-machine verified by the
  twenty-fifth): the DRIVE track is complete; the closeout portfolio
  (the every-3 review, the §7 cycle, the OQ-1 PLAN amendment, the §0.9
  reconciliation, the §6c/§8 final receipts, the claim-evidence gap
  formalization) is the next lineage's work per the updated resume
  instructions.
- The engine's learning-layer accumulation for THIS round: the
  twenty-fifth's lane alone drove **16 runs / 12 dreams** (the live KPI
  at the closeout) with the terminal render clean throughout (B-18
  FIXED-RENDERED, V-43) and the dream consolidation carrying the
  round's latest fix facts; the closeout summarizes across lanes.
- The §0.9.5 re-scope trigger: never fired (Chaconne's exposure held —
  the a11y/resilience/io batteries all found real work).
- The H-10 teardown choice (a hostile-variant fixture via a proper
  ticket, 6/arm, or holding the null) — the teardown window's standing
  question.
- The C-11 missing-law finding: the mid-run turn-budget hook (the
  augment candidate the 165-turn single dispatch receipted).
