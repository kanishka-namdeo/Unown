# Observability round — the competitor research

> The verdict up front: **the terminal coding-agent field has converged on a shared
> observability vocabulary — todo checklist, plan mode, checkpoints, queueing,
> recaps, context/cost footers — but nobody has built the returning-user story
> Unown's mission demands.** Every tool answers "what is happening right now";
> almost none answer "what happened while I was away, why, and what remains."
> Unown's differentiators (the learning loop, receipts, the engine state machine)
> are the raw material for exactly that surface. The gap analysis below (§5)
> drives the round's feature ledger.

- [Method](#method)
- [The field, system by system](#the-field-system-by-system)
- [The TUI UX scorecard](#the-tui-ux-scorecard)
- [The 15 most transferable ideas](#the-15-most-transferable-ideas)
- [Unown's gap analysis](#unowns-gap-analysis)
- [What this round adopts, and what it rejects](#what-this-round-adopts-and-what-it-rejects)


Related pages: [the observability round session record](observability-round-session.md) · [the TUI observability audit](tui-observability-audit.md) · [the user journeys](observability-user-journeys.md) · [the 24-system mission consolidation](competitor-comparison-report.md) · [the SOTA round research](sota-round-competitor-research.md)

## Method

Nine systems researched across the round's nine evaluation dimensions
(progress communication, task visibility, tool visibility, error recovery,
trust signals, planning visibility, user control, session continuation,
long-running-task ergonomics), from official documentation, source code and
release notes fetched live (2026-10-30): Claude Code, OpenAI Codex CLI,
OpenCode, Aider, Cline, Roo Code, Gemini CLI, OpenHands (ex-OpenDevin) — plus
Crush and the upstream pi coding agent as bonus references. General search
engines were bot-degraded from this sandbox, so every fact below comes from a
direct fetch of the vendor's own docs or the project's own source; claims are
tiered `[V]` (verified at the cited page), `[C]` (claimed upstream, not
re-derived), `[U]` (unverified). Unown's own surface was mapped file-by-file in
the same pass (the [audit](tui-observability-audit.md) carries the inventory)
so the scorecard compares shipped behavior against shipped behavior, not
marketing against memory.

## The field, system by system

### Claude Code

The observability benchmark. Collapsed-by-default tool calls with a
transcript viewer (ctrl+o) that adds timestamps and the model per assistant
message `[V]` [code.claude.com/docs/en/interactive-mode.md]; a customizable
status line fed session JSON on stdin — context usage, costs, git status
`[V]` [statusline.md]; a task checklist (ctrl+t, five items visible,
persists across compactions) `[V]`; automatic checkpoints before every user
turn with a five-way `/rewind` menu (restore code / conversation / both /
summarize from here / up to here) `[V]` [checkpointing.md]; the returning-user
recap — a one-line "what happened while you were away" after ≥3 minutes
unfocused with ≥3 turns, `/recap` on demand `[V]`; usage-limit waits shown as
a countdown with automatic continue at reset `[V]`; permission modes cycled
with shift+tab and labeled in the status bar `[V]` [permission-modes.md];
permission prompts accept a free-text comment steering the retry `[V]`
[permissions.md]; queued messages render gray until consumed `[V]`;
`/btw`-style side questions that never enter the transcript `[V]`; footer PR
review badges with color-coded status `[V]`.

### Codex CLI

Approval architecture is its strength: `--sandbox {read-only, workspace-write,
danger-full-access}` × `--ask-for-request {untrusted, on-request, never,
granular}` with config profiles `[V]` [codex-rs/protocol/src/protocol.rs],
plus in-session `/permissions`, `/status` (configuration + token usage),
`/statusline` and `/title` `[V]` [codex-rs/tui/src/slash_command.rs]. `/goal`
names the long-running task's objective; `/plan` mode, `/recap`, `/raw`
(copy-friendly scrollback), `/ps` + `/stop` (background terminals),
`/warnings` (retained diagnostics) `[V]`. Recovery: `/usage` with a
limit-reset affordance, `codex doctor --network-only`, TUI reconnection
recovery incl. offline /quit handling `[V]` [releases 0.166.0]. "Clearer
safety-block explanations and selectable safer follow-up prompts" `[V]` —
refusals as teachable moments. No built-in todo list `[U]`.

### OpenCode

The attention system is the standout: desktop notifications + sounds on
questions, permissions, session errors and completions — but only when the
terminal is blurred `[V]` [opencode.ai/docs/tui/]. Permission model:
allow/ask/deny with wildcard patterns and an `.env`-read guard on by default
`[V]` [docs/permissions/]; the `doom_loop` permission fires when the same
tool call repeats 3× with identical input `[V]` — the best defense against
visible flailing in the field. Git-based `/undo` + `/redo`; `/details`
toggles tool detail; Build/Plan agents switched with tab; `/sessions`,
`/compact`; themeable TUI; third-party review: "possibly the best terminal
UI I've encountered in an open-source coding agent" `[C]`
[elite-ai-assisted-coding.dev/p/opencode-tool-review].

### Aider

Git-native trust: every edit auto-committed with a conventional-commit
message authored by the weak model, `(aider)` attribution, dirty pre-existing
files committed separately so your edits and the agent's never mix, `--no-auto-commits`
opt-outs, `/undo` as `git reset` `[V]` [aider.chat/docs/git.html]. Mode in
the prompt itself (`>` code, `ask>`, `architect>`) `[V]` [usage/modes.html].
Token-limit errors print a breakdown with suggested actions `[V]`
[troubleshooting/token-limits.html]. No todo list — the mental model is
file-centric (`/add`, `/drop`, `/map`) `[V]`. `--notifications` fires OS
notifications when the LLM finishes `[V]` [usage/notifications.html].

### Cline

Shadow-git checkpoints after every tool use with a three-way restore menu —
Restore Files / Restore Task Only / Restore Files & Task — separating code
rollback from conversation rollback `[V]` [docs.cline.bot/core-workflows/checkpoints].
Every edit renders as a reviewable diff; a checkpoint indicator with Compare
and Restore buttons follows each tool use `[V]`. Auto-approve is a per-tool
grid with model-classified `requires_approval` flags rather than a fixed
allowlist `[V]` [features/auto-approve]; notifications when approval is
required and when an auto-approved command runs >30s `[V]`. Plan/Act toggle
with separate models per mode `[V]` [core-workflows/plan-and-act]. The TUI
status area shows model, context, cost, branch, Plan/Act state, auto-approve
`[V]` [docs.cline.bot/usage/tui]. Agent teams persist state across sessions
`[V]` [github.com/cline/cline].

### Roo Code

The mode system: Code, Architect, Ask, Debug + custom modes, and the
Orchestrator ("Boomerang") mode that decomposes into per-context subtasks
whose summaries boomerang back `[V]` [roocodeinc.github.io/Roo-Code/features/boomerang-tasks/].
An embedded interactive Task Todo List auto-created for complex work
`[V]` [features/task-todo-list/]; auto-approve tiles with bulk All/None and
a master Enabled pause `[V]`; checkpoints before file modifications with
per-checkpoint restore menus `[V]`; Intelligent Context Condensing on by
default `[V]`; message queueing — with the documented tradeoff that queued
messages implicitly approve what would otherwise ask `[V]`
[features/message-queueing/].

### Gemini CLI

`/stats` is the field's best built-in metrics surface: session (duration,
tool calls), model (tokens, quota), tools (per-tool usage) `[V]`
[geminicli.com/docs/reference/commands/]. The todo list renders live above
the input with the active step highlighted and ctrl+t for the full list
`[V]` [tutorials/task-planning/]. Checkpoints before file-modifying tools in
a shadow repo; `/restore` reverts files, restores conversation history and
re-proposes the original tool call to run again, modify or ignore `[V]`
[cli/checkpointing/]. Folder-trust dialog with a restricted safe mode `[V]`
[cli/trusted-folders/]. OSC 9 notifications with BEL fallback on completion
and approval-needed `[V]` [cli/notifications/]. YOLO mode is CLI-flag-only
and enterprise-gated `[V]` [reference/configuration/].

### OpenHands (ex-OpenDevin)

The live activity chip — a plain-language current-action label ("reading a
file", "running a command", fallback "Thinking") that disappears on pause
`[V]` [docs.openhands.dev/openhands/usage/agent-canvas/conversations.md] —
reads progress as intent, not logs. Failed messages render Retry/Dismiss
bubbles that survive reloads `[V]`. Pause/resume mid-run with feedback carried
back on rejection `[V]` [sdk/guides/convo-pause-and-resume.md].
ConfirmRisky backed by an LLM security analyzer that classifies action risk
`[V]` [sdk/guides/security.md]; a per-conversation USD budget that stops the
conversation but offers continue-with-prompt `[V]`
[usage/settings/application-settings.md]. No plan mode — child-conversation
decomposition instead `[V]`.

### Bonus references

**Crush** (charmbracelet): mid-session model switching preserving context,
host-themed TUI over a client/server API, piped permissions, hooks across
sessions/turns/permissions incl. compaction lifecycle `[V]`
[github.com/charmbracelet/crush]. **pi** (the upstream substrate): the
footer already carries context %, tokens and cost; steering semantics are
documented (Enter guides the next response, alt+enter waits for the full
task) `[V]` [packages/coding-agent/docs/usage.md]; no todos/plan/permissions
by design — "containerize or sandbox Pi" `[V]` [README].

## The TUI UX scorecard

Shipped behavior against shipped behavior. ✓ strong · ~ partial · ✗ weak.

| System | Progress comm. | Task visibility | Tool visibility | Error recovery | Trust signals | Planning vis. | User control | Session contin. | Long-run ergo. |
|---|---|---|---|---|---|---|---|---|---|
| Claude Code | ✓ recap+statusline | ✓ checklist | ✓ ctrl+o timestamps | ✓ /rewind 5-way | ✓ modes+/usage | ✓ plan gate | ✓ queue+/btw | ✓ resume+compact | ✓ recap+auto-continue |
| Codex CLI | ~ stream+search | ~ /goal only | ✓ /diff /raw /ps | ✓ /usage reset | ✓✓ granular approvals | ✓ /plan | ✓ /side /agents | ✓ /resume /fork | ✓ /goal /daemon |
| OpenCode | ✓ /details+/thinking | ✓ todowrite | ✓ stacked diffs | ✓ git /undo+doom_loop | ✓ pattern perms+.env | ✓ Build/Plan tab | ✓ leader keys | ✓ /sessions | ✓✓ attention system |
| Aider | ~ mode-in-prompt | ✗ file-centric | ✓ SEARCH/REPLACE | ~ token-limit advice | ✓✓ auto-commits+attribution | ~ architect mode | ✓ vi/emacs | ✓ /save /load | ~ notifications |
| Cline | ✓ live watching+TUI bar | ✓ todo tool | ✓✓ diff per edit | ✓✓ shadow-git 3-way | ✓ per-tool grid | ✓✓ Plan/Act models | ✓ auto-approve grid | ✓ task history | ✓ approval+30s alerts |
| Roo Code | ~ spinner | ✓✓ embedded todos | ✓ checkpoint diffs | ✓ checkpoints+condensing | ✓ tiles+All/None | ✓✓ modes+Boomerang | ✓ queueing | ✓ task history | ✓ queueing |
| Gemini CLI | ✓ /stats+live todos | ✓✓ live todo list | ~ /copy /tools | ✓ /restore re-proposes | ✓ folder trust dialog | ✓ /plan+steering | ✓ /settings /vim | ✓✓ resume browser+share | ✓ OSC 9 |
| OpenHands | ✓ activity chip | ~ child convos | ✓✓ panes | ✓ pause/resume+retry | ✓ ConfirmRisky+budget | ✗ none (orchestration) | ✓ pause/resume | ✓ branching | ✓✓ automations |
| **Unown (0.0.44)** | ✓✓ turn meter+recap+OSC 7501 | ✓ todo graph+plan n/m | ✓ split view+fleet | ✓✓ checkpoints+receipts+/undo | ✓ engine states+memory bar | ✓ plan+evidence-gated goal | ✓ steer+queue+steer-children | ✓✓ resume+tree+export | ~ recap is activity-shaped, no mission display |

Reading the row: Unown is at or near the top on raw mechanics — the turn
meter, the engine state machine and the receipts ledger are beyond what most
of the field ships. The weakness is not mechanical but **narrative**: no
persistent mission display, no derived progress on ordinary turns, and a
recap that reports the shape of activity (3 turns, 14 tools) rather than
the state of the work (objective, decisions, risks, what remains).

## The 15 most transferable ideas

Ranked by value to a returning user of a self-improving agent:

1. **Live todo checklist with persistent visibility + one-key full list** (Claude ctrl+t, Gemini ctrl+t, Roo) — Unown has the todo addon; the round's job is wiring it into a progress narrative.
2. **Per-turn checkpoints with granular restore** (Claude /rewind, Cline 3-way, Gemini re-propose) — shipped here; the round's job is making recovery discoverable at the moment it is needed.
3. **One-key verbose mode with provenance** (Claude ctrl+o timestamps+model, OpenCode /details) — split view covers this; the gap is discoverability.
4. **Visible queue state** (Claude gray queued messages, Roo "Queued:") — shipped on pi; nothing to do.
5. **Interrupt preserving partial work** — shipped; nothing to do.
6. **Plan/Act split with visible mode + per-mode models** — shipped (plan mode + scoped models); nothing to do.
7. **"While you were away" recap** (Claude auto-recap, Codex /recap) — the round's flagship: extend the existing /recap from an activity digest to a mission brief.
8. **Usage-limit countdown with auto-continue** (Claude) — the bridge's rate-limit class + governor exist; surface the reset time when 429s land.
9. **Always-visible context+cost+model footer** — shipped (pi footer + turn meter); extend with progress + confidence chips.
10. **Smart attention** (OpenCode blur-gated sounds, Gemini OSC 9, Cline 30s) — OSC 7501 shipped; a completion sound when blurred is a candidate, low priority.
11. **Permission prompts that accept an explanation** (Claude comments, Codex safer follow-ups) — a candidate; the deny path already prints the fix.
12. **Session branching/forking** — shipped (/tree /fork /clone); nothing to do.
13. **Doom-loop guard** (OpenCode) — shipped as `--max-tool-repetitions` + loop_guard; make its trip visible in-session.
14. **Agent-authored commits with attribution** (Aider) — /commit exists, commits are manual; the standing-orders lane covers unattended discipline.
15. **Plain-language activity chip** (OpenHands) — shipped as the verb-first spinner + humanized fleet tools; extend the vocabulary.

## Unown's gap analysis

From the file-by-file surface map (the [audit](tui-observability-audit.md)
has the full inventory), fifteen gaps, critical view:

1. **No mission/objective display by default** — `/goal` is opt-in and its
   text is never pinned on screen; a returning user in a normal session has
   zero statement of "what we are doing and why" (footer shows only
   `goal: active`).
2. **No progress signal on ordinary turns** — plan mode and todos give step
   counts, but a session without them shows only a spinner verb + elapsed:
   no percentage, no "step 3 of ~7", no ETA.
3. **Usage/cost visibility fragments** — the footer's cost chip is the
   first casualty of the ordered-drop ladder; per-child fleet cost needs
   `task_control status`; `/insights` is a manual report, not ambient.
4. **The "why" is collapsed** — thinking is hidden by default and the
   split-view thinking panel is opt-in; mid-turn decisions are invisible
   unless the user already knows `/split`.
5. **Long tool runs show a generic verb** — the spinner names the tool, not
   the milestone; no per-tool progress counters on the main transcript.
6. **Advisor history has no surface** — advice cards render once; "what did
   the watchdog say" is scrollback archaeology (no `/advisor log`).
7. **Guardrail denials are transient** — a deny toast exists but there is no
   running "N actions blocked this session" counter or recovery surface.
8. **The recap reports activity, not state** — counts + last preview, but
   not why a turn failed, what was decided, or what remains open.
9. **Fleet afterlife is thin** — finished async children surface only via
   `/tasks` or delivered messages; no persistent per-session fleet cost row.
10. **Learning is behind the dashboard door** — dreams, versions, minted
    skills and cycle outcomes have no ambient in-session presence beyond the
    memory-bar segment; the returning user must know to open `/dashboard`.
11. **No confidence or session-health signal anywhere** — retries, verify
    failures and error rate are recorded (receipts, insights) but never
    composed into a visible "how is this going" metric.
12. **Recovery is command-shaped, not surfaced** — doctor, /engine actions,
    dead-letter instructions exist in prose; a failed review or blocked note
    never offers an inline action.
13. **Version skew lives in footer suffixes** — `old build` / `stale (vX)`
    with the fix in text; no in-session "restart engine now?" affordance.
14. **Widget budget competition** — the 10-line widget cap means todo +
    plan + fleet can silently truncate exactly when complexity peaks.
15. **Split-view persistence is per-machine** — configured observability
    panels do not follow the user to new checkouts without knowing
    `/split-save`.

## What this round adopts, and what it rejects

**Adopts** (mapped to the round's feature ledger, implemented in the same
round — see the [session record](observability-round-session.md)):

- the **mission panel** — a persistent objective + progress + confidence
  widget (gaps 1, 2, 11): mission from `/goal` when active, else a pinned
  `/mission`, else the auto-title; progress from todos/plan when present;
  confidence from deterministic signals (tool errors, verify failures,
  retries);
- the **mission brief recap** — the returning-user brief (gaps 8, 9):
  objective / what happened / decisions (LLM-mined, cited) / what changed /
  what remains / cost + time, replacing the activity-shaped one-liner;
- the **recovery surface** (gaps 7, 12): retries, verify failures, denials,
  dead letters and engine states as one `/recovery` card with the fix path
  per row, plus a footer health chip;
- the **ambient learning feed** (gaps 10, 15): engine SSE events as a
  compact in-session feed (dreams shipped, skills staged, improvements,
  cycle verdicts) — `/feed` for the drill-in, the dashboard for the rest;
- **telemetry rollups** (gap 3): session cost + time + per-child cost in the
  mission panel and the brief, all derived from existing meters.

**Rejects** (with reasons, per the decision-record house rule):

- **sounds / per-event sound packs** (OpenCode) — the TUI is a shared
  terminal surface; OSC 9 sounds are terminal-dependent and the OSC 7501
  status lane already covers program-status consumers;
- **public session-share pages** — rejected in the 24-system consolidation,
  unchanged;
- **USD budget stop-with-continue** (OpenHands) — the governor already
  enforces hourly/daily call/token ceilings with a breaker; a second,
  interactive budget UI would duplicate it with a weaker contract;
- **queued-message implicit approval** (Roo) — the documented tradeoff
  weakens the permission model; pi's queue semantics stay;
- ** doom-loop as an ask-permission** (OpenCode) — the loop guard already
  aborts deterministically (`exit 4`); an ask-gate on top would reintroduce
  interactive prompts into unattended runs.
