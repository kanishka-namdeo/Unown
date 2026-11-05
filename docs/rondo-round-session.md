# The Rondo round — session log

> **Status: OPEN 2026-11-06** — opened by the **eighteenth lineage** under a
> FRESH A1 directive (the standing shape: **DRIVE A2 × AUGMENT A2 × PROVE
> IT**). The Etude round is PARKED with its E-0 approval gate unresolved —
> its Tempo proposal was scored as ONE candidate among four per the fresh
> directive's §0.9 selection procedure and not auto-accepted; nothing
> standing was deleted. See [SESSION.md](SESSION.md).

One-line purpose: the Rondo round's resumable checkpoint log — mission,
operator decisions, environment checkpoint, validation log, ticket queue,
dispatch briefs, the §0.9 selection receipt, gate receipts, resume
instructions.

**Mini-TOC**

- [Mission](#mission)
- [Operator decisions](#operator-decisions)
- [The §0.9 selection](#the-09-selection)
- [Environment checkpoint](#environment-checkpoint)
- [Validation log](#validation-log)
- [Bug register](#bug-register)
- [Ticket queue](#ticket-queue)
- [First dispatch brief](#first-dispatch-brief)
- [SDLC coverage and learning-mechanism plan](#sdlc-coverage-and-learning-mechanism-plan)
- [Seed augmentation hypotheses](#seed-augmentation-hypotheses)
- [Resume instructions](#resume-instructions)
- [Related pages](#related-pages)

## Mission

A new A1 engagement opened 2026-11-06 with a directive that supersedes the
Etude shape in scope while keeping its spine: one ambitious real-world
project serving simultaneously as (a) production build, (b) stress test of
A2's capabilities, (c) validation of A2's learning architecture, (d)
benchmark programme measuring whether A2 got cheaper and better to drive
while doing meaningful work. The app is the vehicle; the proof is the cargo.
Two tracks, shared learnings, never shared hands: **DRIVE** (ship the app
through A2 — A1 never writes app code) and **AUGMENT** (improve A2 itself at
the extension surface — skills, subagents, commands, recipes, routines,
hooks, review checks, memory rules — authored operator-side, exercised by
A2, receipts prove).

The directive's APP placeholder arrived unfilled; per its §0.9 the vehicle
was selected AFTER recon + four calibration canaries by scored comparison
of four candidates (receipt:
[the benchmark round](../benchmarks/rondo-round/README.md)). **Chaconne** —
a keyboard-first browser-recipe runner at `apps/chaconne/` (compose a
browser flow once; it repeats on demand against fixture pages, capturing
screenshots, extracted values and a run log) — is the selected vehicle
([the PRD](chaconne-prd.md)).

## Operator decisions

Dated rulings opening the round (2026-11-06):

- **Round name: Rondo** — a recurring-theme form: the round's centre of
  gravity is the repeating DRIVE→AUGMENT→PROVE loop over a ground of
  evidence. Verified unclaimed in-repo: the only `rg -i rondo` matches are
  `ChevronDownIcon` substrings and one icon-name list (false positives,
  receipted in the benchmark round's validation log).
- **New task, not a resume.** The Etude round PARKED (its E-0 gate never
  resolved; its A2H-5/A2H-6 fixes stand receipted and CLOSED). The Reprise
  carry-overs (R-3..R-5), the #30 live-hang capture and the standing
  SESSION.md items stay queued as candidates.
- **H-9 PROMOTED** (operator decision, the decision the Etude round
  reserved): the canary evidence is complete — A2H-5/A2H-6 CLOSED through
  A2, wiped-home ×3 per lane + independent operator reruns all exit 0,
  cold-home 0/2 → 2/2, regression bar met (footer 9/9 after the V-7
  engine-drift cure), retention by construction (durable shared-harness
  code), cost $0 metered. The registry row moves to PROMOTED with this
  round's re-open.
- **Selection executed per §0.9, not inherited**: the parked Tempo proposal
  was scored as one of four candidates (Exposure × Generalizability ×
  Value, subject to Tractability ≥ 1 and Measurement = yes) — receipt
  below. The operator approves Chaconne per the directive's own scoring
  rule; the §0.9.5 re-scope trigger stays armed (if after 5 tickets the
  exposure was misjudged, a pivot is proposed, not ground through).
- **Version-bump policy (inherited)**: Unown's `package.json` bumps only
  when Unown itself changes; docs/benchmark/app-round commits ride
  `## [Unreleased]`. A version bump lands with the first Unown-code
  enhancement this round ships.
- **The stdin-guard law (V-1's cure) enters the operator runbook**: every
  `unown -p` dispatch in this harness runs with stdin guarded
  (`< /dev/null` inline; `stdio: ["ignore", …]` in spawned runners — the
  polyglot runner's standing pattern, now mandatory for all A1 dispatches).

## The §0.9 selection

Executed after recon + canaries C1–C4, pre-registered before any app
ticket. The full scoring table, the rejected alternatives and the
pre-registered predicted failure classes live in
[the benchmark round's README](../benchmarks/rondo-round/README.md) (the
anti-retroactivity receipt). Summary: **Chaconne** maximizes Exposure (2)
× Generalizability (2) × Value (2) = 8 subject to Tractability 1 and
Measurement 2 — versus Tempo 1×1×2 = 2 (comfort-zone: the third app of the
same house pattern, no augmentation headroom — the §0.9 anti-gaming
rejection), a third gallery-shaped SaaS 1.5×1.5×1.5 = 3.4 (rehearsed
shape), and a native desktop app (Tractability 0 — rejected per §0.9).

## Environment checkpoint

The eighteenth lineage (this round's opening lineage), 2026-11-06:

- Fresh clone @ `18e4a98a` = `origin/main` (the seventeenth lineage's
  A2H-6 close); 54 tags, 985 commits, clean tree.
- bun **1.4.3** re-pinned to npm-global (`/home/z/.npm-global/bin/bun`) —
  the recycled sandbox had a stale `/usr/local/bin/bun` 1.3.14 below the
  ≥1.4 floor. `fd` **10.5.1** installed (drift note: prior lineage pinned
  10.2.0; 10.5.1 verified working). `chromium_headless_shell-1248` via
  `bunx playwright install chromium`. `pyte`/`pexpect`/`pillow` in the
  persistent venv (`/home/z/.venv`) — all the known recycle-reclamation
  taxes, cured from the bring-up checklist.
- Install **7/7** (`UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun
  scripts/install.ts`), `.env` with the Agnes lane IN PLACE
  (`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`,
  `BRIDGE_MODEL=agnes-3.0-flash`, `BRIDGE_UPSTREAM_KEY` set,
  `UNOWN_HOME=/home/z/my-project/unown-home`).
- The off-repo A1 workspace (`.a1/`) was recycled away with the prior
  sandbox — **recreated this lineage**: the double-fork daemonizer
  `.a1/scripts/dispatch-bg.py` (PPID-1, log + pidfile), the baseline
  battery runner `.a1/scripts/battery.sh`, the canaries dir. Receipted as
  V-2 (the known recycle class, now with a cheaper cure path).
- Stack up via the recreated daemonizer: bridge `:3031` upstream **200**,
  6 agnes models live, default `agnes-3.0-flash`; engine `:3030` ready @
  v0.0.56/`18e4a98a`, bearer token active, 9 router jobs scheduled (fresh
  DB — the known recycle limit).
- Doctor: **"unown is ready to chat"**, 19 ✓ / 2 ⚠ (model-spec — self-heals
  after first session; LSP — the container's honest pair), instruction-set
  audit clean.
- Calibration canaries, all green: **C1** provider-chain smoke ×2 (exit 0,
  2 s / 4 s, `UNOWN_OK` — after the V-1 stdin cure); **C2** doctor gate
  ("ready to chat"); **C3** engine lane (UP, SHA = HEAD, 9 jobs, breaker
  closed); **C4** the DRIVE-lane code canary (a fresh-dir
  fizzbuzz+bun:test task: exit 0 in 13 s, subtype success, exactly 2 files,
  4/4 tests passing — operator-verified by an independent `bun test` run,
  the H-2 tree-verify law).
- Pre-ticket baseline battery at `18e4a98a`: typecheck 0 · lint 0 errors /
  143 warnings · unit **2235/0** across 160 files · check:docs ok ·
  check:changelog ok · check:blog ok · check:benchmarks ok · check:claims
  ok · the ostinato e2e battery **17/17** — the full receipt table in
  [the benchmark round](../benchmarks/rondo-round/README.md).

## Validation log

| ID | Event (dated) | Class | Disposition |
|---|---|---|---|
| V-1 | The opening C1 smoke attempt (`unown -p "Reply with exactly: UNOWN_OK"`, 2026-11-06) hung past a 300 s guard. The session transcript (id `01a1ad49…`) shows the answer WAS produced (`UNOWN_OK`, stop, 2 model calls, ~17 s) but the process never exited; the Bash harness's own wrapper lines (`__workspace_agent_exit_code=$?` …) appear INSIDE the user message — the `-p` run inherited the harness's stdin stream and slurped the script tail into its prompt | prompt-brittleness (operator-harness class, NOT issue #30 — the answer-vs-exit signature differs from the issue's, and the stdin confound explains it) | Cure applied and receipted: stdin guarded (`< /dev/null`) → C1 green ×2 (2 s / 4 s, exit 0). The polyglot runner's `stdio: ["ignore", …]` pattern is now the operator runbook law for every dispatch. A genuine #30 capture stays queued (A2H-7) with the armed watcher |
| V-2 | Sandbox recycle reclaimed the off-repo `.a1/` operator workspace, `unown-home/`, the npm-global bun pin and the pip venv (2026-11-06, bring-up) | infra-flake (the known recycle class, receipted by three prior lineages) | Cured from the bring-up checklist in one pass: bun 1.4.3 re-pinned, fd 10.5.1, playwright chromium-1248, venv, install 7/7, `.env` Agnes lane, stack up. The daemonizer + battery runner + canary scaffolding recreated as durable scripts (`.a1/scripts/`), so the NEXT recycle's cure is `bash` two scripts, not archaeology |

## Bug register

User/operator-visible findings of this round (the B register continues the
lineage numbering — B-1..B-14 live in the Ostinato, Reprise and Etude
logs). **None yet** — B-15 is the next free id.

## Ticket queue

| Ticket | Scope | Verifier (external, named) | State |
|---|---|---|---|
| R-0 | The §0.9 selection gate: candidates scored, vehicle approved, PRD opened | The scoring receipt + the pre-registered failure classes in [the benchmark round](../benchmarks/rondo-round/README.md) | **CLOSED 2026-11-06** (this lineage — Chaconne approved per the directive's own scoring rule; §0.9.5 re-scope trigger armed) |
| C-0 | The architecture plan: the storage/runner/UI decomposition, the fixture-page test strategy, the dependency-law ruling for the runner's playwright import — a read-only `--plan` run with a scored plan file | The plan gate's own score + the operator's review against the PRD's P0 constraints | **NEXT** (first dispatch — brief below) |
| C-1 | The domain core: recipe/step/run types, validation, canonical JSON, atomic store | Lane A unit battery (bun test in `apps/chaconne/`), tsc, lint | QUEUED |
| C-2 | The runner v1: goto/click/fill/select/wait/assert/extract/screenshot against LOCAL fixture pages, honest error taxonomy, run records | Runner unit lane with a fake page adapter + one real-browser smoke against a fixture | QUEUED |
| C-3 | The web app shell: recipe list/create/edit, run history, artifact viewer — keyboard-first, zero-dep, palette, empty/loading/error states | Lane A/B unit + the e2e happy path | QUEUED |
| C-4 | The recurring loop: schedules (interval/one-shot), misfire policy, run history | Unit battery on an injected clock (the Ostinato law) + e2e | QUEUED |
| C-5 | Assertions + artifacts: value checks, screenshot capture with pinned hashes, extraction report | Deterministic fixture battery; artifact sha256 pins | QUEUED |
| C-6 | The e2e battery lane 1: compose → run → artifacts, keyboard-only (K-1 law) | Playwright battery green ×3 consecutive | QUEUED |
| C-7 | The resilience battery: crash-mid-run resume, corrupt-store recovery, offline PWA boot | The R-1 law battery (kill/resume/verify) | QUEUED |
| C-8 | Import/export: byte-stable canonical JSON round-trip, dry-run validation report | Round-trip pin + golden files | QUEUED |
| C-9 | The accessibility battery: axe wcag2a/2aa both schemes, tab-order pin, Esc focus-return | A-1 battery green light AND dark | QUEUED |
| C-10 | The landing band + docs page + usage captures (screenshots of the app in use) | `check:docs`/`check:claims`/`check:blog` + the landing audit | QUEUED |
| C-11 | The runbook + CI gate entry + honest-scope statement | The CI gate config + `bun run chaconne:test`/`e2e` from root | QUEUED |
| A2H-7 | The #30 live-hang capture: the armed watcher (`scripts/issue30_watcher.mjs`) run in both churn lanes during this round's dispatch traffic | A hang capture dir with /proc evidence, or a non-repro receipt with run count | QUEUED (satellite — harness lane) |
| A2H-8 | The #43 browser fill_form iframe-race probe: a fixture-page repro of the iframe fill class through A2's own browser tools, evidence filed upstream | The repro transcript + the upstream issue comment draft | QUEUED (satellite — browser lane) |
| (carry) | Reprise R-3..R-5, the standing SESSION.md items | per their own logs | PARKED (candidates) |

**EFFORT_BUDGET**: C-tickets ≤4 chunks each · each chunk ≤8 turns
(`--max-turns 8`), fresh session per ticket, byte-exact continuation briefs
on every resume (the standing economics); satellites ≤2 chunks.

## First dispatch brief

The C-0 architecture plan ticket — dispatched AFTER the round-opening
commit is pushed (the standing practice: push the claim before dispatch):

```
ROLE: A2 executor — one read-only architecture plan, no code writes.
ALLOWED_INPUTS: docs/chaconne-prd.md (the requirements), apps/ostinato/
  and apps/coda/ (read-only: the house patterns), package.json +
  playwright.config.ts (read-only: the root test lanes), benchmarks/
  ostinato/README.md (read-only: the battery conventions).
FORBIDDEN_INPUTS: pi-repo/ core; mini-services/; src/ (the landing site);
  every write path — this ticket produces a PLAN FILE only.
OUTPUT_ARTIFACT: apps/chaconne/PLAN.md — the architecture plan: module
  decomposition (domain / runner / UI), the file-store schema, the
  fixture-page test strategy, the dependency-law ruling (domain+UI
  zero-dep; the runner may import the repo-root playwright — state the
  exact import mechanism), the ticket-sized build order for C-1..C-11,
  and the three riskiest unknowns with the spike that settles each.
HANDOFF_SCHEMA: the plan file + a one-paragraph summary in the reply.
EFFORT_BUDGET: <=2 chunks x <=8 turns.
NON-OVERLAP: this ticket plans only; C-1 owns the first code write.
ACCEPTANCE: the plan names every PRD P0 item and maps it to a C-ticket;
  every named edge case in the PRD lands in a ticket's verifier; the
  dependency ruling is explicit; no file outside apps/chaconne/PLAN.md
  is written.
```

## SDLC coverage and learning-mechanism plan

The directive's §4 coverage requirement, mapped (every lane ≥ 1 ticket
before Phase 3):

| SDLC lane | Tickets |
|---|---|
| Planning | C-0 (scored plan), the round roadmap itself |
| Architecture | C-0, C-2 (the runner decomposition), C-8 (the canonicalization law) |
| Engineering | C-1..C-5, C-8 (code lanes, unit coverage, type/lint parity) |
| Operations | C-4 (schedules/misfire), C-11 (runbook, CI gate), the engine's own supervision receipts |
| Quality | C-6, C-7, C-9 (the batteries), per-ticket verifier gates |
| Collaboration | C-10 (landing/docs/blog), git discipline per ticket, the round log |
| Learning | the round's memory/dream/skill receipts (below), benchmark minting from failures |

Learning-mechanism validation (the directive's §6c — every advertised loop
intentionally exercised ≥ once, receipted): tiered memory (create → reuse
across C-tickets in the same repo), harness (a genuine-gap failure →
benchmark task → verify → retain, if one occurs), minting (recurring
failure pattern → capability-eval task), consolidation (session notes →
dream → later-ticket benefit), skill generation (repeated procedure →
SKILL.md staged → promoted with paired evidence). A mechanism never
exercised is a coverage-matrix gap, not an assumption.

## Seed augmentation hypotheses

Opened at PROPOSE per the directive's §0.9.4 (pre-registered before the
tickets that will spawn the evidence — the anti-retroactivity law):

- **H-10 — the browser-resilience skill (A2-side)**. Hypothesis: runner
  E2E lanes will hit the fill/iframe/wait defect classes (#43/#44 kin);
  a staged skill encoding the recover-pattern (re-query, retry-with-jitter,
  verify-value-landed) will cut retry churn. Metric: e2e lane flake rate
  and turns-to-green on browser tickets, WITH vs WITHOUT.
- **H-11 — the stdin-guard dispatch helper (operator lane)**. V-1's cure,
  formalized: a one-line wrapper that always dispatches `-p` with stdin
  ignored + a bounded timeout + envelope capture. Metric: hang-class
  dispatch failures → 0 across the round (V-1 is the spawning receipt).
- **H-12 — the chunk-continuation brief generator (operator lane)**. The
  standing byte-exact-continuation economics, automated: read the capped
  session's last state, emit the continuation brief. Metric: continuation
  chunks that need operator correction → 0; operator minutes per resume.

## Resume instructions

For the next lineage resuming this round:

1. Re-clone (or ff-only pull) `origin/main`; verify HEAD matches this
   log's last receipted SHA; re-read this log +
   [`A2_GROUND_TRUTH.md`](../A2_GROUND_TRUTH.md). Preflight with
   `git fetch` + rebase BEFORE every push (a parallel lineage may land
   mid-session — the V-5 lesson).
2. Bring-up (the one-pass cure, V-2's scripts): bun ≥1.4 to npm-global,
   fd, `bunx playwright install chromium`, the venv, `UNOWN_NO_LINK=1
   UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts`, the `.env` Agnes
   lane, stack via `.a1/scripts/dispatch-bg.py stack --cwd
   /home/z/my-project/Unown -- bun run agent:start`, then
   `.a1/scripts/battery.sh` if a baseline re-receipt is needed.
3. Verify the checkpoint: doctor "ready to chat", C1 smoke with stdin
   guarded, `unown engine status` UP at the checkout SHA.
4. Next ticket: the first UNCLOSED row in the queue above; every dispatch
   carries the PROMPT ECONOMY header and the stdin guard.

## Related pages

- [The Chaconne PRD](chaconne-prd.md) — the round's DRIVE vehicle
- [The Rondo benchmark round](../benchmarks/rondo-round/README.md) — the
  baseline, the canaries, the §0.9 selection receipt
- [The reliability coverage matrix](reliability-coverage-matrix.md)
- [The augmentation registry](a1-augmentation-registry.md)
- [`A2_GROUND_TRUTH.md`](../A2_GROUND_TRUTH.md) — the recon snapshot
- [The parked Etude round](etude-round-session.md) — the E-0 gate that
  never resolved; Tempo scored, not forgotten
- [SESSION.md](SESSION.md) — the running index
