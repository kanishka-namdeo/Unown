# The Parley demo's session record

> The receipt behind the landing page's live-demo **gallery's fourth app**:
> what the multi-tenant support-inbox SaaS round built, the agent sessions
> that built it, what each stage's testing found, and the learning-loop
> evidence the round captured while it ran. Kept as a resumable record:
> each checkpoint states what is done, what is verified, and what is next,
> so an interrupted session can resume from the last green state.

- [What the app is](#what-the-app-is)
- [How it was built](#how-it-was-built)
- [Checkpoint 0 — setup](#checkpoint-0--setup-done)
- [Checkpoint 1 — research](#checkpoint-1--research-done)
- [Checkpoint 2 — benchmark baseline](#checkpoint-2--benchmark-baseline-done)
- [Checkpoint 3 — the build](#checkpoint-3--the-build-in-progress)
- [Checkpoint 4 — verification](#checkpoint-4--verification-pending)
- [Checkpoint 5 — learning-loop evidence](#checkpoint-5--learning-loop-evidence-pending)
- [Checkpoint 6 — docs, blog, DOX](#checkpoint-6--docs-blog-dox-pending)
- [Checkpoint 7 — release](#checkpoint-7--release-pending)

Related pages: [Cadence session record](cadence-demo-session.md) (the third
app) · [Sigil Bazaar session record](bazaar-demo-session.md) (the second) ·
[focus session record](live-demo-session.md) (the first) · [Parley round
competitor research](parley-round-competitor-research.md) (the research that
grounds this round) · [tui capture workflow](tui-capture-workflow.md) (the
capture lane the round's stills came from).

## What the app is

Parley — a **multi-tenant customer-support inbox SaaS**, the round's SDLC
stress test on the hardest surface yet: tenancy, authentication, RBAC and
isolation. (Full feature/contract inventory ships at round close — this
section is completed by the build, not before it, so it records what IS
rather than what was planned.)

## How it was built

Written end-to-end by `unown` — the pi coding agent under the self-learning
layer — driven through the established phase chain against the Agnes AI
endpoint (`agnes-3.0-flash`) through the bundled llm-bridge. The receipts
ledger, phase table and commit map ship at round close.

## Checkpoint 0 — setup (DONE)

- Cloned `kanishka-namdeo/Unown` at `8e69ce5` (post-v0.0.36, the presence
  round); `bun install` clean (413 packages, bun 1.4.4); the vendored
  `pi-repo` workspace built (`npm run build` — tsc chain, 682 packages).
- Stack up: llm-bridge :3031 (upstream Agnes `ok:true`), engine :3030
  (`phase:ready`, v0.0.36), landing dev :3000 (`GET /` 200).
- Baseline gates green before any edit: `bun run typecheck`, `bun run lint`
  (0 errors), `bun test src` (359 pass), `check:changelog|blog|benchmarks|
  claims`, sandbox verify 12/12.
- Fresh engine state confirmed (new clone = fresh `data/self-learning/`):
  5 seed tasks, 0 cycles, 0 dreams, 0 skills, policy-tier memory only.
- **Environment resurrection (2026-10-28 18:31 UTC, the session-resume
  checkpoint):** the round resumed on a fresh machine from this record.
  Clone at `6d40de2`, bun 1.4.3 installed (host bun 1.3.14 below the
  floor), `.env` wired to the Agnes upstream key, `agent:install` +
  `agent:start` green (bridge `ok:true` upstream, engine `phase:ready`
  v0.0.37, `unown doctor` green except optional items), baseline gates
  re-verified (typecheck/lint clean, 630 tests, all `check:*` green).
  Two operator incidents, both logged in the SOTA validation log as F3:
  (1) a first headless launch died at tool-call teardown — F2's exact
  pattern, re-verified on this host, the intermediate-exit launcher
  rebuilt (`setsid` + immediate-exit parent); (2) a parallel-predecessor
  collision — the prior operator session was still pushing while this
  environment cloned at `6d40de2`, so its UI-phase commits (`3d10ed4`,
  `c05c9c2`) landed remotely after the clone; a locally-launched UI
  session duplicated finished work for ~14 minutes before the fetch
  caught it. Resolution: kill, discard the uncommitted duplicates, keep
  the receipts, rebase, verify the remote's UI on this machine (647
  tests green, `GET /parley` 200). Procedure adopted: `git fetch` +
  divergence check before EVERY phase launch. The snapshot driver is
  now committed (`benchmarks/parley-round/snapshot.mjs`) so the receipts
  lane is reproducible across environments.

## Checkpoint 1 — research (DONE)

- App-domain research (multi-tenant patterns, demo-safe auth, RBAC testing,
  showcase presentation — OWASP multi-tenant/authorization cheat sheets,
  Microsoft tenancy guidance, Nile's RLS decision, Next.js auth guide,
  Better Auth organization plugin, v0/bolt/SWE-bench showcase practice,
  METR's 2026-03 "would-not-merge" finding) → the Parley concept: a
  support-inbox SaaS, path-based tenancy, row-level isolation with a
  fail-closed repository, DB-backed sessions, 4-role matrix, mock-mailbox
  invites, SLA timers, audit log, usage metering.
- Competitor research: six NEW systems reverse-engineered (ZCode, OpenClaude,
  Codewhale, Goose, Crush, Amp) →
  [`docs/parley-round-competitor-research.md`](parley-round-competitor-research.md).
  Headline: no competitor ships a closed self-improving loop; the 2026
  frontier is adversarial verification + isolation-controlled evaluation +
  durable resumable execution. Adopted: adversarial review probes,
  evidence-first receipts, drain-before-snapshot, holdout discipline,
  cost columns.

## Checkpoint 2 — benchmark baseline (DONE)

- **Baseline snapshot** (all 5 seed tasks run through real engine cycles,
  fresh sandboxes, Agnes upstream):
  `benchmarks/parley-round/snapshots/baseline-*.json` —
  5/5 tasks passing (fix-fizzbuzz, fix-drop-right, fix-csv-parser,
  impl-debounce, impl-map-limit all "baseline passed — no improvement
  needed"), 14/14 runs passed, 5 cycles, 5 dreams already consolidated
  (the engine's auto-dream ran while the baseline cycled), 0 improvements,
  0 skills, 0 minted tasks.
- The seed suite is saturated from the start — per the harness design that
  is the condition that hands the loop to task minting, so the round's
  learning evidence rides on minted tasks + the app-build sessions' notes.
- Snapshot tooling: the engine's full learning state (tasks/cycles/
  improvements/dreams/skills/memory/runs token stats) captured to a
  versioned JSON receipt, taken at baseline / midpoint / final.

## Checkpoint 3 — the build (IN PROGRESS)

Phase chain (the cadence order, extended for tenancy):

| Phase | What | Status |
|---|---|---|
| Plan | `--plan` mode: the numbered plan from the brief | done (operator briefs, pre-revival) |
| Lib | Domain: types, ids, password (scrypt), sessions, tenancy (fail-closed repo), rbac matrix, sla, audit, metering, validation, deterministic seed + unit tests | done — `6a5ef23`, 180 tests |
| API | Route handlers: auth (login/logout/session), conversations CRUD + reply/assign/status/tags, invites + accept, audit, usage, analytics, canned, mailbox, reset + isolation tests | done — `b8d3e0a` + `6d40de2`, 76 tests |
| UI | Login, two-pane inbox, thread, composer, detail panel with SLA chips, admin surfaces, portal toggle, role switcher, embed shell + component tests | done — `3d10ed4` (32 tests) + CSP `c05c9c2`; re-verified post-revival: 647 tests, `GET /parley` 200 |
| E2E | Live browser pass over CDP: login/logout, role switch, cross-tenant 404, invite accept, SLA render, embed reset handshake | in flight (session 2) |
| Review | `/review` with the adversarial brief (this round's adopted pattern) + fixes | pending |
| Drill | `/checkpoint` `/undo` `/commit` through the real TUI | pending |
| Landing | Gallery entry #4, poster, receipts, tests | pending |

## Checkpoint 4 — verification (PENDING)

## Checkpoint 5 — learning-loop evidence (PENDING)

## Checkpoint 6 — docs, blog, DOX (PENDING)

## Checkpoint 7 — release (PENDING)
