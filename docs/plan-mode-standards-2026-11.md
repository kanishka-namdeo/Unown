# Plan-Mode × TUI Standards Research (2026-11-10)

The 2026-11-10 combination round's grounding research — what "latest
standards" means for plan mode and TUI experience as of late 2026, so the
round's audit has an external yardstick instead of an internal echo. Sources
were opened and read during the round; every claim carries its source.

## A. Plan-mode standards checklist (the audit yardstick)

| # | Testable criterion | Implementing agents | Source |
|---|---|---|---|
| 1 | Plan mode is a first-class permission mode in a cycling order (default → acceptEdits → plan), toggled by one hotkey (Shift+Tab) | Claude Code | code.claude.com/docs/en/permission-modes.md |
| 2 | Mode chip always visible in the status bar while planning, and on exit/switch | Claude Code | same |
| 3 | Multiple entry paths: hotkey, slash command, CLI flag, persisted default | Claude Code, Gemini CLI | permission-modes.md; geminicli.com/docs/reference/commands |
| 4 | Read-only restriction enforced during planning (edits blocked; reads/grep/glob allowed) | Claude, Gemini ("Plan Mode (read-only)"), OpenCode (Plan agent) | permission-modes.md; opencode.ai/docs/agents |
| 5 | Shell during planning stays permission-gated (classifier or prompt), not blanket-allowed | Claude (`useAutoModeDuringPlan`), OpenCode | permission-modes.md; opencode.ai/docs/agents |
| 6 | Approval offers both execution granularities + continue-planning (Claude: "Yes, and use auto mode" / "Yes, manually approve edits" / "No, keep planning") | Claude Code | permission-modes.md#review-and-approve-a-plan |
| 7 | The plan is editable before execution (Claude: Ctrl+G → $EDITOR; this fork: the "Edit the plan" in-TUI dialog) | Claude Code | permission-modes.md |
| 8 | The plan renders as a todo/task list with progress indicators | Claude (task list), Gemini ("Plan tasks with todos"), OpenCode (plan files) | code.claude.com/docs/en/interactive-mode.md; geminicli.com commands |
| 9 | Approving a plan switches the session's permission mode (plan → acceptEdits/default), not just resumes | Claude Code | permission-modes.md |
| 10 | A separate model for planning is supported (Claude `opusplan`; Gemini "Plan Mode with model steering") | Claude, Gemini | permission-modes.md; geminicli.com commands |
| 11 | Plan artifacts persist beyond the dialog (session auto-titled from the plan; plan copyable) | Claude, Gemini, OpenCode | permission-modes.md; geminicli.com commands |
| 12 | Plan mode reachable headlessly/programmatically (`claude -p --permission-mode plan`, SDK `permissionMode`) | Claude Code | permission-modes.md |
| 13 | Plan mode can be disabled/config-pinned (OpenCode `agents.plan.disabled`; Claude `defaultMode`) | OpenCode, Claude | opencode.ai/docs/agents; permission-modes.md |
| 14 | Agents without plan mode compensate via approvals × sandbox granularity (Codex: AskForApproval × read-only/workspace-write/danger-full-access) | Codex, Amp | github.com/openai/codex; ampcode.com/manual |

2025–2026 shifts worth auditing against: Claude Code's default starting mode
became **auto** (classifier-approved, v2.1.283 era) with an adaptive first
plan-approval option; Gemini CLI shipped a read-only Plan Mode with todos and
model steering; OpenCode ships a built-in Plan agent; upstream pi (v1.5.1,
Nov 2026) still ships **no plan mode** — this fork's plan mode is fully
custom divergence, so the fork owns its standards floor.

## B. TUI standards checklist (late-2026 baseline)

| # | Criterion | Source |
|---|---|---|
| 1 | `NO_COLOR` honored (any non-empty value disables color) | no-color.org |
| 2 | Capability ladder truecolor → 256 → 16 → plain; silent degrade on `TERM=dumb` | no-color.org; learn.microsoft.com/windows/console/console-virtual-terminal-sequences |
| 3 | Kitty keyboard protocol via progressive-enhancement flags | sw.kovidgoyal.net/kitty/keyboard-protocol/ |
| 4 | Legacy-key fallback mandatory (never require extended keys) | kitty protocol; code.claude.com interactive-mode.md |
| 5 | Synchronized output `CSI ? 2026 h/l` wrapping full repaints | MS VT sequences (now official) |
| 6 | OSC 8 hyperlinks for file/URL rendering | iterm2.com/documentation-escape-codes.html |
| 7 | OSC 9 notifications (and 9;4 progress) for async completion/approvals | same |
| 8 | Alt-screen via DECSET 1049 with clean restore on exit/crash | MS VT sequences |
| 9 | SGR mouse mode 1006 (+1000/1002 variants) | MS VT sequences |
| 10 | Bracketed paste (DECSET 2004) against paste injection | MS VT sequences |
| 11 | Focus reporting (DECSET 1004) for recap/notification behavior | MS VT sequences |
| 12 | Clipboard write via OSC 52 where supported | iterm2 escape codes |
| 13 | Capability negotiation with timeouts — never block on a missing reply | kitty protocol |
| 14 | Accessibility: a screen-reader / non-alt-screen escape hatch | textual.textualize.io/help/screen-reader/ |

## C. Where this fork already stands (pre-audit map)

Standards A1–A13 map to shipped unown surfaces (Shift+Tab cycle, PLAN chip,
`--plan`/`--plan` boot/`/plan`/Ctrl+Alt+P/ACP setMode, read-only toolset with
`isSafeCommand` bash gate, the 4-option approval gate, the in-TUI plan
editor, todo⇄plan unification, mode switch on approval, `--plan-model`
split, plan files under `.unown/plans/`, `-p --plan` print lane, the V3 kill
switch). A14 is N/A (this fork IS the plan-mode agent). TUI B1–B5, B8–B10 are
shipped (truecolor/256/plain ladder, kitty parsing, sync output, mouse,
alt-screen, bracketed paste). The audit focuses on B6/B7/B11/B13/B14 as
candidate gaps and on the combination matrix of A × B.

## D. Sources opened

1. https://code.claude.com/docs/llms.txt
2. https://code.claude.com/docs/en/permission-modes.md
3. https://code.claude.com/docs/en/interactive-mode.md
4. https://code.claude.com/docs/en/common-workflows.md
5. https://raw.githubusercontent.com/openai/codex/main/README.md
6. https://raw.githubusercontent.com/openai/codex/main/codex-rs/cli/src/main.rs
7. https://raw.githubusercontent.com/google-gemini/gemini-cli/main/README.md
8. https://www.geminicli.com/docs/reference/commands
9. https://opencode.ai/docs/llms.txt (permissions/agents/commands)
10. https://ampcode.com/manual
11. https://no-color.org/
12. https://sw.kovidgoyal.net/kitty/keyboard-protocol/
13. https://learn.microsoft.com/en-us/windows/console/console-virtual-terminal-sequences
14. https://iterm2.com/documentation-escape-codes.html
15. https://raw.githubusercontent.com/badlogic/pi-mono/main/README.md
16. https://github.com/badlogic/pi-mono/releases.atom
