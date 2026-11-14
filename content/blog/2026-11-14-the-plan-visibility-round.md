---
title: The round that made the plan visible
description: Unown scored the plan, saved it, gated it — and never showed it. Seven competitors later, the plan renders at every moment it matters.
date: 2026-11-14
lastmod: 2026-11-14
tags: [planning, tui, release]
type: feature
media: [/blog/2026-11-14-the-plan-visibility-round/the-plan-finally-visible.png, /blog/2026-11-14-the-plan-visibility-round/plan-complete.png]
---

The report was one sentence: **user cannot see plan mode's created plan by
default.** It was entirely true, and it was worse than it sounded.

After a planning pass, the plan's full content existed in exactly three
places — the `.unown/plans/<slug>.md` file on disk, the `plan_write` tool
result, the `exit_plan_mode` tool result. The TUI rendered **none of them**.
`plan_write`'s renderer printed one line (`✳ Plan scores 85/100 …`) and threw
the objective, the steps, the risks, and the verification on the floor.
`exit_plan_mode`'s showed the first 90 characters of the first line. Both
ignored the `expanded` render option, so `Ctrl+O` was a functional no-op. And
the approval dialog — the moment the user is asked to *commit* to a plan —
was a score summary plus four options. You were approving a plan you had
never been shown. The only glimpse of the plan's body came from picking
"Edit the plan", the option for people who already know what they want to
change.

![The plan, finally visible — the plan_write checklist above, the approval dialog carrying the objective and steps below](/blog/2026-11-14-the-plan-visibility-round/the-plan-finally-visible.png)

## What the field does

Before touching code, the round asked what everyone else does. Seven
products, every claim sourced to their docs or their source: **Claude Code**
presents the plan in the conversation and asks how to proceed; **Cursor**
auto-opens the plan as a virtual file you can read and edit; **Cline**'s
chat *is* the plan; **Copilot** shows a Review Plan card with "Open Full
Plan"; **Codex** renders a `ProposedPlanCell` — the full plan markdown,
streamed live into the transcript — then asks "Implement this plan?";
**Aider** prints everything to the stream; **Gemini CLI** writes the plan as
a Markdown file *and* presents it in chat for formal approval.

The law is unanimous across all seven: **the plan is shown, in full, at the
moment it is ready — never hidden by default.** Progressive disclosure
(compact checklists, preview caps) is applied only *after* first
presentation. Nobody requires an opt-in to *see* the plan. Unown scored it,
saved it, gated it — and hid it.

## The corrected workflow

The fix ships as a pure display module (`plan-display.ts`) plus a shared
renderer, wired into every moment the plan matters:

- **When the model writes the plan** — the `plan_write` block now renders the
  objective, the score, and the step checklist (`1. ☐ …`), capped for narrow
  terminals with an honest `⋯ N more steps` tail. `Ctrl+O` expands it to the
  full markdown.
- **When the approval dialog opens** — the title carries the plan itself
  (objective + first steps under the unchanged `Plan ready — <score>`
  headline), with the four options byte-identical to what the keyboard round
  pinned. `Ctrl+O` passes through the open dialog and expands the transcript
  block behind it.
- **When the plan is approved or rejected** — the result block renders the
  approval line plus the step checklist, or the rejection plus your
  feedback, expandable to the full markdown. Legacy transcripts without the
  new payloads recover the plan from the result text markers — a resumed
  session never loses its approved plan.

The expand hint renders through the live keybinding machinery
(`keyText("app.tools.expand")`), so a user who rebinds it sees *their* key,
and macOS renders `option+O` — never a hardcoded string.

## The verification's own dividend

The first live gate run failed — and the failure was a real bug nobody had
filed: `Home`, `End`, `PageUp`, `PageDown`, `k` and `j` did nothing inside
the docked approval dialog. The fullscreen viewport's scroll bindings
consumed them before the focused component ever saw input. The fix is the
opt-in `wantsViewportNav` component contract — the selector, input and
editor dialogs declare that they want viewport navigation, and the
fullscreen layer defers. The usage docs' `Home`/`End` promise is now
actually true in the live TUI.

The final verification drove the corrected workflow end to end on a real
terminal against the live model: **the PTY matrix 18/18 green** — the gate
opens with the plan visible above it, the full navigation matrix works, the
stay-loop holds, approve executes to `Plan complete`, todo discipline
intact. The captured pane above is that run.

![Plan complete — the approved plan executed](/blog/2026-11-14-the-plan-visibility-round/plan-complete.png)

## Why it wasn't simple

The obvious fix — echo the plan into the transcript when the dialog opens —
doesn't work: `sendCustomMessage` during a tool's execution is deferred to
end-of-turn, because providers that validate message order reject a message
wedged between a tool call and its result. The visibility has to live in
the `plan_write` block (which renders the turn *before* `exit_plan_mode`
fires), the dialog itself, and the result block. That's where it now lives.

The round also left the lane pinned: ten display pins in the new
`plan-mode-display.test.ts` (the display lane was previously unpinned — the
defect's accomplice), plus the pure builders' contracts. And the release
cut itself surfaced three environment-dependent test flakes on the CI
runners that every pre-warmed sandbox had been quietly passing — each
root-caused and cured, with the freshest lesson being that a test
asserting on themed output must pin the theme mode, not inherit whatever
the runner's environment happens to say.

The plan was always there. Now you can see it. That's the whole fix — and
it took a seven-product teardown, a pure display module, a viewport
navigation contract, ten pins, and an 18/18 live matrix to make it true at
every moment it matters.
