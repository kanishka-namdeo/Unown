# The Vivace round — session log

One-line purpose: the resumable log for the Vivace round — the 2026-11-05
DRIVE × AUGMENT × PROVE engagement (the eighteenth lineage) whose vehicle
is **Legato** and whose cargo is driving-improvement evidence.

- Directive: a fresh A1 brief ("clone, setup and run" + the standing
  DRIVE × AUGMENT × PROVE shape, Agnes AI endpoint + GitHub PAT supplied)
  — **a new task, not a resumption**: the Etude round parked intact, the
  Reprise queue stands.
- Opened: 2026-11-05 · **PARKED 2026-11-06 at the triple-incarnation
  reconciliation** — the Rondo round's Chaconne governs (landed on `main`
  first, C-0 closed), Tempo is carry-over #1, Legato parks as carry-over
  #2 with this Phase-0 record + the frozen rig intact. This lineage
  continues the mission inside the Rondo round's queue (A2H-9 chunk 4,
  then C-1) — the dual-incarnation working pattern receipted since
  Coda-C4. Phase 0 stood COMPLETE at park time; no V-ticket ever ran.

## Mission

Ship a real app **through A2** (Unown) while proving that driving A2 got
cheaper and better: turns-to-done trending down, augmentation deltas
receipted against frozen baselines, improvements retained across
sessions. The app is the vehicle; the proof is the cargo. Two tracks,
never shared hands: DRIVE (tickets through A2; A1 never writes app code)
and AUGMENT (operator-side authoring, evidence-gated promotion).

## Operator decisions (pre-registered, 2026-11-05)

1. **Round name**: Vivace (the tempo marking; the lineage counter rolls
   to eighteenth).
2. **Vehicle**: **Legato** — offline-first, keyboard-first read-later /
   web-clip PWA at `apps/legato/` — selected by the §0.9 scoring record
   in [the PRD](vivace-prd.md) over Tempo (parked with Etude) and an
   Aria-shaped SaaS (Tractability=1 infra risk). Predicted failure
   classes on file: P1 hostile-page clipping, P2 cross-session schema
   drift, P3 e2e keyboard flake, P4 schema-output prose-wrapping.
3. **Model lane**: `zai-bridge/agnes-3.0-flash` (bridge →
   `https://apihub.agnes-ai.com/v1`), effort default; the provider
   abstraction stays swappable.
4. **Bun**: 1.4.4 (this lineage upgraded from the container's 1.3.14; the
   prior lineages pinned 1.4.3 for bun#46510 — the battery receipt below
   is the 1.4.4 evidence; repin if any lane reddens).
5. **Home shape**: default `~/.unown` (drift from the prior
   `unown-home` convention — both supported; logged in ground truth §10).
6. **Seed hypotheses** at PROPOSE: H-10 (hostile-page-clip skill), H-11
   (schema-contract memory rule), H-12 (schema-strict-final lane) —
   [the registry](a1-augmentation-registry.md).

## Environment checkpoint (receipted 2026-11-05, tree `18e4a98a`)

- **Clone**: fresh `git clone` of `main` @ `18e4a98a` (PAT in the remote
  per the standing convention; PAT identity verified via the GitHub API
  before the clone).
- **Install**: `bun run agent:install` → **7/7 steps green** (bun 1.4.4;
  the engine-service step reports the documented container/systemd
  caveat — the stack is started by `agent:start` instead, which is the
  supported lane here).
- **Upstream**: Agnes AI pre-verified by hand before any agent run —
  `POST /v1/chat/completions` → `AGNES-OK` (87 tokens).
- **Bridge** `:3031`: `ok:true`, upstream 200, key set, **9 live models**
  (agnes-3.0-flash default), lanes 3 concurrent / 400 ms / 45 s yield.
- **Engine** `:3030`: ready, v0.0.56 @ `18e4a98a`, bearer token active
  (unauthenticated curl correctly refused), 9 router jobs scheduled.
- **Doctor**: "unown is ready to chat" — 19 ✓ / 2 ⚠ (the honest pair:
  model-spec self-heal before first session + LSP absent in-container).
- **Calibration canaries** (frozen rig
  [`run-canaries.sh`](../benchmarks/vivace-round/run-canaries.sh), stamp
  `20261105T202532Z`): **C1 PASS · C2 PASS · C3 content-pass +
  schema exit 3** — the V-3 class (prose-wrapped JSON) is the round's
  first measured improvement target. Full evidence:
  [the validation log](../benchmarks/vivace-round/validation-log.md).
