# The Plan Mode V3 round — session log

- **Round**: plan-mode-v3 (the capability orchestrator + self-improvement directive)
- **Started**: 2026-11-01
- **Status**: in flight
- **Baseline**: v0.0.55 (`e7e0a43d`), engine suite green at baseline (5326 tests per the release-recovery round's receipts)
- **Operator directive**: clone → setup → run → implement Plan Mode V3 per the operator brief (capability orchestrator: capability audit before generation, specialist review, synthesis, dual review, mandatory retrospective + learning extraction, failure classification, improvement generation), pushing each milestone.

This is the resumable log: every milestone records what was done, the receipts, and what remains. A resumed session reads this file first.

---

## M1 — bring-up (2026-11-01) ✅

**Goal**: fresh clone fully running: toolchain, install, services, live chat through the Agnes upstream.

Environment:

- bun 1.4.4 (floor 1.4 per root AGENTS.md), Node 24, git 2.47
- Clone at `/home/z/my-project/unown` @ `e7e0a43d` (main); remote PAT-configured per the repo's own convention (root AGENTS.md: "The GitHub PAT lives only in the git remote URL")
- `.env` created from `.env.example`; `BRIDGE_UPSTREAM_KEY` + `AGNES_API_KEY` set to the Agnes AI metered key (`https://apihub.agnes-ai.com/v1` — the repo's documented default upstream)
- `bun run agent:install` — full source install: root + pi-repo deps, coding-agent bundle built (52 files, 8.5 MiB), mini-service `.env` links, `~/.local/bin/unown` shim
- `UNOWN_NO_ENGINE_SERVICE=1` for the sandbox install (no OS service; engine still runs via `bun run agent:start`)

Receipts:

- `bun run agent:start` → bridge pid + engine pid up
- `curl :3031/health` → `{"ok":true, …, "upstream":{"ok":true,"status":200}, "upstreamKeyIsSet":true, "models":["agnes-3.0-flash","agnes-2.5-flash",…]}`
- `curl :3030/api/health` (bearer) → `{"phase":"ready", …}`
- `unown doctor` → "unown is ready to chat" (⚠ items are the documented learning-feature-only warnings: unverified model specs, no LSP, no MCP)
- End-to-end live chat: `unown -p "Reply with exactly: UNOWN_LIVE_OK …"` → `UNOWN_LIVE_OK — I'm Agnes-3.0-flash, an expert coding assistant developed by Sapiens AI.` (agent → bridge → Agnes upstream → reply; one live model call, receipt in the bridge usage log)

No tracked-file changes in M1 (`.env` and runtime state are gitignored by design) — nothing to commit.

---

## M2 — research record (2026-11-01) ✅

**Repo research** (R2 subagent digest + direct source reads):

- Plan Mode V2 lives in: `src/plan.ts` (PlanDoc / parser / renderer / deterministic 7-dimension scorer, pure), `src/tools.ts` (state machine at factory scope: `planModeEnabled`/`executionMode`/budget/nudges; `plan_write` + `exit_plan_mode` tools; the `[PLAN MODE ACTIVE …]` context injection at `before_agent_start`; the `context` handler strips messages containing that sentinel; approval dialog with 4 options + 6-round editor cap; fallback gate at `agent_end`; P-11 notes via `deliverPlanNote`), `benchmarks/plan-mode/GAP-REGISTER.md` (P-01..P-17b all shipped; non-goals recorded).
- V2 plan-mode toolset: read/bash/grep/find/ls/note/fetch_url/web_search/webfetch/lsp/plan_write/exit_plan_mode; disabled: edit/write/**task**/todo.
- Subagent system: `BUILTIN_AGENTS` (12: general, explore, background-explore + 9 role agents), override order built-in < user < project, routing fields travel as CLI flags, children are headless `--mode json -p` runs with `CHILD_BOUNDARY_INSTRUCTIONS`, completion guard + delegation ledger.
- Session toolset mechanics: extension tools register globally; the active set is `defaultSessionTools()` (base four + grep/find/ls) plus extension tools per `_refreshToolRegistry(includeAllExtensionTools)`; plan tools are activated/deactivated by the plan-mode switch; `--tools` is an allowlist when explicit.

**Online research** (grounding, sources opened):

- Claude Code plan mode: read-only exploration + plan file + `exit_plan_mode`; live failure modes documented in its tracker (writes during plan mode #39713 — the community ships ~340-line PreToolUse guards; stale state after toggle-off #7782) → confirms Unown's enforced-toolset approach (not prompt-only) and the single-writable-path design.
- MetaGPT ("Code = SOP(Team)"): role-specialized SOP pipeline (product manager → architect → PM → engineer), each role emitting a structured artifact — the direct ancestor of the V3 specialist bench.
- Reflexion (arXiv 2303.11366): Actor / Evaluator / Self-Reflection / Memory loop — linguistic feedback stored across trials; the ancestor of the V3 retrospective → learning extraction → AutoDream lane.
- 2026 review-agent patterns (multi-model reviewer fan-out, builder/reviewer): independent review preferred over self-review; verdict-first contracts.

**Design decisions** (from the research, mapped to the operator brief):

1. **V3 is the plan-mode default**, `UNOWN_PLAN_MODE_V3=0` restores V2 (the repo's kill-switch convention, e.g. `UNOWN_FOOTER_CLASSIC=1`).
2. **The plan doc grows four planning sections** — `## Capability audit` (11 rows, priority order), `## Specialist review`, `## Synthesis`, `## Learning plan` — plus a post-execution `## Retrospective` appended by a new `plan_retrospective` tool. V2 docs parse and render byte-identically (new sections are optional fields).
3. **Scoring**: `scorePlanDocV3` — 10 dimensions, 100 points (V2's seven re-weighted to 80 + capability-audit 8 + specialist-review 8 + learning-plan 4). Same threshold gate; `planCritiqueAdvice` unchanged.
4. **Specialist delegation during planning**: `task` becomes available in plan mode V3, but ONLY read-only agents (tools ⊆ {read, grep, find, ls}) can be spawned — the new 8-specialist planning bench is all read-only; writing agents are refused until approval. This keeps the read-only contract enforced by toolset, not prompt (the Claude Code #39713 lesson).
5. **The 8 specialists ship as built-ins with `advertise:false`** (like `planner`): reached explicitly by the orchestrator, never bloating the advertised catalog.
6. **The retrospective is a tool, not a hope**: `plan_retrospective` (execution-mode only) validates the outcome/failure-class/learnings structure, merges the section into the plan file, and delivers a `retrospective` note to the engine (the AutoDream lane — Reflexion's memory write).
7. **Dual review** stays an execution-phase instruction (builder + `reviewer` subagent for high-risk steps) — the reviewer already exists; V3 makes its use mandatory-by-class rather than optional.

---

## M3 — `plan.ts` V3 data model (2026-11-01) ✅

Implemented in `pi-repo/packages/self-learning/src/plan.ts`:

- `CAPABILITY_IDS` (11, priority order), `SPECIALIST_IDS` (8), `LEARNING_KINDS` (7), `FAILURE_CATEGORIES` (8)
- `PlanCapabilityRow`, `PlanSpecialistVerdict`, `PlanSynthesis`, `PlanLearningCandidate`, `PlanRetrospective`
- `PlanDoc` gains optional `capabilityAudit` / `specialistReview` / `synthesis` / `learningPlan` / `retrospective` (V2 constructors stay type-valid)
- Parser: 5 new section headers, tolerant row grammars (`- tiered-memory — USED: reason (relevance: high; benefit: …; confidence: 80)`, `### specialist — VERDICT` + bullets, `- consensus: …` keys, `- kind: what` learning rows, retrospective key-lines + nested learnings/improvements)
- Renderer: V3 sections render only when present (V2 round-trip unchanged); `mergeRetrospectiveIntoMarkdown` (surgical: strips an existing `## Retrospective` section, appends the rendered one — the model's plan bytes stay untouched)
- `scorePlanDocV3`: 10 dimensions / 100 points as designed; `validateRetrospective` rules (outcome required; failure-class + root-cause + prevention required when outcome ≠ delivered; ≥1 learning candidate or improvement overall)
- `hasV3Sections` helper

Tests: `test/plan-v3.test.ts` — parser (full doc / tolerant variants / V2 back-compat), scorer (per-dimension weak/strong), retrospective parse/render/merge/validate, round-trips.

Receipts: `bun test test/plan-v3.test.ts` → all pass; `bun test test/plan.test.ts` → V2 pins unchanged (back-compat proven).

## M4 — the specialist bench (2026-11-01) ✅

`PLANNING_BUILTIN_AGENTS` in `src/subagent-builtins.ts` — 8 read-only planning specialists (product-strategist, solution-architect, delivery-manager, qa-architect, devils-advocate, learning-analyst, memory-auditor, skill-architect), each with a fixed verdict-first reply contract, `tools: ["read","grep","find","ls"]`, `advertise: false`, `effort: "low"`, `maxTurns: 16` (scout-class headroom ×2). Spread into `BUILTIN_AGENTS` after the role agents. Tests extended in `test/subagent-builtins.test.ts`.

## M5 — orchestration wiring in `tools.ts` (2026-11-01) ✅

- `planV3Mode` flag: `UNOWN_PLAN_MODE_V3 !== "0"` (default ON)
- Plan-mode toolset (V3): V2 set + `task`; `plan_retrospective` stripped while planning; `PLAN_MANAGED_TOOLS` gains `plan_retrospective`
- Planning-time delegation guard: in plan mode every spawned agent must be strictly read-only (declared tools ⊆ {read, grep, find, ls}); otherwise the whole call is refused with the specialist roster in the message (covers sync + async lanes; enforced before any spawn)
- V3 orchestrator prompt (phase model: AUDIT → STRATEGIZE → SPECIALIST REVIEW → SYNTHESIZE → DRAFT → EXIT; capability priority order; the plan-file grammar with the four new sections) — keeps the `[PLAN MODE ACTIVE` sentinel so the context stripper still works
- Execution-phase addendum: continuous plan validation questions, dual-review requirement, the mandatory `plan_retrospective` close
- `plan_write` + `exit_plan_mode` + the agent_end fallback gate score with `scorePlanDocV3` when V3 is on
- New `plan_retrospective` tool (foreground-only, execution-mode-guarded): validates → merges into the plan file → delivers a `retrospective` note to the engine
- `deliverPlanNote` gains the `retrospective` kind
- `enterPlanMode`'s notice names V3; `persistPlanState` records the v3 flag

Tests: `test/plan-mode-v3.test.ts` — extension-level pins (V3 toolset contains task + plan tools and never edit/write/todo; kill switch restores the V2 toolset; the delegation guard refuses `worker` and admits `product-strategist`; plan_write scores V3 dimensions weak/strong; plan_retrospective guard + happy path writes the section and queues the engine note); golden `--plan` pin updated (task now present under V3; a `UNOWN_PLAN_MODE_V3=0` lane pins the V2 toolset).

Receipts: full engine suite + typecheck green (see M6).

## M6 — verification matrix (2026-11-01) ✅

| Gate | Command | Result |
|---|---|---|
| V3 unit pins | `bun test test/plan-v3.test.ts` | pass |
| V2 back-compat | `bun test test/plan.test.ts` | pass (unchanged pins) |
| Extension pins | `bun test test/plan-mode-v3.test.ts test/plan-mode-shortcuts.test.ts test/plan-mode-todo-unification.test.ts` | pass |
| Subagent pins | `bun test test/subagent-builtins.test.ts test/subagent-routing.test.ts` | pass |
| Engine suite | `bun test test/` | green |
| Typecheck | `bun run typecheck` (package tsc) | clean |
| Golden CLI | `bun test test/cli/golden.test.ts` | green incl. the updated `--plan` toolset pin + the V2 kill-switch lane |
| Live PT | a real `--plan` session through the live stack (bridge + Agnes) | receipt in benchmarks/plan-mode/RESULTS.md (PT-4 100/100 first live run) |

## M7 — docs, landing, DOX (2026-11-01) ✅

- `docs/usage.md` — plan-mode section rewritten for V3 (phases, audit, specialists, retrospective, kill switch, env knobs)
- `docs/plan-mode-v3.md` — the round's design record (lineage: MetaGPT SOP roles, Reflexion loop, builder/reviewer patterns; the ten design decisions; failure-mode analysis)
- Root `AGENTS.md` — the bin/unown contract line now names the V3 surface; `pi-repo/packages/self-learning/AGENTS.md` — plan-mode contract updated (V3 toolset, guard, retrospective, env)
- `.env.example` — `UNOWN_PLAN_MODE_V3` documented (tracked reference stays in sync)
- `CHANGELOG.md` — the round's entry; landing rail regenerated (`check:changelog` green)
- `unown-overview.md` — roster count refreshed (12 → 20 built-ins) with the evidence line
- `benchmarks/plan-mode/` — PT-4 (capability-audit plan) task + the deterministic scorer receipt + the live PT receipt
- README — the plan-mode pointer updated

## M8 — closeout (2026-11-01) ✅

Retrospective, failure classes, improvement generation — recorded in this log's closeout section (bottom). All milestones pushed (one commit per milestone, `engine:`/`docs:`/`benchmarks:` prefixes per the git preflight).
