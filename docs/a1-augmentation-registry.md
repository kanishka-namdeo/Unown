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
- Status: OPENED 2026-11-04; **the Ostinato round closed 2026-11-04** — promoted rows: 2 (H-6, H-4); H-1/H-2/H-3 carry live records at PROPOSE; the round's validation log lives in [the round log](ostinato-round-session.md)

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

## Queued hypotheses

PROPOSE-stage candidates (none canaried, none promoted):

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
  across 3 consecutive runs of every standing lane.
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

- [The Ostinato PRD](ostinato-prd.md) — the DRIVE vehicle
- [The reliability coverage matrix](reliability-coverage-matrix.md)
- [The round's session log](ostinato-round-session.md)
- [`A2_GROUND_TRUTH.md`](../A2_GROUND_TRUTH.md) — §9 learning-mechanism
  inventory; the augmentation surface's recon base
