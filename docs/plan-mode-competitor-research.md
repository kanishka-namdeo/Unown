# Plan Mode — competitor research (docs/plan-mode-competitor-research.md)

The 2026-10-31 planning round's research base: how the field's terminal coding
agents implement planning, surveyed before designing Plan Mode V2. Sources were
opened and verified during the round (official docs, shipped bundles, and
source at pinned SHAs); the round's session log carries the raw sweep notes.
The register of resulting gaps and fixes lives in
[benchmarks/plan-mode/GAP-REGISTER.md](../benchmarks/plan-mode/GAP-REGISTER.md).

## The systems and their planning mechanisms

### Claude Code (the reference)

- **Mode cycling**: Shift+Tab cycles `default` → `acceptEdits` → `plan` (optional `bypassPermissions`/`auto` slot in); status line shows `⏸ plan mode on`. `--permission-mode plan`, `/plan [open|<description>]`.
- **Plan V2 (2.1.x)**: the plan lives in a **file** (`~/.claude/plans/<slug>.md` — the ONLY writable path in plan mode, exempted from protected-path blocking); `ExitPlanMode` takes **no plan content** — it reads the file and signals readiness. Legacy (≤2.0.x): the plan rode the tool parameter.
- **The approval dialog** ("Ready to code?"): *Yes, and use auto mode* / *Yes, manually approve edits* / *No, keep planning* — mapped 1:1 onto permission-mode transitions; Shift+Tab in the dialog quick-approves; **Ctrl+G opens the plan in $EDITOR** before deciding; rejection echoes the rejected plan + feedback and stays in plan mode.
- **Post-approval re-injection**: the tool_result carries "User has approved your plan… ## Approved Plan: <content>"; a clear-context variant seeds a fresh conversation with "Implement the following plan:"; accepting titles the session from the plan.
- **Durability**: the plan-mode reminder re-attaches every 5 turns (full every 5th) — plan + mode survive compaction (fixed in 2.1.47) and resume; `/fork` gets its own plan file.
- **Guard rails**: ExitPlanMode outside plan mode errors; `PreToolUse: allow` cannot approve writes in plan mode; `Edit(...)` allow rules cannot bypass the block.
- **Workflow prompts** (2.1.112): Phase 1 parallel Explore subagents → Phase 2 Plan subagent → Phase 3 review → Phase 4 write plan file → Phase 5 ExitPlanMode; "your turn should only end with either AskUserQuestion or ExitPlanMode"; "never ask what you could find out by reading the code"; plan requirements = Context, recommended-approach-only, file paths, reuse references, a Verification section; brevity flags push < 40 lines.
- **`opusplan`**: Opus during plan mode, Sonnet for execution (`/model opusplan`; env `ANTHROPIC_DEFAULT_{OPUS,SONNET}_MODEL`).

### Gemini CLI

- **Plan Mode**: `/plan [goal]`, Shift+Tab cycling, `--approval-mode=plan`, and model-initiated `enter_plan_mode`. Read-only tools + plan-file writes only (`.md` in a plans dir); `exit_plan_mode(plan_path)` validates the path and presents the plan; rejection returns feedback to refine.
- **Collaborative editing**: Ctrl+X opens the plan in the external editor; the CLI detects changes and reviews the user's comments.
- **Model routing**: Pro (high-reasoning) while planning, Flash after approval.
- **Todos**: `write_todos` (pending/in_progress/completed/cancelled/blocked; one in_progress; Ctrl+T) evolving into experimental `tracker_*` DAG tools (epic/task/bug, dependencies, topological order, ASCII visualize).

### Roo Code

- **Orchestrator (Boomerang tasks)**: `new_task` down (mode, message, todos — comprehensive handoff: all context, defined scope, "these instructions supersede"), `attempt_completion` up (result = the source of truth for the parent). Task stack; each subtask in its own context; the orchestrator itself has NO tool groups — context-poisoning prevention.
- **Architect mode**: read + md-only edits; plans in `/plans`; todo lists mandatory; "never provide effort estimates"; `switch_mode` to implement.

### OpenHands / OpenDevin

