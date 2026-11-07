# The A1 augmentation registry

> **Verdict up front:** opened EMPTY on 2026-11-04 per the A1 directive's
> Phase 0 ("Empty Augmentation Registry") — no augmentation earns a row
> until it survives the lifecycle below with receipts. Inherited standing
> practices from prior rounds are listed separately: already receipted in
> their own round logs, not promotions of this engagement.

One-line purpose: the lifecycle ledger for every A2-side or operator-side
augmentation this engagement proposes, canaries, gates and promotes — or
retires.

- Owner: the A1 operator (authored outside A2 sessions)
- Status: OPENED 2026-11-04; the Ostinato round closed 2026-11-04 — promoted rows: 2 (H-6, H-4); the **Reprise round opened 2026-11-05** — **promoted rows: 3 (+H-8, A2H-4, 2026-11-05)**; H-1/H-2/H-3 carry live records at PROPOSE; the Reprise round PARKED 2026-11-05 (a fresh directive opened); the **Etude round opened 2026-11-05 EMPTY** — one PROPOSE on file (H-9, that round's opening harvest); the round's validation log lives in [the round log](etude-round-session.md) + [the benchmark validation log](../benchmarks/etude-round/validation-log.md); the **Rondo round opened 2026-11-06** (the fresh DRIVE × AUGMENT × PROVE directive) — **H-9 PROMOTED by the CONVERGENT DUAL operator decision** (both parallel lineages promoted it independently on the same receipts — the Rondo round's opening call and the Etude lineage's own E-0-gate decision; promoted rows: 4), **H-10/H-11/H-12 opened at PROPOSE** (the round's pre-registered seed hypotheses; H-11 advanced to CANARY 2026-11-06 — formalized by the twenty-first, cross-lane receipted by the twentieth; H-12 advanced to CANARY 2026-11-06 — BUILT + live-canaried by the twenty-fourth on a genuine V-12 capped chunk, zero operator correction; H-10 advanced to CANARY-READY 2026-11-06 — staged + gate-designed by the twenty-fourth, the paired runs pre-committed to the teardown window); the round's validation log lives in [the round log](rondo-round-session.md) + [the benchmark validation log](../benchmarks/rondo-round/validation-log.md); the **Rondo round CLOSED 2026-11-06** (the twenty-fifth's close portfolio receipted in its log); the **Scherzo round opened 2026-11-07** (the fresh DRIVE × AUGMENT × PROVE directive, the twenty-sixth lineage — vehicle **Bolero** per [the §0.9 selection receipt](../benchmarks/scherzo-round/README.md)) — **H-12's generator REBUILT + COMMITTED in-repo** at `scripts/a1-continue.py` (the Rondo closeout's mandated first act: the retention gap is cured by construction — the artifact now survives recycles; the promotion gate re-runs on this round's first genuine capped chunk), **H-10 RE-ACTIVATED** (Bolero's scheduled browser lane is the firing surface the Rondo null lacked — the round decides promote-or-retire on real evidence), **H-16 BUILD SCHEDULED** (the round's PROPOSE→build candidate, the teardown research standing), seeds **H-18/H-19 opened at PROPOSE** (the §0.9 pre-registration); the round's validation log lives in [the round log](scherzo-round-session.md) + [the benchmark validation log](../benchmarks/scherzo-round/validation-log.md); the **Sonata track opened 2026-11-07 IN PARALLEL** (the twenty-seventh lineage — a second fresh directive of the day on the same base tree `ae8a73d`; reconciled per the ledger-arbiter law, the V-42 class: Scherzo governs the round opening, Sonata runs as the NON-OVERLAPPING parallel engagement at `apps/fugue/` — the engine/learning-loop surface vs Bolero's browser/ops surface) — the H-12 rebuild is a **CONVERGENT DUAL** (both tracks rebuilt `scripts/a1-continue.py` within the hour; the Scherzo artifact governs), **H-20 (the engine-contract skill) seeded** (renumbered clear of Scherzo's H-18/H-19), **H-14 revived** for the Fugue vehicle, **H-17 taken by the Sonata lane** (Scherzo took H-16's build); the validation log lives in [the round log](sonata-round-session.md) + [the benchmark validation log](../benchmarks/sonata-round/validation-log.md); the **Serenade round opened 2026-11-07** (the fresh DRIVE × AUGMENT × PROVE directive, the thirty-second lineage — vehicle **Legato** per [the §0.9 selection receipt](../benchmarks/serenade-round/README.md); the 33rd lineage's split-lane resume: the parallel lineage drives the L-queue while the 33rd took the augment lane) — **H-24 (the live-traffic fixture refresh) PROMOTED 2026-11-07** (the round's first promotion, the full PROPOSE→CANARY→GATE→PROMOTE lifecycle in one session: three dormant fiction pins caught at refresh-time on the live engine, the pins dual-laned, the paired A/B false-confidence delta MEASURED — [the receipt](../benchmarks/serenade-round/receipts/h24.md); promoted rows: 5)

**Mini-TOC**

- [Lifecycle](#lifecycle)
- [Gate requirements](#gate-requirements)
- [Registry](#registry)
- [Queued hypotheses](#queued-hypotheses)
- [Inherited standing practice](#inherited-standing-practice)
- [Related pages](#related-pages)

## Lifecycle

`PROPOSE → CANARY → GATE → PROMOTE → RETIRE`. No stage skipping.

- **PROPOSE** — a named hypothesis plus the evidence that spawned it (a
  failure class, a friction observation, a debugging session) and the
  metric it claims to move.
- **CANARY** — exercised on live work with before/after instrumentation;
  canaries never ship as defaults.
- **GATE** — the promotion review, against the requirements below.
- **PROMOTE** — lands in its durable lane: skill, subagent, command,
  recipe, routine, hook, review check, memory rule — or an operator-side
  practice when the fix belongs to the operator lane.
- **RETIRE** — a promoted augmentation whose receipts went stale or whose
  cost outweighs its lift is retired explicitly, with the receipt.

## Gate requirements

Promotion requires all five: a measurable reliability improvement on the
metric named at PROPOSE (before/after receipts); regression-detection
improvement or neutral; **no keyboard regressions and no TUI-consistency
regressions** (the directive's hard bars); acceptable latency and cost
(the Agnes metering budget respected); and retention evidence — the
improvement survives a session boundary (memory or skill lane receipt).

## Registry

| ID | Stage | Lane | Hypothesis | Metric | Evidence | Status |
|---|---|---|---|---|---|---|
| H-6 | PROMOTED 2026-11-04 | A2-side code fix (ticket A2H-1, v0.0.56) | The status-line collision guard: `showStatus`'s dedup must never clobber a DIFFERENT notify's text — reuse only for identical-text refreshes | The abort PTY lane under a fresh isolated UNOWN_HOME: notify visible 3/3; zero TUI-consistency regressions in the standing lanes | BEFORE 2/3 defect vs AFTER **3/3 both-lines-persist** (`scripts/repro_abort_notice.py`, B-1 receipted); footer 9/9 · picker PASS · resume-hint ALL HELD; unit: status 34/34 · self-learning 5561/0 · root 2152/0; the fix is durable code + the rewritten coalescing test pins the semantics; receipt `.unown/receipts/a2h1.md` tree-verified 5/5 | **LANDED** — the registry's first promotion |
| H-4 | PROMOTED 2026-11-04 | operator-lane harness fix (ticket A2H-2, in-repo `scripts/tui-capture/`) | Pump-while-typing in the PTY harness: every keystroke send drains output concurrently, so the pty write window never stays undrained | Keystroke-loss incidents in PTY lanes → 0 across the round; lane determinism across re-runs | The morning receipts (X/Y 2/2 loss; the /abort matrix 8/8) as spawning evidence; the landed `_send_drained` (reader-thread drain on `send`/`key`/`type_prompt`); the standing lanes re-ran green on the fixed harness (footer 9/9 · resume-hint ALL HELD · picker PASS); the product-side investigation's volume ladder receipted (input preservation holds on v0.0.56 at every tested volume — the fix is determinism insurance); receipt `.unown/receipts/a2h2.md` | **LANDED** — the second promotion |
| H-8 | PROMOTED 2026-11-05 | operator-lane harness fix (ticket A2H-4, in-repo `scripts/tui-capture/`) | The PTY harness's fresh-install hardening: `pty_common.py` the single source of truth for `UNOWN_ROOT`/`UNOWN_BIN` (script-relative, env-overridable — no lane carries a checkout-path default); `UnownPty` strips an ambient `UNOWN_HOME` from every spawn; the picker lane runs a true fresh-install truth (isolated `VERIFY_HOME` + `dismiss_first_flights` after both boots + the lane's-own-HOME discovery + the subprocess env filter) | The picker lane passes on a fresh container with ZERO operator cures, 3 consecutive runs | BEFORE 3/3 FAIL on the fifteenth lineage's fresh bring-up (V-3/V-4/V-5: the catalog eating keystrokes, the ambient `UNOWN_HOME` leak, the hard-coded prior-checkout path — three operator cures needed just to run it) → AFTER **3/3 consecutive PASS with the ambient `UNOWN_HOME` deliberately set**; the scoped fix's own standing-lane regression (the eight scripts' local defaults) caught by the operator's ritual and cured in-ticket (`rg -l "my-project/Unown" scripts/tui-capture/` → empty); `verify_resume_hint` ALL HELD with zero env overrides; the fix is durable shared-harness code + the receipt (retention by construction); cost: 5 budgeted chunks, $0 metered | **LANDED** — the third promotion (the Reprise round's first) |
| H-9 | PROMOTED 2026-11-06 | operator-lane harness fix (tickets A2H-5 + A2H-6, in-repo `scripts/tui-capture/`) | Fresh-boot gate awareness in the PTY harness: every fresh-home lane boot survives the product's own pre-TUI first-run gate — the hint lane's `setup` subprocess env-filtered (A2H-5, the H-8 filter applied to the one call site that missed it) + the pane-aware `answer_first_run_gate` helper in `pty_common.py` (A2H-6, the preferred shape: sends `n` + Enter when the gate text is on the pane, so the lane exercises the product's real first-run flow instead of bypassing it) | The hint and picker lanes pass WIPED homes ×3 consecutive, ambient `UNOWN_HOME` deliberately exported | BEFORE cold-home **0/2 lanes** (V-2/V-3: B-13 the ambient-`UNOWN_HOME` setup leak, B-14 the deterministic first-run-gate block) → AFTER **2/2 lanes, wiped-home ×3 each + the operator's independent reruns, all exit 0** (receipts [a2h5.md](../benchmarks/etude-round/receipts/a2h5.md) · [a2h6.md](../benchmarks/etude-round/receipts/a2h6.md)); regression bar met (footer-quiet 9/9 after the V-7 engine-drift cure — the variance root-caused environment-class via git-stash isolation, not a helper regression; resume-hint ALL HELD on a wiped home); retention by construction (durable shared-harness code, the same lane H-8 rode); cost $0 metered across 5 A2 chunks (13 + 22 turns, 0 operator unblocks) | **LANDED** — the Etude round's first promotion (the operator gate at the E-0 decision package, 2026-11-06) |

## Queued hypotheses

PROPOSE-stage candidates (none canaried, none promoted):

- **H-16 — the mid-run turn-budget hook (the C-11 receipt's candidate,
  design-sharpened by [the budget-visibility
  teardown](TEARDOWN_2026-11-06_budget-visibility.md), the round
  closeout's §7 cycle).** Spawning evidence: C-11's 165-turn single
  dispatch (the 8-turn EFFORT_BUDGET blown 20×, every gate green, the
  cap gate firing post-hoc — the operator blind until the end). The
  teardown's three-part design (sourced from three shipped systems —
  Codex 0.142.0's rollout budgets, OpenHands's visible-limit proposal,
  Strands's stop-reason reporting): (a) the harness enforces the turn
  budget MID-RUN (the abort at the limit, not after); (b) the
  remaining budget is injected into the session at intervals (the
  model paces itself); (c) the envelope's stop-reason taxonomy gains
  the budget class. The OpenHands #5480 recovery-gap receipt is the
  design's caution: the abort path must preserve the resume path (the
  V-12 continuation economics stay supreme). Metric: budget blowouts
  detected at turn ~2×budget → 100%; operator blind-spots → 0. Stage:
  PROPOSE (the next round's PROPOSE-gate research opens the Codex
  changelog primary before building — the teardown's honest-depth
  note).
- **H-17 — the conversation-pattern stuck detector (the V-14 manual
  watch automated; the OpenHands Stuck Detector's shape on A2's
  engine).** Spawning evidence: the V-14 spiral watch (the operator
  manually reading chunks for self-chosen mechanisms burning >2 chunks
  — exercised live at C-2's fake-clock spiral and A2H-14's cap
  continuations) + OpenHands's shipped detector (repeated-action and
  repeated-error patterns over conversation history) + their #5480
  recovery-gap receipt (a stuck-flagged conversation must stay
  resumable). The candidate: engine-side pattern analysis over the
  session log (repeated tool calls with identical args, repeated
  failing verifications), surfaced on the dashboard + the dispatch
  envelope. Metric: spirals detected before the operator's manual
  read; false positives on legitimate retry ladders → 0 (the C-8
  flake-fix's 15 s bounded retry is the honest-retry shape to not
  flag). Stage: PROPOSE (filed at the closeout; not dispatched).
- **H-18 — the cross-host contract-pin skill (operator lane, Scherzo round
  seed; the V-41 generalization).** Two hosts, one grammar, one law: when
  a producer (a runner, a CLI, a generator) and a consumer (a server, a
  PWA, a parser) share an artifact contract, the grammar is declared ONCE
  in a shared module, both hosts import it, and a round-trip pin test
  throws on drift — dotted names THROW, RED by construction (the
  A2H-13/A2H-14 pattern made reusable). Spawning evidence: V-41 (the
  Rondo round's genuine find — the runner's report ext drifted from the
  PWA's boot grammar across THREE invisible gate gaps: a runner-side pin,
  a satisfiable-only e2e assertion, and no real-record bridge). Candidate:
  a `.unown/skills-staged/contract-pin/SKILL.md` procedure A2 loads when
  building any producer/consumer pair. Metric: contract-drift defects
  caught at A2's own gates (not the operator's) on Bolero's S-1/S-3
  seams; the round-trip pin's presence in every cross-host ticket.
  Stage: PROPOSE (2026-11-07, pre-registered in the Scherzo selection).
- **H-19 — the ops-lane memory rules (operator lane, Scherzo round
  seed).** The project's memory tiers hold rich app-craft (PWA patterns,
  test batteries, golden files) and ZERO server-ops craft: supervision,
  health endpoints, graceful drain, restart-mid-run, log hygiene, the
  daemonizer pattern. Spawning evidence: the SDLC matrix's thinnest lane
  (W6) — every prior vehicle is a local-first PWA; Bolero's S-3/S-4/S-6
  are the first server/supervision tickets. Candidate: a `## Manual
  notes` batch in the project memory tier (authored outside sessions,
  committed) distilling the ops laws as they are EARNED this round (each
  rule receipts its ticket). Metric: server tickets after the rules land
  need fewer continuation chunks than before (turns-to-done on the S-3→S-6
  trend); the rules are retrieved by A2 in later sessions (the memory
  health card's successful-retrieval count). Stage: PROPOSE (2026-11-07,
  pre-registered in the Scherzo selection).
- **H-20 — the engine-contract skill (operator lane, Sonata-track seed, 2026-11-07; the minting lane's designed live candidate).** The Fugue vehicle's F-2..F-6 tickets consume the engine REST surface repeatedly (token discovery, the `/api/overview|automations|runs|dreams|notes|memories` contracts, drift recovery, the engine-down outbox pattern). Hypothesis: a skill encoding the engine REST contract + drift recovery + token discovery beats per-ticket re-derivation once the pattern repeats ≥2× — and if the pattern genuinely recurs in session notes, it is the first live candidate for the MINTING lane (the W2 exercise: no pattern has ever repeated ≥2× in a round). SHOULD fire on engine-adapter authoring/debugging tickets; SHOULD-NOT on tickets that never touch the engine API. Metric: F-4+ engine-surface dispatches needing zero operator contract re-explanation vs the F-2 baseline; failed-retrieval count in the memory health card; if minted — the WITH/WITHOUT paired gate on a frozen holdout task (the H-10 protocol). Stage: PROPOSE (seeded at the Sonata §0.9 selection; renumbered from the colliding first-draft H-18 after the Scherzo landing took that id).

- **H-13 — the hostile-page-clip skill (Vivace seed, PARKED at the reconciliation — renumbered from H-10 to clear the Rondo collision; operator lane → skill).** When a clip target is
  JS-walled, redirect-crazy, or oddly encoded, a fetch→browser→readability fallback chain skill should
  beat ad-hoc per-ticket flailing. Spawning evidence: the PRD's W2 weakness (prior rounds' live-web
  `[U]`s; the research sweep's browser-resilience gap); predicted to fire first at ticket V-3.
  Metric: hostile-clip task success (the frozen B-16 holdout) WITH vs WITHOUT, ≥3 paired runs.
  SHOULD fire on URL-fetch failures + extraction-empty pages; SHOULD-NOT on local files or clean
  pages. Stage: PROPOSE (2026-11-05).
- **H-14 — the schema-contract memory rule (Vivace seed, PARKED — renumbered from H-11; operator lane → memory rule).** A standing
  `## Manual notes` bullet carrying the vehicle's current storage schema + migration state, edited
  OUTSIDE sessions per ticket, protects late tickets against the 110-bullet render cap pruning
  early-ticket facts (the W3 weakness). Metric: V-7/V-9 dispatches that need zero operator
  schema re-explanation vs the V-2/V-3 baseline; failed-retrieval count in the memory health card.
  Stage: PROPOSE (2026-11-05).
- **H-15 — the schema-strict-final lane (Vivace seed, evidence-backed by the frozen C3 canary's exit-3 class — PARKED, renumbered from H-12; operator lane → command/review check).** The
  C3 class (correct content, prose-wrapped JSON, exit 3) cured by a reusable final-answer contract
  (a `/schema-strict` command prefix or a review check) rather than per-brief sentences. Metric:
  the C3 canary rig exit 3 → exit 0 with the SAME brief, ≥3 runs (the B-15 holdout is the frozen
  brief-side comparison — if B-15 alone cures it, H-12 stays PROPOSE and the brief lane wins).
  Stage: PROPOSE (2026-11-05).

- **H-1 — pre-dispatch smoke canary (operator lane).** One `UNOWN_OK`
  print-mode round trip before every A2 dispatch catches
  provider/bridge/engine staleness for ~4 s of spend, converting silent
  chunk-loss into a fast, cheap, classified failure. Spawning evidence:
  the seventh lineage's smoke-1 receipt pattern; this lineage's 3.7 s
  smoke (2026-11-04). Canary: armed for every O-ticket dispatch this
  round. Metric: catch rate vs overhead. **Live record at the closeout
  (2026-11-04)**: armed before every dispatch of the O-6 lane (11 chunks)
  at ~4–7 s each — catch rate **0** (the null result is the receipt:
  nothing was stale, and the whole closeout ran without a single lost
  chunk — the lane converts silent chunk-loss into a classified failure,
  which is exactly what did NOT happen) with overhead ≈ 0.4% of the
  round's turns. Stays PROPOSE: a zero-catch round is not a promotion
  receipt; it is one clean data point.
- **H-2 — tree-verify FILE claims at the operator gate (operator lane).**
  Standing practice from the spend round's receipt-overclaim lesson,
  formalized into this round's gate: the receipt's FILES list is
  re-verified against the tree, never trusted. Metric: overclaims
  surviving gate = 0. **Live record 2026-11-04**: O-1's receipt caught
  the 12-vs-13 prose slip (V-11); O-2's receipt verified clean — 10/10
  files on the tree, zero extras (the strongest form: nothing claimed
  that does not exist, nothing existing that goes unclaimed). **At the
  closeout (2026-11-04)**: the O-6 receipt's FILES re-verified against
  the tree (the band's four files + the two twins + the three doc
  surfaces + the blog post), zero overclaims, zero extras — and H-2's
  law extended to operator-authored receipts: the O-6 receipt was
  operator-written from run evidence after three cap-fell-off A2 writes,
  and it was tree-verified like any other.
- **H-3 — PTY keyboard/TUI audit as a pre-ticket ritual (operator lane).**
  The standing PTY lanes (25 scenario specs, ~30 scripts under
  `scripts/tui-capture/`) re-run on each fresh lineage before the first
  dispatch — the directive's first keyboard/TUI audit brief. Metric: lanes
  green on a fresh lineage with zero fixes, or findings filed to the bug
  register. **First live harvest 2026-11-04** (ninth-lineage resume): footer
  9/9, resume-hint pass, resume-picker pass-on-rerun (V-8 flake), abort
  lane flake root-caused into B-1 + V-9 — the audit paid for itself before
  the first dispatch.
- **H-4 — pump-while-typing in the PTY harness (operator lane / repo
  harness).** `pty_common.send`/`type_prompt` must interleave output
  draining while sending keystrokes during active streams (V-9's law —
  undrained output silently drops typed input). Evidence: the X/Y
  differential (2/2 loss without reads vs 2/2 landing with reads) plus 8/8
  corroborating race/matrix runs, 2026-11-04. Metric: keystroke-loss
  incidents in PTY lanes → 0 across the round. **PROMOTED 2026-11-04**
  (see the registry table): A2H-2 landed `_send_drained` on
  send/key/type_prompt; the product-side investigation receipted input
  preservation holding on v0.0.56 across the volume ladder — the law is
  condition-dependent, the promotion is determinism insurance.
- **H-5 — isolated UNOWN_HOME per PTY lane (operator lane).** Lanes boot
  with an isolated home (`env_extra` UNOWN_HOME) and dismiss the
  first-flights catalog before typing; lane verdicts must not depend on
  the developer home's onboarding history (the abort lane's 07:07 vs
  07:21 flip was home-state: the flying tip armed in a fresh ~/.unown,
  latched in the real one). Metric: lane re-run determinism — same verdict
  across 3 consecutive runs of every standing lane. **Second live receipt
  2026-11-05 (the fifteenth lineage)**: the picker lane red-on-fresh-install
  exactly this class — the unlatched real ~/.unown showed the first-flights
  catalog (keys eaten) while a latched home passes; plus the ambient-
  `UNOWN_HOME` leak (V-4) breaking the isolation from the other side. The
  A2H-4 fix candidate is the durable form.
- **H-6 — status-line collision guard (A2-side, spawns ticket A2H-1).**
  pi's `showStatus` dedup-reuse lets a later notify replace an earlier
  one's text; the `/abort` feedback is silently overwritten by the
  first-flight tip exactly when a new user aborts their first turn (B-1).
  Candidate lanes: notify dedup keyed by source, `agent_settled` tip
  deferral past user-command notices, or the abort notice rendered as a
  message-level note. Metric: the abort PTY lane under a fresh isolated
  home shows the notify 3/3; zero new TUI-consistency regressions in the
  standing lanes. **PROMOTED 2026-11-04** (see the registry table): the
  landed lane was the operator-decided variant — dedup keyed on
  identical text (refresh-only), covering every ordering and every
  notify source with no API change; the retiring of the coalescing
  feature is receipted in the CHANGELOG's [0.0.56] entry.
- **H-7 — verifier-first diagnosis (operator lane).** When an external
  verifier reds against prose-clean code, diagnose the VERIFIER before
  the code it reds on — regex/source scanners match prose as readily as
  member access. Spawning evidence: V-14 (2026-11-04, O-2) — the
  boundary lane's `DOM_GLOBS` redded `io.ts` twice over comments ending
  sentences with the word "document."; the first catch (`storage.ts`'s
  "window.localStorage" comment) looked like the code's fault, the
  second proved the scanner's. Fix landed both layers (the regex now
  requires an identifier after the dot; the belt: no global literal in
  domain comments). Metric: verifier false-positives filed as code
  defects = 0 for the rest of the round.
- **H-8 — the picker lane's fresh-install hardening (operator lane /
  repo harness, spawns ticket A2H-4).** `verify_resume_picker.py` must
  dismiss the first-flights catalog before typing (pty_common's mandate —
  the catalog is focused and eats keystrokes), clear `UNOWN_HOME` in its
  spawn env (the HOME isolation must not depend on the caller's shell),
  and resolve `UNOWN_BIN` from `UNOWN_ROOT` (no hard-coded checkout
  path). Spawning evidence: V-3/V-4/V-5 (2026-11-05, the fifteenth
  lineage — the lane failed 3 consecutive runs on a fresh install, then
  passed with the operator cures: the one-time `flightsDismissed` latch,
  `env -u UNOWN_HOME`, the `UNOWN_BIN` override, `fd` on PATH). Metric:
  the lane passes on a fresh container with ZERO operator cures, 3
  consecutive runs. Stage: **PROPOSE** (opened at the Reprise round's
  second bring-up; the A2H-4 dispatch is a round-operator decision).
  **PROMOTED 2026-11-05** (see the registry table): A2H-4 landed the fix
  across the whole harness (five chunks; the scoped fix's standing-lane
  regression caught by the operator's ritual and cured in-ticket); the
  gate receipts — BEFORE 3/3 FAIL on a fresh install → AFTER 3/3 PASS
  with the ambient `UNOWN_HOME` deliberately set, the standing lanes
  green with zero env overrides, the durable-code retention.
  **Receipt correction (2026-11-05, the Etude round's V-3)**: the
  3/3 PASS holds only for pre-warmed homes — on a WIPED home the lane
  is deterministically red (the pre-TUI first-run gate blocks the
  header; B-14). The promotion stands (the `pty_common` hardening is
  real and load-bearing); the fresh-install claim is corrected by
  H-9/A2H-6 below, which restore it.
- **H-9 — fresh-boot gate awareness in the PTY harness (operator lane /
  repo harness, spawns tickets A2H-5 + A2H-6).** Every fresh-home lane
  boot must survive the product's OWN pre-TUI first-run gate
  (`cli.ts:3595-3618`) — either provisioned (an env-filtered
  `setup --provider bridge` that writes `settings.json`, suppressing
  the gate) or pane-aware (a `first_run_gate` helper in `pty_common.py`
  that answers `n` + Enter when the gate text is on the pane — the
  preferred shape: the lane then exercises the product's real
  first-run flow instead of bypassing it). Spawning evidence: the
  Etude round's V-2/V-3 (2026-11-05, the seventeenth lineage — the
  hint lane's setup subprocess leaked ambient `UNOWN_HOME` and
  provisioned the wrong home, B-13; the picker lane provisions nothing
  and blocks on the gate, B-14; cold-home 0/2 lanes → warm-home 3/3,
  with the controlled `setup`-writes-`settings.json` experiment as the
  root-cause receipt). Metric: the hint and picker lanes pass WIPED
  homes ×3 consecutive, ambient `UNOWN_HOME` deliberately exported.
  Stage: **PROPOSE → CANARY COMPLETE (both halves green, 2026-11-05)**:
  A2H-5 (the env-filter shape, hint lane) closed through A2 in two
  chunks and A2H-6 (the preferred pane-aware-helper shape, picker lane
  + `pty_common.py`) closed in three — sessions `01a1aa60…` and
  `01a1aa68…`, 0 operator unblocks; wiped-home ×3 per lane + the
  operator's independent reruns all exit 0 (receipts
  [a2h5.md](../benchmarks/etude-round/receipts/a2h5.md) ·
  [a2h6.md](../benchmarks/etude-round/receipts/a2h6.md)); the
  regression bar met (footer-quiet 9/9 after the V-7 engine-drift cure,
  resume-hint ALL HELD on a wiped home); cost $0 metered across 5 A2
  chunks. **GATE-READY — the promotion decision is reserved to the
  operator** (the directive's for-approval bar): measurable improvement
  cold-home 0/2 lanes → 2/2; regression-detection neutral-or-better;
  no keyboard/TUI regressions (the V-7 variance root-caused
  environment-class); retention by construction (durable shared-harness
  code, the same lane H-8 rode). **PROMOTED 2026-11-06 — by the CONVERGENT
  DUAL operator decision** (the Rondo round's opening call and, in
  parallel and independently, the Etude lineage's own E-0-gate operator
  decision — both lineages read the same receipts and promoted the same
  row the same day; the dual event itself is the promotion-determinism
  receipt): all five gate requirements hold on the receipts as they
  stand — measurable improvement (cold-home 0/2 → 2/2 lanes),
  regression-detection neutral-or-better, no keyboard/TUI regressions
  (the V-7 variance root-caused environment-class), cost $0 metered,
  retention by construction; the row moves to the registry table
  below; the retire condition is any PTY lane regressing on a wiped
  home after a harness change (the same bar that caught H-8's receipt
  correction).
- **H-10 — the browser-resilience skill (A2-side, Rondo round seed).**
  Pre-registered at the round's opening per the fresh directive's §0.9.4
  (before the tickets that will spawn the evidence): the Chaconne
  runner's browser lanes are predicted to hit the fill/iframe/wait
  defect classes (#43/#44 kin — the §0.9 predicted-failure receipt);
  a staged SKILL.md encoding the recover pattern (re-query the frame,
  retry-with-jitter, verify-the-value-landed) is the candidate lane.
  Metric: e2e lane flake rate and turns-to-green on browser tickets,
  WITH vs WITHOUT (the paired gate). Stage: PROPOSE.
  **Evidence accrual 2026-11-06 (the twentieth lineage, A2H-8)**: the
  probe CONFIRMED the residual gap is real (the loud-failure window
  between navigate's return and the frame's ref readiness — see
  [a2h8.md](../benchmarks/rondo-round/receipts/a2h8.md) + the two
  upstream comments on issue #43) and named the exact recover-pattern
  ingredients the skill must encode: re-snapshot for fresh refs, the
  eval-into-contentDocument fallback, verify-value-landed after every
  fill, and the partial-application hazard (resolve ALL fields before
  applying any). The skill's staging waits for C-2/C-6's actual runner
  lanes (the WITH/WITHOUT gate needs the lane to exist); the receipt
  is the pre-registered evidence base.
  **Staged + gate-designed 2026-11-06 (the twenty-fourth lineage)**: the
  C-2/C-6 lanes exist (the blocking condition cleared), so this lineage
  STAGED the draft — [.unown/skills-staged/browser-resilience/SKILL.md]
  (never auto-loaded, the 2026-10-22 hardening; minter-validated: name
  regex / desc 380≤1024 / body 2880 chars, 58 lines — all within caps;
  the instruction-set audit clean with it staged) — encoding the four
  ingredients VERBATIM plus SHOULD/SHOULD-NOT firing conditions derived
  from a2h8's named findings. The WITH/WITHOUT gate design is
  pre-registered (authored through an A2 read-only research dispatch,
  session `01a1b0a2…`, 6+7 turns across the H-12-continued chunks; the
  full artifact in `.a1/logs/h10-research-chunk2.json` on the operator
  lane): pairs = (1) the flow-cli lane on the form-iframe fixture (the
  a2h8 twin — the primary flake arm), (2) the flow lane's reload/seed
  surface, (3) the a11y battery as the neutral-or-better regression
  arm; metrics = red-lane-runs/total per arm (the honest-gap note: the
  config sets no `retries`, so flake-rate is measured as repeated
  frozen-tree runs, the V-31 convention) + the envelope's `num_turns`
  summed per ticket session (turns-to-green); pairing law = ≥3 runs/arm
  (6 if the delta lands inside 2–3 pp), pins = frozen post-C-7 tree
  SHA / the 4014 fixture server / playwright 1.64.1 build 1248 / the
  same model tier / the skill the ONLY variable between arms. The
  paired runs execute at the teardown window on the frozen post-C-7
  tree (the existing specs are C-7's read-only context — the pairing
  surface is stable across its landing). Stage: **PROPOSE → CANARY-READY**
  (the instrument is staged and the protocol pre-registered; the
  canary's live runs are the teardown window's first act).
  **External methodology anchors (the twenty-fourth's research pass,
  2026-11-06)**: the gate's flake-rate verdicts interpret against the
  industry baselines — a healthy e2e flake rate is **under 3%** of runs
  ([testdino's benchmark data](https://testdino.com/blog/e2e-test-performance-benchmarks)),
  and a single test at 5% flake blocks CI roughly once every 20 runs
  ([the flaky-tests survey](https://wopee.io/blog/flaky-tests-complete-guide),
  after Luo et al.) — the gate's
  harness already treats a flaky (retry-passed) lane as NOT green, the
  masking-cautious convention the same survey recommends. The golden-file
  lane (C-8's surface, the H-12 canary's second artifact) matches the
  pin-on-first-run + committed-artifact convention
  ([the golden library's model](https://github.com/franiglesias/golden)).
  **The paired runs EXECUTED 2026-11-06 13:00 UTC (the same lineage, the
  teardown-window first act on the frozen post-C-7 tree `b436b843`)**:
  n=3/arm, the skill the only variable, the harness's pins enforced
  live — **the result is an honest NULL**: the skill's firing surface
  (iframe fill failure / partial application / empty read-back) never
  occurred in any of the six runs (the fixture's 50 ms re-tap only
  resets EMPTY fields; Playwright's fill+read-back wins synchronously —
  the WITH-1 report itself derives the mechanism), completions 1/3 vs
  1/3, e2e flake 0.0 both arms, no delta claimable on the mechanism.
  The instrument itself is the run's cargo: the harness worked
  end-to-end (refusals, promote/demote revert, incremental receipts,
  resume), the v1 brief flaw was caught BY the runs and both arms
  re-measured on the corrected v2 (the archived v1 data is the flaw's
  receipt), and the genuine finding — the fixture's race is benign by
  construction; measuring the recover pattern needs a hostile variant
  via a proper ticket — is filed for the teardown. Receipt
  [h10-paired-runs.md](../benchmarks/rondo-round/receipts/h10-paired-runs.md).
  Stage: **CANARY-READY → CANARY (executed, null receipted)** — the
  skill stays STAGED; the teardown chooses: 6/arm, the hostile-variant
  instrument ticket, or hold the null and ride the round's remaining
  browser tickets for organic firing evidence.
- **H-11 — the stdin-guard dispatch helper (operator lane, Rondo round
  seed).** V-1's cure formalized: every `-p` dispatch in this harness
  must guard stdin (inline `< /dev/null`; `stdio:["ignore"]` in
  spawned runners — the polyglot runner's standing pattern, now law).
  Candidate form: a one-line operator wrapper with a bounded timeout +
  envelope capture, so the law is enforced by tooling not memory.
  Metric: hang-class dispatch failures → 0 across the round (V-1 is the
  spawning receipt). Stage: PROPOSE.
  **Formalized 2026-11-06 by the twenty-first lineage** as
  `.a1/scripts/a1-dispatch.py` (off-repo, the standing convention —
  documented in the round log): the wrapper enforces the stdin guard
  by construction. **Cross-lane receipt (the twentieth lineage)**: 16
  dispatch-side runs this round (8 A2H-8 browser-tool turns through
  the daemonizer's `os.close(0)` + the 16 watcher `-p` loops) — zero
  hang-class failures; the A2H-7 watcher's both-lane non-repro
  receipts are the metric's first data point. Stage: CANARY (the
  activation is verified every dispatch; the promotion gate needs the
  round's full dispatch tally).
  **Evidence accrual 2026-11-06 (the twenty-fourth lineage)**: this
  lane's every `-p` dispatch rode the rebuilt helper — 6 dispatch-side
  runs (the wrapper self-test, 2 envelope-format probes, the H-10
  research chunk 1, its H-12-continued chunk 2, one capped-envelope
  repro), zero hang-class failures, zero stdin-inheritance incidents;
  the helper's own build iteration caught and cured TWO defects live
  (the stderr-pollution envelope parse and the bare-PATH binary
  resolution — both now encoded in the script, both reusable laws).
  Round tally to date: 16 (the twentieth's cross-lane receipt) + 6 =
  **22 dispatch-side runs, 0 hang-class**. The watcher's own 16+16
  spawns (the twentieth's + this lane's fresh r24 receipts) ride the
  same stdin-guard contract via their own bounded loop — corroborating,
  not counted. Stage: CANARY (holding for the round's full tally at
  teardown).
- **H-12 — the chunk-continuation brief generator (operator lane, Rondo
  round seed).** The standing byte-exact-continuation economics,
  automated: read the capped session's last state, emit the continuation
  brief (the Etude round's V-6 pattern — capped chunks are errors, never
  silent; the continuation carries the state). Candidate: a small
  operator script. Metric: continuation chunks needing operator
  correction → 0; operator minutes per resume. Stage: PROPOSE.
  **Evidence accrual 2026-11-06 (the twentieth lineage)**: three
  continuation briefs authored this round (A2H-8 chunk 2, A2H-10 chunks
  2+3) — zero required re-dispatch correction (each resumed session
  continued productively on first contact), but TWO new taxonomy
  entries feed the generator's design: the V-11 template-literal law
  (never brief raw backticks into a template literal — the generator
  must escape them) and the V-15 pins-first completion pattern (when a
  chunk dies pre-test, the continuation should INJECT the operator's
  pin set, not just the state). The C-1 lane's V-11/V-12 envelope
  taxonomy (preamble-stop + cap-abort-mid-stream) adds the envelope
  parsing the generator needs. Stage: PROPOSE (the automation itself
  is not yet built; the round's remaining C-tickets are its evidence
  surface).
  **BUILT + LIVE-CANARIED 2026-11-06 (the twenty-fourth lineage)**: the
  generator now exists — `.a1/scripts/a1-continue.py` on the operator
  lane (durable, the V-2 rebuild class): reads the dispatch envelope
  log (a1-dispatch.py's capture), locates the session file by id,
  parses the state (the original brief verbatim, the tool census, the
  files written, the commands already run, the last settled assistant
  words), applies the V-11 backtick-escape law to every carried
  fragment, injects the operator's `--pins` set per the V-15 law, and
  computes the V-5(a) raised cap (prior session turns + chunk budget)
  for the `--resume <id> -p <brief>` dispatch. **The live canary**: a
  genuine V-12 capped chunk (the H-10 gate-design research dispatch,
  6 turns, cap-abort-mid-stream, empty result) → the generator emitted
  the 3,972-char continuation brief as-is (zero operator edits) → the
  resumed session completed the full four-section artifact in 7 more
  turns (13 total, subtype success, capped false) — **continuation
  chunks needing operator correction: 0** (the metric's first live
  data point, on a real research artifact that this registry's H-10
  row now cites). Two generator defects were caught and cured AT BUILD
  by the canary itself: (a) stderr pollution broke the envelope JSON
  parse — the cap notices ride stderr; the parser now extracts the
  LAST `{"type":"result"}` line from clean stdout (the V-12 lesson
  re-learned at the tooling layer); (b) the bare `unown` PATH lookup
  failed in the subprocess context — the H-8 env-overridable
  binary-resolution law applied. Stage: **PROPOSE → CANARY** (the
  activation is verified on this lane's every dispatch; the promotion
  gate needs the round's full continuation tally — C-7's own chunks
  and the teardown window's H-10 paired runs are the remaining
  evidence surface).
  **Second canary point 2026-11-06 (the same lineage, a different task
  shape)**: the C-8 prep-research dispatch (read-only survey, the
  import/export design inputs) — chunk 1 capped at 6 turns mid-research
  → the generator emitted the brief WITH the operator's `--pins` set
  injected (the V-15 law: "committed golden files, deterministic
  dry-run reports") → the continuation completed the full 11,087-char
  four-section artifact at 14 turns, subtype success, **zero operator
  correction — and the artifact's own verdict line cites the pins as
  complied-with** ("Pin-compliant: committed golden files,
  deterministic dry-run reports — no timestamps"): the pins-first
  pattern demonstrably rode into the output. Canary tally: **2/2
  continuations, 0 corrections** (two task shapes: a gate-design
  research task and an import/export survey). The honest gap the
  artifact itself flags (the golden-file layout is NOT derivable from
  the house patterns — Coda/Ostinato carry neither committed goldens
  nor a regeneration story; the recommendation is the C-8 brief
  author's decision, not an inherited convention) is recorded for the
  C-8 brief author at `.a1/logs/c8-prep-chunk2.json` (operator lane).
  **Pattern-tally accrual 2026-11-06 (the twenty-fifth lineage, the
  V-40-era stress test)**: 8 more continuation dispatches across two
  sessions under the output-token ceiling — the C-10 capture session
  (`01a1b15e…`, 3 continuations: the split-write law's first exercise,
  the §3.7 operator-derivation fix handoff, the A2H-14-unblocked
  completion) + the A2H-14 fix session (`01a1b169…`, 4 continuations:
  the pin-writing completion, the edit completion, the acceptance
  lanes, the real-run receipt) — **every continuation resumed
  productively on first contact, 0 brief corrections needed, 0
  misfires** (the caps were the 4096-token ceiling's turn-budget
  artifacts, not brief failures). Honest scope: these 8 were
  HAND-authored per the generator's laws (the state carry, the pins
  injection, the derivation handoff) — the PATTERN's tally, not the
  generator's emission tally (which stays 2/2). The V-40 ceiling makes
  the continuation shape the DEFAULT dispatch mode, raising the
  generator's value: at 4096 output tokens/run, multi-chunk is no
  longer the exception. Pattern tally: **10/10 continuations, 0
  corrections** across four task shapes and three lineages.
  **The closeout disposition (2026-11-06, the twenty-fifth — the
  round's formal close): H-12 STAYS AT CANARY.** The promotion gate's
  five requirements: the metric bar met (zero corrections, the
  canary + the tally), regression-neutral, no product surface, $0
  metered — but **requirement 5 (retention) FAILS HONESTLY**: the
  generator lives at `.a1/scripts/a1-continue.py` on the OPERATOR
  lane — off-repo, and the sandbox recycle claimed it with the
  twenty-fourth's lane (the V-2 class's eleventh victim; the
  twenty-fifth's rebuilt `.a1/` carries no a1-continue.py — verified
  at the close). The fix is named for the next round's first AUGMENT
  act: rebuild the generator from the receipts' design description
  (the registry row above IS the spec) and COMMIT it in-repo
  (`scripts/a1-continue.py`, the tui-capture lane's home) — then the
  promotion gate re-runs on the retained artifact. The pattern LAWS
  it encoded (the state carry, the V-11 escape, the V-15 pins
  injection, the raised cap) are already standing operator practice —
  the tally stands as the pattern's evidence regardless of the
  artifact's loss.

  **The Scherzo rebuild (2026-11-07, the twenty-sixth lineage's Phase 0 —
  the Rondo closeout's named first act, executed): the generator REBUILT
  from this row and COMMITTED IN-REPO at
  [`scripts/a1-continue.py`](../scripts/a1-continue.py), extended beyond
  the row (session-file location by id, tool census, files-written
  state, `--exec` through the dispatch helper). Retention by
  construction. THE CONVERGENT DUAL (2026-11-07, the V-23 class's
  fourth event): the parallel Sonata track independently rebuilt and
  committed the same mandate within the hour — the Scherzo artifact
  GOVERNS (first landing), the Sonata draft folds as the converging
  trail (preserved operator-side at the Sonata lane's artifacts). The
  promotion gate re-runs on BOTH rounds' continuation tallies.**

A2-side candidates (skills, subagents, hooks, review checks) enter at
PROPOSE only from receipted failures observed during O-ticket driving —
none exist at Phase 0, by design.

## Inherited standing practice

Carried into this engagement unchanged, receipted in prior round logs
(not this registry's promotions): fresh sessions per ticket (the 570 KB
context-degradation lesson); the double-fork dispatch daemonizer
(`scripts/dispatch-bg.py` off-repo); push the round-opening claim before
dispatch; incremental receipts from chunk 1 with the first-poll EXISTENCE
check; the fairness laws (pristine-vs-current A/B, strictly-sequential
re-trials).

## Related pages

- **H-21 — truncation-aware continuation (operator tooling, 2026-11-07; the V-12 conversion + the pi-teardown routing).** Hypothesis: when a session tail shows k>=2 consecutive "Tool call was not executed: the response hit the output token limit" refusals, the continuation brief must AUTO-INJECT the V-40 split-write mechanism ruling (the exact pin that cured V-12, fired by evidence instead of operator memory). Baseline exists on file: the V-12 envelope (8-turn burn, 33K output tokens, zero tree change). SHOULD fire on any capped chunk whose session tail carries the signature; SHOULD-NOT on ordinary caps (no signature → no pin, zero overhead). Gate design: paired A/B on replayed frozen sessions with the signature present vs absent; graders = loop-burn turns (target: the 8-turn class -> <=1) + tree-change-per-chunk + tokens. Upstream kin: pi #11227/#11233 fixed the session-poisoning variant at the harness layer (our chassis predates it — the teardown's drift-audit ticket decides the rebase question). Stage: **CANARY** (2026-11-07, the Serenade round's 33rd lineage — the build landed in-repo: a1-continue.py now scans the session tail for the k>=2 consecutive output-limit refusal signature [the exact agent-loop.ts refusal text pinned] and AUTO-INJECTS the V-40 SPLIT-WRITE law when it fires; the deterministic paired A/B green 8/8 [scripts/a1/test-a1-continue.py: signature-present k=3 injects with the counted k · clean tail zero-injection · k=1 zero-injection · mid-session-escaped refusals zero-injection — the SHOULD-NOT laws encoded]; the LIVE promotion evidence — a genuine capped chunk whose tail carries the signature, the continuation landing without the loop-burn, turns-to-done measured — accrues on the round's remaining dispatches; the H-12 promotion precedent: promoted on a genuine capped chunk, zero operator correction). The a1-dispatch PROCESS-CLEANUP auto-append of V-13 is its shipped little sibling — the same evidence-triggered-brief-append pattern, already live.
- **H-22 — the dream-render diff log (operator lane, 2026-11-07; the V-15 escalation — the #46 class, FIFTH occurrence).** Hypothesis: every memory re-render keeps a unified diff of previous -> new project.md (ring buffer, last N=16, operator-side), and the standing close gate gains a one-line check: a diff that deletes ANY landing-quoted line flags BEFORE commit (the V-8 law automated). Baseline: five hand restorations on file (2026-11-01 x2, 11-02, 11-07 x2 — the fifth took the ENTIRE restored durable lane). SHOULD fire on every render; SHOULD-NOT never (it is a log, not a gate on the render itself — AutoDream is untouched). Gate: inject a pruned memory file, assert the flag reddens (the V-8 §5 benchmark candidate, now with a designed detector); paired delta = close-gate catches with/without the log across the next round's renders. Stage: GATE — THE ARTIFACT LANDED 2026-11-07 (scripts/a1/memory-guard.mjs, the thirty-first lineage, at the NINTH occurrence: the second ENTIRE durable-lane loss in one day — the 30th's F-7-item-1 session renders took the whole Manual-notes lane + the Environment heading, caught at the 31st's commit boundary by hand, cured by the standing gate). The gate design test PASSING live: an injected prune reddens (rc=1, the deleted protected lines named: the Environment heading + the durable bullets), a clean diff passes (rc=0), every check appends to the ring buffer (.a1/memory-diffs/, last 16). AutoDream untouched — the flag fires only at the operator's commit boundary. The promotion measure (the paired A/B across the next round's renders) stays open. Upstream kin: Letta's MemFS versioning per the 2026-11-07 teardown.)
- **H-23 — the probe-first rule (operator procedure law, 2026-11-07; the V-14 conversion).** Hypothesis: when a gate failure survives TWO A2 corrective cycles, the operator instruments the live page BEFORE the next dispatch (the scripts/probe-compose.mjs pattern: boot the real app against the real lane, instrument events/mutations/page errors, split handler-wired from propagation-blocked from state-dead). Evidence: cycles 3-5 of F-5 — the probe caught the rerender-stomp, the delete-null invariant throw, and the runs-vs-jobs design conflict in minutes each, after ~250 turns of symptom-layer dispatches. SHOULD fire at cycle 2 of any gate failure; SHOULD-NOT on first-failure dispatches (A2 gets its two honest attempts). Metric: corrective cycles per caught defect (F-5's 5 -> target <=2) + the turns-to-correct ratio. Stage: PROPOSE as a standing operator law (the harness artifact joins the a1 toolchain); the playbook amendment lands at the F-6 review per the every-3-tickets cadence.
- **H-24 — the live-traffic fixture refresh (operator lane, 2026-11-07; the 2026-11-07 contract-honesty teardown's pick). PROMOTED 2026-11-07 by the Serenade round's 33rd lineage (the split-lane augment duty; [the receipt](../benchmarks/serenade-round/receipts/h24.md)) — the full lifecycle in one session, honestly receipted.** Hypothesis: the fixture server's canned JSON REGENERATES from recorded live engine responses (a record mode on the H-23 probe instrument: capture the live wire's actual responses per endpoint, emit them as the fixture files with provenance + timestamp). The V-15 law mechanized: the fixture cannot fossilize into the V-24 fiction because its source IS the live wire; the contract pins verify against refreshed fixtures + the live probe stays the final gate (the replay-tools' core move, per the MCP replay-testing source). Baseline: V-24 — FOUR fixture-fictions in one ticket (numeric ids, the notes shape, the automation_runs history shape, the camelCase-only pins), each caught only by live-lane grind (~590 turns F-6). SHOULD fire at every fixture-consuming ticket's open (refresh-then-build); SHOULD-NOT on pure-domain tickets. Gate design: paired A/B on a deliberate wire change (rename a field on a stub engine): the refreshed-fixture lane reddens at the contract pin vs the stale fixture passing (the false-confidence delta, directly measured). Upstream kin: Pact provider-verification-by-replay; the MCP replay tool; Schemathesis. **The promotion evidence (the receipt's numbers): the FIRST refresh against the live engine caught THREE dormant fiction pins at refresh-time (overview.version object, the notes uuid/content/epoch shape, the spend total/routines shape — the third UI-DEAD via safeSpend's masked drift, the panel silently showing "No spend data" over a live wire); the pins dual-laned per the assertMemories precedent, mapNotes raw-passthrough, mapSpend new (the spend panel ALIVE against the real engine); the paired A/B gate MEASURED the pre-registered delta (stale lane exit-0 GREEN wire-blind vs refreshed lane exit-1 RED at notes[0].text on the same deliberate content→note_body rename); the battery green (fugue lanes 300/0/939, root 2727/0/215 typecheck 0, e2e 23+1 skipped); the artifacts committed in-repo (fixture-refresh.mjs, fixtures-live.gen.ts + the lane, live-wire e/f/g/g2 pins, h24-gate.mjs) — retention by construction; the refresh-then-build law in docs/fugue.md's Test-it table.** Stage: **PROMOTED** (the fixture-server seed-from-recording swap is the named follow-up for the next fugue-touching ticket — receipted scope note).
- **H-25 — the drift-pin classification ladder (the app contract lane, post-round candidate, 2026-11-07; the teardown's second pick).** Hypothesis: the contract pins gain the MCP guide's block/review/allow classes — breaking (field removed/type narrowed/required added) reddens the ticket gate; review-worthy (vocabulary widened, optional field added, description-level change) receipts a note; additive-safe stays green. The binary drift pin's quiet-change blind spot (a vocabulary or description change passes the pin while behavior shifts — the MCP source's sharpest class: "No error is raised. The task simply stops completing") gets a visible middle lane. Anti-scope: touches the app's contract lane — a NEXT-round candidate, filed for the record, no this-round retrofit. Stage: PROPOSE.
- [The Ostinato PRD](ostinato-prd.md) — the Ostinato round's DRIVE vehicle
- [The Etude PRD](etude-prd.md) — the Etude round's proposed DRIVE vehicle
- [The reliability coverage matrix](reliability-coverage-matrix.md)
- [The Ostinato round log](ostinato-round-session.md) · [the Reprise round log](reprise-round-session.md) · [the Etude round log](etude-round-session.md) — the registry's rounds
- [`A2_GROUND_TRUTH.md`](../A2_GROUND_TRUTH.md) — §9 learning-mechanism
  inventory; the augmentation surface's recon base
