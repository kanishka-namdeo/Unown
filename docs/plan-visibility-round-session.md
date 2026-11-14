# The Plan Visibility round — the plan the user can finally see (2026-11-14, IN FLIGHT)

**Mission:** the reported defect, verbatim: *"user cannot see plan mode's
created plan by default."* Understand how the field's coding agents present a
plan created in plan mode, then implement the corrected end-to-end workflow —
the plan visible at every moment it matters, production-grade, cross-platform,
pinned by tests and the PTY lane.

The name: the round that closes the gap between a plan the model writes and a
plan the *user reads*. Every competitor ships the plan to the user's eyes;
Unown scored it, saved it, gated it — and hid it.

## The field's consensus (CP0 research, every claim sourced)

Seven products surveyed (the full table lives in this file's §Research):
**Claude Code** (plan presented in the conversation + `ExitPlanMode` approval
prompt + `Ctrl+G` external editor), **Cursor** (the plan auto-opens as a
virtual file you can read and edit), **Cline** (the chat IS the plan; Plan→Act
toggle), **GitHub Copilot** (Review Plan card + "Open Full Plan" in the
Markdown editor), **OpenAI Codex CLI** (the `ProposedPlanCell`: bold `•
Proposed Plan` header + the FULL plan markdown in the transcript, streamed
live, then the "Implement this plan?" popup), **Aider** (everything prints to
the chat stream), **Gemini CLI** (the plan written as a Markdown file AND
presented in chat for formal approval).

The law, unanimous across all seven: **the plan is shown, in full, at the
moment it is ready — never hidden by default.** Progressive disclosure
(compact checklist + expand key) is applied only *after* first presentation:
Codex caps its `update_plan` checklist at 3 preview lines with a disclosure
key, Claude Code's task list shows 5 with `Ctrl+T` — but the *proposed* plan
itself always renders. Nobody requires an opt-in to *see* the plan.

## The defect, root-caused (CP0 code map)

The plan's content exists in exactly three places after creation — the file
`.unown/plans/<slug>.md`, the `plan_write` tool result, and the
`exit_plan_mode` tool result — and the TUI rendered **none of them**:

1. **`plan_write` `renderResult`** (tools.ts:2914-2919) shows one line — `✳
   Plan scores 85/100 …` — the entire plan (objective, steps, files, risks,
   verification) is invisible. The `_o` options arg (the `{ expanded }`
   payload) is received and ignored.
2. **`exit_plan_mode` `renderResult`** (tools.ts:3050-3055) shows the first
   line of the result hard-capped at **90 characters** — the `## Approved
   Plan` full markdown assembled at tools.ts:3012 is discarded on the floor.
   `expanded` ignored → **`Ctrl+O` (app.tools.expand) is a functional no-op
   for both plan tools.**
3. **The approval dialog** (`runPlanApprovalDialog`, tools.ts:2645-2646) is a
   bare `ctx.ui.select` — title `Plan ready — 85/100 — 6 steps · …` + four
   options. No objective, no steps, no plan text: the user is asked to
   approve a plan whose content they have not been shown. (The only plan
   glimpse is picking "Edit the plan", which opens the in-TUI editor.)
4. Because both tools define `renderResult`, the generic 10-line fallback
   preview with its `⋯ N earlier hidden · ctrl+o` chip (tool-execution.ts:
   156-177) never applies — there was not even a *hint* that more content
   exists.

Corroborating history: the fallback gate (the model never calling
`exit_plan_mode`) DOES show the approved plan — the `unown-plan-echo`
`display:true` message (tools.ts:7025-7034) — while the *standard* path shows
nothing. The standard path was the untested lane: no test anywhere pinned
what the plan renderers display.

Why the transcript echo could not simply be bolted onto the standard path:
`sendCustomMessage` during a tool's execute is **deferred to end-of-turn**
(agent-session.ts:1517-1522 — "appending now would put the message between an
assistant tool call and its result, which providers that validate message
order reject on replay"). The plan therefore cannot be injected into the
transcript *while* the approval dialog is open; the visibility has to live in
(1) the `plan_write` block (which renders the turn BEFORE `exit_plan_mode`
fires), (2) the dialog itself, and (3) the `exit_plan_mode` result block.

## The corrected workflow (the design)

| Moment | Before | After |
|---|---|---|
| Model writes the plan (`plan_write`) | one score line | **the plan renders**: objective + steps + score, compact by default, `Ctrl+O` expands to the full markdown (the `read` tool's affordance pattern, dynamic keybinding text) |
| Approval dialog opens | title + 4 options | title + 4 options **+ a capped plan preview in the dialog title** (objective + first steps + `⋯ N more`); the transcript above still shows the `plan_write` block; `Ctrl+O` passes through the open dialog and expands it to the full markdown |
| Plan approved (`exit_plan_mode` result) | first 90 chars of the first line | **the approved plan renders**: approval line + the step checklist (`n. ☐ …`, the fallback-echo glyph), expandable to the full markdown |
| Plan rejected | first 90 chars | rejection line + the user's feedback, expandable to the rejected plan |
| `plan_retrospective` | first 90 chars | outcome + learnings/improvements compact, expandable |
| Fallback gate (no `exit_plan_mode`) | already visible (the echo) | unchanged + the enriched dialog |

Cross-platform: the expand hint renders through `keyText("app.tools.expand")`
— the live keybinding machinery (user rebinds honored, `option` vs `alt`
rendering on macOS, the Windows keybinding variant), never a hardcoded
"ctrl+o". The preview caps keep the dialog inside the narrow-terminal budget
(the 60x20 matrix lane): steps are truncated, the title capped, options and
keyboard contract byte-identical (the keyboard round's stable constants —
`GATE_OPTS` routing and the PTY anchors stay intact).

## Phase ledger

| Phase | Status | Artifact |
|---|---|---|
| CP0 research + code map + baseline bring-up | ✅ done | this file + the verified baseline below |
| CP1 the display lane — `plan-display.ts` pure module, the three renderers honor `expanded`, `details` payloads, the dialog preview | ✅ done | `src/plan-display.ts` + the tools.ts lanes |
| CP2 pinned tests — `test/plan-mode-display.test.ts` (the unpinned lane gets its pins) | ✅ done | 10 pins, D1-D9 + the pure builders, 117/117 across the eight plan suites |
| CP2b the vendored nav fix — `wantsViewportNav` (found by CP3's live verification) | ✅ done | tui.ts + tui-alt-screen.ts + the three dialogs + 2 tui tests |
| CP3 the PTY matrix lane — live verification of the new surfaces on a real TUI | ✅ done | gate 18/18, options-a 5/5, options-b 3/3, options-c 5/5, budget 6/6, deterministic phases green |
| CP4 docs/DOX/CHANGELOG/README/overview + landing gates | ✅ done | usage.md items 4/5/6, self-learning AGENTS.md, root AGENTS.md, docs/AGENTS.md, README, CHANGELOG (2 Fixed) |
| CP5 version bump + 3-OS CI + xplat release-verify + the v0.0.65 tag/release | ☐ | |
| CP6 security sweep (dependabot + code scanning) + blog/capture assets | ☐ | |

## CP0 — the baseline (2026-11-14, pristine tree ba2b6aaa)

Fresh bring-up on the untouched tree (bun 1.4.4 — the 1.3 line cannot parse
`pi-repo/bun.lock` lockfileVersion 3; installed via npm global, the frozen
`bun install --frozen-lockfile` restored the reviewed lockfile after a stray
`bun install` drifted it — reverted, lesson recorded): `hydrate:model-data`
(model data was absent from the checkout, `check:model-data` failed closed
until hydrated), `build:offline` **52 files / 8.5 MiB** (matches the
divertimento baseline exactly), root `typecheck` clean, the seven plan-mode
test files **107/107**, the full engine suite **5598 pass / 0 fail / 105
skip** (one flaky failure on first run — reproduced green on re-run, the
known [count-once convention](https://bun.sh/docs/test/cli) applies), the
Agnes AI upstream probed live (`GET /v1/models` lists `agnes-3.0-flash`,
`agnes-2.5-pro-alpha`, … — the `.env` injected, gitignored as the contract
requires).

## Research — the seven-product table (CP0)

| Product | Trigger | Plan rendered where | Default visibility | Approval flow | After approval |
|---|---|---|---|---|---|
| Claude Code | Shift+Tab cycle / `/plan` | the conversation (markdown) + VS Code auto-opens the plan doc | visible by default | Yes+auto / Yes+manual / No-keep-planning; `Ctrl+G` edits in $EDITOR; Shift+Tab approves | exits to chosen mode, session titled from the plan |
| Cursor | Shift+Tab (chat) | virtual file, auto-opened, editable | visible by default | "Build" button | agent builds; plans saved as files |
| Cline | Plan/Act toggle | the chat stream | visible by default (chat IS the plan) | the toggle itself | Act mode carries context; checkpoints |
| GitHub Copilot | `/plan` + Plan agent | Review Plan card + full plan in the Markdown editor | visible by default | Implement / Approve-only / Autopilot / Reject; inline comments | implementation starts / plan attachable |
| OpenAI Codex CLI | Shift+Tab / `/plan` | `ProposedPlanCell` in the transcript — full markdown, streamed live | visible by default | "Implement this plan?" popup: yes / yes+fresh-context / no | mode switch + "Implement the plan." submitted |
| Aider | `/ask` `/architect` | the terminal chat stream | visible by default | informal ("go ahead") | edits + auto-commit |
| Gemini CLI | Shift+Tab / `/plan` | chat presentation + plan file in the plans dir | visible by default | Yes auto / Yes manual / Esc; `Ctrl+X` external editor | mode switch, model routing, plan file kept |

Sources (opened and read, not search-snippet-quoted):
code.claude.com/docs/en/permission-modes, /interactive-mode, /vs-code,
/tools-reference, /terminal-config, /agent-sdk/todo-tracking; cursor.com/docs/
agent/plan-mode + /help/ai-features/plan-mode; docs.cline.bot/core-workflows/
plan-and-act + /usage/ide + /usage/cli-overview; code.visualstudio.com/docs/
agents/run/planning + /agent-customization/custom-agents; github.com/openai/
codex (codex-rs: protocol/src/plan_tool.rs, tui/src/history_cell/plans.rs,
tui/src/chatwidget/plan_implementation.rs, tui/src/keymap.rs — read at the
source level); aider.chat/docs/usage/modes.html + /repomap.html; github.com/
google-gemini/gemini-cli docs/cli/plan-mode.md + docs/tools/planning.md;
anthropic.com/engineering/building-effective-agents ("Prioritize transparency
by explicitly showing the agent's planning steps").

## CP1-CP4 — the implementation and its verification (2026-11-14)

**CP1 the display lane.** `src/plan-display.ts` (pure, plan.ts-style): the
`PlanResultDetails` payload, the compact line builders for the
written/approved/rejected/retrospective lanes, `planDialogPreviewTitle`, the
caps (`PLAN_PREVIEW_STEPS_COLLAPSED`=3, `PLAN_DIALOG_PREVIEW_STEPS`=4,
`PLAN_STEP_TRUNCATE`=68, `PLAN_DIALOG_STEP_TRUNCATE`=56,
`PLAN_DIALOG_OBJECTIVE_TRUNCATE`=56) and `planExpandHintSuffix`. tools.ts: the
shared `renderPlanResultBlock` (compact by default, full `Markdown` on
`expanded` via `getMarkdownTheme()`, the hint through
`keyText("app.tools.expand")`, legacy marker recovery for pre-round
transcripts); `details` payloads on all three tools' results; the dialog
title through `planDialogPreviewTitle` (first line byte-stable). 161
insertions / 14 deletions in tools.ts — the surgical-diff discipline held
(a stray `biome --write` had reformatted the whole file to the vendored tab
config; reverted and re-applied in the package's native 8-space style — the
committed self-learning tree does not follow pi-repo's biome format, the
keyboard round's "native style, minimal diff" principle re-learned).

**CP2 the pins.** `test/plan-mode-display.test.ts`: D1 the details payload +
compact render, D2 the caps + the honest no-hint degradation (the
bun-test process cannot reach the coding-agent keybinding instance — the
live pairing is pinned by the PTY lane), D3 the full markdown expanded, D4
the approved checklist (`n. ☐` glyphs), D5 the rejected feedback, D6 the
stayed single line, D7 the dialog title contract (byte-identical options),
D8 the legacy marker recovery, D9 the retrospective render, plus the pure
builders. 117/117 across the eight plan suites; the full engine suite
5713/0 (one known flaky first-run failure, green on re-run, same as the
pristine baseline); root typecheck clean.

**CP2b the vendored nav fix — the verification's own dividend.** The first
live gate run failed Home/End/PageUp/PageDown/k/j: the fullscreen
viewport's scroll bindings (`tui.altScreen.top/bottom/pageUp/pageDown` =
home/end/pageUp/pageDown) consume input before the focused component, and
the existing defer only covers overlays — the extension dialogs are docked
in the editor container. A probe isolated it (arrows/k/j worked, the CSI
nav keys did nothing, selection state consistent with a steal); a stash
experiment could not acquit the baseline (the metered upstream refused to
converge a planning pass twice — the flake class, not evidence). Fix: the
opt-in `wantsViewportNav` component contract (`tui.ts`), the defer extended
(`tui-alt-screen.ts`), the selector/input/editor dialogs declare it. Pinned
by two new tui tests (47/0 in `tui-alt-screen.test.ts`); the main editor is
deliberately untouched (its pageUp/pageDown scrolling is the documented
fullscreen behavior — the main editor's home/end shadowing recorded here as
an observed adjacent upstream decision, not changed).

**CP3 the PTY lane (the real-user verification, live Agnes upstream).** The
metered upstream made gate-opening a dice roll (three runs never converged
a V3 pass within the window — two of them on the PRISTINE tree, the flake
class recorded). The green runs: **gate 18/18** (gate opens, 4 options,
initial selection, the FULL navigation matrix Down/Up/Home/End/PageUp/
PageDown/k/j — all green after the fix, stay-loop, re-arm, approve →
execute → Plan complete, todo discipline seeds=1 creates=0), **options-a
5/5** (digit-5 inert, editor round + re-score, the 6-round cap),
**options-b 3/3** (Ctrl+C stay, feedback → revise → re-offer), **options-c
5/5** (approve-each-edit: permission mode, per-edit ask census, Plan
complete, todo discipline), **budget 6/6**, deterministic p1/boot/diag/v2/
narrow green (one flaky cold-boot on the first p1, green on re-run). The
captured pane (m4-gate) shows the corrected workflow end to end: the
plan_write block with `1. ☐ … / 2. ☐ … / ⋯ 1 more step / <file> · ctrl+o
to expand` above the dialog, and the dialog carrying `Plan ready — 93/100 —
4 steps …` + the objective + all four steps + the four options. The
plan-model phase is green 5/5 on its default flash sibling (gate on the
sibling, approve → execute → Plan complete, 4/17 planning turns on the
sibling, footer, diagnostics, the unknown-model warning); the heavier
pro-alpha sibling did not converge a planning pass inside two 9-minute
windows — the metered-upstream flake class, recorded, with the 2026-11-10
round's receipts standing for that configuration; the matrix script's
mislabeled except branch (a slow execution reported as a failed re-arm) is
fixed in the same change.

**CP4 docs/DOX.** usage.md items 4/5/6 + the keyboard sentence (the doc's
Home/End promise is now true in the live TUI); self-learning AGENTS.md
gains the display-lane contract; root AGENTS.md gains the round sentence;
docs/AGENTS.md indexes this log; README's plan paragraph gains the
visible-at-every-moment sentence; CHANGELOG gains the two Fixed entries.