- **Current**: a structured **PLAN.md** file with a fixed schema — OBJECTIVE / CONTEXT SUMMARY / APPROACH OVERVIEW / IMPLEMENTATION STEPS (goal + method + reference) / TESTING AND VALIDATION. `PlanningFileEditorTool` can view any file but edit only PLAN.md. Phases: Initial Understanding → Planning (evaluate multiple approaches, consult on tradeoffs) → Synthesis & User Alignment → Refinement. Planning condenser keeps more initial context (max_size 100, keep_first 6). Two-phase pattern: a separate execution agent reads PLAN.md.
- **Legacy (0.9.x)**: plan as a task tree in state (`add_task`/`modify_task`, states in_progress/completed/verified/abandoned); "if History contradicts the state, you MUST modify the task".

### Aider

- **Architect mode** (`--architect`): two inference steps — the architect proposes, an editor model turns the proposal into edits (SOTA at introduction: o1-preview architect + DeepSeek editor). Ask→code workflow: discuss in `/ask`, then "go ahead" in `/code` executes the discussed plan.
- **Repo map**: graph-ranked symbol map (aider's own algorithm — the one unown vendors for its repomap) gives the planner file awareness without full reads.

### Cline / Codex CLI

- **Cline**: the Plan/Act toggle; plan mode restricts tools; `ask_followup_question` to clarify before planning; checkpoints around every step.
- **Codex CLI**: `update_plan` — a step list with per-step status (pending/in_progress/completed) shown in the TUI; auto-planning for multi-step work.

## Plan-quality evaluation (what "better" means, measurably)

- **TravelPlanner / NATURAL PLAN / PlanBench**: constraint-satisfaction and exact-match solve rates — plans judged by whether they execute.
- **AgentBoard**: progress rate — partial credit toward the goal instead of binary success.
- **DevAI / Agent-as-a-Judge**: hierarchical requirement-satisfaction scoring with an agentic judge.
- **"From Plan to Action" (2604.12147)**: plan-compliance measurement on SWE-bench trajectories — whether agents follow the plan they were given.
- **Agentless counterpoint**: a fixed localize→repair→validate pipeline matched planning-heavy agents on SWE-bench — structure matters more than agentic planning theatre.

Unown's rubric (deterministic, judge-free — the repo's receipts-first doctrine) scores the plan DOCUMENT on seven structural dimensions (objective, context, approach, steps + files, risks, verification, clarity); compliance and correctness remain the execution benchmarks' job (edit-bench, longhorizon).

## What Unown adopted, and what it deliberately did not

| Mechanism | Source | In V2? |
|---|---|---|
| Plan file as the artifact + only writable path | Claude Code V2, Gemini, Roo Architect | **Yes** — `.unown/plans/<slug>.md` via `plan_write` |
| Structured exit tool reading the file | Claude Code ExitPlanMode | **Yes** — `exit_plan_mode` |
| Approval options mapped to permission modes | Claude Code | **Yes** — auto-accept → acceptEdits, manual → default |
| Edit-in-$EDITOR before deciding | Claude Code Ctrl+G, Gemini Ctrl+X | **Yes** — the dialog's $EDITOR lane |
| Rejection feedback loop | Claude Code | **Yes** — rejected plan + feedback re-injected |
| Plan → todos on approval | Roo, Gemini, Claude Code | **Yes** — steps seed the todo store |
| Plan/execute model split | Claude Code opusplan, Gemini Pro→Flash, Aider architect/editor | **Yes** — `--plan-model` |
| Mode cycling keybinding | Claude Code, Gemini | **Yes** — Shift+Tab (default → acceptEdits → plan) |
| Required plan structure | OpenHands PLAN.md, Claude Code plan prompts | **Yes** — the six-section contract |
| Session title from the plan | Claude Code | **Yes** — `plan: <objective>` |
| Plan-mode model upgrade for small models | Claude Code (Haiku→Sonnet) | No — unown's provider set is user-owned; the flag is the equivalent |
| Interview phase flag / Explore+Plan subagent fan-out | Claude Code flags | Partial — the workflow prompt names the phases; the task tool exists for delegation; the flag lane is follow-up |
| DAG task dependencies | Gemini tracker_* (experimental) | No — flat ordered steps + the todo tool (recorded as a non-goal with rationale) |
| Headless auto-approval | — | No — the approval gate is the safety property; print mode reports the plan instead (recorded) |
