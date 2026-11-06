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
- **The dual-incarnation reconciliation (V-7, 2026-11-06)**: a parallel
  incarnation of the same eighteenth lineage landed the Etude round's
  E-0 resolution (Tempo APPROVED with amendments, the E-1..E-6 queue
  formed, market research receipted) and worked A2H-9 within this round,
  mid-session. The ruling: both threads' evidence stands; the VEHICLE
  question is governed by the directive's §0.9 letter — a proposed idea
  must be scored, not auto-accepted — so Chaconne stays the active
  vehicle and the Etude-approved Tempo becomes the designated §0.9.5
  re-scope fallback (its market-research evidence base ready).
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

The nineteenth lineage (the resume lineage), 2026-11-06:

- Fresh clone @ `1e4e840b` = `origin/main` (the eighteenth lineage's
  session-checkpoint commit — B-18 filed, the Rondo queue's continuation
  state updated); 54 tags, 994 commits, clean tree. Clone path drift:
  `/home/z/my-project/work/unown` (the prior `/home/z/my-project/Unown`
  was recycled away; all off-repo tooling re-pathed to match).
- Recycle taxes cured in one pass (the V-2 class, seventh rebuild of the
  operator tools): npm-global bun **1.4.3** re-pinned (the 1.4.4 install
  was downgraded back to the deliberate pin per bun#46510), `fd` 10.2.0
  (prior lineage's 10.5.1 URL drifted; 10.2.0 verified working), the venv
  re-pipped (`pyte`/`pexpect`/`pillow`), playwright chromium, install
  **7/7**, `.env` Agnes lane in place, `UNOWN_HOME` recreated fresh.
- The `.a1/` operator workspace REBUILT as durable scripts
  (`dispatch-bg.py` — double-fork daemonizer with PID-tree stop;
  `battery.sh` — the nine-lane receipt runner; logs/pids/canaries dirs).
  The git PAT moved to the credential store at
  `/home/z/my-project/.secrets/git-credentials` (the in-remote-URL clone
  convention reverted — no token in `.git/config`, per the ground-truth
  drift note).
- Stack up via the rebuilt daemonizer: bridge `:3031` upstream **200**;
  engine `:3030` UP @ v0.0.56/`1e4e840b`, 9 router jobs scheduled (fresh
  DB — the known recycle limit), breaker closed.
- Checkpoint canaries: **C2** doctor gate green ("unown is ready to chat",
  19 ✓ / 2 ⚠ — the same honest pair); **C3** engine lane green (UP, SHA =
  HEAD); **C1** provider-chain smoke ×2 green (exit 0, `UNOWN_OK`, 3.7 s
  on 1.4.4 pre-pin + 6.1 s on the 1.4.3 pin — both under the stdin
  guard). C4 (the DRIVE-lane code canary) skipped: the C-1 dispatch
  itself exercises the same lane within its verified envelope.
- **The A2H-9 cure re-verified on the fresh tree**: `bun run test:unit`
  **2258 pass / 0 fail / 161 files** (159.2 s) — the closure receipt's
  tally holds post-recycle, first run, no flakes.
- **Next ticket: C-1** (the Chaconne domain core, building against
  `apps/chaconne/PLAN.md`) — dispatched after this checkpoint is pushed.

The **twenty-first lineage** (the third parallel resume — the canonical-path
clone `/home/z/my-project/Unown`, this reconciliation's author), 2026-11-06:

- Fresh clone @ `1e4e840b`; recycle taxes cured one pass: bun **1.4.4**
  npm-global (verified working — diverges from the nineteenth's 1.4.3
  pin; both ≥ the 1.4 floor), fd 10.5.1 (the GitHub-release lane — still
  working here, contra the twentieth's 403 receipt: the fd lane is
  machine-dependent, try GitHub first, apt as fallback), the REPO's own
  `node_modules/.bin/playwright install chromium` → chromium-1248 (the
  drift note: `bunx playwright install` resolves the NPM-GLOBAL playwright
  pinning chromium-1200 and silently no-ops for the repo's 1.64.1 — use
  the repo binary), the venv, install 7/7, `.env` Agnes lane.
- **H-11 formalized**: `.a1/scripts/a1-dispatch.py` — the stdin-guarded
  dispatch helper (bounded timeout, `--output-format json` envelope
  capture — NOT `--mode json`, which emits JSONL events — the subtype+
  capped double gate, session-id/num-turns recovery for continuation
  briefs), self-tested green ×3 (the flag drift caught by the first
  self-test). Every dispatch in this lane rides it now.
- Stack up via the daemonizer (rebuilt): bridge `:3031` upstream 200;
  engine `:3030` UP @ v0.0.56/`1e4e840b`; doctor 19 ✓ / 2 ⚠; C1 smoke
  green through the helper (subtype success, 2 turns, 5.5 s).
- The full battery re-receipted at `1e4e840b`: **9/9 — tsc 13 s · lint
  20 s · unit 2258/0/161 (158 s) · all five check gates · ostinato e2e
  17/17 (9.9 s)** — the THIRD independent same-tally verification of the
  A2H-9 close across three fresh trees.

The **twenty-second lineage** (the fourth resume, 2026-11-06), continuing
the Rondo round:

- Fresh clone @ `2b94f45f` = `origin/main` (the twenty-first's C-6
  converged-tree cure, V-31); 995 commits, clean tree; the PAT in the
  credential store (`~/.my-project` off-repo lane, `.git/config`
  token-free per the nineteenth's convention).
- Recycle taxes cured one pass (the V-2 class, eighth rebuild of the
  operator tools): bun **1.4.4** npm-global, `fd` 10.2.0 (GitHub lane),
  the repo's own `node_modules/.bin/playwright install chromium` →
  chromium-1248, the venv re-pipped (`pyte` — pexpect/pillow survived),
  install **7/7**, `.env` Agnes lane in place,
  `UNOWN_HOME=/home/z/my-project/unown-home` fresh.
- The `.a1/` operator workspace REBUILT (eighth rebuild): the
  daemonizer `dispatch-bg.py` (double-fork, PPID-1, log + pidfile,
  PID-tree stop), the stdin-guarded `a1-dispatch.py` (H-11 — envelope
  capture via `--output-format json`, subtype + capped double gate,
  session-id/turns recovery), the nine-lane `battery.sh`.
- Stack up via the daemonizer: bridge `:3031` upstream **200** against
  Agnes; engine `:3030` UP @ v0.0.57/`2b94f45f` (= HEAD), 9 router jobs
  (fresh DB — the known recycle limit), breaker closed.
- Checkpoint canaries: **C1** provider-chain smoke ×2 green (exit 0,
  `UNOWN_OK`, 2.9 s / 1.8 s, subtype success, stdin guarded through the
  helper); **C2** doctor green ("unown is ready to chat", 19 ✓ /
  2 ⚠ — the same honest pair); **C3** engine lane green (UP, SHA = HEAD).
- The full battery re-receipted at `2b94f45f`: **9/9 — tsc 14 s · lint
  22 s (0 err/143 warn) · unit 2353/0/172 (160 s) · all five check
  gates · ostinato e2e 17/17 (11 s)** — the FOURTH independent
  cross-machine verification of the C-6 close, every number
  exact-matching V-31's converged battery.
- **Next ticket: C-7** (the resilience battery — crash-mid-run resume,
  corrupt-store recovery, offline PWA boot). The standing brief lives
  below. **CLAIM**: C-7 dispatched by this lineage at push time (the
  V-9/V-10 protocol — 30-minute window; the queue row's ACTIVE marker
  checked at dispatch time AND at chunk-2 time per the V-26 mitigation).
  Budgeted at the C-6 ledger's ~2× e2e cost; acceptance items name the
  SCRIPT (`bun run test:unit`), never the bare command (the C-6
  confound lesson); V-30's artifact-grammar defect is OUT of scope (a
  dedicated pre-C-8 ticket owns it — C-7 must not paper over it).

The **twenty-third lineage** (the fifth resume — the OTHER half of a
DUAL-INCARNATION claim: the twenty-second's checkpoint `63b3a84c`
landed first and governs per the ledger-arbiter law; this lane's
independent claim stood down at the rebase — the V-9/V-19 shape),
2026-11-06 (late):

- Same fresh clone @ `2b94f45f`, same one-pass cure (the V-2 class,
  a NINTH tool rebuild in the same hour — the recycle tax now paid
  twice per recycle): npm-global bun **1.4.3** (the deliberate pin —
  a drift from the twenty-second's 1.4.4, both ≥ the floor), fd 10.2.0
  via the GitHub-release `.deb` + dpkg-extract lane (the apt lane
  needs a password in this sandbox — the download-and-extract variant
  works), the venv, install **7/7**, `.env` Agnes lane, `.a1/` tools
  rebuilt (the same trio, independently derived), PAT in the credential
  store.
- The chromium-1200-vs-1248 pitfall RE-HIT then cured here too
  (`bunx playwright install` → 1200, the repo binary → 1248): the
  twenty-first's drift note is a STANDING trap, not a one-machine
  fluke — third independent confirmation.
- Canaries **C1/C2/C3 green** (corroborating the twenty-second's
  numbers: C1 `UNOWN_OK` 2 s through the rebuilt helper) **+ C4** the
  DRIVE-lane code canary (fresh-dir fizzbuzz: exactly 2 files, 4/4
  tests operator-verified independently — the H-2 law; the
  twenty-second skipped C4, this lane's C4 completes the pair).
- The chaconne e2e battery at HEAD re-verified **6/6 (9.0 s)** — the
  FIFTH independent tree holding the C-6 converged-tree cure.
- **Reconciliation**: this lane's C-7 claim stands down (first landing
  governs); this lane's STANDING BRIEF (below — the substantive one
  the twenty-second's checkpoint points at, landing in this same
  commit) serves WHICHEVER lineage dispatches: the twenty-second's
  active window, or this lane at window expiry per the V-9/V-10
  protocol (~11:49 UTC, absent dispatch evidence). This lane takes the
  cross-machine verifier role at the C-7 landing (the V-14 precedent).

The **twenty-fourth lineage** (the sixth resume — a THIRD concurrent
incarnation of the C-7 bring-up, 2026-11-06, reconciled 11:30 UTC):

- This lane brought up on its own fresh clone of the same `2b94f45f`
  INDEPENDENTLY of both landed lineages (its claim push was rejected by
  the dual landing — the V-5 fetch+rebase law exercised again); all
  standing down per the ledger-arbiter law: the twenty-second's ACTIVE
  C-7 window governs, the twenty-third holds the standby dispatch + the
  cross-machine verifier role.
- Receipts folded in as the THIRD independent corroboration (the
  sixth tree verification of the C-6 converged state): C1 smoke ×2
  green (exit 0, stdin guarded), C2 doctor "ready to chat" (the
  model-spec ⚠ self-healed via explicit `--context-window 131072
  --max-tokens 16384` setup flags), C3 engine UP @ v0.0.57/`2b94f45f`
  = HEAD, 9 jobs, breaker closed; Lane A **115 tests/0 fail** (111
  pass + 4 DOM-guarded skip), Lane B **146/0**, root `bun run
  test:unit` **2353/0/172**, tsc **0**, lint **0 err/143 warn**, e2e
  battery **6/6 (7.3 s)** — every number exact.
- The chromium browser-build trap hit this lane TOO (the fourth
  confirmation): the cure variant here `bunx playwright@1.64.1 install
  chromium` (version-pinned bunx — equivalent to the landed
  repo-binary cure; both install build 1248, the only build the repo's
  pinned playwright 1.64.1 accepts).
- bun **1.4.4** ran the FULL battery green on this tree (install 7/7,
  root 2353/0, e2e 6/6) — the bun#46510 concern logged as un-triggered
  drift here too.
- **This lane's portfolio (non-overlapping with the ACTIVE C-7
  dispatch)**: the AUGMENT track — H-12's continuation-brief generator
  BUILT and canaried on this round's live dispatch traffic (PROPOSE →
  CANARY), H-10's browser-resilience skill staged + its WITH/WITHOUT
  gate design prepared for the teardown review, A2H-7's armed watcher
  re-run during the C-7 dispatch traffic (a fresh non-repro receipt,
  per the standing instruction). No apps/chaconne writes from this
  lane while C-7 is ACTIVE (the non-overlap discipline).


## Validation log

| ID | Event (dated) | Class | Disposition |
|---|---|---|---|
| V-1 | The opening C1 smoke attempt (`unown -p "Reply with exactly: UNOWN_OK"`, 2026-11-06) hung past a 300 s guard. The session transcript (id `01a1ad49…`) shows the answer WAS produced (`UNOWN_OK`, stop, 2 model calls, ~17 s) but the process never exited; the Bash harness's own wrapper lines (`__workspace_agent_exit_code=$?` …) appear INSIDE the user message — the `-p` run inherited the harness's stdin stream and slurped the script tail into its prompt | prompt-brittleness (operator-harness class, NOT issue #30 — the answer-vs-exit signature differs from the issue's, and the stdin confound explains it) | Cure applied and receipted: stdin guarded (`< /dev/null`) → C1 green ×2 (2 s / 4 s, exit 0). The polyglot runner's `stdio: ["ignore", …]` pattern is now the operator runbook law for every dispatch. A genuine #30 capture stays queued (A2H-7) with the armed watcher |
| V-2 | Sandbox recycle reclaimed the off-repo `.a1/` operator workspace, `unown-home/`, the npm-global bun pin and the pip venv (2026-11-06, bring-up) | infra-flake (the known recycle class, receipted by three prior lineages) | Cured from the bring-up checklist in one pass: bun 1.4.3 re-pinned, fd 10.5.1, playwright chromium-1248, venv, install 7/7, `.env` Agnes lane, stack up. The daemonizer + battery runner + canary scaffolding recreated as durable scripts (`.a1/scripts/`), so the NEXT recycle's cure is `bash` two scripts, not archaeology |
| V-3 | The baseline battery's `check:docs` gate redded mid-run (exit 1) on a tree the prior lineage receipted green | operator-procedure (measurement isolation) | The battery ran while the operator was writing the round's own new docs — the gate correctly flagged links to not-yet-created pages. Law: no tree writes during a battery run. Full detail in [the benchmark validation log](../benchmarks/rondo-round/validation-log.md) |
| V-4 | The baseline battery's unit lane: 2257 pass / 1 fail / 161 files at `18e4a98a` — the encore Finale "h2 + blockquote" test fails ONLY in the full-suite run (order/timing-dependent: 3 fails / 7 runs, still fails under `--max-concurrency=1`; GREEN in isolation 55/0 and in every two-file pair tested — the landing suspects, the gallery siblings, the nocturne/aria API tests; the full-set context is required) | **genuine-gap — RESOLVED 2026-11-06** (test-isolation defect, fixed at the polluting layer) | A2H-9 **CLOSED**: the error dump named the polluter (the ostinato settings-modal leftover h2 — the `iframe` stack was a red herring); one-hunk `afterEach` fix through A2; operator-verified 2258/0 ×2. Full chain: [the receipt](../benchmarks/rondo-round/receipts/a2h9.md) + [the validation log's resolution](../benchmarks/rondo-round/validation-log.md) |
| V-5 | The A2H-9/C-0 dispatch economics: (a) `--max-turns` counts CUMULATIVE session turns — a chunk-N continuation must RAISE the cap (chunk 2's first attempt died instantly at `--max-turns 8` against an 8-turn session); (b) the C-0 chunk-1 envelope reported `subtype:"success"` WITH `capped:true` and a mid-work sentence as the result — the cap envelope can mislabel | prompt-brittleness (operator-harness class — the dispatch discipline, not the product) | Cures: (a) continuations dispatch with `--max-turns <prior_total + chunk_budget>` — runbook law; (b) the operator gate reads BOTH `subtype` AND `capped` — `capped:true` is incomplete REGARDLESS of subtype. Both are H-12's spawning receipts |
| V-6 | The C-0 plan ticket closed clean through A2: 11 turns across 2 chunks (8 recon + 3 write), `apps/chaconne/PLAN.md` 489 lines | receipt | The operator gate tree-verified: 6/6 sections, 7/7 PRD P0 items mapped, 11/11 PRD-named edge cases individually mapped to named tickets' verifiers (none orphaned), the dependency ruling explicit (repo-root `node_modules` walk-up, fallback recorded), the fixture set named, 3 unknowns with spikes; only PLAN.md written — the round's first DRIVE artifact |

| V-7 | A parallel incarnation of the same lineage landed `7f615d84`+`8df0f580` mid-session (the Etude E-0 Tempo approval with amendments + the A2H-9 claim + the C-0 re-queue) while this lineage closed C-0 and deepened A2H-9 — the rebase conflicted in the round log, the validation log and the memory render | upstream-change (the known parallel-lineage class — the Etude round's V-5) | Reconciled 2026-11-06: both threads' evidence stands; the vehicle question is governed by the directive's §0.9 letter (a proposed idea is scored, not auto-accepted) — Chaconne stays the active vehicle, the Etude-approved Tempo becomes the designated §0.9.5 re-scope fallback with its evidence base ready; A2H-9 merges both forensics threads (OPEN, shard-bisect next); C-0's closure supersedes the re-queue; the memory render takes theirs (the newer dream); gates re-verified post-rebase |
| V-8 | The TWENTIETH lineage's bring-up (2026-11-06, a PARALLEL resume of this round — see V-9): the sandbox recycle again reclaimed the environment (bun pin, fd, venv, `.a1/` workspace — the known V-2 class, seventh rebuild) AND `npm install -g bun` this time landed the 1.4.3 binary inside the package despite the allow-scripts warning (the `.exe`-named Linux binary — a drift from the eighteenth lineage's GitHub-release lane, verified working); `fd` 10.2.0 via `apt-get download` + dpkg-extract (the npm fd-find postinstall 403s on GitHub releases in this sandbox — a new cure lane, receipted); chromium-1248 + the venv re-pinned; install 7/7; `.env` Agnes lane in place; stack up (bridge upstream 200, 6 models, default `agnes-3.0-flash`; engine ready v0.0.56 @ `1e4e840b` = HEAD); doctor "ready to chat" 19✓/2⚠; C1 smoke `UNOWN_OK` exit 0 (5.3 s, stdin guarded); the full battery at `1e4e840b`: **9/9 — tsc 0 · lint 0e/143w · unit 2258/0/161 (158.1 s) · check:docs/changelog/blog/benchmarks/claims ok · ostinato e2e 17/17** (the A2H-9 close's numbers hold at the newer HEAD — independently corroborating the nineteenth lineage's same-tally re-verification 159.2 s on its own fresh tree); the `.a1/` workspace recreated as durable scripts again (`dispatch-bg.py` double-fork daemonizer + `battery.sh`) — the daemonizer's `execvp` env bug caught and cured in one pass | infra-flake (the known recycle class) | One-pass cure. Environment facts for the next lineage: the fd npm lane is now 403-blocked — use the apt lane recorded here; the bun npm lane works again (verify with `bun --version`, the binary is named `bun.exe` inside the package) |
| V-9 | The DUAL-INCARNATION resume event (2026-11-06): TWO parallel lineages resumed the round within minutes of each other on separate machines — the nineteenth (clone at `/home/z/my-project/work/unown`, its checkpoint `6885f2f3` landed on `main` at 05:05 UTC: bring-up green, A2H-9 re-verified 2258/0/161, "C-1 dispatched next") and the twentieth (clone at `/home/z/my-project/unown`, its checkpoint authored against the same `1e4e840b` base, push rejected by the race, rebased onto `6885f2f3` — this reconciliation). Both bring-ups independently re-verified the same green state (battery 9/9, unit 2258/0/161 ±1 s, doctor 19✓/2⚠, C1 smoke guarded) — a dual-verification receipt, not a conflict | upstream-change (the known parallel-lineage class — V-7's, now at the resume boundary) | Ruled per the ledger-arbiter law: the nineteenth's landing governs the lineage numbering and the C-1 dispatch claim; the twentieth reconciles (this entry), keeps BOTH evidence sets (they corroborate), and stands down from C-1 for a 30-minute window (the protocol in the resume instructions). The C-1 brief below stands as the shared dispatch artifact for whichever lineage dispatches |
| V-10 | The TRIPLE-INCARNATION resume event (2026-11-06, 05:15 UTC): a THIRD parallel resume (the twenty-first lineage, clone at the canonical `/home/z/my-project/Unown`) pushed its checkpoint while the nineteenth's `6b32f7b8` ("C-1 DISPATCHED", 05:13 UTC) landed — push rejected by the race, rebased onto `6b32f7b8` (this reconciliation). The state at reconciliation: NO C-1 evidence on `main` (apps/chaconne holds PLAN.md only, no `.unown/receipts/c1.md`, no session id, no landing commit) and the nineteenth's clone path is not present in this sandbox's namespace — the dispatch claim's evidence lives on a machine this lineage cannot observe | upstream-change (the parallel-lineage class, now at THREE concurrent incarnations — the directive's resumability working as designed, and its race discipline now load-bearing) | Ruled per the V-9 protocol's own expiry clause: the 30-minute window from `6885f2f3` (05:05 UTC) binds the twentieth's stand-down; the twenty-first honors the same window (expiry 05:35 UTC), then — absent any C-1 evidence on `main` — dispatches with the standing brief (the shared artifact). If the nineteenth's chunks land first at any point, the per-chunk ledger-arbiter law applies (first landing governs; this lineage reconciles at its next fetch). All three bring-up receipts stand as a TRIPLE independent verification of the same green baseline (2258/0/161 ×3 trees) |
| V-11 | The C-1 opening dispatch ended `subtype:"success"`, `capped:false`, after ONE turn with the 7-token result "I'll start with the pref" — the model emitted an intent-to-act preamble as its complete reply, zero tool calls (2026-11-06, session `01a1af41…` round 1) | prompt-brittleness (model-behavior class — agnes-3.0-flash preamble-stop; NOT a product defect) | Cure: a firm continuation ("do not announce intent… execute… BLOCKED is acceptable; a preamble is not") restarted the session into normal tool use. Runbook law: the operator gate reads the RESULT TEXT on every envelope — `success` + short text + no file writes = preamble-stop, re-dispatch, don't re-brief |
| V-12 | The C-1 continuation that hit its cap MID-TOOL-STREAM surfaced `subtype:"error_during_execution"` with an EMPTY result + `capped:true` (vs the message-boundary cap's `success` + `capped:true` + partial text) — the cap-abort taxonomy depends on WHERE the Nth turn start lands (2026-11-06, rounds 2-4) | operator-harness (envelope taxonomy — a §8 measurement note, not a product defect; the CLI's documented contract only names capped-success) | Cure: none needed beyond the standing law — read `capped` FIRST; if true, the subtype is unreliable and the session simply continues with a raised cap (V-5's `--max-turns <prior_total + budget>`). Logged for the benchmark report's envelope-fidelity row |
| V-13 | The nineteenth's C-1 LANDING reconciled against the V-10 handoff ruling: the closure commit (session `01a1af41…`, 27 turns / 5 dispatch rounds, the tree + receipt `benchmarks/rondo-round/receipts/c1.md` on the nineteenth's clone) reached `main` as the FIRST C-1 evidence — the twenty-first's armed dispatch (window expiry 05:35 UTC) stands down per the per-chunk ledger-arbiter law; if its chunks land later, they reconcile against this closure at its next fetch | upstream-change (the parallel-lineage class, now at the LANDING boundary — the third such event this round) | First landing governs: C-1 is CLOSED by the nineteenth's evidence (the operator gate re-ran every lane on the landing tree — Lane A/B 31/0, root battery 2289/0/166, typecheck 0, lint 0/143 — and proved the boundary pin bites via live DOM-glob injection). The twentieth's/twenty-first's bring-up receipts stand as independent corroboration of the baseline. All evidence sets retained |
| V-14 | The twenty-first's post-landing verification of C-1 (2026-11-06, 05:40 UTC, the H-2 tree-verify law applied to a PARALLEL lineage's landing — the first cross-machine operator re-verification of the round): Lane A 31/0/5 exit 0; Lane B 31/0/5 exit 0; root battery **2289/0/166** (159.3 s); typecheck exit 0; lint 0 errors — every number matches the nineteenth's operator-gate tally on a fourth independent tree | receipt | The C-1 closure is now quadruply verified (A2's run + the nineteenth's operator gate + the C-1 landing's CI-green check + this lane). The C-2 claim follows on the same tree (the queue row + the standing brief below); the twenty-first dispatches after this claim-push — the twentieth's A2H-10 lane is untouched (no overlap: engine vs app dirs) |
| V-15 | The A2H-10 dispatch economics (2026-11-06, the twentieth lineage): (a) chunk 3's MEM0_CUSTOM_INSTRUCTIONS rider introduced a SYNTAX ERROR — raw backticks inside the backtick-delimited template literal closed it early (line 166); the run died at the cap with the broken tree; (b) the four-defect gate catch — A2's draft filter carried a nested-bracket residue bug, a stray-quote regex that made the JSON-fragment strip a NO-OP for every non-empty value (the pattern `(?:"[^"\\]|\\.)*` can never match value content starting with a non-quote), a missing comma in the `}, {` separator, and an over-aggressive mid-prose Reason strip — ALL invisible to A2's own runs (it never reached the test phase) and caught only by the operator's 14 pins at the gate | prompt-brittleness (the A2 drafting class) + genuine-gap (the operator-gate lane working as designed) | Cures: (a) the operator's one-line syntax fix (backticks → single quotes) — a new pre-dispatch brief law for template-literal edits: never embed raw backticks in a template literal via a brief; (b) the pins-first completion pattern — when a chunk dies before testing, the OPERATOR writes the pin set against the receipt's design FIRST, then runs it against the draft (the four defects were designed to be caught, and were). The receipt's honest A2/operator split is the R-2/SM-1 class receipted again |
| V-16 | The engine-change closeout law applied (2026-11-06, the twentieth lineage — the V-ids renumbered past the twenty-first's V-11..V-14 at the rebase): A2H-10 is the round's first Unown-code enhancement → the version bump **v0.0.57** + the CHANGELOG `## [0.0.57]` section + the regenerated rail (56 stops / 543 entries / 55 dated) + the release tag ride the closeout commit; the package suite re-ran green (5470/0), the package tsc at exact parity (77 = 77, stash-verified), the root typecheck 0, the root battery re-verified post-rebase onto C-1's landing (2289/0/166 — the combined state, matching V-14's tally) | receipt | The standing discipline: engine changes close with the version bump; the post-fix render observation (B-18's pending close) is the next dream cycle's natural experiment |
| V-17 | The B-18 post-fix render observation attempt (2026-11-06, the twentieth lineage) — FOUR live-lane findings, all §6c receipts: (a) **the spend governor works**: the round's own dispatch traffic (201k tok/h) throttled the dream lane at the 200k default (`budget:throttled` in the engine log — the S2-11 lane's design catching its own round); cured by the receipted `PI_ENGINE_MAX_TOKENS_HOUR=400000` raise (Agnes is $0-metered); (b) **the dream canary gate works — and catches THIS round's memories**: every consolidation landed `gated` with the note "canary swap-if-else-messages: tool drift: canary executed [python3, bun] vs reference [node] — the new memory redirected the agent's verification tooling" — the round's own bun/python environment facts genuinely redirected the canary's tool choice, and the gate correctly refused (a memory-quality backlog item is born: the canary task is sensitive to legitimate environment facts — it should pin its verification tooling); (c) **the tier-vs-terminal split**: `/api/dreams/run` drives the ENGINE-scope tiers (the observation run with `PI_DREAM_GATE=0` landed v15, guard clean, 4 adds) while the repo's terminal `.unown/memory/project.md` renders via the TERMINAL dream lane (session-end triggered) — the two paths are easily conflated; (d) **the timed-out `engine restart` apparently rewrote `.env`** (the budget append vanished, mtime rolled back — the restart's env handling re-materialized the file; re-appended and verified persisting through a clean stop/start) | receipt + one genuine-gap candidate (the `.env` rewrite lane — not ticketed this round: unobserved mechanism, the receipt names it for the memory-quality backlog) | B-18 closes as FIXED at the unit level (the 14 deterministic pins are the proof); the live terminal-render observation defers to the next terminal dream cycle (the next A2 session's natural end). The gate override was removed post-observation (the gate is ACTIVE — the .env line carries the receipt comment) |
| V-18 | The C-2 fake-clock spiral (2026-11-06, session `01a1af59…` rounds 2-6): A2 self-designed a manual-clock mechanism for the fake adapter's timed waits; a microtask-ordering flaw (the test advanced the clock BEFORE the run armed its timer), then an unbounded real-setTimeout accumulation → the battery OOM-killed (rc 137) and 5 s test timeouts; three operator continuations with progressively sharper derivations did not break the spiral — A2 kept redesigning the mechanism | genuine-gap → **the §3.7 brief-adaptation cure**: the operator imposed the structural decision (DELETE the manual clock; bounded real-clock poll `max(25, cap/20)` ≤ ~20 probes; the two hanging tests rewritten as real-clock tests at 200 ms caps) and A2 landed it clean in one round | Runbook law gained: when a model spirals on a self-chosen mechanism (~40 turns on one test family), the operator does not keep deriving the bug — it decides the MECHANISM (A1 owns the what) and hands the design down. The injected-clock law stays C-4's scheduler lane, where the PLAN put it. Receipt [c2.md](../benchmarks/rondo-round/receipts/c2.md) |
| V-19 | The C-2 LANDING reconciliation (2026-11-06): the nineteenth's closure (session `01a1af59…`, the tree + receipt on `main`) is the FIRST C-2 evidence — the twenty-first's CLAIM (`31ce2b2a`, the standing brief authored, dispatch planned but not landed) stands down per the per-chunk ledger-arbiter law; the claim's brief differences are noted for the record (it planned an ephemeral Bun.serve smoke; the landing used file:// — both LOCAL-only, the acceptance's letter) | upstream-change (the parallel-lineage class, the LANDING boundary again — V-13's live exercise, now with a claim-vs-landing shape) | First landing governs: C-2 is CLOSED by the nineteenth's evidence. The twenty-first's brief work is not wasted — it becomes the seed of the C-3 brief's shape. If the twenty-first's chunks land later, they reconcile against this closure at its next fetch |
| V-21 | The v0.0.57 tag's CI cancellation + the C-2 cross-machine gate (2026-11-06, the twentieth lineage — the V-id renumbered past the C-2 landing's V-18/V-19 at the pull): (a) the tagged commit `ff5d1785`'s CI matrix was CANCELLED mid-flight by the twentieth's own rapid follow-up pushes (the concurrency group's cancel-in-progress — the registry and §6c receipts landed within minutes of the tag), so the Release workflow's "CI green on the tagged commit" gate FAILED and the v0.0.57 GitHub release never rendered; **cured**: both cancelled workflows re-run via the API (CI + CodeQL), the Release workflow re-runs after CI greens — **the tag-push law is born: after a release tag, NO pushes until the tagged commit's CI concludes**; (b) the C-2 landing's cross-machine operator gate (the V-14 precedent, this time the twentieth verifying the nineteenth's landing): Lane A **70/0**, Lane B **70/0**, root typecheck 0, lint 0 errors/143 warnings, root battery **2289/0/166** (157.9 s) — every number matches the landing commit's tally on a fourth independent tree | operator-procedure (the push-timing race) + receipt (the C-2 gate) | The C-2 closure is now triply verified (A2's run + the landing lineage's operator gate + this lane). The v0.0.57 release renders when the re-run CI greens (the receipt amends with the release URL). **AMENDMENT (06:52 UTC): the law was violated BY ITS OWN AUTHOR within minutes** — the V-21 receipt push (16dad48a, 06:42) cancelled the first re-run; the repair sequence is now: THIS freeze-note commit is the LAST push, then the CI/CodeQL re-runs for `ff5d1785`, then the Release re-run (its gate waits up to 40 min for CI) — **ALL LINEAGES: hold main pushes until the v0.0.57 release renders (ETA ~07:15 UTC; check the release tag's check-runs before pushing)** |
**ALL LINEAGES: hold main pushes until the v0.0.57 release renders (ETA ~07:15 UTC; check the release tag's check-runs before pushing)** |
| V-22 | The v0.0.57 release-blocker root-caused (2026-11-06, the twentieth lineage): the re-run CI on the tagged commit failed GENUINELY this time — Windows `Self-learning engine tests` → `automation-spend.test.ts:110` "no such table: automations" — and the archaeology found the PRE-EXISTING wall: **the v0.0.56 tag's CI has been red since 2026-11-04** (the same Windows failure + a changed-line-coverage fail), its Release workflow failed, and **the last rendered GitHub release is v0.0.55** — two release tags exist with no releases. The defect (B-19 below): the test's `beforeAll` does raw SQL on the lazily-created `automations` table; Windows alphabetical discovery makes this file the FIRST store caller on a fresh DB. Reproduced locally (wipe the redirected test DB, run the file alone → the exact CI stack), cured with the one-call fix (`ensureAutomationsSchema()` first), verified: fresh-DB 10/0, package suite **5575/0** | genuine-gap (the §5 reflex exercised: deterministic repro → fix at the named layer → the fresh-DB single-file lane as the pin) | The freeze broke for the fix commit (receipted necessity: the tag pointed at a red commit; the release ships from green). The v0.0.57 tag re-points to the fix commit; CI's three-OS verdict re-runs on it (the version bump is in the tree); the Release workflow follows the new tag. **The release-rendering verification closes this entry**. **RESOLVED 07:52 UTC: the v0.0.57 release IS RENDERED** — [the release](https://github.com/kanishka-namdeo/Unown/releases/tag/v0.0.57) with 13 assets (the installers, the SBOM, sha256sums, and binaries for darwin-arm64/x64 + linux-arm64/x64 + windows-arm64/x64), all 15 release jobs green: the CI gate ✓, the 3-OS release assertions ✓, the 5-platform artifact runs ✓, the feed verification ✓, the 3-OS binary installs ✓. The road there: two tag re-points (the first pointed at a red-CI commit, the second at the never-branched fix SHA whose gate had nothing to find — a stuck 40-min gate run cancelled to unblock the queued one), the merge-not-rebase choice preserving the tagged SHA, and the B-19 fix proving itself in the release assertion's own Windows leg. **The release-render gap (v0.0.56) stands receipted**: that tag remains red-CI with no release; the honest record is the CHANGELOG's B-19 entry |

| V-23 | The B-19 CONVERGENT DUAL closure (2026-11-06): the twenty-first's A2H-11 (session `01a1afb2…`, 2 chunks — the windows-CI log diagnosis + the live isolation repro + the identical one-call fix) and the twentieth's B-19 fix (`c69d6382`) landed within the hour — the same root cause (the lazily-created `automations` table + the beforeAll's raw DELETE), the same cure (`ensureAutomationsSchema()` first), independent chains | receipt (the A2H-9 convergence pattern, third occurrence — the directive's parallel-incarnation discipline producing cross-validated fixes, not conflicts) | The twentieth's landing governs (first on `main`); the twenty-first's tree was reset to it and the fix verified AGAIN cross-machine (isolation 10/0 on their variant). Receipt [a2h11.md](../benchmarks/rondo-round/receipts/a2h11.md) carries the parallel lane's evidence |
| V-24 | The A2H-11 dispatch's 9-failure observation was a CONCURRENT COLLISION artifact: the operator's parallel isolation-repro run raced A2's full-suite verify on the shared `/tmp/engine-tests-b` redirect (the `_env.ts` co-ownership warning); clean sequential re-runs showed 0 fail both WITH the fix (5575/0/248) and WITHOUT (5470/0) | operator-procedure (the V-3 measurement-isolation class, now at the test-suite boundary) | Law: never run the self-learning suite concurrently with anything touching `/tmp/engine-tests-b` — check the a1-dispatch pidfile status before every gate run |
| V-25 | The C-3 landing's cross-machine operator gate (the twenty-first verifying the nineteenth's `5cedc01a`): Lane A **85/0/15**, Lane B **110/0/15** (the DOM-guarded honest-skip pattern — 25 DOM pins run only under Lane B's happy-dom), tsc 0, lint 0 err/143 warn, root battery **2329/0/171** (2289 standing + 40 new; `apps/chaconne/src/ui/**` carries the src substring so the UI tests join the root battery, unlike the runner lane) | receipt | C-3 is now triply verified (A2's run + the landing lineage's gate + this lane). The battery's app-suite growth is tracked: 2258 → 2289 (C-1) → 2329 (C-3) |

| V-26 | The C-4 CONVERGENT DUAL closure (2026-11-06, the fourth convergence of the round — A2H-9, B-19, C-2, C-4): the twenty-first's session `01a1afd8…` (5 rounds, envelope turns 8/16/24/40/56, operator-gated ALL GREEN: Lane A 116/0, Lane B 143/0, tsc 0, lint 0/143, battery 2353/0/173) and the nineteenth's `9c316604` (57 turns / 6 rounds) — independent implementations of the same PLAN §1/§5-edge-6 laws, agreeing on every invariant (the injected-clock scheduler, SKIP_RECORD_CAP=1, the (recipeId, dueAt) dedup, the OQ-2 true-run-id), differing only in module shape | receipt (the convergence pattern — duplicated spend, cross-validated invariants) | Their landing governs; this lane's tree reset + their C-4+C-5 verified cross-machine (V-28). The spend-duplication cost is receipted honestly: ~2 tickets' dispatch spend for 1 ticket's landing, twice this round — the claim-before-dispatch law held on this lane's side (the claim `2315f8ec` landed before the dispatch), but the parallel lane was already mid-flight. The mitigation for C-6+: the queue row's ACTIVE marker is checked at dispatch time AND at chunk-2 time (a mid-flight stand-down is cheaper than a full duplicate run) |
| V-27 | The reset-survivor class (2026-11-06, the C-4/C-5 gate): after the convergent reset (`git reset --hard origin/main`), this lane's UNTRACKED test file (`schedule-ui.test.ts`, importing this lane's module shape) survived — hard reset touches tracked files only — andredded the FIRST verification pass with a phantom `Export named 'scheduleRowState' not found` (1 error in both lanes) that looked like a C-4/C-5 interface break in the LANDED code | operator-procedure (a new measurement-isolation class: the convergent-closure reset) | Law: after every convergent reset, `git status --short` + remove the untracked app-lane files (they live in the parallel-impl tag) BEFORE any gate run. The clean re-verification: Lane A 115/0/17, Lane B 146/0/17, tsc 0, lint 0/143, battery 2353/0/172 — every number exact-matching the C-5 receipt |
| V-28 | The C-4+C-5 cross-machine operator gate (the twenty-first verifying the nineteenth's landings, post-reset-clean): Lane A **115/0/17**, Lane B **146/0/17**, tsc 0, lint 0 err/143 warn, root battery **2353/0/172** (159.3 s) — every number exact-matches both landing receipts' tallies | receipt | C-4 and C-5 are now triply verified each (A2's run + the landing lineage's gate + this lane). The battery growth: 2258 → 2289 (C-1) → 2329 (C-3) → 2353 (C-4/C-5) |

| V-29 | The C-6 battery's first real CLI invocation caught B-20 — the runner CLI was DEAD: the isMain guard compared path.resolve(process.argv[1]) (a filesystem path) against path.resolve(import.meta.url) (a file:// URL string resolved as a relative literal → '<cwd>/file:/...'), so isMain was ALWAYS false and main() never ran — every 'bun apps/chaconne/runner/index.ts ...' was a silent exit-0 no-op; the unit lanes import cmdRun directly and never covered the entry (the coverage gap that let it land green through C-2..C-5); operator-proven with a 4-line live repro (equal? false). **The parallel C-6 landing (b6013928) did NOT catch it — its flow spec runs the app's Run action, never the CLI binary — so the A2H-12 fix lands ON TOP of it as this lane's complement** | genuine-gap → FIXED through A2 (A2H-12: Bun's native `import.meta.main`, one hunk; the CLI's first verified real run: 'run 1 (recipe 1 v1): ok; committed prefix 1') | The e2e-first coverage law: the CLI entry is only ever covered by an e2e lane that EXECS the binary — unit lanes structurally cannot, and a UI-action spec does not either. The convergent C-6 closures are COMPLEMENTARY: theirs (the UI flow + the a11y start) + this lane's (the CLI end-to-end spec, `chaconne-flow-cli.spec.ts`, B-20's regression pin) |
| V-30 | The C-6 receipt's P1 open defect (BLOCKED-noted, a future ticket): the runner's saveArtifact with ext 'extract-report.json' produces names like 0_r2_sha256:…extract-report.json that violate the PWA domain's ARTIFACT_NAME_RE single-dot grammar — a cross-host schema boundary mismatch (the C-2/C-5 runner vs the C-1 domain); the spec's workaround (assert the runner's on-disk record directly; seed only PWA-grammatical names into localStorage) is correct for the lane | genuine-gap (OPEN — queued as a candidate; the fix is either widening the PWA regex or simplifying the runner's ext) | Reconcile in a dedicated ticket before C-8 (the io round-trip lane would trip the same boundary); the C-7 lane should not paper over it. **RESOLVED 2026-11-06: A2H-13 CLOSED** — ruling (a) the runner side (ext → \`json\`, the domain FROZEN), the cross-host pins through \`assertData\` guard the seam; receipt [a2h13.md](../benchmarks/rondo-round/receipts/a2h13.md) |

| V-31 | The converged-tree gate caught the parallel C-6 landing's OVERCLAIM: its receipt's "battery green 6 consecutive" did not hold on its own final tree — the out-of-lane ARIA fix (role option->listitem, aria-current on selection) landed AFTER the 6-green run and the battery was never re-run, so its flow spec's `toHaveAttribute("aria-selected", "true")` was RED against its own app code (the SM-1/V-9 class — a claim outrunning the final tree state) | operator-procedure (the post-fix re-run law, now explicit) | **The law: a battery claim is valid only for the FINAL tree state — any post-claim code change (including an accepted out-of-lane fix) REQUIRES a battery re-run before the close receipt counts.** Cured through A2 (session `01a1b01a…` chunk 6: both specs' assertions updated to aria-current, no app code touched); the converged battery 6/6 (a11y ×4 + the K-1 flow + the CLI pin), operator-verified ×2 (7.7 s / 7.5 s) + tsc 0 + lint 0/143 + test:unit 2353/0/172 |
| V-32 | A DUAL-INCARNATION C-7 claim (2026-11-06, ~11:18 UTC): two lineages brought up INDEPENDENTLY on the same fresh clone `2b94f45f` within minutes (both one-pass cures, both stack-up green, both canaries green — the twenty-second skipped C4, the twenty-third ran it) and both authored a C-7 claim checkpoint; the twenty-second's `63b3a84c` landed first and governs per the ledger-arbiter law; the twenty-third's rebase folded its receipts in as the parallel verification + the substantive standing brief (the twenty-second's checkpoint references "the standing brief lives below" — the brief itself lands in the reconciliation commit) | infra-flake (the sandbox-recycle class spawning parallel resumes — the V-9/V-19/V-23 lineage, now the round's SIXTH dual event) | Standing down per the V-9/V-10 protocol: the twenty-second's ACTIVE window governs to ~11:49 UTC (checked at dispatch AND chunk-2 per the V-26 mitigation); at expiry, absent dispatch evidence on `main`, the twenty-third dispatches with the standing brief. The cross-machine verifier role at the C-7 landing is the twenty-third's (the V-14 precedent). **RESOLVED: the window expired with zero C-7 evidence (only the twenty-fourth's AUGMENT lane landed); the twenty-third dispatched at 11:50 UTC and CLOSED the ticket (receipt [c7.md](../benchmarks/rondo-round/receipts/c7.md))** |
| V-33 | A THIRD concurrent incarnation of the same C-7 bring-up (2026-11-06, reconciled 11:30 UTC): this lane's claim push landed AFTER the twenty-second's `63b3a84c` + the twenty-third's `41d0e47b` reconciliation and was rejected (the fetch+rebase law); its independently-produced receipts duplicate the dual landing's almost exactly — same clone `2b94f45f`, same canary set green, same battery tallies to the digit (Lane A 115/0, Lane B 146/0, root 2353/0/172, tsc 0, lint 0/143, e2e 6/6), same chromium browser-build trap hit and cured (the version-pinned bunx variant) | infra-flake (the V-9/V-19/V-23/V-32 parallel-lineage class, now a TRIPLE incarnation — the round's seventh concurrent-lineage event) | This lane stands down on C-7 (the twenty-second's ACTIVE window + the twenty-third's standby govern) and takes the non-overlapping AUGMENT portfolio instead: H-12's generator built + canaried, H-10's skill staged + gate designed, A2H-7's watcher re-run on the C-7 dispatch traffic. The triple corroboration upgrades the bring-up baseline's confidence: three independent trees, three independent one-pass cures, identical tallies |
| V-34 | The AUGMENT portfolio's first act, all three items landed (2026-11-06, the twenty-fourth lineage): (a) **H-12 BUILT + LIVE-CANARIED** — the continuation-brief generator (`.a1/scripts/a1-continue.py`, operator lane) exercised on a GENUINE V-12 capped chunk: the H-10 gate-design research dispatch capped at 6 turns mid-stream (empty result, cap-abort class) → the generator emitted the 3,972-char brief as-is (original brief verbatim + tool census + commands-run + the V-11 backtick-escape law + the V-5(a) raised cap 6+8=14) → the resumed session completed the full four-section artifact in 7 more turns (subtype success) — continuation chunks needing operator correction: **0** (the metric's first live data point); two generator defects caught AT BUILD (stderr pollution breaking the envelope parse — the V-12 lesson re-learned at the tooling layer; the bare-PATH binary lookup — the H-8 law applied); (b) **H-10 STAGED + GATE-DESIGNED** — the browser-resilience SKILL.md staged at `.unown/skills-staged/` (never auto-loaded; minter-validated; the instruction-set audit clean with it staged), the four recover-pattern ingredients verbatim from a2h8, and the WITH/WITHOUT gate design pre-registered (authored through the SAME A2 research dispatch — the artifact this registry now cites); (c) **A2H-7's watcher re-run** — both lanes ×8 on this lane's real dispatch traffic: idle 8/8 exit 0 (1.6–1.8 s), dream 8/8 exit 0, no hang — the fresh non-repro receipts at [a2h7/r24/](../benchmarks/rondo-round/receipts/a2h7/r24/) (the watcher stays armed) | receipt (the augmentation registry's H-10 → CANARY-READY, H-12 → CANARY rows carry the evidence) | The teardown window's first act is pre-committed: the H-10 paired runs (≥3/arm, 6 if the delta lands inside 2–3 pp) on the frozen post-C-7 tree. The research dispatch's own honest gaps (the ticket-set freeze at the BEFORE arm's start; the a11y battery composition pin) are recorded in the registry row — no post-hoc story-telling at the gate |
| V-35 | The operator-gate drift test on a tree with UNCOMMITTED A2 work: the verify-precache deliberate-drift proof used `git checkout apps/chaconne/sw.js` to restore — reverting sw.js to the committed C-5 state and DESTROYING A2's uncommitted O-1 fix (the `.js`-convention precache keys); the very next `bun run test:unit` failed on exactly the pin A2 had updated for the fix — the pin caught the operator's own tree-drift within seconds (the gate working as designed, against its own author) | operator-procedure (the V-31 class inverted: the tree drifted, the claim was honest) | Cure through A2 (the 8-turn recovery chunk: the sw.js changes re-applied, all three verifies green). **The law: drift tests on uncommitted work snapshot-restore (cp/stash), never `git checkout`; the operator gate COMMITS the A2 landing BEFORE any destructive verify.** The recovery chunk is priced in the C-7 receipt's economics |
| V-36 | The twenty-second lineage's C-7 stand-down + the CONVERGENT DUAL closure reconciled (2026-11-06, ~13:05 UTC — the V-26 pattern's fifth convergence): this lane's C-7 work completed LOCALLY (the full scope: the ×4-lane resilience spec, offline.html, verify-precache.ts + drift test, capture-usage.mjs + smoke, the loadJsonRows quarantine — session `01a1b09a…` cut twice by the operator's own dispatch timeouts, then the fresh-session closing chunk `01a1b0de…` 28 turns / 418 s writing the receipt; every gate lane green locally: Lane A 121p/4s/0, Lane B 156/0, root 2353/0/172, tsc 0, lint 0/143, e2e 10/10 ×3) but the push was rejected — the twenty-third had dispatched at the window expiry (V-32's own resolution) and CLOSED first; per the ledger-arbiter law their landing governs and this lane stood down WITHOUT landing (the orphaned commit `e8714355` preserves this lane's A2 work for archaeology; its capture-usage.mjs is NOT landed — the governing receipt's deviation #3 rules it C-10's to consume, and this lane honors the ruling) | infra-flake (the dual-dispatch spend-duplication class — this round's EIGHTH concurrent-lineage event; the honest cost: ~72 min of this lane's A2 wall time + the closing chunk's 28 turns duplicated the twenty-third's 89-turn landing) | The cross-machine verification receipt (this lane, on the governing tree `12dc8466`): Lane A **113p/4s/0** (their receipted 111 + the A2H-13 cross-host pin's +2 — the expected growth), Lane B **148/0**, root battery **2353/0/172** exact hold, tsc **0**, lint **0 err/143 warn**, the e2e battery **10/10** (18.2 s) — the twenty-third's C-7 + A2H-13 landings now triply verified (A2's run + their gate + this lane's cross-machine). The dispatch-timeout lessons this lane paid for are receipted as laws in the local operator tools: the fresh-session handoff for long chunks, the 2400 s helper default, the cap-gate FAIL ≠ work FAIL adjudication path |
| V-37 | The H-10 paired runs EXECUTED (2026-11-06 13:00 UTC, the twenty-fourth lineage — the teardown-window first act, pre-committed at V-34): n=3/arm on the frozen post-C-7 tree `b436b843`, the skill the only variable, the `a1-paired-runs.py` harness's pins enforced live — **an honest NULL**: the skill's firing surface never occurred in any of the six runs (the fixture's 50 ms re-tap only resets EMPTY fields; Playwright's fill+read-back wins synchronously — the WITH-1 report itself derives the mechanism), completions 1/3 vs 1/3, e2e flake 0.0 both arms, no delta claimable. THREE instrument incidents, all receipted: (a) the v1 brief invented `#city`/`#gift` fields the fixture does not carry — caught BY the runs (run 2's report named the real set), both arms re-measured on the corrected v2, the v1 data archived as the flaw's receipt; (b) the first WITH-2 dispatcher was SIGTERMed externally (−15, no log) — re-run cleanly, the re-run is the datum; (c) detached background execution does not survive the harness here — the harness was restructured for foreground-safe arm-by-arm runs with incremental receipts + resume (the harness's own lesson, now encoded) | receipt (the null is the H-1-precedent shape: one clean data point, not a promotion claim) | H-10 → CANARY (executed, null receipted); the skill stays STAGED; the genuine finding — the fixture's race is benign BY CONSTRUCTION, measuring the #43 recover pattern needs a hostile variant fixture via a proper ticket — is the teardown's open choice alongside 6/arm or holding the null. Receipt [h10-paired-runs.md](../benchmarks/rondo-round/receipts/h10-paired-runs.md) |
| V-38 | The Agnes upstream's first LIVE degradation window of the round (2026-11-06, ~13:46 UTC): the bridge log fills with `degenerate upstream stream (200, no content frames)` + `stream ended early` + one retryable 500; every dispatch — including the 2.2 s smoke — returns `error_during_execution` with 0 input tokens (`the run ended without an answer`); the C-9 closing chunk failed twice on this (1.5 s each), the smoke passed at 13:46:43 then failed at 13:50:18 — the upstream flipped mid-minute. Timeline context: the C-9 chunk 1 ran 40 minutes of clean turns (13:05→13:45) on the same stack minutes earlier | infra-instability (the provider class — NOT prompt-brittleness, NOT a genuine gap; the §3 taxonomy's first bucket, no benchmark conversion) | **ROOT-CAUSED + CURED (~14:10 UTC)**: the mechanism was NOT a generic provider flap — the usage log shows the failing requests returned `upstream 400: max_tokens exceeds the limit of 4096` — the Agnes upstream CHANGED its output cap under us (the model spec's `maxTokens: 65536` was accepted all round, then flipped at ~13:46; the co-occurring `degenerate upstream stream (200, no content frames)` entries are the bridge's parallel signature). The cure (operator lane, the provider-config lane): both flash models' `maxTokens` pinned to **4096** in `UNOWN_HOME/agent/models.json` + `model-specs.json` (`operator-pin` provenance), the engine force-restarted onto the current build — the smoke green in 3.2 s. **The law: an upstream capability flip is receipted as a spec pin with provenance, never silently absorbed; every parallel lane's dispatch ledger that crosses a provider flip window owes its own re-smoke.** The C-9 claim stays ACTIVE; chunk 1's landed work is safe on the tree (`4d9f6dd2`, the WIP checkpoint). **Corroborated + applied on the twenty-third's lane (14:12 UTC)**: the same pin (both spec files, operator-pin provenance) + the engine restart → the smoke green in 1.5 s — the cure is stack-independent and the re-smoke law's first cross-lane exercise |

| V-39 | The C-8 flake-fix dispatch died SILENTLY twice (rc=143 at ~10 s, zero stdout/stderr, no envelope): the dispatch BRIEF carried the literal text `pkill -f chaconne/serve.mjs` (a cold-boot suggestion) — the harness's prompt-level safety guard terminated the run WITHOUT writing an envelope, so the gate read NO-ENVELOPE (a hang-class reading), not blocked-by-policy. The sanitized brief ran normally (the instruction rephrased) | operator-harness (the guard's silent-kill shape — the V-1 stdin class's sibling: an operator-side law, not an A2 defect) | **The law: dispatch briefs never carry literal kill/termination command text**; the H-11 helper should classify rc=143 + empty output as a distinct GUARD-KILL signal (a PROPOSE-class registry note). Root-caused by differential test: same brief sanitized → runs; same text → dies at ~10 s, twice |


## Bug register

User/operator-visible findings of this round (the B register continues the
lineage numbering — B-1..B-14 live in the Ostinato, Reprise and Etude
logs). **B-15/B-16** are the holdout benchmark ids (see the suite README);
**B-17** was the Vivace lineage's alias for the A2H-9 defect (CLOSED —
folded into the receipt); the next free bug id is **B-18**.

- **B-18 (FIXED 2026-11-06 by A2H-10, pending the post-fix render — filed by the third lineage
  2026-11-06):** the AutoDream/Mem0 consolidation's rendered
  `.unown/memory/project.md` carries an embedded REASONING-NOISE blob —
  a "Known pitfalls" bullet contains the dream LLM's own meta-deliberation
  ("[NOTE: The original memory contained a markdown artifact… I will
  keep the text as is…]" — ~90 words of it) leaked INTO the stored fact
  (observed in the 2026-11-06 re-render, git-visible in the A2H-9
  closeout commit). The extraction/consolidation prompt's chain-of-
  thought is not being stripped before storage. Impact: every future
  session injecting project memory reads the noise; the memory-quality
  backlog item (inference review queue; placement/duplication audit)
  gains a concrete defect class. Fix lane: the dream's extraction
  prompt/output filter (engine-side — check whether it's extension-
  surface or upstream before ticketing).
  **Second observation (the twenty-first lineage, 2026-11-06 05:12 UTC
  re-render): the defect PERSISTS in a new shape** — the fresh render
  dropped the old `[NOTE: …]` blob but now embeds raw consolidation-JSON
  fragments INTO fact bullets (two "Facts" lines end with `", "reason":
  "Removed raw markdown note…"}, {` — the mem0 provenance's reason field
  and object delimiters rendered as fact text). Same root class (the
  consolidation output is not sanitized before storage/render), a second
  observed signature; notably the render ALSO learned this lane's
  markers correctly ("DISPATCH_OK for dispatch-related sessions and
  UNOWN_OK for general completion" — the note→memory loop works, the
  filter is the gap). The fix lane is unchanged; this strengthens the
  case for an output-shape validation (JSON-parse the fact line, reject
  fragments) at the dream's write boundary.
  **Third observation (the twentieth lineage, 2026-11-06 ~05:22 UTC
  render, git-visible in the A2H-7/A2H-8 closeout rebase): the
  ORIGINAL reasoning-blob shape RECURRED on a fully fresh engine DB**
  (this lineage's engine was recycled-fresh at 05:01, 0 dreams at
  bring-up) — the render's clippad fact carries ~180 words of embedded
  meta-deliberation ("[NOTE: The original memory contained a markdown
  artifact '[note 1]'… I will keep the text as is… Let's look at
  similar memories… I will just keep the text…]") PLUS the two
  A2H-8-derived pitfalls rendered CLEANLY alongside it (the iframe
  race findings landed as crisp facts — the note→memory loop works
  again; only the filter is the gap). Both shapes (reasoning-blob and
  JSON-fragment) are now observed within one hour across three
  independent engine instances — the defect is deterministic-enough to
  ticket: the fix lane gains a concrete repro (run any dream
  consolidation on the clippad fact lineage) and the output-shape
  validation proposal above stands.

- **B-19 (FIXED 2026-11-06 by the twentieth lineage — the Windows
  release-blocker, found blocking BOTH v0.0.56 and v0.0.57):**
  `automation-spend.test.ts`'s isolation `beforeAll` runs a raw
  `DELETE FROM automations` — but the `automations` table is created
  lazily by `ensureAutomationsSchema()`, NOT by store.ts's base SCHEMA.
  On Linux the table pre-exists by the time the file runs (a sibling
  suite's `createAutomation` migrated the shared redirected DB, or a
  live engine created it); on Windows CI's ALPHABETICAL discovery,
  `automation-spend` runs FIRST — the raw DELETE hits a fresh DB →
  "no such table: automations" → the three-OS release verdict fails →
  the Release gate blocks the release. **The v0.0.56 tag has been red
  since 2026-11-04 and its release never rendered — the last rendered
  release is v0.0.55; the v0.0.57 attempt exposed the same wall.**
  Reproduced deterministically locally (wipe `/tmp/engine-tests-b`,
  run the file alone: 9/1 with the exact CI stack). Fix:
  `ensureAutomationsSchema()` at the top of the `beforeAll` (the
  one-call cure at the named layer); the fresh-DB single-file run 10/0,
  the full package suite 5575/0. The v0.0.57 tag re-points to the fix
  commit (the tag had pointed at a red-CI commit; no release existed,
  so the re-point is clean).


- **B-20 (FIXED 2026-11-06, CLI lane — filed by the twenty-first
  lineage, caught by the C-6 CLI spec):** the Chaconne runner CLI was a
  silent no-op — the isMain guard's path-vs-URL comparison was always
  false, so `bun apps/chaconne/runner/index.ts run …` exited 0 doing
  nothing (user-visible: the product's documented CLI invocation did
  nothing, silently). Fixed through A2 (A2H-12: `import.meta.main`);
  the entry coverage gap (unit lanes import cmdRun, never the binary;
  the parallel C-6's UI-action spec doesn't either) is V-29's law. The
  regression pin: `e2e/chaconne-flow-cli.spec.ts` (the CLI end-to-end
  lane).

## Ticket queue

| Ticket | Scope | Verifier (external, named) | State |
|---|---|---|---|
| R-0 | The §0.9 selection gate: candidates scored, vehicle approved, PRD opened | The scoring receipt + the pre-registered failure classes in [the benchmark round](../benchmarks/rondo-round/README.md) | **CLOSED 2026-11-06** (this lineage — Chaconne approved per the directive's own scoring rule; §0.9.5 re-scope trigger armed) |
| A2H-9 | The encore Finale unit-battery isolation fix: the battery's one near-deterministic fail — `Finale — the program's success question + live answer (plan §5.7) > renders the success question as an h2 + blockquote` (`encore.test.tsx:817`, a `getByRole("heading", { level: 2 })` query) — passes standalone 55/0 but fails in-battery (~6/8 runs across both lineages — order/timing-dependent; still fails under `--max-concurrency=1`; every two-file pair green); root-cause the cross-file pollution and fix it at the polluting layer, assertions unweakened | `bun run test:unit` exits 0 twice consecutive (2258/0); `bun test src/components/encore/__tests__/encore.test.tsx` stays 55/0 standalone; the failing test's h2 + blockquote assertions NOT weakened | **CLOSED 2026-11-06** — a CONVERGENT DUAL closure: this lineage's 8 A2 chunks across 2 sessions (session `01a1ad6e…` chunks 1–4, then the fresh-session extension `01a1ad98…` chunks 5–8, the last a 16-turn closing chunk by operator ruling — the 8-turn cap mis-fit for battery-verification tickets, a pre-split lesson); the root cause: **`bun test src` is a substring filter** — the battery's 161 files include 16 `apps/*/src` test files every green subset missed; the polluter `apps/ostinato/src/ui/settings-modal.test.ts` (the R-2 landing) left `<h2>Deck settings</h2>` in the shared one-process document → the encore `getByRole` multi-matched (the order-dependence the parallel lineage measured at ~6/8 is the mechanism's signature: the pollution needs settings-modal to run before encore in the walk, and bun's file-discovery order varies); the fix: a 13-line `afterAll` body-reset in the polluting file (the encore file byte-identical, product code untouched); A2's verifies: the pair 60/0 (pre-fix 59/1), battery **2258/0 ×2 consecutive** (157.6 s / 157.7 s), encore standalone 55/0, ostinato Lane A 119/2-skip/0; the operator gate re-verified independently (battery 2258/0 exit 0, 159.6 s) + tree-verified the one-file scope; the substring-filter blind spot was the OPERATOR's derivation handed to A2 in the closing brief (the §3.7 brief-adaptation lane, receipted); the PARALLEL lineage's independent forensics (24 turns, 3 chunks: full-suite-only, `--max-concurrency=1` still red, all pairs green — the shard-bisect lane) stand as the converging pre-close investigation, folded into [the V-4 dossier](../benchmarks/rondo-round/validation-log.md); receipt [a2h9.md](../benchmarks/rondo-round/receipts/a2h9.md) tree-verified (one file, +13/-1) |
| C-0 | The architecture plan: the storage/runner/UI decomposition, the fixture-page test strategy, the dependency-law ruling for the runner's playwright import — a read-only `--plan` run with a scored plan file | The plan gate's own score + the operator's review against the PRD's P0 constraints | **CLOSED 2026-11-06** — 2 chunks, 11 turns (8 recon + 3 write), fresh session `01a1ad6d…`; `apps/chaconne/PLAN.md` (489 lines); the operator gate tree-verified (V-6). The parallel lineage's re-queue of C-0 behind A2H-9 is superseded by this closure (V-7's reconciliation) — both rulings stand: A2H-9 closed independently on the same clock |
| C-1 | The domain core: recipe/step/run types, validation, canonical JSON, atomic store | Lane A unit battery (bun test in `apps/chaconne/`), tsc, lint | **CLOSED 2026-11-06** — the nineteenth lineage; session `01a1af41…`, 27 turns / 5 dispatch rounds (the preamble-stop V-11 + the capped continuations V-12 in the ledger; the V-13 landing reconciliation against the V-10 handoff ruling); 1,367 lines: types/ids/invariants/model/io/storage + co-located tests + the boundary scanner + the localStorage adapter + the 7-line zero-dep package.json + eslint chaconne scoping + the tsconfig include (PLAN §4's own assignment); the operator gate independently re-ran every lane (Lane A 31/0, Lane B 31/0, root battery **2289/0/166** = 2258 standing + 31 new, typecheck 0, lint 0/143 standing) and PROVED the boundary pin bites (live DOM-glob injection → 1 fail → restore → green); four deviations reviewed and accepted (receipt [c1.md](../benchmarks/rondo-round/receipts/c1.md)) |
| C-2 | The runner v1: goto/click/fill/select/wait/assert/extract/screenshot against LOCAL fixture pages, honest error taxonomy, run records | Runner unit lane with a fake page adapter + one real-browser smoke against a fixture | **CLOSED 2026-11-06** — the nineteenth lineage; session `01a1af59…`, 65 turns / 8 dispatch rounds (the fake-clock spiral V-18 — the operator's structural decision closed it; the V-19 claim-vs-landing reconciliation); 1,933 lines: the PageAdapter seam + FakePageAdapter + RealPageAdapter (iframe resolution, post-fill read-back — the #43 cure), caps/RunLedger (committed-prefix law), disk store (temp+rename atomic, sha256 artifacts), run log, CLI entry with the C-4 stub, 5 LOCAL fixtures, 39 runner tests incl. the 3-test real-browser smoke (file://, zero network); the operator gate re-ran every lane — Lane A/B **70/0/10**, root battery **2289/0/166** holding, typecheck 0, lint 0/143 standing; six deviations reviewed and accepted (receipt [c2.md](../benchmarks/rondo-round/receipts/c2.md)) |
| C-3 | The web app shell: recipe list/create/edit, run history, artifact viewer — keyboard-first, zero-dep, palette, empty/loading/error states | Lane A/B unit + the e2e happy path | **CLOSED 2026-11-06** — the nineteenth lineage; session `01a1af91…`, 33 turns / 4 dispatch rounds (the round's smoothest — the ordered-write brief pattern, adopted into the playbook per the every-3-tickets review in [the receipt](../benchmarks/rondo-round/receipts/c3.md)); 19 files / 3,303 lines: the PWA shell + serve.mjs (Bun.Transpiler :4014) + the 11-command Ctrl+K palette + the dialog-contract recipe editor + grouped run history with 5-status badges + artifact viewer + the four empty panels + light/dark CSS + 5 DOM-guarded test files; the operator gate re-ran every lane — Lane A 81p/4s/0, Lane B **110/0**, root battery **2329/0/171** (2289+40), typecheck 0, lint 0/143, serve boot HTTP 200 verified |
| C-4 | The recurring loop: schedules (interval/one-shot), misfire policy, run history | Unit battery on an injected clock (the Ostinato law) + e2e | **CLOSED 2026-11-06** — the nineteenth lineage; session `01a1afb2…`, 57 turns / 6 dispatch rounds (the twenty-first's concurrent CLAIM stands down per the per-chunk ledger-arbiter law — the V-19 shape again; its standing brief's misfire/OQ-2 rulings fold into the record as corroborating design review); 8 files / 2,024 lines: the PURE injected-clock scheduler (one-shot retires; interval anchor-relative; misfire skip-and-record, no catch-up storm; dedup + **the HEAL** — the test-caught genuine gap: a crashed-persistence window bricked interval schedules forever, the dedup no-op now advances nextDue past now, §5 receipt), the runner loop with the re-entrancy guard, the scheduleHook wiring, the schedule UI rows (backward-compatible signatures — app.ts byte-identical); the operator gate re-ran every lane — Lane A 109/0, Lane B **138/0**, root battery **2351/0/172** (2329+22), typecheck 0, lint 0/143; five deviations reviewed (one attribution corrected); receipt [c4.md](../benchmarks/rondo-round/receipts/c4.md) |
| C-5 | Assertions + artifacts: value checks, screenshot capture with pinned hashes, extraction report | Deterministic fixture battery; artifact sha256 pins | **CLOSED 2026-11-06** — the nineteenth lineage; session `01a1afdf…`, 63 turns / 5 dispatch rounds (one gate catch: the sw.js PRECACHE_LIST forward-referenced C-7's offline.html — cache.add on a 404 would fail SW install; fixed through A2 in one round with the fetch-fallback fall-through verified); value checks (exact + `=~` contains, mismatch = step-failed with expected-vs-actual, never silent), the screenshot determinism pin, the content-addressed extract-report artifact + renderExtractReport, the completed precache list with the 3-part derivation; the operator gate re-ran every lane — Lane A 115/0, Lane B **146/0**, root battery **2353/0/172**, typecheck 0, lint 0/143; receipt [c5.md](../benchmarks/rondo-round/receipts/c5.md) |
| C-6 | The e2e battery lane 1: compose → run → artifacts, keyboard-only (K-1 law) | Playwright battery green ×3 consecutive | **CLOSED 2026-11-06** — the nineteenth lineage; session `01a1affe…`, 87 turns / 5 dispatch rounds (the twenty-first's concurrent CLAIM stands down — the V-19 shape a third time; its standing brief folds in as corroborating design review, and its V-27 reset-survivor receipt is the SAME class as this closure's measurement confound — the bare-`bun test src` engine-fixture pickup — both receipts stand as independent discoveries of the one law: acceptance gates run the SCRIPT, and the tree is clean of untracked phantoms); the CHACONNE_E2E-armed config + the K-1 flow spec (zero pointer events — the gate's grep verified the only `.click(` hits are comments) + the a11y lane start (axe wcag2a/2aa light+dark, tab-order, Esc focus-return); the e2e battery green **6 consecutive** (A2's 3 + the operator's 3, ~7.5 s each); one out-of-lane ARIA fix ACCEPTED (role option→listitem + aria-current, honestly flagged, C-9-adjacent); the real `bun run test:unit` is 2353/0/172; Lane A 115/0, Lane B 146/0, typecheck 0, lint 0/143; receipt [c6.md](../benchmarks/rondo-round/receipts/c6.md) |)
| C-7 | The resilience battery: crash-mid-run resume, corrupt-store recovery, offline PWA boot | The R-1 law battery (kill/resume/verify) | **CLOSED 2026-11-06** — the twenty-third lineage (dispatched at the twenty-second's window expiry per V-32's disposition); session `01a1b0b2…`/`01a1b0b3…`, **89 turns / 7 rounds** (incl. the 8-turn operator-caused recovery chunk — V-35); the 4-lane spec (the REAL SIGKILL harness + the fake-lane log-bytes twin, the corrupt panel with bytes surviving, the O-1 offline boot + fallback + storm-check twin), offline.html + the sw.js entry restored **+ the O-1 root-cause fix (the `.js`-convention precache keys — the install-cache/module-graph key mismatch that stalled the offline shell on "Booting…")**, verify-precache.ts (the 3-way ladder, clean 0/drift 1/restored 0); the operator gate: e2e **7 consecutive green** (A2's 3 + the operator's 4, ~13 s each), test:unit **2353/0/172 exact-hold** (+7 expect), tsc 0, lint 0/143, Lane A 111p/4s/0; three deviations accepted (the storm-check form, the completion-only kill form, the capture-usage pricing); receipt [c7.md](../benchmarks/rondo-round/receipts/c7.md) |
| C-8 | Import/export: byte-stable canonical JSON round-trip, dry-run validation report | Round-trip pin + golden files | **CLOSED 2026-11-06** — the twenty-third lineage; session `01a1b0ef…`, **10 rounds / ~135 turns** (the round's heaviest: 6 chunks to the first x3-green + the operator gate's FLAKE CATCH — the battery was 12-13/14 on cold cross-runs after A2's warm x3 — and 4 chunks of root-cause/fix/proof); the 4 goldens (unicode RAW UTF-8, sha256-pinned) + regen-golden.ts `--check` (0/1 exits proven) + the 4-lane io spec (EXPORT byte-equal, ROUND-TRIP byte-identical, REFUSED never-partial with the store byte-identical, CORRUPT honest error + the boot twin); the fix (DOM-condition waits + the 15 s bounded retry + fail-fast dump — the C-2 law applied to the filechooser); **12 consecutive green** (A2's 6/6 + the operator's 6/6, 6 cold boots); test:unit 2353/0/172 exact-hold, tsc 0, lint 0, Lane A 113/4/0; V-39 filed (the prompt-guard silent kill); receipt [c8.md](../benchmarks/rondo-round/receipts/c8.md) |
| C-9 | The accessibility battery: axe wcag2a/2aa both schemes, tab-order pin, Esc focus-return | A-1 battery green light AND dark | **CLOSED 2026-11-06** — the twenty-second lineage; session `01a1b0f6…` (the scope, cut by the operator's 2400 s timeout — the V-32 fresh-session-handoff cure applied) + the closing chunk `01a1b12b…` (34 turns / 576 s, subtype success — the 16-turn cap overspend receipted, the V-32(b) shape a second time; the two infra-failed closes in between are V-38's max_tokens window, toll receipted); the 7-block a11y spec (the dialog contract on editor + palette: role=dialog, aria-modal, attach-before-focus, the Tab trap, Esc + focus-return; the resize lane at 1280×800/768×1024/375×667 — no overflow, no zero-size, keyboard operable, axe clean at the narrowest, light+dark; the selection semantics — arrow-nav + aria-current + role=listitem; the loading state — the honest #chaconne-status-idle terminal, deviation #1) + focus-trap.ts + its test (the unit backing); the operator gate re-ran every lane — Lane A 113p/5s/0, Lane B **156/0**, root battery **2361/0/173** (+8, the focus-trap tests join via src/ui), tsc 0, lint 0/143, the e2e battery **20/20 × 3 consecutive incl. the CI=1 cold boot** (the C-8 amendment honored; the cold-boot retry arms fired on the io lanes and held), the io lane untouched (the parallel-courtesy check); receipt `.unown/receipts/c9.md` (the hardening-map BEFORE/AFTER table — every PRD row pinned or scoped; 3 deviations, 3 OQs for C-10/C-11: the live progress row, the breakpoint re-derivation law, the palette P0-reachability audit) |
| C-10 | The landing band + docs page + usage captures (screenshots of the app in use) | `check:docs`/`check:claims`/`check:blog` + the landing audit | **CLAIMED 2026-11-06 (the twenty-second lineage, post-C-9)** — the Ostinato-band house pattern applied to Chaconne: the ChaconneSection band + capture-usage.mjs (the C-7 receipt's ruling: C-10's to consume/write) + the real stills + docs/chaconne.md + the README rows; dispatched after the claim-push |
| C-11 | The runbook + CI gate entry + honest-scope statement | The CI gate config + `bun run chaconne:test`/`e2e` from root | QUEUED |
| A2H-9 | The encore Finale test-isolation fix (V-4): the full-suite-only, order-dependent unit fail — next chunk runs the shard-bisect protocol (find the minimal co-failing file set), then fixes at the named layer; the encore test's intent is NOT weakened | `bun run test:unit` 0 fail (quoted tail) + isolation rerun green + the minimal co-failing set receipted in `.unown/receipts/a2h9.md` | **CLOSED 2026-11-06** — see the first queue row + [the receipt](../benchmarks/rondo-round/receipts/a2h9.md) |
| A2H-7 | The #30 live-hang capture: the armed watcher (`scripts/issue30_watcher.mjs`) run in both churn lanes during this round's dispatch traffic | A hang capture dir with /proc evidence, or a non-repro receipt with run count | **NON-REPRO RECEIPTED 2026-11-06 (the twentieth lineage)** — both lanes ×8 runs: idle 8/8 exit 0 (`UNOWN_OK`, 1.5–4.7 s), dream 8/8 exit 0 (1.5–2.1 s) — the dream lane run CONCURRENT with the A2H-8 browser dispatch (real dispatch traffic, engine requests 18→48 mid-lane); no hang, no capture dir; receipts [a2h7/idle-summary.json](../benchmarks/rondo-round/receipts/a2h7/idle-summary.json) + [a2h7/dream-summary.json](../benchmarks/rondo-round/receipts/a2h7/dream-summary.json) committed. The watcher STAYS ARMED for the round's later dispatch traffic (each re-run mints a fresh non-repro receipt; a capture ends the wait) |
| A2H-8 | The #43 browser fill_form iframe-race probe: a fixture-page repro of the iframe fill class through A2's own browser tools, evidence filed upstream | The repro transcript + the upstream issue comment draft | **CLOSED 2026-11-06 (the twentieth lineage)** — 2 chunks (8+8 turns, session `01a1af48-8b74…`, the V-5 continuation law applied); the verdict (reconciled with the repo's own F3 postfix evidence): **the v0.0.55 silent-loss path is NOT REPRODUCIBLE on v0.0.56** — the F3 fix (`0d0c64ff`, in v0.0.56) closed it; 5/5 runs fail LOUDLY; RESIDUAL GAP: a loud-failure window between navigate's return and the frame's ref readiness (the barrier should extend to fill_form's ref resolution), plus a minor partial-application atomicity gap (the select lands when the input fails); evidence filed upstream — [comment 1](https://github.com/kanishka-namdeo/Unown/issues/43#issuecomment-6677636789) + [the reconciliation follow-up](https://github.com/kanishka-namdeo/Unown/issues/43#issuecomment-6677653366); receipt [a2h8.md](../benchmarks/rondo-round/receipts/a2h8.md) (5 verbatim run records, the operator gate verified the excerpts against the session log, the amended reconciliation section included). Feeds C-2's RealPageAdapter design (verify-value-landed is now CONFIRMED necessary — the residual window is real) |
| A2H-10 | The B-18 fix: the deterministic reasoning-noise filter at the dream's write boundary — `sanitizeMemoryText()` applied at all three leak lanes (ADD/reconcile-UPDATE/salvage) in `pi-repo/packages/self-learning/src/memzero.ts`, stripping the `[NOTE: …]` blob + JSON-fragment + trailing-Reason shapes, REJECTING empty residuals; clean facts pass byte-identical | The package suite (`cd pi-repo/packages/self-learning && bun test test/`) green with new shape pins + the clean pass-through pin + each lane's pin; tsc parity (0 new errors); the root battery holds | **CLOSED 2026-11-06 (the twentieth lineage)** — A2 3 chunks (session `01a1af52…`: recon 8 / implementation +106/−10 with all three lanes wired / the rider attempt that died at cap on a template-literal syntax error), then the operator's priced completion (the R-2/SM-1 precedent): the syntax cure, the ENTIRE 14-pin test file, and four genuine defects caught by the pins at the gate (nested-bracket residue; a stray-quote regex bug that made the JSON-fragment strip a NO-OP for every non-empty value; the missing `}, {` comma; the over-aggressive mid-prose Reason strip → the sentence-start lookbehind) + the whitespace-only reject floor. **Gates: pins 14/14 · package suite 5470/105-skip/0-fail (the 9-fail bridge-under-load flake set from the mid-dispatch baseline ALSO resolved on the quiet re-run) · package tsc 77 = 77 exact parity (stash-verified; memzero.ts 0 errors both sides) · root typecheck 0**. Receipt [a2h10.md](../benchmarks/rondo-round/receipts/a2h10.md) with the honest A2/operator split + the four design deviations. **The round's first Unown-code enhancement → the version bump v0.0.57 + the CHANGELOG entry + the regenerated rail (56 stops/543 entries/55 dated) ride this closeout**. B-18's register row moves to FIXED-pending-render (the next dream cycle over a shape-carrying fact lineage is the natural experiment) |
| A2H-11 | (CONVERGENT — see V-23) the windows-CI test-isolation fix: `automation-spend.test.ts`'s beforeAll calls `ensureAutomationsSchema()` before the DELETEs (one file) | The isolation repro green (10/0, was 1 fail); the full suite green with the fix (5575/0/248) | **CLOSED-CONVERGENT 2026-11-06** — the twentieth's B-19 landing (`c69d6382`) governs; this lane's session `01a1afb2…` + receipt [a2h11.md](../benchmarks/rondo-round/receipts/a2h11.md) stand as the parallel evidence |
| A2H-12 | The B-20 fix: the runner CLI's dead isMain guard — replace the path-vs-URL comparison with Bun's native `import.meta.main` (one hunk, the guard region only) | The CLI runs for real (a seeded store → 'run 1 (recipe 1 v1): ok; committed prefix 1', exit by status); Lane A 115/0 unaffected (the import lane never fires the guard) | **CLOSED 2026-11-06** — session `01a1b031…`, 3 chunks (one out-of-scope edit self-caught and reverted mid-flight); the operator gate re-verified: Lane A 115/0, the CLI spec's invocation reaches the real run path; receipt [a2h12.md](../benchmarks/rondo-round/receipts/a2h12.md) — **lands ON TOP of the parallel C-6 (b6013928) whose landing still carried the dead guard** |
| A2H-13 | The V-30 reconciliation: the runner's `extract-report.json` ext (a dotted token) violates the PWA domain's single-token `ARTIFACT_NAME_RE` — the cross-host artifact-name seam | The cross-host pin (the runner's on-disk record → the PWA domain's validation) green, and RED on the old grammar; `bun run test:unit` + Lane A green; the ruling receipted | **CLOSED 2026-11-06** — the twenty-third lineage; session `01a1b0df…`, 56 turns / 6 chunks (priced: 3 cap-stop verify chunks + the latent-seed-defect catch); ruling (a): the ext → `json` (the domain's vocabulary), the domain FROZEN; the 4-file diff + the two cross-host pins through `assertData` (the dotted name THROWS — RED by construction); one latent defect caught at A2's own gate (the flow specs' stale old-grammar seeds passing the old assertion for the wrong reason); the operator gate: Lane A **113/4/0 (+2)**, e2e 10 passed, test:unit **2353/0/172 unchanged**, tsc 0, lint 0; receipt [a2h13.md](../benchmarks/rondo-round/receipts/a2h13.md) — **C-8 inherits a conforming runner + the frozen grammar + the seam pin**. **Corroborating design review (the twenty-fourth lineage, read-only)**: the ruling preference (a) verified against the UI — the artifact viewer's dispatch is `.png`-vs-else (`app.ts:715`) and the extract render reads `run.extracted`, NOT the artifact name (`artifact-viewer.ts:96-106`), so the single-token rename needs NO `src/ui/` edit and the ALLOWED_INPUTS list stands as-authored; the e2e assertion lane is already covered by the brief's own "assertion updates if artifact names change" clause (the CLI spec's on-disk name pin `0_r…sha256:….extract-report.json` at `store.test.ts:158` is the assertion that moves) |
| (carry) | Reprise R-3..R-5, the standing SESSION.md items | per their own logs | PARKED (candidates) |

**EFFORT_BUDGET**: C-tickets ≤4 chunks each · each chunk ≤8 turns
(`--max-turns 8`), fresh session per ticket, byte-exact continuation briefs
on every resume (the standing economics); satellites ≤2 chunks.

## First dispatch brief

The A2H-9 isolation-fix ticket — dispatched AFTER this queue update is
pushed (the standing practice: push the claim before dispatch):

```
ROLE: A2 executor — one scoped test-isolation fix, no scope creep.
ALLOWED_INPUTS: src/components/encore/__tests__/encore.test.tsx (the
  failing test's file — isolation guards only, never assertion
  weakening), src/components/encore/views/finale.tsx + src/test-dom-setup.ts
  (read-only context; editable ONLY if the root cause lands there), and
  the polluting test file(s) once identified — the receipt names them.
FORBIDDEN_INPUTS: weakening, skipping or re-basing the failing test's
  assertions (the h2 + blockquote contract stands); changing the Finale
  component's product behavior; product code outside the encore lane;
  DOX; CHANGELOG (the operator lane); apps/.
OUTPUT_ARTIFACT: the isolation fix at the layer the root cause names
  (the polluting file, the shared setup, or the test file's own guards);
  a receipt at .unown/receipts/a2h9.md with the root-cause chain, the
  differential evidence (standalone 55/0 vs in-battery 2257/1 → 2258/0),
  and the verify tally.
HANDOFF_SCHEMA: plain text — the root cause, what changed, the verify
  tally, the receipt path.
EFFORT_BUDGET: <=4 chunks x <=8 turns.
NON-OVERLAP: C-0 owns the Chaconne plan; nothing here touches apps/ or
  any Unown product code outside the encore lane.
ACCEPTANCE: `bun run test:unit` exits 0 (2258 tests, 0 fail) TWICE
  consecutive; `bun test src/components/encore/__tests__/encore.test.tsx`
  stays 55/0 standalone; the failing test's assertions are byte-identical
  or stronger (the h2 role query and the blockquote textContent check
  stand); if the fix lands in a polluting file, the receipt names it and
  the isolation mechanism.
```

The C-0 architecture plan ticket — dispatched AFTER A2H-9 closes (the
round-opening law stood: the claim is pushed before dispatch):

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

The C-1 domain-core ticket — the STANDING BRIEF (authored by the
twentieth lineage against the PLAN; whichever lineage dispatches per
the V-9 protocol uses it; fresh session, the prompt-economy header,
stdin guarded, `--mode json` envelope, ≤4 chunks × ≤8 turns; the claim
pushed BEFORE dispatch per the ledger-arbiter law):

```
ROLE: A2 executor — C-1, the Chaconne domain core: the FIRST code write
  under apps/chaconne/, building strictly against apps/chaconne/PLAN.md.
ALLOWED_INPUTS: apps/chaconne/PLAN.md (the governing plan — §1 file
  tree, §2 schema + invariants, §3 lanes, §4 dependency ruling),
  docs/chaconne-prd.md (the requirements), apps/ostinato/src/domain/**
  + apps/ostinato/src/storage/local-storage.ts + apps/ostinato/package.json
  (read-only: the house patterns — types/ids/invariants/model/io/storage
  + boundary.test.ts + the 7-line package.json), tsconfig.json +
  eslint.config.mjs (read-only: the scoping targets).
FORBIDDEN_INPUTS: every write outside apps/chaconne/ EXCEPT the root
  tsconfig.json include line; no runner/ code (C-2), no src/ui/ (C-3),
  no scheduler LOGIC (C-4 owns src/domain/scheduler.ts; C-1 owns only
  the Schedule TYPE + the recordSchedule mutation), no fixtures (C-2),
  no index.html/sw.js/serve.mjs (C-3/C-6), no playwright imports (the
  runner's exception is C-2's, never the domain's), no new deps, no
  CHANGELOG/DOX edits (the operator lane), nothing under src/, pi-repo/,
  mini-services/, apps/coda/, apps/ostinato/ (writes).
OUTPUT_ARTIFACT: under apps/chaconne/ exactly — package.json (the
  7-line zero-dep law: @unown/chaconne), src/domain/types.ts (Recipe,
  Step, RunRecord, Schedule, ArtifactRef, the 5-entry status taxonomy
  ok|step-failed|selector-not-found|timeout|invalid-recipe,
  DomainInvariantError), src/domain/ids.ts (INTEGER ids, deterministic
  next-free allocation — the PLAN's deliberate divergence from
  Ostinato's strings), src/domain/invariants.ts (assertData: unique ids
  per collection; run.recipeId resolves; recipeVersion present on runs;
  selectors non-empty; step kinds in the closed 9-set; artifact names
  match the content-addressed grammar; committedPrefix <= steps.length),
  src/domain/model.ts (pure mutations: addRecipe, updateRecipe bumps
  recipeVersion, addRun, recordSchedule), src/domain/io.ts (canonical
  JSON — sortKeysDeep + compact separators + stable array order,
  byte-stable; export; import with the "chaconne.v1" schema gate —
  foreign/future schema REJECTED with a dry-run report, never partial),
  src/domain/storage.ts (StoragePort: load/save/recover, temp-key +
  commit-swap contract), src/storage/local-storage.ts (the adapter:
  "chaconne.data"/"chaconne.tmp", atomic writes, corrupt-store recovery
  — load() null on undecodable, recover() discards orphaned tmp, never
  a silent wipe), co-located *.test.ts per module + boundary.test.ts
  (the import-graph pin: src/** imports ./ ../ bun:test ONLY — the
  Ostinato V-14 regex precedent), PLUS the root tsconfig.json include
  gains "apps/chaconne/**/*.ts" AND eslint.config.mjs gains the
  chaconne domain pair (the Coda scope shape on
  apps/chaconne/src/domain/*.ts + *.test.ts). A receipt at
  .unown/receipts/c1.md (root cause-free: files written, the Lane A/B
  tallies, tsc/lint state, open questions).
HANDOFF_SCHEMA: plain text — files written, test tallies, gates state,
  open questions for C-2.
EFFORT_BUDGET: <=4 chunks x <=8 turns.
NON-OVERLAP: C-2 owns runner/ + fixtures; C-3 owns the UI; the
  round log/CHANGELOG are the operator's; the receipt is the LAST
  chunk's closeout write.
ACCEPTANCE: (1) cd apps/chaconne && bun test — Lane A green, 0 fail;
  (2) bun test apps/chaconne from root — Lane B green; (3) root
  bun run typecheck — 0 NEW errors; (4) bun run lint — 0 NEW
  errors; (5) bun run test:unit — 2258/0 holds (no regression);
  (6) the schema laws pinned by tests: canonical export byte-stable
  (same data two boots -> identical bytes), the schema-gate rejection,
  the version-bump law, committedPrefix bound, the artifact-name
  grammar, integer-id allocation; (7) boundary.test.ts green in BOTH
  lanes (the import-graph pin).
```

The C-2 runner ticket — the STANDING BRIEF (authored by the
twenty-first lineage against the PLAN §1/§3/§4/§6.1; fresh session,
the prompt-economy header, stdin guarded via the a1-dispatch helper,
`--output-format json` envelope, ≤4 chunks × ≤8 turns — a closing
verify chunk may run 16 by the A2H-9 pre-split precedent; the claim
pushed BEFORE dispatch per the ledger-arbiter law):

```
ROLE: A2 executor — C-2, the Chaconne runner v1: the execution engine
  that turns a C-1 recipe into a run record against LOCAL fixture
  pages, building strictly against apps/chaconne/PLAN.md.
ALLOWED_INPUTS: apps/chaconne/PLAN.md (the governing plan — §1 the
  runner tree, §3 the fixture set + the fake-adapter strategy, §4 the
  dependency ruling + the exact import mechanism, §6.1 the spike),
  docs/chaconne-prd.md, apps/chaconne/src/** (C-1's landed domain —
  IMPORT freely: types, model, invariants, io; treat as CLOSED: no
  edits — a discovered gap is an open question in the receipt, never
  a silent change), apps/ostinato/** + apps/coda/** (read-only: house
  patterns), the repo root's node_modules/playwright (the import
  target — resolution by bare specifier per PLAN §4).
FORBIDDEN_INPUTS: every write outside apps/chaconne/ EXCEPT the
  receipt at .unown/receipts/c2.md; no src/ui/ (C-3), no
  index.html/sw.js/serve.mjs/public/ (C-3/C-6/C-7), no
  playwright.chaconne.config.ts or e2e/ specs (C-6), no scheduler —
  src/domain/scheduler.ts and runner/schedule.ts are C-4's entirely
  (the Schedule TYPE + recordSchedule already exist from C-1); no
  edits to src/domain/** or src/storage/**; no new deps anywhere (the
  runner imports the root playwright ONLY); no CHANGELOG/DOX edits;
  nothing under src/, pi-repo/, mini-services/, apps/coda/,
  apps/ostinato/ (writes).
OUTPUT_ARTIFACT: under apps/chaconne/ exactly — runner/smoke-resolve.ts
  (the §6.1 spike, RUN FIRST: bare `import { chromium } from
  "playwright"`, print chromium.executablePath(), launch headless
  against test/fixtures/blank.html via file:// or a boot-local static
  server, close, exit 0 — green before anything else is built),
  runner/page-adapter.ts (the PageAdapter seam: goto/click/fill/
  select/wait/assertText/assertElement/extract/screenshot + the
  step-error taxonomy types mapping to the 5-entry RunRecord status
  set), runner/caps.ts (per-step + per-run caps: max steps, wall
  clock; the committed-prefix law — a killed/failed run keeps only
  fully-completed steps), runner/store.ts (the DISK store:
  data/chaconne.data.json + .tmp twin, writeFile(tmp) ->
  renameSync(tmp, commit); content-addressed artifact names
  sha256(payload) under data/artifacts/; recover() discards
  orphaned tmp on boot), runner/log.ts (the run-log artifact: honest
  step-by-step log + taxonomy entries, written atomically),
  runner/real-adapter.ts (RealPageAdapter over a playwright Page:
  intoFrame resolution by name/data-testid, post-fill READ-BACK
  verification — input.value() must equal the intended value, the
  #43 cure; screenshot({fullPage:true}); capped waitForSelector/
  waitForFunction surfacing selector-not-found/timeout, NEVER a
  hang), runner/fake-adapter.ts (the in-memory DOM table + injected
  clock test double: every step kind, every taxonomy entry,
  deterministic), runner/index.ts (the CLI: `bun
  apps/chaconne/runner/index.ts run <recipeId>` with --store <dir>
  (default <app>/data) and --base <url> (relative goto URLs resolve
  against it; absolute pass through); loads the store, executes via
  the real adapter, writes the run record atomically, prints a
  one-line summary + exit code by status), runner/smoke.ts (the ONE
  real-browser smoke — a SCRIPT, not a bun:test file: boots an
  ephemeral Bun.serve serving ONLY test/fixtures/ on 127.0.0.1:<free
  port> (never 4014 — that is C-3's), runs a 4-step recipe through
  the RealPageAdapter: goto form-iframe.html, fill the plain field,
  fill the iframe-hosted field (the read-back assert), assert-text on
  a known marker; writes the run record + artifacts to a temp dir,
  prints the summary line, exits 0), runner/*.test.ts co-located (the
  fake-adapter unit lane: every step kind; every taxonomy entry;
  caps; committed-prefix on mid-run failure; recipeVersion snapshot
  in the run record; corrupt/orphan store recovery on fs; the tests
  MUST NOT import real-adapter.ts or index.ts — the unit lane never
  transitively loads playwright), test/fixtures/form-iframe.html +
  tall.html + slow.html + dynamic.html + blank.html (the 5 named
  fixtures of PLAN §3: static, zero-network, inline <script> timers
  only, no CDNs), .gitignore (app-local, 2 lines: data/ + any
  runner scratch), AND the receipt at .unown/receipts/c2.md (files
  written, the Lane A/B tallies, the spike + smoke outputs verbatim,
  tsc/lint state, open questions for C-3/C-4).
HANDOFF_SCHEMA: plain text — files written, test tallies, the spike
  and smoke result lines, gates state, open questions.
EFFORT_BUDGET: <=4 chunks x <=8 turns (a closing verify chunk may
  run 16 turns — the A2H-9 pre-split lesson, prefer splitting).
NON-OVERLAP: C-3 owns the UI shell + serve.mjs + the 4014 lane; C-4
  owns all scheduling; C-6 owns the e2e config + specs; the round
  log/CHANGELOG are the operator's; the receipt is the LAST chunk's
  closeout write.
ACCEPTANCE: (1) `cd apps/chaconne && bun test` — Lane A green, 0
  fail (the standing 31 domain tests + the new runner unit tests;
  the count named in the receipt); (2) `bun test apps/chaconne` from
  root — Lane B green, same count; (3) `bun
  apps/chaconne/runner/smoke-resolve.ts` — exit 0, the executablePath
  line printed (the §6.1 spike settled); (4) `bun
  apps/chaconne/runner/smoke.ts` — exit 0, the 4-step real-browser
  recipe's summary line printed, the run record + artifacts present
  in the temp dir (the ONE real-browser verification); (5) root
  `bun run typecheck` — 0 NEW errors; (6) `bun run lint` — 0 NEW
  errors; (7) `bun run test:unit` — **2289/0 holds exactly** (the
  runner tests live under apps/chaconne/runner/ whose path carries
  no "src" substring — they join Lane A/B, NOT the root battery;
  apps/chaconne/src/** stays the only joiner); (8) the edge pins:
  timeout mid-run -> committedPrefix in the run record (slow.html
  via fake + the cap); selector-not-found (blank.html via fake) ->
  the taxonomy entry, NO hang (the capped wait returns); iframe fill
  -> the read-back assert (the smoke's step 3); recipeVersion
  snapshot in the run record (fake lane); (9) the 5 fixtures:
  static, zero-network, inline timers only; (10) no file outside
  apps/chaconne/ written except .unown/receipts/c2.md.
```

The C-4 scheduling ticket — the STANDING BRIEF (authored by the
twenty-first lineage against the PLAN §1/§5-edge-6; dispatched after
the claim-push, fresh session, the prompt-economy header, stdin
guarded via the a1-dispatch helper, `--output-format json` envelope,
≤4 chunks × ≤8 turns + the A2H-9 16-turn closing allowance):

```
ROLE: A2 executor — C-4, the Chaconne recurring loop: schedules
  (one-shot + interval), the misfire policy, and their run-history
  integration, building strictly against apps/chaconne/PLAN.md and
  the landed C-1/C-2/C-3 code.
ALLOWED_INPUTS: apps/chaconne/PLAN.md (§1 the scheduler files, §2 the
  Schedule shape, §5 edge 6's verifier), docs/chaconne-prd.md,
  apps/chaconne/src/** + apps/chaconne/runner/** + apps/chaconne/src/ui/**
  (the landed code — IMPORT freely; the C-2 receipt's OQ-2 ruling is
  yours to implement: the artifact-name runId convention), apps/ostinato/
  (read-only: the house scheduler pattern — src/domain/scheduler.ts),
  the repo root's node_modules/playwright-core (the C-2 OQ-1 resolution).
FORBIDDEN_INPUTS: every write outside apps/chaconne/ EXCEPT the receipt
  at .unown/receipts/c4.md; no C-5 lanes (assertion depth, screenshot
  hash pinning); no e2e specs or playwright config (C-6); no
  index.html/sw.js product changes beyond wiring schedule UI rows into
  the EXISTING run-history view; no new deps; no edits to
  pi-repo/ or the engine.
OUTPUT_ARTIFACT: under apps/chaconne/ exactly — src/domain/scheduler.ts
  (PURE (schedule, now) -> {due, skip, record}: interval + one-shot,
  the misfire policy SKIP-AND-RECORD — a gap >= interval yields a
  skipped+recorded entry, never a silent double-run, never a catch-up
  storm; deterministic, injected-clock testable — the Ostinato law),
  src/domain/scheduler.test.ts (the injected-clock battery: due/not-due
  boundaries, the misfire gap, the one-shot expiry, the interval
  rollover, DST-free plain-ms math), runner/schedule.ts (the loop:
  ONE-SHOT fires once then deactivates; INTERVAL fires per due tick;
  reads the schedule via the domain, executes through the C-2 runner
  seam (executeRecipe / the scheduleHook stub C-2 left), records
  skipped misfires, run-history dedup by (recipeId, dueAt)), the OQ-2
  resolution in the runner's artifact naming (the TRUE run id in the
  r<id> slot — the C-2 receipt names this refactor as C-4's), the
  schedule UI rows in src/ui/run-history.ts + their tests (the
  existing view gains: the schedule state per recipe, the next-due
  display, the skip-record entries in history — keyboard-navigable,
  the C-3 contract), AND the receipt at .unown/receipts/c4.md (files,
  tallies, the misfire-policy pin outputs, open questions).
HANDOFF_SCHEMA: plain text — files written, test tallies, the
  misfire/dedup pins, gates state, open questions for C-5.
EFFORT_BUDGET: <=4 chunks x <=8 turns (closing verify chunk may run 16).
NON-OVERLAP: C-5 owns assertion/artifact depth; C-6 owns e2e; the
  round log/CHANGELOG are the operator's; the receipt is the LAST
  chunk's closeout write.
ACCEPTANCE: (1) cd apps/chaconne && bun test — Lane A green, 0 fail
  (the standing 85 + the new scheduler/UI tests; count named);
  (2) bun test apps/chaconne from root — Lane B green (the standing
  110 + the new count); (3) root bun run typecheck — 0 NEW errors;
  (4) bun run lint — 0 NEW errors; (5) bun run test:unit — 2329/0
  holds PLUS the new scheduler tests that live under src/ (the src
  substring joins them — name the new exact total); (6) the misfire
  law pinned: a gap >= interval -> ONE skipped+recorded entry, ZERO
  double-runs, ZERO catch-up storms (the injected-clock battery);
  (7) the dedup law pinned: run-history has no (recipeId, dueAt)
  duplicates after an interval fire + a misfire recovery; (8) the
  one-shot law: fires exactly once, then the schedule reads inactive;
  (9) the OQ-2 resolution landed (the artifact name's r<id> is the
  run id) + a test pinning it; (10) no file outside apps/chaconne/
  written except .unown/receipts/c4.md.
```

The C-6 e2e battery ticket — the STANDING BRIEF (authored by the
twenty-first lineage against the PLAN §4's config spec + §5's K-1 law;
dispatched after the claim-push; fresh session, the prompt-economy
header, stdin guarded via the a1-dispatch helper, `--output-format
json` envelope, ≤4 chunks × ≤8 turns + the 16-turn closing allowance):

```
ROLE: A2 executor — C-6, the Chaconne e2e battery lane 1: the
  compose -> run -> artifacts flow, KEYBOARD-ONLY (the K-1 law),
  building strictly against apps/chaconne/PLAN.md and the landed
  C-1..C-5 code.
ALLOWED_INPUTS: apps/chaconne/PLAN.md (§4 the config spec verbatim:
  the webServer/testDir/testMatch/marker/outputDir/baseURL/project
  shape; §5 the K-1 law), docs/chaconne-prd.md, apps/chaconne/**
  (the landed app — read + import; serve.mjs is the webServer target),
  playwright.ostinato.config.ts + e2e/ostinato-*.spec.ts (read-only:
  the house e2e pattern — the self-skip guard, the battery
  conventions), the repo root's @playwright/test + playwright.
FORBIDDEN_INPUTS: every write outside e2e/ + playwright.chaconne.config.ts
  EXCEPT the receipt at .unown/receipts/c6.md; NO root package.json
  edits (C-11 lands the chaconne:* script entries — the verifier runs
  the battery via bunx directly); no app code changes (if the flow
  finds a genuine app defect, STOP and report it BLOCKED with the
  repro — the fix is a new ticket, not an in-ticket patch); no
  resilience/offline/precache specs (C-7); no a11y spec (C-9 — the
  queue's lane split defers the PLAN's a11y-spec-in-C-6 mapping to
  C-9, a documented deviation); no new deps.
OUTPUT_ARTIFACT: playwright.chaconne.config.ts (repo root, the PLAN §4
  spec VERBATIM: testDir "e2e", testMatch /chaconne-.*\.spec\.ts/,
  module-scope process.env.CHACONNE_E2E = "1", outputDir
  "download/test-results-chaconne", baseURL
  http://127.0.0.1:4014, the chromium-desktop-only project
  devices["Desktop Chrome"], ONE webServer: bun
  apps/chaconne/serve.mjs with env CHACONNE_PORT 4014,
  reuseExistingServer: !process.env.CI, timeout 60_000),
  e2e/chaconne-flow.spec.ts (the K-1 battery: create a recipe via the
  palette/editor keyboard-only (Ctrl+K, arrows, Enter, Esc per the
  C-3 contract), run it against a LOCAL fixture (the runner's
  fixture lane — the recipe's goto targets the served
  /test/fixtures/ pages), watch the run history update, open the
  artifact viewer, assert the screenshot + extract artifacts render;
  EVERY interaction keyboard-only — zero mouse clicks in the spec),
  AND the receipt at .unown/receipts/c6.md (files, the x3-consecutive
  battery tallies verbatim, timings, open questions for C-7).
HANDOFF_SCHEMA: plain text — files written, the battery tally x3,
  timings, open questions.
EFFORT_BUDGET: <=4 chunks x <=8 turns (closing verify chunk may run 16).
NON-OVERLAP: C-7 owns resilience + offline + precache specs; C-9 owns
  a11y; C-11 owns the root script wiring; the round log/CHANGELOG are
  the operator's.
ACCEPTANCE: (1) `bunx playwright test -c playwright.chaconne.config.ts`
  from root — the battery GREEN, named count, run THREE consecutive
  times (the x3 law — quote each tally + wall time); (2) the spec is
  keyboard-only (a grep-level self-check: no .click( with a mouse
  position, no page.mouse — keyboard actions only); (3) the config is
  the PLAN §4 spec verbatim (the self-skip guard verified: running the
  root `bunx playwright test` WITHOUT the chaconne config skips the
  chaconne specs); (4) the fixtures stay LOCAL (the spec's goto URLs
  are /test/fixtures/... on 127.0.0.1:4014 only); (5) root bun run
  typecheck + lint — 0 NEW errors; (6) bun run test:unit — 2353/0
  holds (the e2e specs are NOT unit tests — no battery growth); (7)
  no file outside e2e/, playwright.chaconne.config.ts, and
  .unown/receipts/c6.md written.
```

The C-7 resilience-battery ticket — the STANDING BRIEF (authored by the
twenty-second lineage against the PLAN §5 C-7 row + edge cases 5/11 +
spike 3; fresh session, the prompt-economy header, stdin guarded,
`--output-format json` envelope, ≤4 chunks × ≤8 turns with the closing
verify chunk allowed 16; the claim pushed BEFORE dispatch):

```
ROLE: A2 executor — C-7, the Chaconne resilience battery: crash-mid-run
  resume (the R-1 kill/resume/verify law), corrupt-store recovery boot,
  and the offline PWA boot (O-1) — building strictly against
  apps/chaconne/PLAN.md (§5 C-7 row, edge cases 5 + 11, spike 3).
ALLOWED_INPUTS: apps/chaconne/** (the app tree: sw.js, public/, src/,
  runner/, test/fixtures/, scripts/ — new dirs allowed under
  apps/chaconne/scripts/), e2e/chaconne-resilience.spec.ts (new),
  e2e/chaconne-seed.js + the existing chaconne specs (read-only
  context), playwright.chaconne.config.ts (read-only — C-6's landed
  config governs), apps/chaconne/PLAN.md + docs/chaconne-prd.md
  (read-only: the governing docs), .unown/receipts/c7.md (your receipt).
FORBIDDEN_INPUTS: pi-repo/ core; mini-services/; src/ (the landing
  site); apps/ostinato/ + apps/coda/ (read-only context at most); the
  root package.json script entries (C-11 owns chaconne:test/e2e);
  CHANGELOG / DOX / the round log (the operator lane); weakening any
  existing test; live-network tests (every fixture is LOCAL, served
  from 127.0.0.1:4014 — no external URL may appear in a spec).
OUTPUT_ARTIFACT: (1) e2e/chaconne-resilience.spec.ts — three lanes:
  [R-1] a scripted kill harness: spawn `bun apps/chaconne/runner/index.ts
  run <id> --data-dir <tmp>` against the slow.html fixture via
  child_process, SIGKILL it mid-recipe at a chosen step boundary, then
  VERIFY: the data dir holds either the clean committed prefix or an
  orphaned temp file (never a torn commit); a fresh boot/inspection
  recovers to the committed prefix (the orphaned-tmp discard — the
  Ostinato recover() law on fs); a re-run NEVER re-fires steps <=
  committedPrefix (assert against the run log's step records);
  [CORRUPT] a corrupt-store boot: seed localStorage with invalid JSON
  at the app's storage key -> boot -> the honest corrupt panel renders
  (the DomainInvariantError UI state — NEVER a silent wipe, NEVER a
  crash; the corrupt bytes stay inspectable, a reset is an explicit
  user action); [O-1] the offline PWA boot: register the service
  worker, context.setOffline(true), reload -> the shell boots ENTIRELY
  from precache (assert the app surface, not a browser error page);
  navigate to a non-precached path -> the offline fallback page
  renders; the pending-schedules twin: 3 due schedules seeded, offline
  boot -> 3 logged deferrals, 0 background fires, 0 UI storm (C-4's
  misfire policy exercised against its scheduler).
  (2) apps/chaconne/public/offline.html — the offline fallback page
  (keyboard-accessible, links back to the app root) + the sw.js
  PRECACHE_LIST entry restored IN THE SAME CHANGE (a 404 would reject
  cache.add and fail install — the C-5 law).
  (3) apps/chaconne/scripts/verify-precache.ts — the derivation
  proof: statically derive the module closure (index.html's script
  root + the served .ts import graph) and assert it EQUALS
  PRECACHE_LIST, failing loudly on drift (exit 1 naming both sides).
  Runnable as `bun apps/chaconne/scripts/verify-precache.ts`.
  (4) .unown/receipts/c7.md — files, the x3 battery tallies verbatim,
  timings, the R-1 kill-boundary choices, open questions for C-8.
HANDOFF_SCHEMA: plain text — files written, the battery tally x3,
  timings, the kill-boundary matrix, open questions.
EFFORT_BUDGET: <=4 chunks x <=8 turns (the closing verify chunk may
  run 16 — the C-6 precedent for e2e-lane tickets).
NON-OVERLAP: C-8 owns import/export + golden files; C-9 owns a11y
  depth; C-10 owns the landing band + usage captures (capture-usage.mjs
  is C-10's to consume; do NOT write it this ticket — a documented
  deviation from the PLAN's file list, priced by the operator: the
  resilience battery is already the heaviest lane); C-11 owns the root
  script wiring + runbook; the round log/CHANGELOG are the operator's.
ACCEPTANCE: (1) `node_modules/.bin/playwright test -c
  playwright.chaconne.config.ts` from root — the FULL battery (the
  existing 6 + the new resilience specs) GREEN, named count, run THREE
  consecutive times (the x3 law — quote each tally + wall time);
  (2) `bun apps/chaconne/scripts/verify-precache.ts` exits 0, and a
  deliberate one-entry drift test proves it exits 1 (run it, quote
  both exits); (3) the R-1 lane kills a REAL runner process (a
  child_process SIGKILL, not a page.reload stand-in — the runner is a
  CLI, the PLAN's spike names the real kill); the no-re-fire assertion
  cites the run log's step records; (4) the corrupt lane asserts the
  honest panel AND that the store bytes survive (no wipe); (5) the
  O-1 lane asserts 3 deferrals / 0 fires / 0 storm with the offline
  boot; (6) `bun run test:unit` (THE SCRIPT, never bare `bun test src`
  — the C-6 confound law) — 2353/0/172 exact-hold (new unit tests for
  verify-precache's derivation may grow the count; quote it);
  (7) `bun run typecheck` + `bun run lint` — 0 NEW errors; (8) any
  genuine app defect found mid-lane: STOP, report BLOCKED with the
  repro — the fix is a new ticket, not an in-ticket patch; (9) no
  file outside apps/chaconne/, e2e/chaconne-resilience.spec.ts, and
  .unown/receipts/c7.md written.
```

The A2H-13 artifact-grammar reconciliation ticket — the STANDING BRIEF
(authored by the twenty-third lineage against V-30's receipt; claimed,
DISPATCH GATED on the C-7 landing — the ticket touches
`apps/chaconne/runner/` and `apps/chaconne/src/domain/`, the same tree
C-7's ACTIVE dispatch owns; the per-chunk ledger-arbiter law and the
V-26 spend-duplication lesson both say: serialize, don't collide):

```
ROLE: A2 executor — A2H-13, the V-30 reconciliation: the runner's
  artifact-name grammar must conform to the PWA domain's
  ARTIFACT_NAME_RE (or the ruling must be explicit and receipted).
ALLOWED_INPUTS: apps/chaconne/runner/{store.ts,store.test.ts,index.ts,
  schedule.ts}, apps/chaconne/src/domain/invariants.ts + its test
  (ONLY if the ruling lands domain-side), e2e/chaconne-flow-cli.spec.ts
  + e2e/chaconne-flow.spec.ts (assertion updates if artifact names
  change), benchmarks/rondo-round/receipts/a2h13.md (the operator
  receipt — NOT this ticket's; A2's receipt is .unown/receipts/a2h13.md),
  .unown/receipts/a2h13.md.
FORBIDDEN_INPUTS: everything else — pi-repo/, mini-services/, src/,
  other apps, the root package.json, CHANGELOG/DOX/round log; NO
  weakening of existing pins; no new deps.
OUTPUT_ARTIFACT: the one-layer fix + its pin: EITHER (a) the runner
  side — saveArtifact's ext for the extract report becomes a single
  token (e.g. "extract-report" — no dot), the name grammar then passes
  ARTIFACT_NAME_RE unchanged (the PREFERRED ruling: the PWA domain's
  grammar is the published canonical-export contract, C-8's lane
  depends on it staying frozen), with the artifact-viewer's rendering
  of the report verified; OR (b) the domain side — ARTIFACT_NAME_RE's
  ext segment widens to allow dots, WITH the io.ts canonical round-trip
  re-pinned and the ruling receipted as a grammar change (the costlier
  lane). A pin asserting a round-trip through BOTH hosts: the runner's
  on-disk record -> the PWA domain's validation (the exact cross-host
  seam V-30 named). The receipt names the ruling + why.
HANDOFF_SCHEMA: plain text — the ruling, the diff files, the pin, the
  verify tally.
EFFORT_BUDGET: <=2 chunks x <=8 turns (a satellite).
NON-OVERLAP: C-7 owns the resilience battery (this ticket dispatches
  only after C-7 lands); C-8 owns the io round-trip lanes; the round
  log/CHANGELOG are the operator's.
ACCEPTANCE: (1) `bun run test:unit` (THE SCRIPT) — green, the tally
  quoted, any growth accounted; (2) Lane A (`cd apps/chaconne && bun
  test`) green, tally quoted; (3) `bun run typecheck` + `bun run lint`
  — 0 NEW errors; (4) the cross-host pin exists and fails RED on the
  OLD grammar (run it against the pre-fix shape once via a stash or a
  fixture, quote the failure); (5) the chaconne e2e battery
  (`node_modules/.bin/playwright test -c playwright.chaconne.config.ts`)
  green if any e2e assertion touched the old names; (6) no file
  outside the ALLOWED list written.
```

The C-8 import/export battery ticket — the STANDING BRIEF (authored by
the twenty-third lineage; the golden-file layout is THIS brief's ruling
— the twenty-fourth's C-8 prep research honestly flagged that the
layout is NOT derivable from the house patterns, so it is decided here:
goldens COMMITTED under `apps/chaconne/test/golden/`, deterministic by
the V-15 pins-first law — no timestamps, no boot-dependent bytes — and
a regen script whose `--check` mode is the gate, whose write mode is a
deliberate operator-priced update):

```
ROLE: A2 executor — C-8, the Chaconne import/export battery: the
  byte-stable canonical JSON round-trip end-to-end + the dry-run
  validation report, building strictly against apps/chaconne/PLAN.md
  (§5 C-8 row, edge cases 9 + 10) on the post-A2H-13 tree.
ALLOWED_INPUTS: apps/chaconne/** (the app tree — src/domain/io.ts is
  LANDED and its shape governs; src/ui assertion updates if the specs
  need them; the new test/golden/ + scripts/ trees), e2e/
  chaconne-io.spec.ts (new), the existing chaconne specs (read-only
  context), .unown/receipts/c8.md (your receipt).
FORBIDDEN_INPUTS: pi-repo/ core; mini-services/; src/ (the landing
  site); apps/ostinato/ + apps/coda/; the root package.json script
  entries (C-11 owns chaconne:test/e2e); CHANGELOG / DOX / the round
  log (the operator lane); weakening any existing pin; new deps;
  live-network anything (the io lane is pure local).
OUTPUT_ARTIFACT: (1) the GOLDEN FILES under apps/chaconne/test/golden/:
  export.golden.json (a fixture dataset with UNICODE recipe names —
  edge case 9 — serialized through io.ts's toCanonicalJson, committed
  as raw UTF-8 bytes, never \u-escaped), import-refused.golden.json
  (a chaconne.v2 future-schema document — edge case 10's input), and
  the expected dry-run report golden for the refusal. (2)
  apps/chaconne/scripts/regen-golden.ts — regenerates the goldens
  from the same fixture source; `--check` mode asserts byte-equality
  and exits 1 on drift (the gate); the bare write mode is the
  deliberate-update lane (prints what changed). (3)
  e2e/chaconne-io.spec.ts — the battery lanes: [EXPORT] via the UI
  keyboard-only (the palette's export action), the exported bytes
  BYTE-EQUAL the golden (UTF-8, no \u-escape drift); [ROUND-TRIP]
  import the golden back -> the store's canonical re-export is
  byte-identical (the same-data-same-bytes law across the UI's import
  lane); [REFUSED] import the chaconne.v2 golden -> the dry-run
  report renders (the would-have counts + the refusal reasons), the
  store is BYTE-IDENTICAL to pre-import (asserted — never a partial
  import); [CORRUPT] import a malformed JSON file -> the honest
  error notice, store unchanged. (4) .unown/receipts/c8.md — files,
  the x3 battery tallies, the golden byte-stability proof across 3
  independent boots, the drift-check exits, open questions for C-9.
HANDOFF_SCHEMA: plain text — files written, the battery tally x3, the
  golden proofs, open questions.
EFFORT_BUDGET: <=4 chunks x <=8 turns (the closing verify chunk may
  run 16 — the e2e-lane law).
NON-OVERLAP: C-9 owns the a11y depth; C-10 owns the landing band +
  captures; C-11 owns the root script wiring + runbook; the round
  log/CHANGELOG are the operator's; io.ts's SHAPE is C-1's landed
  contract — only additive changes if a genuine gap is found (and a
  found gap is reported, not silently patched).
ACCEPTANCE: (1) `node_modules/.bin/playwright test -c
  playwright.chaconne.config.ts` — the FULL battery (the standing 10 +
  the new io lanes) GREEN, named count, THREE consecutive runs (the x3
  law — quote each tally + wall time); (2) `bun
  apps/chaconne/scripts/regen-golden.ts --check` exits 0, and a
  deliberate one-byte drift proves it exits 1 (quote both); (3) the
  export golden round-trips byte-identically through the UI import
  lane (asserted in the spec); (4) the unicode golden carries RAW
  UTF-8 bytes (the spec asserts the actual bytes, not a re-serialization);
  (5) the refused import leaves the store byte-identical (asserted);
  (6) `bun run test:unit` (THE SCRIPT) — 2353/0/172 exact-hold (any
  growth accounted); (7) `bun run typecheck` + `bun run lint` — 0 NEW
  errors; (8) a genuine app defect: STOP, report BLOCKED with the
  repro; (9) no file outside apps/chaconne/, e2e/
  chaconne-io.spec.ts, and .unown/receipts/c8.md written.
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

**§6c accrual state (2026-11-06, the twentieth lineage's mid-round
receipt — the plan's mechanisms, exercised so far)**:

| Mechanism | Exercised | The receipt |
|---|---|---|
| Tiered memory (create → reuse) | YES | The A2H-8 session's browser-probe findings landed as clean pitfall facts in the very next memory render (V-17/B-18's third observation: "the two A2H-8-derived pitfalls rendered CLEANLY alongside" the noise) — the note→memory loop works; the C-tickets' reuse test comes with C-2/C-3 |
| Harness (failure → benchmark → verify → retain) | YES | A2H-9 (the test-isolation genuine-gap → the substring-filter lesson pinned in the standing `bun run test:unit 2>&1 \| rg "^apps/"` check + the afterAll pattern) and A2H-10's four gate-caught defects → the 14-pin suite (the pins ARE the retained regression) |
| Minting (pattern → capability-eval task) | NOT YET | No recurring cross-ticket pattern has repeated ≥2× yet; the V-15 pins-first pattern is the leading candidate (one occurrence) |
| Consolidation (notes → dream → benefit) | YES (richly) | The B-18 arc: the defect FOUND in consolidation renders, root-caused across three engine instances, fixed at the write boundary (A2H-10, v0.0.57) — plus V-17's four live-lane observations (the spend governor, the canary gate's tool-drift catch, the tier-vs-terminal split, the .env rewrite) |
| Skill generation (procedure → staged → promoted) | PARTIAL | H-10's evidence base complete (A2H-8) + **the draft STAGED 2026-11-06 (the twenty-fourth lineage — `.unown/skills-staged/browser-resilience/`, never auto-loaded, minter-validated, audit-clean) + the WITH/WITHOUT gate design pre-registered** (the paired runs are the teardown window's first act, on the frozen post-C-7 tree); H-11 at CANARY; **H-12 BUILT + live-canaried** (the continuation-brief generator, zero operator correction on its first genuine capped chunk — the registry row); no PROMOTE yet this round (H-9's promotion was the opening call) |

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
4. Next ticket: the first UNCLOSED row in the queue above (**C-7**, the
   resilience battery — C-1..C-6 CLOSED, the battery 2353/0; the e2e-lane
   tickets cost ~2x the unit lanes (the C-6 ledger) — budget C-7
   accordingly; acceptance items name the SCRIPT (`bun run test:unit`),
   never the bare command — the C-6 confound lesson);
   the §7 competition cycle OPENED at this closure:
   [the Letta filesystem-memory teardown](TEARDOWN_2026-11-06_letta-filesystem-memory.md));
   every dispatch carries the PROMPT ECONOMY header, the stdin guard,
   the V-11 preamble-stop watch (read the result text), and the V-14
   spiral watch (a self-chosen mechanism burning >2 chunks on one test
   family → the operator decides the mechanism). The **dispatch-claim protocol (the V-9/V-10
   dual/triple-incarnation ruling)** stands for every future ticket: a
   checkpoint that pre-declares a dispatch governs for a 30-minute
   window; absent evidence on `main` at expiry, the next lineage
   dispatches with the standing brief; per-chunk, first landing governs
   (the Coda-C4/SM-1 precedent — V-13 is this round's live exercise of
   it).

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
