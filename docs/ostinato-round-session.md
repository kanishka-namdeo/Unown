# The Ostinato round — session log

> **Status: OPEN** — opened 2026-11-04 by the eighth lineage. The
> DRIVE-track app round of the 2026-11-04 A1 engagement: **Ostinato**, a
> keyboard-first, offline-first spaced-repetition flashcard PWA at
> `apps/ostinato/`, planned by [the PRD](ostinato-prd.md), gated by [the
> reliability coverage matrix](reliability-coverage-matrix.md), measured
> by [the benchmark suite](../benchmarks/ostinato/README.md), augmented
> only through [the registry](a1-augmentation-registry.md).

One-line purpose: the round's resumable checkpoint log — mission, operator
decisions, validation log, ticket queue, gate receipts.

**Mini-TOC**

- [Mission](#mission)
- [Operator decisions](#operator-decisions)
- [Phase 0 artefacts](#phase-0-artefacts)
- [Environment checkpoint](#environment-checkpoint)
- [Validation log](#validation-log)
- [Ticket queue](#ticket-queue)
- [O-1 dispatch brief](#o-1-dispatch-brief)
- [Gate run](#gate-run)
- [Resume instructions](#resume-instructions)
- [Related pages](#related-pages)

## Mission

The engagement directive (2026-11-04, user-issued): STABILISE A2 × HARDEN
A2 × PROVE IT. One ambitious real-world project doubles as the production
build, the stress test of A2's reliability, and the benchmark programme
that measures whether A2 became more reliable, predictable and cheaper to
operate while doing meaningful work. Two tracks, shared learnings, never
shared hands: **DRIVE** (harden and ship the app through A2 tickets — A1
never writes app code; tickets succeed through A2 or fail informatively)
and **AUGMENT** (improve A2 itself from receipted failures, via the
registry's lifecycle). Hardening-first: keyboard-only workflows, focus,
modals, palette, scrolling, selection, empty/loading states, interruption,
resize, crash and persistence recovery — all exercised before feature
velocity. Every verifier is external (build, tests, lint, typecheck,
deterministic checks); loops capped at 4 with validation-revert; every
genuine failure enters the failure→benchmark reflex.

## Operator decisions

Dated 2026-11-04, this round-opening session:

- **APP = Ostinato** — keyboard-first, offline-first spaced-repetition
  flashcard PWA; **path `apps/ostinato/`** (the Coda pattern); push lane
  **direct to `main`**; hardening-first order per the PRD.
- **Version-bump policy**: Unown's `package.json` version bumps only when
  Unown itself is enhanced (repo law: version + dated heading + rail + tag
  on the green SHA). App-round commits ride `## [Unreleased]`.
- **Pre-split pricing** inherited from the doc-truth round's deviation
  ledger: authoring tickets ~4 chunks; measurement tickets +2;
  registry-derivation tickets +4; landing-amendment tickets +6.
- The queue's standing items (S2-7/S2-8/S2-9, the S2-3/S2-16 L-pair,
  S2-22, the injection-scanner ML classifier, the delegation reuse axis,
  OB-7, the landing queue, the term.ts follow-up, the release-monitor
  routine's first weekly run 2026-11-08) stay queued in
  [SESSION.md](SESSION.md) — this engagement does not resume them; it
  opens its own round per the directive.

## Phase 0 artefacts

All landed in the round-opening commit:

1. [The PRD](ostinato-prd.md) — vision, scope P0/P1/P2, non-goals, the
   hardening-first mapping table, architecture, verification, deployment,
   success criteria.
2. [The reliability coverage matrix](reliability-coverage-matrix.md) — the
   directive's eleven lanes with today's receipted coverage and the round's
   additions.
3. [The augmentation registry](a1-augmentation-registry.md) — opened
   EMPTY per Phase 0, with three PROPOSE-stage hypotheses (H-1..H-3).
4. [The benchmark suite scaffold](../benchmarks/ostinato/README.md) — the
   C1–C3 calibration canaries defined and armed; app lanes K-1/A-1/O-1/
   R-1/I-1 named; RESULTS carries honest nulls.
5. The recon refresh — [`A2_GROUND_TRUTH.md`](../A2_GROUND_TRUTH.md)
   header/§1/§2/§5/§10 re-verified live on the eighth lineage.
6. This log + SESSION.md rotation + the CHANGELOG entry + regenerated
   rail + the README/DOX index updates.

## Environment checkpoint

The eighth lineage's bring-up state, 2026-11-04 (the newest of the
lineage checkpoints — [SESSION.md](SESSION.md) keeps the index):

- Sandbox recycled before this session; re-cloned @ `189fa033` =
  `origin/main` into `/home/z/my-project/Unown`; PAT rewired into the git
  remote + the off-repo credential store `/home/z/my-project/.creds`
  (exposed as `/home/z/my-project/.secrets`).
- bun **1.4.3** project-local at `/home/z/my-project/.tools/bun-linux-x64`
  (the sandbox ships 1.3.14 — sub-1.4 bun rewrites the root lockfile
  down; prior lineages lost a global upgrade to the recycle, a
  project-local binary does not). Export PATH ahead of every bun call.
- `UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts` —
  7/7 green. `.env` authored minimal + duplicate-free at the repo root
  (Agnes lane: `BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`, key
  set, `BRIDGE_KNOWN_MODELS=agnes-3.0-flash,agnes-2.5-flash`,
  `PI_MODEL_ID=agnes-3.0-flash`, `UNOWN_HOME=/home/z/my-project/unown-home`).
- Stack: bridge `:3031` (upstream 200, 6 agnes models), engine `:3030`
  (v0.0.55/`189fa033`, fresh DB). `bun bin/unown doctor` → "ready to
  chat" (20✓/2⚠: model-spec + LSP — the honest first-session pair).
- Operator tools rebuilt (the recycle reclaimed the seventh lineage's):
  `/home/z/my-project/scripts/dispatch-bg.py` (double-fork daemonizer,
  PPID-1 supervisor, log/pid/exit receipts), `/home/z/my-project/tickets/`
  (logs, receipts, receipt-mirror.md). Smoke 1/1 `UNOWN_OK` exit 0, 3.7 s.
- Operator-side raw receipts: `/home/z/my-project/tickets/receipts/`
  (`doctor.txt`, `help.txt`, `engine-status.txt`, `smoke-1.log/.json`).

## Validation log

| ID | Event (dated) | Class (directive taxonomy) | Disposition |
|---|---|---|---|
| V-1 | The recycle reclaimed `/home/z/my-project/scripts/` + `tickets/` + `.secrets/` despite the survival convention (2026-11-04) | infra-flake (environmental) | Rebuilt byte-fresh: daemonizer re-validated (PID detached, supervisor PPID 1); mirror re-staged. H-1..H-3 armed. |
| V-2 | Sandbox ships bun 1.3.14 (sub-1.4 rewrites the root lockfile) | stale-assumption (environmental) | Project-local 1.4.3 pin at `.tools/` — new pattern, survives recycles; recorded in A2_GROUND_TRUTH §10. |
| V-3 | Print-mode pipe-hold quirk (the issue #30 class): the outer tool call stalls after the answer flushes | infra-flake (environmental; #30 upstream OPEN) | Avoided by construction — every `-p` dispatch rides the daemonizer; the #30 live-hang capture remains pending upstream (armed watcher + `UNOWN_PRINT_EXIT_TRACE=1` stand). |
| V-4 | doctor's 2 ⚠ (model-spec unverified, no LSP) | honest first-session state, not a failure | No action; both documented doctor lanes. |
| V-5 | The docs gate caught the round log's three parenthetical headings hashing to unguessable anchors (2026-11-04, at the round-opening gate) | prompt-brittleness (operator-side authoring) | Headings simplified to bare names; the gate's catch IS the receipt — the check:docs lane holds operator-authored docs to the same anchor law. |
| V-6 | The quiet-footer lane failed A2/A3 ("two rows at rest", "ambient silence") because the engine build drift (engine @`189fa033` vs agent @`15430eb5`) surfaces as the `memory: up · old build` ambient warning chip at rest (2026-11-04, ninth-lineage resume) | state-desync (environmental) | Waited for an idle router window, `unown engine restart` → build aligned; lane re-run 9/9. The lane doubled as a build-drift detector — receipted as a standing use. |
| V-7 | The recycle reclaimed pip state (`pyte` gone) — the PTY lanes cannot even import (2026-11-04) | infra-flake (environmental, the V-1 class) | `pip install pyte` + recorded in the operator bootstrap: the lane bring-up now installs pyte explicitly. |
| V-8 | The resume-picker lane's step-1 boot timed out at 90 s waiting for the TUI header (07:05:30); green on re-run at 07:20 with themes at t+5 s in the same cwd | infra-flake (momentary; likely bridge slowness in the engine-restart window) | Receipted as flake; if it recurs, arm a boot-timing watcher before filing. |
| V-9 | **The PTY backpressure law**: keystrokes sent to a streaming TUI are silently dropped unless the parent concurrently drains PTY output. Differential receipt: X1/X2 (no-read-while-typing) lost the probe chars 2/2; Y1/Y2 (read-while-typing) landed them 2/2; the six-run race matrix and the two-run determinism matrix lost `/abort` 8/8 the same way (2026-11-04, `/tmp/repro-abort/`) | infra-flake (harness law; product-robustness note B-2) | Operator harness rule: pump while typing during active streams. `pty_common.send` fix queued as A2H-2/H-4. |
| V-10 | The C2 canary's variant B run: A2 authored the module + tests but hit the 8-turn cap with 2 of 8 authored tests still red (`bun test` rc 1 at scoring) — the first A2-lane measured failure of the baseline (2026-11-04, receipt `run-20261104T*/c2.jsonl`) | genuine-gap (A2 capacity on small-code tickets at the chunk cap) | Receipted as the baseline's honest spread (C2 2/3); no fix ticket — the measurement IS the artefact; the round's chunk economics exist to manage this class. |
| V-11 | The O-1 receipt's closing prose said "exactly the 12 files above" while listing 13 — the operator tree-verify (H-2) caught the count slip; all 13 listed files exist, nothing extra on the tree | prompt-brittleness (A2 receipt prose; no overclaim — every named file verified) | The catch receipted here; H-2's first live catch of the round. |

Bug register (user-visible findings, the failure→benchmark reflex's
input):

- **B-1 — the first-flight settle tip overwrites the `/abort` notify**
  (2026-11-04, genuine product defect). When a brand-new user aborts
  their first-ever turn, `agent_settled` fires the flights extension's
  "You're flying" tip through the same `ctx.ui.notify` → `showStatus`
  path the `/abort` command's notice just used; `showStatus`'s dedup
  branch reuses the last status line and `setText`-replaces the abort
  feedback with the onboarding tip. Evidence: the abort lane's 07:07 run —
  `firstTaskAt` latched at 07:07:13.090Z (the lane's own prompt submit),
  "You're flying" on the pane, pi's message-level "Operation aborted"
  present, the unown notify absent; source trace: `flights.ts` agent_settled
  handler vs `tools.ts` /abort handler vs `interactive-mode.ts` showStatus
  dedup. Repro family: `/home/z/my-project/scripts/repro_abort_*.py`,
  `diag_abort_keys.py` (the healthy path shows both lines painting and
  persisting). Fix ticket A2H-1; regression lane: the abort lane re-run
  under a fresh isolated UNOWN_HOME must show the notify 100%.
- **B-2 — keystroke loss under output backpressure** (2026-11-04,
  harness-first with a product-robustness edge). V-9's law: a TUI whose
  output writes block (undrained PTY) drops typed input. A real user with
  a paused terminal (flow control / scroll lock) could lose keystrokes
  the same way. Fix ticket A2H-2 (harness: pump-while-typing in
  `pty_common`; product: investigate input preservation while writes
  block).

## Ticket queue

| Ticket | Scope | Verifier | Status |
|---|---|---|---|
| O-1 | Calibration canaries C1–C3 (baseline turns-to-done/cost) + the app skeleton at `apps/ostinato/` (zero-dep PWA scaffold + AGENTS.md draft) | canary receipts + both unit lanes boot | **LANDED 2026-11-04** — canaries C1 3/3 · C2 2/3 (B cap-overflow receipted) · C3 3/3; skeleton 13 files, Lane A 5/5, Lane B 5/5, receipt tree-verified |
| O-2 | Domain core: deck/card model, SM-2 scheduler, import/export + Lane A/B tests | both unit lanes + app tsc + invariants pins | queued |
| O-3 | Review runner + keyboard surface (palette, search, j/k, selection, states) | unit lanes + keyboard-focused e2e stub | queued |
| O-4 | Hardening e2e battery: zero-mouse flow, axe both schemes, offline, crash-resume, resize | the e2e battery green | queued |
| O-5 | PWA + capture lane + root wiring + CI job (the Coda C5 pattern) | CI coda-style job + capture receipts | queued |
| O-6 | Closeout: landing band, usage captures, blog post, README/DOX, graduation | full gate set + check:blog | queued |
| A2H-1 | Fix B-1: the `/abort` notice must survive the first-flight settle tip (status-line collision guard — notify dedup keyed by source, tip deferral, or notice-as-message-note) | the abort PTY lane under a fresh isolated UNOWN_HOME, 3/3 runs with the notify visible | queued (A2-hardening) |
| A2H-2 | Fix B-2: `pty_common.send/type_prompt` pump-while-typing (harness law V-9) + a product-side investigation of input preservation while output writes block | X/Y differential re-run: keystroke loss 0/4 without read-while-typing | queued (A2-hardening) |

Pre-ticket PTY audit (H-3): re-run the standing `scripts/tui-capture/`
verify lanes on this lineage before O-1 dispatch.

## O-1 dispatch brief

The prompt-economy header the directive mandates, pre-baked for the first
dispatch (fresh session per ticket; incremental receipt from chunk 1):

- **ALLOWED_INPUTS**: `docs/ostinato-prd.md`,
  `benchmarks/ostinato/README.md`, `apps/ostinato/` (to create), `/tmp`
  scratch, the repo's own docs under `docs/` read-only.
- **FORBIDDEN_INPUTS**: `AGENTS.md` at any depth (draft as
  `apps/ostinato/AGENTS.draft.md` — the instruction-set gate is final);
  `.unown/memory/**`; `pi-repo/packages/self-learning/src/**` (app code
  only this round); `src/**`; `content/**`; `benchmarks/**` except
  reading its own README.
- **OUTPUT_ARTIFACT**: the `apps/ostinato/` skeleton (index.html, sw.js
  stub, manifest, `src/domain/` with the model stubs, `package.json` with
  NO dependency fields, `serve.mjs`, Lane A test boot) +
  `.unown/receipts/o1.md` with `STATUS`, `FILES` (tree-verified at the
  operator gate), `GATES`, `DECISIONS`.
- **HANDOFF_SCHEMA**: receipt markdown; STATUS ∈ COMPLETE | PARTIAL |
  BLOCKED; every FILE claim verified against the tree by the operator.
- **EFFORT_BUDGET**: ≤4 chunks × ≤8 turns (`--max-turns 8`).
- **NON-OVERLAP**: no landing surfaces, no CI wiring (O-5), no e2e (O-4),
  no scheduling logic (O-2 — stubs only).

## Gate run

The round-opening commit's own gate battery, run on this tree before the
push (the hints-round lesson honored — the unit suite ran AFTER the rail
regen):

- Rail regen: `node scripts/landing_changelog.mjs` — **rc 0**, 54 stops /
  526 entries (this round's entry is the 526th; Unreleased undated,
  v0.0.55 the latest dated).
- `bun run typecheck` — **rc 0** (tsc --noEmit, clean).
- `bun run lint` — **rc 0**, 0 errors / 142 warnings (the vendored
  baseline, unchanged).
- `bun run check:docs` — **rc 0**, 147 docs ok — after one live catch:
  the round log's three parenthetical headings hashed to unguessable
  anchors (exactly the docs/AGENTS.md anchor warning); headings
  simplified, re-run green (see V-5).
- `bun run check:changelog` — **rc 0**, rail matches CHANGELOG.md: 54
  stops, 526 entries, 53 dated.
- `bun run check:blog` — **rc 0**, 45 posts / 112 tags.
- `bun run check:benchmarks` — **rc 0**, 6 tracks, 6 resolved.
- `bun run check:claims` — **rc 0**, 9 jobs; 62 page literals resolve in
  the engine sources.
- `bun run test:unit` — **rc 0, 2125 pass / 0 fail**, 15792 expect()
  calls across 150 files, 158.68 s — the family baseline exactly.

A red gate blocks the push; none red.

## Resume instructions

1. `export PATH=/home/z/my-project/.tools/bun-linux-x64:$PATH`
2. `cd /home/z/my-project/Unown` — verify `git log --oneline -1` is the
   round-opening commit; `git fetch origin --tags --prune` + ff-only pull
   if a parallel lineage moved `main`.
3. Stack: `bun run agent:start` (bridge :3031 + engine :3030; mortal
   across recycles); health: `curl -s localhost:3031/health`.
4. Doctor: `bun bin/unown doctor` — expect "ready to chat" (2 ⚠ honest).
5. Dispatch: `python3 /home/z/my-project/scripts/dispatch-bg.py <name>
   bun bin/unown -p "<brief>"` then poll
   `/home/z/my-project/tickets/logs/<name>.exit`.
6. Pre-dispatch: run the H-1 smoke canary + the H-3 PTY audit lanes.
7. This log owns the round state; `A2_GROUND_TRUTH.md` owns capability
   truth; [SESSION.md](SESSION.md) owns the index.

## Related pages

- [The Ostinato PRD](ostinato-prd.md)
- [The reliability coverage matrix](reliability-coverage-matrix.md)
- [The augmentation registry](a1-augmentation-registry.md)
- [The benchmark suite](../benchmarks/ostinato/README.md)
- [Coda](coda.md) — the architecture precedent
- [SESSION.md](SESSION.md) — the running index
