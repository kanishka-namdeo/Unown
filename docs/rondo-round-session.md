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
## Bug register

User/operator-visible findings of this round (the B register continues the
lineage numbering — B-1..B-14 live in the Ostinato, Reprise and Etude
logs). **B-15/B-16** are the holdout benchmark ids (see the suite README);
**B-17** was the Vivace lineage's alias for the A2H-9 defect (CLOSED —
folded into the receipt); the next free bug id is **B-18**.

- **B-18 (OPEN, memory-hygiene lane — filed by the third lineage
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

## Ticket queue

| Ticket | Scope | Verifier (external, named) | State |
|---|---|---|---|
| R-0 | The §0.9 selection gate: candidates scored, vehicle approved, PRD opened | The scoring receipt + the pre-registered failure classes in [the benchmark round](../benchmarks/rondo-round/README.md) | **CLOSED 2026-11-06** (this lineage — Chaconne approved per the directive's own scoring rule; §0.9.5 re-scope trigger armed) |
| A2H-9 | The encore Finale unit-battery isolation fix: the battery's one near-deterministic fail — `Finale — the program's success question + live answer (plan §5.7) > renders the success question as an h2 + blockquote` (`encore.test.tsx:817`, a `getByRole("heading", { level: 2 })` query) — passes standalone 55/0 but fails in-battery (~6/8 runs across both lineages — order/timing-dependent; still fails under `--max-concurrency=1`; every two-file pair green); root-cause the cross-file pollution and fix it at the polluting layer, assertions unweakened | `bun run test:unit` exits 0 twice consecutive (2258/0); `bun test src/components/encore/__tests__/encore.test.tsx` stays 55/0 standalone; the failing test's h2 + blockquote assertions NOT weakened | **CLOSED 2026-11-06** — a CONVERGENT DUAL closure: this lineage's 8 A2 chunks across 2 sessions (session `01a1ad6e…` chunks 1–4, then the fresh-session extension `01a1ad98…` chunks 5–8, the last a 16-turn closing chunk by operator ruling — the 8-turn cap mis-fit for battery-verification tickets, a pre-split lesson); the root cause: **`bun test src` is a substring filter** — the battery's 161 files include 16 `apps/*/src` test files every green subset missed; the polluter `apps/ostinato/src/ui/settings-modal.test.ts` (the R-2 landing) left `<h2>Deck settings</h2>` in the shared one-process document → the encore `getByRole` multi-matched (the order-dependence the parallel lineage measured at ~6/8 is the mechanism's signature: the pollution needs settings-modal to run before encore in the walk, and bun's file-discovery order varies); the fix: a 13-line `afterAll` body-reset in the polluting file (the encore file byte-identical, product code untouched); A2's verifies: the pair 60/0 (pre-fix 59/1), battery **2258/0 ×2 consecutive** (157.6 s / 157.7 s), encore standalone 55/0, ostinato Lane A 119/2-skip/0; the operator gate re-verified independently (battery 2258/0 exit 0, 159.6 s) + tree-verified the one-file scope; the substring-filter blind spot was the OPERATOR's derivation handed to A2 in the closing brief (the §3.7 brief-adaptation lane, receipted); the PARALLEL lineage's independent forensics (24 turns, 3 chunks: full-suite-only, `--max-concurrency=1` still red, all pairs green — the shard-bisect lane) stand as the converging pre-close investigation, folded into [the V-4 dossier](../benchmarks/rondo-round/validation-log.md); receipt [a2h9.md](../benchmarks/rondo-round/receipts/a2h9.md) tree-verified (one file, +13/-1) |
| C-0 | The architecture plan: the storage/runner/UI decomposition, the fixture-page test strategy, the dependency-law ruling for the runner's playwright import — a read-only `--plan` run with a scored plan file | The plan gate's own score + the operator's review against the PRD's P0 constraints | **CLOSED 2026-11-06** — 2 chunks, 11 turns (8 recon + 3 write), fresh session `01a1ad6d…`; `apps/chaconne/PLAN.md` (489 lines); the operator gate tree-verified (V-6). The parallel lineage's re-queue of C-0 behind A2H-9 is superseded by this closure (V-7's reconciliation) — both rulings stand: A2H-9 closed independently on the same clock |
| C-1 | The domain core: recipe/step/run types, validation, canonical JSON, atomic store | Lane A unit battery (bun test in `apps/chaconne/`), tsc, lint | **CLOSED 2026-11-06** — the nineteenth lineage; session `01a1af41…`, 27 turns / 5 dispatch rounds (the preamble-stop V-11 + the capped continuations V-12 in the ledger; the V-13 landing reconciliation against the V-10 handoff ruling); 1,367 lines: types/ids/invariants/model/io/storage + co-located tests + the boundary scanner + the localStorage adapter + the 7-line zero-dep package.json + eslint chaconne scoping + the tsconfig include (PLAN §4's own assignment); the operator gate independently re-ran every lane (Lane A 31/0, Lane B 31/0, root battery **2289/0/166** = 2258 standing + 31 new, typecheck 0, lint 0/143 standing) and PROVED the boundary pin bites (live DOM-glob injection → 1 fail → restore → green); four deviations reviewed and accepted (receipt [c1.md](../benchmarks/rondo-round/receipts/c1.md)) |
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
| A2H-9 | The encore Finale test-isolation fix (V-4): the full-suite-only, order-dependent unit fail — next chunk runs the shard-bisect protocol (find the minimal co-failing file set), then fixes at the named layer; the encore test's intent is NOT weakened | `bun run test:unit` 0 fail (quoted tail) + isolation rerun green + the minimal co-failing set receipted in `.unown/receipts/a2h9.md` | **CLOSED 2026-11-06** — see the first queue row + [the receipt](../benchmarks/rondo-round/receipts/a2h9.md) |
| A2H-7 | The #30 live-hang capture: the armed watcher (`scripts/issue30_watcher.mjs`) run in both churn lanes during this round's dispatch traffic | A hang capture dir with /proc evidence, or a non-repro receipt with run count | **NON-REPRO RECEIPTED 2026-11-06 (the twentieth lineage)** — both lanes ×8 runs: idle 8/8 exit 0 (`UNOWN_OK`, 1.5–4.7 s), dream 8/8 exit 0 (1.5–2.1 s) — the dream lane run CONCURRENT with the A2H-8 browser dispatch (real dispatch traffic, engine requests 18→48 mid-lane); no hang, no capture dir; receipts [a2h7/idle-summary.json](../benchmarks/rondo-round/receipts/a2h7/idle-summary.json) + [a2h7/dream-summary.json](../benchmarks/rondo-round/receipts/a2h7/dream-summary.json) committed. The watcher STAYS ARMED for the round's later dispatch traffic (each re-run mints a fresh non-repro receipt; a capture ends the wait) |
| A2H-8 | The #43 browser fill_form iframe-race probe: a fixture-page repro of the iframe fill class through A2's own browser tools, evidence filed upstream | The repro transcript + the upstream issue comment draft | **CLOSED 2026-11-06 (the twentieth lineage)** — 2 chunks (8+8 turns, session `01a1af48-8b74…`, the V-5 continuation law applied); the verdict (reconciled with the repo's own F3 postfix evidence): **the v0.0.55 silent-loss path is NOT REPRODUCIBLE on v0.0.56** — the F3 fix (`0d0c64ff`, in v0.0.56) closed it; 5/5 runs fail LOUDLY; RESIDUAL GAP: a loud-failure window between navigate's return and the frame's ref readiness (the barrier should extend to fill_form's ref resolution), plus a minor partial-application atomicity gap (the select lands when the input fails); evidence filed upstream — [comment 1](https://github.com/kanishka-namdeo/Unown/issues/43#issuecomment-6677636789) + [the reconciliation follow-up](https://github.com/kanishka-namdeo/Unown/issues/43#issuecomment-6677653366); receipt [a2h8.md](../benchmarks/rondo-round/receipts/a2h8.md) (5 verbatim run records, the operator gate verified the excerpts against the session log, the amended reconciliation section included). Feeds C-2's RealPageAdapter design (verify-value-landed is now CONFIRMED necessary — the residual window is real) |
| A2H-10 | The B-18 fix: the deterministic reasoning-noise filter at the dream's write boundary — `sanitizeMemoryText()` applied at all three leak lanes (ADD/reconcile-UPDATE/salvage) in `pi-repo/packages/self-learning/src/memzero.ts`, stripping the `[NOTE: …]` blob + JSON-fragment + trailing-Reason shapes, REJECTING empty residuals; clean facts pass byte-identical | The package suite (`cd pi-repo/packages/self-learning && bun test test/`) green with new shape pins + the clean pass-through pin + each lane's pin; tsc parity (0 new errors); the root battery holds 2258/0 | QUEUED 2026-11-06 (the twentieth lineage — the fix-lane investigation receipted at [b18-fixlane.md](../benchmarks/rondo-round/receipts/b18-fixlane.md): engine-side, IN-REPO fixable — the mem0ai prompt is upstream but the write boundary is Unown's own code, the F3 lane; three leak boundaries named, one already half-fixed at the reconcile lane) |
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
4. Next ticket: the first UNCLOSED row in the queue above (**C-2**, the
   runner v1 — C-1 is CLOSED by the nineteenth's landing, the battery
   2289/0); every dispatch carries the PROMPT ECONOMY header, the stdin
   guard, and the V-11 preamble-stop watch (read the result text, not
   just the envelope). The **dispatch-claim protocol (the V-9/V-10
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
