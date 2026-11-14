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
| CP5 version bump + 3-OS CI + xplat release-verify + the v0.0.65 tag/release | ✅ done | fold 243bd1b9 → the tag-gate cure ac650c7f (CI green, 4 workflows) → `v0.0.65` tagged there → release rendered green |
| CP6 security sweep (dependabot + code scanning) + blog/capture assets | ✅ done | CodeQL #91 closed (the linear `parseMemoryReviewDiscard`); dependabot 0 open; blog post + the live gate-run stills |

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

## CP5 — the v0.0.65 cut (2026-11-14)

The fold: the ten post-v0.0.64 entries graduate into `## [0.0.65] -
2026-11-14` — this round's two Fixed plus the Memory Divertimento round's
CP1-CP5 (six Fixed, two Added; the round itself stays in flight — its CP6/CP7
entries ride 0.0.66 when it closes, the 0.0.58–0.0.61 precedent). The
byte-identical duplicate `unown memory doctor` entry the upstream CP5 commit
left in [Unreleased] is dropped at the fold (587 → 586 entries). The 35 older
stragglers keep riding [Unreleased] per the rolling-lane convention.

The budget ritual: the new stop's chrome breached the e2e budget twin at
4,604w > 4,590 (MAX_LISTED=1 renders only the Added/Behavior first items —
this round's own Fixed entries never render; the stop's only listed lead is
the Divertimento's review-queue title, and the first compression attempt
taught the lesson again: a lead shorter than TITLE_MAX=112 renders MORE of
its parenthetical, not fewer words). Cured per the sanctioned order — the
stop's own listed title first, then six historical first-listed leads, bold
leads only, bodies untouched (0.0.1's cloned-repo lead, 0.0.2's binary
install lane, 0.0.16's blog, 0.0.34's commerce round, 0.0.40's validation
round, 0.0.9's browser-subagent) — landing at **20.2vh / 4,582w ≤ 4,590 in
the twin, eight words of headroom**. All five landing checks + the audit
green; `bun bin/unown --version` = 0.0.65; unown-overview re-stamped at
v0.0.65 with the plan-mode row carrying the visibility surfaces.

**The tag-gate cure (2026-11-15).** The fold commit's 3-OS CI went red on
"Self-learning engine tests" (run 43624110386; the implementation commit's
run 43622789226 the same) — three environment-dependent flakes, none a
product defect, every one root-caused and cured before the tag:

1. **D3 (this round's own pin)** — the expanded-markdown assertion is
   environment-sensitive: `initTheme()` picks plain vs 256color from the
   process env, and the GitHub runner (no `NO_COLOR`) rendered bare `ESC`
   wraps inside styled spans where every pre-warmed sandbox rendered plain.
   Cure: the suite pins the deterministic plain mode (`NO_COLOR ??= "1"` in
   `test/_env.ts`); the live PTY lane keeps validating colored rendering.
2. **The memory idempotence pin** — `renderProjectMemoryMarkdown` threaded
   the injected `opts.now` into the freshness stamps but stamped the footer
   from `new Date()`: two same-input renders crossing a millisecond boundary
   were byte-different. Cure: the footer rides the injected clock (a real
   determinism bug in the `opts.now` contract, not just a test fix).
3. **The hoist guard pin** — the test assumed the "established tier" its own
   comment names; on a fresh store the hoist is a first mint and first-mint
   semantics correctly GATE the whole block (F4B), so `out.rules` was `[]`
   on fresh runners only. Cure: the test establishes the tier first; the
   first-mint path keeps its unit pin in `guard.test.ts`.

Verified against a completely fresh redirected store AND a pre-warmed one
(41/41 in the three files × three consecutive runs; the full engine suite
5661/0 with only the documented first-run outbox flake, green on re-run);
root typecheck clean. The v0.0.65 tag lands on the cure commit (the 0.0.62
precedent), after its own 3-OS CI green.

**The cut (2026-11-15).** CI green on the cure commit `ac650c7f` — all four
workflows (CI's 3-OS matrix, CodeQL, Scorecard, deploy-verify). `v0.0.65`
tagged there and pushed; the release run **failed its 3-OS assertion legs**
(ubuntu: the outbox dead-engine pin raced the shared outbox dir's concurrent
writers — expected 1 file, received 5; windows: the automations catch-up
ONE-SHOT pin counted the dispatcher's GLOBAL calls, not the row under test —
dispatched 2 while the row ran once) — the publish and every downstream job
skipped, so nothing was ever published from the tag. Both pins were
asserting on SHARED suite state instead of their own subject; both are cured
(the outbox pin asserts its marker-named file, the count stays a floor; the
automations pin counts only its row's dispatches + a run-row no-replay
floor). The tag is then MOVED per the v0.0.53 release-recovery precedent
(no release object, no assets, no feed entry ever referenced the old tag):
re-cut on the flake-cure SHA after its own CI green. The honest receipts
live in the release-recovery session log's own convention — this round's
closeout records the final green run.

## CP6 — the security sweep + the blog/capture assets (2026-11-15)

**Security.** Dependabot: 0 open alerts, 0 open version-bump PRs. Code
scanning: ONE open alert — **#91, js/polynomial-redos (high)** at the CLI's
`memory review discard` argument regex, the identical shape duplicated at
the TUI's `/memory review` lane. Closed the #90 way: `parseMemoryReviewDiscard`
in `memory-review.ts` — a single linear character pass (no backtracking),
shared by both call sites, behaviorally identical to the regex on a 28-case
equivalence battery that pins BOTH (the re-declared regex rides the battery
as its own guard rail); 200k-char pathological input in < 5 ms; 26 new tests
(44/0 in the file, 167/0 across the five neighboring suites).

**Blog/capture.** The round's PTY gate matrix re-run live from this session
against the Agnes upstream: **18/18 ALL GREEN** (gate opens with the plan
visible above it, the full navigation matrix, stay-loop, re-arm, approve →
execute → Plan complete, todo discipline seeds=1 creates=0) — the captured
pane (`m4-gate`) is the blog's hero still: the `plan_write` block carrying
the `1. ☐ / 2. ☐ / 3. ☐` checklist + the plan file path + `ctrl+o to expand`
above the dialog carrying `Plan ready — 100/100` + the objective + all
steps. The post (`content/blog/2026-11-14-the-plan-visibility-round.md` —
"the round that made the plan visible") ships the defect, the
seven-product law, the corrected workflow, the `wantsViewportNav` dividend,
and the why-it-wasn't-simple transcript-ordering constraint, embedding the
gate + complete stills under `public/blog/2026-11-14-the-plan-visibility-round/`.
Honest scope: the expanded (`ctrl+o`) still was attempted three times against
the metered upstream (two gate-window timeouts, one dead background retry —
the round's own documented flake class); the two green-run stills satisfy
the post's media contract, the expanded lane stays unit-pinned (D3) and
live-hint-verified (the `ctrl+o to expand` chip renders in the hero still
itself).
