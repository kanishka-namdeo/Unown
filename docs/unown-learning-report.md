# The Unown learning report — the five mechanisms, validated on live work

> The mission's learning deliverable: did Unown actually identify
> weaknesses, learn from failures, improve its behaviour, and retain the
> improvements while building real software? This report validates the
> five advertised self-improvement mechanisms against receipts gathered
> **while the agent performed meaningful work** (the four gallery apps —
> Sigil Focus, Sigil Bazaar, Cadence, and the Parley multi-tenant
> support-inbox SaaS — plus the Fugue workflow-platform build). Every
> claim cites its receipt; null results are kept as findings.

- [The five mechanisms, one-line verdicts](#the-five-mechanisms-one-line-verdicts)
- [1 — Tiered memory](#1--tiered-memory)
- [2 — The self-improving harness](#2--the-self-improving-harness)
- [3 — Task minting](#3--task-minting)
- [4 — AutoDream](#4--autodream)
- [5 — Agent skill generation](#5--agent-skill-generation)
- [Failures discovered](#failures-discovered)
- [Lessons learned](#lessons-learned)
- [Memory growth](#memory-growth)
- [Benchmark evolution](#benchmark-evolution)
- [Improvements retained](#improvements-retained)
- [What was NOT validated](#what-was-not-validated)

Related: [the benchmark report](benchmark-improvement-report.md) (the
trajectories) · [the competitor report](competitor-comparison-report.md)
(the design research) · [the parley validation log](../benchmarks/parley-round/validation-log.md)
(the failure→fix ledger) · [the parley session record](parley-demo-session.md)
(the build itself)

## The five mechanisms, one-line verdicts

| # | Mechanism | Verdict | The receipt that proves it |
|---|---|---|---|
| 1 | Tiered memory | **Validated** — memory grew 12 versions during the round and carried real build knowledge that later sessions consumed | project memory v4 → v12; the Parley playbooks + the CSP pitfall (below) |
| 2 | Self-improving harness | **Validated** — the first full closed cycle shipped a verified memory patch from a measured failure | improvement `f0db6ac3` (R1 in the benchmark report) |
| 3 | Task minting | **Validated, with honest gate receipts** — a measured edit-bench failure became a suite task; the solvability gate discarded 2 unsolvable candidates | `swap-if-else-messages` in the suite; the discard record |
| 4 | AutoDream | **Validated** — 50 dreams consolidated 140 notes into 58 memory versions; a dream minted a skill | the SOTA midpoint snapshot; the `test-cadence-domain` lifecycle |
| 5 | Agent skill generation | **Validated** — a recurring procedure (verify the cadence domain) was distilled from notes, staged, verified, and promoted | the promoted `.unown/skills/test-cadence-domain/` |

## 1 — Tiered memory

**The claim to validate:** project memory is created, reused effectively,
previous decisions persist, and memory improves future behaviour.

**Creation and growth (receipted):** the parley lineage's project memory
moved v4 → v12 during the round (snapshot pair
`parley-round/snapshots/{baseline,midpoint}*`); the SOTA lineage's memory
stack grew 7 → 58 versions across 50 dreams and 140 notes
(`sota-round/results/snapshot-{baseline,midpoint}.json`). The terminal
side keeps `.unown/memory/project.md` per project (file-is-truth,
AutoDream-written, with the `## Manual notes` lane that survives every
re-render and the `project.provenance.json` authorship sidecar).

**Reuse (the load-bearing evidence — memory changing later behaviour):**
the parley project memory now contains, verbatim:
- *Task playbooks*: "Parley Phase 3 API step 14 adds shared route-level
  helpers in `api/`, including `_auth.ts` with `sessionFromRequest` that
  traces cookie → verifySignedCookie → liveSession → sessionActor and
  derives role from membership rather than the user row" — a procedure
  distilled from the API-phase sessions, injected into every later
  parley-cwd session (the UI, E2E and review phases consumed it).
- *Known pitfalls*: the frame-hardening gap — "next.config.ts applies
  frame-hardening headers … only for /demo/:path* and /bazaar/:path* …
  extend the header block" — this exact pitfall entry predates the
  Parley UI phase, and the UI phase **shipped the fix** (commit
  `c05c9c2`, "the CSP frame-hardening block for /parley/:path*"): a
  memory entry measurably shaping a later phase's code.
- *Facts*: the domain-layer contracts ("`clock.ts` enforces pin/restore
  round-trips and bans `Date.now()` in the domain layer; `ids.ts` uses
  mulberry32 with deterministic prefixes") — the UI phase's client store
  was written against these without re-deriving them.

**Decisions persisting:** the shipped harness patch (mechanism 2) lives
in project memory v11 and survives re-renders through the Mem0 platform's
event stream (the memory row carries the provenance); the rollback lane
(`/api/memory` + one-key rollback in the dashboard) means every version
is recoverable, and the canary gates guarantee a patch that breaks a
last-passing task rolls back automatically.

**Where memory did NOT help (honest):** the standing finding, twice
reproduced — memory buys efficiency, not correctness (the edit-bench
memory-lift null at 97.2% → 97.2%, `edit-bench/results/memory-lift-2026-10-28/`;
the selfimprove v2/v3 0pp pass-lift with −25.5% duration on agnes). The
mechanism's value on model-tier correctness is bounded by the model; its
value on procedure retention and later-session behaviour is exactly what
the receipts above show. One drift also recorded: early memory entries
carry the predecessor environment's paths (`/home/z/unown`) —
superseded-but-not-yet-pruned provenance, the recency-first
contradiction handling the memory research flagged as the #1 upgrade
target (bi-temporal supersede).

## 2 — The self-improving harness

**The claim:** whenever a meaningful failure occurs, convert it into a
benchmark task, reproduce it, propose improvements, validate that
behaviour improves, and verify the improvement survives reruns.

**The closed cycle (the programme's first in the parley lineage):**
improvement `f0db6ac3`, cycle `4c6a432e`, task `swap-if-else-messages`:
baseline run `864d69da` **failed** (the failure was real and reproduced
in the engine's full-tool sandbox) → the harness mined the transcript for
a root cause (escaped-backtick confusion in template literals) →
proposed a 4-rule patch (extract exact bytes with `od -c`/`repr()` before
replacements; never assume standard escaping for backticks; inspect on
'exact text not found' errors; validate byte-identity with SHA-256 on
byte-exact tasks) → candidate run `b07be91b` **passed**, and the
verify-twice rule ran it twice → **shipped to project memory v11**, cycle
summary: "baseline failed; iteration 1 patch passed twice — shipped".
Wall time: 18:20:35 → 18:32:52 UTC. Receipt:
`parley-round/snapshots/midpoint-2026-10-28184614.json`.

**The loop applied to Unown itself (the SDLC twin):** the F3 envelope
loss (two headless sessions dying with 0-byte results) went through the
same discipline by hand: root cause (two layers — upstream
empty-completion trigger + the CLI's bare `process.exit()` defect),
benchmark (4 pinning tests, `test/print-exit-envelope.test.ts`),
improvement (the `lastResort` hook + `writeSync(1, …)` envelope + the
`forced_exit` subtype, commit `b4cdbbe`), rerun (the workflow resumed
through the same launcher with the fix live), retention (the pinning
tests are the regression net). Receipt:
[the parley validation log, F3](../benchmarks/parley-round/validation-log.md).

**The harness's honest quiet:** 10 of the 11 midpoint cycles answered
`already-passing` — the harness does not manufacture improvements from a
passing suite; it waits for a real gap. The saturated-seed-suite
condition is what hands the loop to task minting (mechanism 3).

## 3 — Task minting

**The claim:** recurring failure patterns become benchmarks, evaluation
tasks, and future regression tests.

**Minted from a measured failure:** `swap-if-else-messages` — the task
EXISTS in the suite because the edit-bench campaign measured
`structural-swap-if-else-006` failing (one of the three failures behind
the 97.2%, receipt `edit-bench/results/rerun-2026-10-21/`), and the SOTA
round converted it into an engine capability task (the F1 decision:
"a measured failure becomes the harness's real gap"). The minted task
then DID what a minted task should: it failed at baseline, drove the
shipped patch (mechanism 2), and now stands in the regression suite
(where the final snapshot's sweep must show it still passing — the
retention check).

**The gate holding:** during the SOTA round, two mined patterns were
**discarded by the solvability gate** — an unsolvable task would burn a
full agent run every cycle, and the gate's rejects are the receipt that
the minting pipeline filters, not floods. The engine's KPI panel tracks
`minted` separately from `seed` (suite: 6 total = 5 seed + 1 minted in
the parley lineage; 9 total = 6 seed + 3 minted in the SOTA lineage at
midpoint).

**Graduation path (design, exercised in the engine's history):** minted
tasks graduate into the regression suite once mastered — the suite's
`graduated` counter is the lane, and the caps (`UNOWN_MAX_MINTED_TASKS`
8, 6 files / 12k chars / 40k total) bound the suite's growth.

## 4 — AutoDream

**The claim:** session notes are consolidated into memory, recurring
procedures identified, later sessions benefit from earlier ones.

**Volume (receipted):** the SOTA lineage: 50 dreams consolidating 140
notes — 24 entries merged, 108 added, 112 pruned — into 58 memory
versions (midpoint snapshot). The parley lineage: 13 dreams / 38 notes /
project memory v4 → v12 (midpoint snapshot). The dream queue drains
before every snapshot (drain-before-snapshot, `drained: true` on the
receipts — counts are completed-consolidation counts).

**The full lifecycle, live (the cleanest single receipt):** a smoke
session's `run:finished` fired `dream-check` (16:03:37 → 16:04:45); the
dream minted `test-cadence-domain` — a real procedure distilled from
real notes ("how to verify the cadence domain") — and staged it under
`.unown/skills-staged/`; the operator verified its claims exactly (62
tests, 2,343 expects — measured, not trusted); the promotion was a human
`mv` (the documented review gate). Notes → dream → mint → stage →
verify → promote: every step receipted in the fugue session record
([docs/fugue-demo-session.md](fugue-demo-session.md)).

**Later sessions benefiting:** the parley UI/E2E phases ran with the
API-phase playbooks in context (mechanism 1's receipts); the E2E session
(8/8 steps green) consumed the seeded-persona and reset-handshake
contracts the earlier phases' notes had consolidated.

**The quarantine lane:** poisoned/structured-attack notes never reach the
extraction LLM (zero-extraction quarantine, `guard.ts`) — the
memory-defense receipts (10/10 poison variants flagged, 0 planted,
0 directives shipped; mpbench 0/50 planted, 0/20 benign false-positives)
are the adversarial validation of the dream's input lane.

## 5 — Agent skill generation

**The claim:** procedures that occur multiple times become reusable
skills that improve later execution.

**The minted skill:** `test-cadence-domain` (lifecycle above) — the
procedure "verify the cadence domain" recurred across sessions (the lib
phase, the review phase, the QA pass); the dream minted it; it was
verified against the measured claims and promoted to
`.unown/skills/test-cadence-domain/`, from where it injects into every
session in that project. The SOTA midpoint counts 2 staged skills.

**Skills the engine's own operation produced (the operator-side lane):**
`recover-failed-cycle` ("Failed harness cycles auto-recover — do NOT
restart the engine", with the recovery procedure), `restart-engine`, and
`pre-commit-engine-check` — the recurring operational procedures of
running the engine itself, distilled, staged, verified, promoted. They
are consumed by every operator session since (this round's sessions
included: the engine's 13 error-class runs auto-recovered exactly as the
skill prescribes — no manual restarts happened).

**The human gate held:** no skill auto-loaded; every promotion was a
verified `mv`. The staged-vs-promoted split is the review point, and the
gate rejected nothing this round only because the solvability gate had
already discarded the unsolvable candidates upstream.

## Failures discovered

The complete ledger lives in the validation logs
([parley](../benchmarks/parley-round/validation-log.md) ·
[SOTA](../benchmarks/sota-round/validation-log.md)); the summary:

- **F3 (Unown defect, fixed):** print-mode forced exits swallowed the
  result envelope — two build sessions lost their results to a hung
  teardown past the +15 s grace. Fixed (the `lastResort` hook +
  `writeSync` envelope + `forced_exit` subtype), pinned (4 tests),
  rerun, retained.
- **F4 (logging gap, documented):** the bridge usage log records
  zero-token rows when the upstream omits the usage frame on an
  otherwise-healthy stream — a reading hazard for degeneracy analysis,
  documented with the repro campaign rather than "repaired" by inventing
  numbers.
- **The upstream empty-completion family (external, guarded):** the
  Agnes flash endpoint intermittently returns 200 streams with zero
  content under load — all three guard layers (bridge degenerate retry,
  pi-ai empty-completion throw, the F11 empty-answer guard) fired as
  designed across the round's occurrences; the F3 fix closed the
  remaining loss path.
- **The E2E phase's three app defects (found + fixed live by the agent):**
  the remote session's E2E pass (commit `9ea0a4f`) found and fixed three
  real defects in the parley UI during the live browser pass.
- **The null results kept as findings:** the memory-lift null (twice),
  the harness's `already-passing` quiet, the recency-first contradiction
  drift (one stale-path entry) — the programme's discipline is that a
  null with a receipt IS a result.

## Lessons learned

1. **Memory buys procedure and efficiency; correctness comes from the
   loop's mechanisms, not the memory lane.** (Twice-reproduced null +
   the shipped patch as the counter-example.)
2. **A learning claim without a drained-and-captured receipt is not a
   claim** (the ZCode lesson, adopted as the snapshot discipline).
3. **Boundedness must never cost the caller its result** (F3 — the fix
   pattern: every forced exit writes its envelope first, fail-open).
4. **The unattended-caller contract is: stdin /dev/null, stdio to files,
   intermediate-exit spawn, envelope polled from the log** (F0/F2,
   re-verified on this host as F5 by the predecessor).
5. **Fetch-before-every-phase-launch** — two live operators on one repo
   reconciled through the repo itself (the continuity event in the
   parley session record).
6. **Verified absences are findings** — the competitor corpus's
   `[V-absence]` tier found more truth than any marketing page.

## Memory growth

| Lineage | Start | Midpoint | Growth | Receipt |
|---|---|---|---|---|
| Parley project memory | v4 | **v12** | +8 versions (incl. the shipped patch at v11) | `parley-round/snapshots/midpoint-*` |
| SOTA memory stack | 7 versions | **58 versions** | +51 across 50 dreams | `sota-round/results/snapshot-midpoint.json` |
| Parley notes → dreams | 15 notes / 5 dreams | 38 notes / 13 dreams | the input lane doubling | same |
| SOTA notes → dreams | 20 / 11 | 140 / 50 | the consolidation engine at scale | same |
| Hook decisions | 127 | 1,733 | the guard stack's decision volume | same |

## Benchmark evolution

The suite grew with the work: the parley lineage's benchmark suite went
from 5 saturated seed tasks to 6 (the minted `swap-if-else-messages`,
whose baseline failure converted the suite from a formality into a real
measurement — pass rate honestly dipping 100% → 70% at midpoint because
the suite now contained a task the agent actually fails); the SOTA
lineage's suite reached 9 (6 seed + 3 minted). The measurement framework
itself evolved through the rounds — from ad-hoc baseline tooling to the
committed REST-based snapshot driver (`64573b6`), the drain-gate, the
holdout rule, and the cost columns. Full trajectories:
[the benchmark report](benchmark-improvement-report.md).

## Improvements retained

- **The harness patch (R1)**: shipped at project memory v11; the
  retention check is the final snapshot's regression sweep (pending
  receipt at round close — the sweep must show `swap-if-else-messages`
  still passing with the patch live, and the patch's memory row still
  present).
- **The F3 envelope fix (R2)**: retained by construction — the 4
  pinning tests run in the engine unit suite on every CI pass; the
  contract is documented in three places (CHANGELOG, BEHAVIOR.md,
  usage.md).
- **The skills**: retained in `.unown/skills/` (the promoted lane) —
  `recover-failed-cycle` demonstrably retained (this round's 13
  error-class runs recovered with zero manual intervention, exactly as
  the skill prescribes).
- **The null findings**: retained as receipts (the memory-lift lane is
  re-runnable against any future memory candidate via
  `UNOWN_BENCH_MEMORY_LIFT=1`).

## What was NOT validated

The honest boundary of this round's validation:

1. **Long-horizon retention (>1 day)** — the retention checks cover the
   round's own lifetime; a multi-day regression sweep is future work.
2. **Cross-project transfer** — every shipped improvement is
   project-scoped by design; the hoist gate (2-project recurrence)
   exists but did not fire this round.
3. **Skill-execution improvement measurement** — the skills lane proved
   mint → verify → promote → consume, but a paired run "with skill vs
   without" (the Codewhale SKILL_EVALUATION shape) was not executed;
   noted as the follow-up.
4. **Model-tier lift** — deliberately out of scope (matched-model
   design); the flash model's ceiling is the model's, not the loop's.
