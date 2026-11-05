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
- Status: OPENED 2026-11-04; the Ostinato round closed 2026-11-04 — promoted rows: 2 (H-6, H-4); the **Reprise round opened 2026-11-05** — **promoted rows: 3 (+H-8, A2H-4, 2026-11-05)**; H-1/H-2/H-3 carry live records at PROPOSE; the Reprise round PARKED 2026-11-05 (a fresh directive opened); the **Etude round opened 2026-11-05 EMPTY** — one PROPOSE on file (H-9, that round's opening harvest); the round's validation log lives in [the round log](etude-round-session.md) + [the benchmark validation log](../benchmarks/etude-round/validation-log.md); the **Rondo round opened 2026-11-06** (the fresh DRIVE × AUGMENT × PROVE directive) — **H-9 PROMOTED by the CONVERGENT DUAL operator decision** (both parallel lineages promoted it independently on the same receipts — the Rondo round's opening call and the Etude lineage's own E-0-gate decision; promoted rows: 4), **H-10/H-11/H-12 opened at PROPOSE** (the round's pre-registered seed hypotheses); the round's validation log lives in [the round log](rondo-round-session.md) + [the benchmark validation log](../benchmarks/rondo-round/validation-log.md)

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
- **H-11 — the stdin-guard dispatch helper (operator lane, Rondo round
  seed).** V-1's cure formalized: every `-p` dispatch in this harness
  must guard stdin (inline `< /dev/null`; `stdio:["ignore"]` in
  spawned runners — the polyglot runner's standing pattern, now law).
  Candidate form: a one-line operator wrapper with a bounded timeout +
  envelope capture, so the law is enforced by tooling not memory.
  Metric: hang-class dispatch failures → 0 across the round (V-1 is the
  spawning receipt). Stage: PROPOSE.
- **H-12 — the chunk-continuation brief generator (operator lane, Rondo
  round seed).** The standing byte-exact-continuation economics,
  automated: read the capped session's last state, emit the continuation
  brief (the Etude round's V-6 pattern — capped chunks are errors, never
  silent; the continuation carries the state). Candidate: a small
  operator script. Metric: continuation chunks needing operator
  correction → 0; operator minutes per resume. Stage: PROPOSE.

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

- [The Ostinato PRD](ostinato-prd.md) — the Ostinato round's DRIVE vehicle
- [The Etude PRD](etude-prd.md) — the Etude round's proposed DRIVE vehicle
- [The reliability coverage matrix](reliability-coverage-matrix.md)
- [The Ostinato round log](ostinato-round-session.md) · [the Reprise round log](reprise-round-session.md) · [the Etude round log](etude-round-session.md) — the registry's rounds
- [`A2_GROUND_TRUTH.md`](../A2_GROUND_TRUTH.md) — §9 learning-mechanism
  inventory; the augmentation surface's recon base
