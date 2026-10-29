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