- **Pre-ticket battery** (bun 1.4.4, this lineage's fresh tree): see the
  table below — every lane green at Phase 0.

| Battery lane | Result (2026-11-05, this 2-core container) |
|---|---|
| typecheck | 0 errors |
| lint | 0 errors / 143 warnings |
| unit (`test:unit`) | **2257 pass / 1 fail** / 2258 tests / 161 files — the one failure is **B-17** (see below); CI is green on the same commit |
| check:docs | ok |
| check:changelog | 55 stops / 540 entries / 54 dated |
| check:blog | 46 posts / 116 tags |
| check:benchmarks | 6/6 resolved |
| check:claims | 62/62 literals |

**B-17 (registered, queued as VH-1)**: the encore finale h2 test
(`src/components/encore/__tests__/encore.test.tsx:817`) fails
deterministically in the FULL suite in this container (4/4 runs, bun 1.4.3
AND 1.4.4, with and without the changelog-data revert) but passes
isolated and with sibling files; GitHub CI's "Build + test (ubuntu-latest)"
is **success on the same commit `18e4a98a`** (check-runs receipt,
2026-11-05). Classification: environment-sensitive test-isolation defect
(2-core load exposes cross-file DOM/state interference the CI runner does
not). The operator's first battery draft claimed "ALL GREEN 2235/0" from
the prior lineage's receipt — corrected to the measured numbers before
commit (the receipt-overclaim law applied to the operator's own draft).

## Validation log

Lives in
[`benchmarks/vivace-round/validation-log.md`](../benchmarks/vivace-round/validation-log.md)
— V-1 (the stdin pipe lesson), V-2 (the rig's fixture-pin fix), V-3 (the
C3 schema class), V-4 (bun test's stderr summary). The §5 reflex applies
from V-1 forward: every genuine-gap failure converts to a frozen,
rerunnable benchmark before the ticket moves on.

## Bug register

- **B-17** (2026-11-05, OPEN — queued as hardening ticket VH-1): encore
  finale h2 test fails in the full unit suite in this 2-core container
  (deterministic 4/4) while passing isolated; CI green on the same commit.
  Environment-sensitive test isolation — the fix lane is test hygiene
  (cleanup between files / the shared happy-dom document), through A2.

## Ticket queue (the drive roadmap)

| Ticket | Lane | Deliverable | Status |
|---|---|---|---|
| V-1 | Planning + Engineering | scaffold `apps/legato/` via plan-mode ticket | NEXT |
| V-2 | Architecture + Engineering | storage core + schema v1 + migration frame | queued |
| V-3 | Engineering | clip pipeline + error taxonomy + freeze B-16 | queued |
| V-4 | Engineering + Quality | search index + ranking tests | queued |
| V-5 | Engineering | UI shell + palette + theming + a11y | queued |
| V-6 | Engineering | reading queue + states | queued |
| V-7 | Engineering | tags + filters | queued |
| V-8 | Engineering | highlights/annotations | queued |
| V-9 | Quality | byte-stable import/export + Markdown | queued |
| V-10 | Operations | PWA offline + offline e2e | queued |
| V-11 | Quality | the e2e battery + hostile-clip e2e + cross-browser smoke | queued |
| V-12 | Collaboration + Learning | docs, README, blog, CHANGELOG + the learning harvest | queued |

Ticket protocol (inherited): fresh session per ticket · PROMPT-ECONOMY
header (ALLOWED/FORBIDDEN inputs, OUTPUT_ARTIFACT, HANDOFF_SCHEMA,
EFFORT_BUDGET, NON-OVERLAP) · pre-flight canaries armed (C1 smoke +
doctor + engine status) · `< /dev/null` on every dispatch (V-1) ·
receipts verified against the tree, never trusted (H-2) · no commits
unless the ticket says so · QA before the next feature.

### V-1 dispatch brief (the scaffold ticket — first DRIVE dispatch)

- CWD: `/home/z/my-project/unown` (the repo; the app lands at
  `apps/legato/`)
- MODEL: `zai-bridge/agnes-3.0-flash` · MODE: `--plan` first (the V3
  orchestrator), then execution chunks
- ALLOWED_INPUTS: `apps/ostinato/**` (the lane's reference shape),
  `apps/coda/**` (the second reference), `package.json`, `docs/vivace-prd.md`
- FORBIDDEN_INPUTS: everything under `src/` (the landing — out of scope),
  `.unown/**` state, any secrets
- OUTPUT_ARTIFACT: `apps/legato/` — `index.html`, `src/` (main.ts,
  app.css), `serve.mjs` (the static server twin of ostinato's), a
  `README.md`, `package.json`-scoped unit harness (`bun test`), and the
  `AGENTS.md` lane note; plus a plan file at `.unown/plans/v1-scaffold.md`
  when plan mode writes one
- CHECKS: `bun test apps/legato` green; `bun run typecheck` still 0;
  `bun apps/legato/serve.mjs` serves the shell at the printed port; NO
  commit (the operator gates + lands)
- EFFORT_BUDGET: ≤ 10 turns per chunk, ≤ 4 chunks
- NON-OVERLAP: no storage schema (V-2), no clip logic (V-3), no UI
  beyond the empty shell + one static view (V-5)

## Resume instructions

1. Re-verify the stack: `curl localhost:3031/health` and
   `curl localhost:3030/api/overview` (with the engine token from
   `data/self-learning/engine.token`); `bun run agent:start` if the
   sandbox recycled (the known container limit).
2. Re-run the canary rig (one command, ~40 s):
   `bash benchmarks/vivace-round/run-canaries.sh` — expect C1 PASS, C2
   PASS, C3 SCHEMA-FAIL (the V-3 class). Any other result: diagnose
   before dispatching (§3.2 — the platform moved).
3. Read this log + [the PRD](vivace-prd.md) + the
   [validation log](../benchmarks/vivace-round/validation-log.md); the
   ticket queue above is the backlog.
4. Dispatch the next ticket's brief (V-1's is above) with the ticket
   protocol; pin everything per §3.2.

## Related pages

- [The Legato PRD](vivace-prd.md) · [the suite](../benchmarks/vivace-round/README.md)
  · [the validation log](../benchmarks/vivace-round/validation-log.md)
- [SESSION.md](SESSION.md) (the index) · [A2_GROUND_TRUTH.md](../A2_GROUND_TRUTH.md)
- The prior DRIVE round: [Ostinato](ostinato-round-session.md) (the lane
  Legato inherits); parked: [Etude](etude-round-session.md) (Tempo),
  [Reprise](reprise-round-session.md)
