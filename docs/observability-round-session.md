# The Observability Round — the session record

> The resumable checkpoint log for the TUI Productization & Dogfooding
> mission (2026-10-30 →): transform Unown into the most transparent,
> trustworthy and informative coding-agent terminal experience possible.
> Every feature must help a developer answer: What is happening? Why is
> it happening? What changed? What risks remain? Is progress being made?
> The primary success metric: a developer can leave the terminal for 30
> minutes, return, and understand what happened, why, what decisions
> were made, what was learned and what remains — within 60 seconds.
> Each checkpoint states what is done, what is verified, and what is
> next, so an interrupted session resumes from the last green state.

- [Checkpoint 0 — setup, the stack verified, and the mission opened](#checkpoint-0--setup-the-stack-verified-and-the-mission-opened)
- [Checkpoint 1 — phases 1-4: the research, the journeys, the audit, the architecture](#checkpoint-1--phases-1-4-the-research-the-journeys-the-audit-the-architecture)
- [Checkpoint 2 — phase 5, the in-session surfaces: panel, brief, recovery, confidence, feed](#checkpoint-2--phase-5-the-in-session-surfaces-panel-brief-recovery-confidence-feed)

## The contract

The mission's success question: *"Can a developer who was away for 30
minutes understand the state of the project within 60 seconds?"* —
answerable only with measured evidence (trust tests at random
checkpoints, before/after captures, benchmark receipts). The
information hierarchy is fixed by the mission: Mission > Progress >
Current Task > Active Decisions > Evidence > Risks > Learning Events >
Metrics > Logs — raw logs must never dominate the interface; summaries
win over token streams. Dogfood rule: every discovered weakness becomes
a benchmark, an evaluation, or a regression test — failure → root cause
→ benchmark → fix → rerun → evidence.

## Checkpoint 0 — setup, the stack verified, and the mission opened

**DONE.** Fresh clone at `cbbbeb37` (remote main synced — one doc commit
ahead of the v0.0.44 release tag); bun upgraded 1.3.14 → 1.4.4 (the
lockfileVersion-3 floor); `bun run agent:install` (root + pi-repo
installs, model-data hydration, build, `.env` bootstrap, PATH link);
`.env` configured with the Agnes upstream
(`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`, key set,
`AGNES_API_KEY` set, the metered free-tier guards untouched);
`bun run agent:start` brought up the stack.

**VERIFIED (receipts from this machine, 2026-10-30):**

| Gate | Result |
|---|---|
| Bridge `:3031/health` | ok, upstream 200, `agnes-3.0-flash` default, 6 models served, concurrency guards active |
| Engine `:3030` | running (token-gated API — auth by design, M7) |
| `bun bin/unown -p "Reply with exactly: UNOWN-OK"` | `UNOWN-OK` end-to-end through the bridge |
| `unown doctor` | all green (bubblewrap sandbox active, instruction-set audit clean; 1 ⚠ LSP servers — optional) |
| `bun bin/unown --version` | 0.0.44 === `package.json` |
| Git preflight | `git fetch origin --tags --prune` + `git pull --ff-only` → `cbbbeb37`, tree clean |

**NEXT.** Phase 1 opens: competitive research (Claude Code, Codex CLI,
OpenCode, Aider, Cline, Roo Code, Gemini CLI, OpenHands/OpenDevin) run
as parallel subagents against live sources; the repo's own prior
research mined for what is already known; the TUI surface inventory
(the Phase 3 audit's raw material) mapped in full.

## Checkpoint 1 — phases 1-4: the research, the journeys, the audit, the architecture

**DONE.** Three parallel subagents: (a) the full TUI surface inventory —
every screen, command, keybinding, widget, overlay, footer segment and
dashboard screen mapped file-by-file with a critical gap pass (15 gaps);
(b) the live competitor research — nine systems + two bonus references
across the round's nine dimensions, every fact tiered and sourced;
(c) the repo's own research mined — what is already shipped (the
33-command surface, the turn meter, the engine state machine, the
receipts ledger), what the repo itself recorded as open, and the
conventions every feature must carry (visual law, responsive law,
capture lane, beauty gates, benchmark receipt rules).

**The deliverables written (the audit's 21-flag ledger drives everything
after it):**

| Deliverable | Page |
|---|---|
| Phase 1 — competitor research + the TUI UX scorecard + the gap analysis | `docs/observability-competitor-research.md` |
| Phase 2 — the five user journeys (solo dev, senior eng, founder, PM, DevOps) | `docs/observability-user-journeys.md` |
| Phase 3 — the TUI observability audit: every surface judged against the seven questions; 22 ambiguity flags; 8 benchmark tasks (OB-1..OB-8) | `docs/tui-observability-audit.md` |
| Phase 4 — the information architecture: the nine-level hierarchy and its placement law | `docs/tui-observability-audit.md` §[the information architecture] |

**The round's feature ledger (from flags A1–E9):** the mission panel
(objective + progress + risk, `/mission`), the mission brief recap (the
60-second returning-user brief), the recovery surface (`/recovery` +
footer health chip + dashboard Recovery screen), confidence scoring
(deterministic signals → footer chip + panel), the ambient learning feed
(`/feed`), telemetry rollups (cost/time in panel + brief). Rejections
recorded with reasons in the research page (sound packs, USD budget
stop, queued-message implicit approval, doom-loop ask-gate).

**NEXT.** Phase 5 — implementation, milestone order: M1 mission panel +
progress, M2 the mission brief, M3 recovery, M4 confidence, M5 learning
feed, M6 telemetry rollups, M7 the dashboard Recovery screen. Each
milestone lands with pinning tests, `docs/usage.md` + `cli.ts` HELP sync
where the surface changes, a CHANGELOG entry, capture-lane stills, and a
push.

## Checkpoint 2 — phase 5, the in-session surfaces: panel, brief, recovery, confidence, feed

**DONE.** The audit's feature ledger implemented as three pure cores
(`mission.ts` ~440 lines, `recovery.ts` ~200, `learning-feed.ts` ~230) plus
the tools.ts wiring (the mission state + `unown-mission` persistence lane,
the `tool_execution_end` classifier, the turn-boundary refresh pass, the
slow overview poll, four new commands) and the engine-status/todo-bridge
seams. Everything through pi's documented surfaces — no fork, no new
dependency, TUI-only guards, subagents never see any of it.

| Surface | What it answers (audit flags) |
|---|---|
| The mission panel (widget `unown-mission`, `/mission`) | A1 A2 A4 A5 B1 C2 E1 — objective pinned, progress derived, confidence + drivers, risks composed, learning fresh |
| The auto-brief + `/brief` (mission.ts buildBrief) | E4 E5 D1 — the 60-second returning-user answer, deterministic on the prompt path; /brief adds the decision miner |
| `/recovery` + the `health` footer chip (recovery.ts) | A3 E6 E7 — failures classified once at tool_execution_end, worst-first with fix paths |
| The ambient learning feed + `/feed` + the `feed` chip (learning-feed.ts) | D1 E8 E9 — dream news, memory versions, improvements, notes consolidated |
| Confidence scoring (mission.ts deriveConfidence) | A5 B3 D3 — receipts only: tool errors, verify failures, denials → ✓/◐/✗ |
| Telemetry rollups | B2 — session cost/time in the panel and brief (the /usage attribution) |

**VERIFIED:**

| Gate | Result |
|---|---|
| `bun test test/` (self-learning suite, this machine) | 5045 tests — 4944 pass, 101 env-gated skips, **0 fail** (43 new pinning tests: mission 21, recovery 12, learning-feed 14... plus the recap persisted-name pin) |
| Live PTY capture (`scripts/tui-capture/pty_capture_observability.py`) | all six surfaces asserted from the literal pane text against the real stack (bridge + engine + Agnes): the mission line, the conf chip, the brief's mission/happened/remains rows, the recovery/feed/brief cards — stills + pane dumps committed under `public/landing/tui/observability-round/stills/` |
| Docs/env sync | `usage.md` (the Mission & observability section + 4 command rows), `configuration.md` + `.env.example` (UNOWN_MISSION_PANEL + the two rows that had drifted out of the example file) |
| CHANGELOG | the observability round entry (Added + the two Fixed: the persisted-digest `unknown` tool names — a pre-existing recap.ts bug the brief's live capture caught — and the env-example sync gap) |

**Dogfood finding fixed in-round** (failure → root cause → pin → fix): the
brief's "happened" row printed `unknown` for every persisted tool —
recap.ts read `toolName` from entries that carry `name`. Root-caused against
the real session JSONL, pinned in `test/recap.test.ts`, fixed in the same
change.

**NEXT.** Phase 5's remaining milestone (M7): the dashboard Recovery screen
composing failed jobs/runs/denials/dead letters; then Phase 6 dogfood
validation (the OB-1..OB-8 benchmark receipts), Phase 7 trust tests, the
landing/README/blog pass, and the v0.0.45 release with builds.

## Checkpoint 3 — phases 6-7: the dogfood benchmark + the trust test

**DONE.** The OB-1..OB-8 lanes run live (`scripts/tui-capture/pty_benchmark_observability.py`,
`pty_trust_test.py`); receipts committed under `benchmarks/observability/receipts/`
(the pane is truth). **6 lanes green with receipts, OB-7 deferred with its reason
recorded, OB-4 re-scoped honestly** (the supervisor's auto-start heals a killed
engine — the narration contract, not a permanent down state, is the correct
expectation). The trust test measured the mission's primary metric: after an
11-minute real idle window (crossing the engine's own dream + overview cadences),
the return brief answers all five questions in one screenful — and its `learned:`
line reports a dream that really happened while away (memory v4 → v5).

**The dogfood ledger (found → root-caused → pinned → fixed, in-round):**

1. persisted digest tools printed `unknown` (entries carry `name`, the digest read
   `toolName`) — pinned in `test/recap.test.ts`;
2. an idle session learned in silence (engine-loop pushes had no repaint path) —
   the push-listener, pinned in `test/learning-feed.test.ts`, verified live in the
   OB-1 composite receipts;
3. the overview diff read flat payload keys (the engine nests under `kpis`/`notes`) —
   fixed against the live payload, pinned with the real shape.

**The deliverables written:** the benchmark record
(`benchmarks/observability/RESULTS.md`), the trust & transparency report
(`docs/unown-trust-transparency-report.md`), the UX principles card
(`docs/unown-ux-principles.md`).

**VERIFIED:** full self-learning suite 4944 pass / 0 fail (re-run after the
dogfood fixes); every trust-test assertion programmatic on the pane text; docs
gate green.

**NEXT.** The release pass: the blog post + landing/README refresh, the version
bump to 0.0.45, the release artifacts (six per-OS binaries), the tag.

## Checkpoint 4 — the release: 0.0.45

**DONE.** The blog post (`content/blog/2026-10-30-the-observability-round.md`,
generated rail + feed green), the README refresh (the observability-round
feature bullet, the docs-table row, the twelve-screen lists), the DOX pass
(`docs/AGENTS.md` ownership, `pi-repo/packages/self-learning/AGENTS.md` local
contracts — the round's surfaces documented for future sessions, the
`benchmarks/AGENTS.md` suite registered), the version bump to **0.0.45** and
the CHANGELOG release stop (43 rail stops).

**The mission's eight deliverables, where they live:**

1. TUI UX audit report — `docs/tui-observability-audit.md`
2. Unown Trust & Transparency Report — `docs/unown-trust-transparency-report.md`
3. Comparison Against Competitors — `docs/observability-competitor-research.md`
4. New TUI features implemented — the CHANGELOG 0.0.45 stop + `docs/usage.md` §Mission & observability + the README bullet
5. Before/After screenshots — `public/landing/tui/observability-round/stills/` (six audited stills + pane dumps; the "before" is the audit's recorded state)
6. Benchmark results — `benchmarks/observability/RESULTS.md` + `receipts/`
7. Evidence of learning improvements — the benchmark's dogfood ledger (3 defects found/pinned/fixed live) + the trust receipts showing the engine dreaming during the away window (v4 → v5)
8. The UX principles document — `docs/unown-ux-principles.md`

**NEXT.** The release gate battery (typecheck, lint, build, the suites), the
release commit, CI green, the v0.0.45 tag (the release workflow builds the six
per-OS binaries + installers + SBOM and publishes the GitHub release), and the
deploy verification.

## Checkpoint 5 — the release shipped: v0.0.45

**DONE.** The tag `v0.0.45` pushed; the release workflow green end to end —
CI green on the tagged commit, the 3-OS install matrix, the production build,
the six per-OS binaries **each run on its own platform** (darwin-arm64/x64,
linux-x64/arm64, windows-x64; windows-arm64 shipped with its checklist note
as always), the SBOM + sha256sums + release.json manifest, the published
GitHub release verified by fresh installs on all three OSes, and the release
feed check. The previous push's two Windows child-process timing flakes
(parked-ask steer, /commit 5s cap) were proven flakes: the identical code
paths green on the tagged commit's CI.

**VERIFIED:** the landing deployment (routes, SEO, blog + feed, every media
URL) — `bun scripts/verify-deploy.mjs` all checks passed. Final suite state at
the tag: self-learning 5047 (0 fail), landing 2063 (0 fail), bridge 221
(0 fail), lint at baseline, typecheck + build green.

**The mission's ledger, closed:** the five mechanisms kept learning throughout
(project memory v1 → v6 during the round — the engine consolidated the round's
own benchmark notes, including the OB-5 listener contract); every discovered
weakness became a pin (three in-round dogfood fixes); the 60-second metric
measured with pane receipts; the UX principles card now binds future TUI work.
The one open lane (OB-7 fleet outcomes in the brief — the FleetManager bridge)
is recorded with its reason as the next iteration's first build.
