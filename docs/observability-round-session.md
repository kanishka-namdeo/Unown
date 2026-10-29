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
