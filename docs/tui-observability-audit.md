# The TUI observability audit

> The verdict up front: **Unown's observability machinery is strong and its
> observability narrative is weak.** Auditing every screen, command and
> workflow against the seven questions (objective, current task, progress,
> blockers, risks, confidence, next action), the machinery scores —
> checkpoints, receipts, meters, state machines, an 11-screen dashboard —
> but the answers are scattered across surfaces the user must already know
> exist. Twenty-one ambiguity flags fall out of the audit, each mapped to
> the round's feature ledger; the benchmark tasks in §4 turn the worst of
> them into regression tests the dogfood phase must run.

- [Method](#method)
- [The seven questions](#the-seven-questions)
- [Audit A — the main session view](#audit-a--the-main-session-view)
- [Audit B — the footer and status chrome](#audit-b--the-footer-and-status-chrome)
- [Audit C — the widgets above the editor](#audit-c--the-widgets-above-the-editor)
- [Audit D — the dashboard's eleven screens](#audit-d--the-dashboards-eleven-screens)
- [Audit E — the five workflows](#audit-e--the-five-workflows)
- [The ambiguity ledger](#the-ambiguity-ledger)
- [Benchmark tasks](#benchmark-tasks)
- [The information architecture](#the-information-architecture)


Related pages: [the observability round session record](observability-round-session.md) · [the competitor research](observability-competitor-research.md) · [the user journeys](observability-user-journeys.md) · [the dashboard plan](tui-dashboard-plan.md) · [the split view](split-view.md)

## Method

Every screen, command and workflow of the interactive TUI as shipped at
`cbbbeb37` (v0.0.44) was inventoried file-by-file — the pi interactive mode
(`pi-repo/packages/coding-agent/src/modes/interactive/`), Unown's extension
layer (`pi-repo/packages/self-learning/src/`), and the dashboard
(`.../src/dashboard/`) — then each surface was audited against the seven
questions the mission fixes: can a user immediately identify (1) the current
objective, (2) the current task, (3) progress, (4) blockers, (5) risks,
(6) the confidence level, and (7) the next action? The audit judges
**shipped behavior**, reading each surface's render code, not its intention.
Flags are lettered A1, A2 … by audit section and carry the fix target in the
round's feature ledger. The full surface inventory (every command, key,
widget, screen with its file) is preserved in §[A–D] tables' source column —
this page is the judgment, not the catalog.

## The seven questions

The audit's rubric. A surface "answers" a question only if the answer is
visible **without the user running another command** — ambient, on-screen,
in the default layout. Anything behind a command counts as half an answer
(discoverable but not ambient); anything behind a flag or a second surface
counts as absent for this audit's purposes.

## Audit A — the main session view

The main layout: header → widgets-above-editor → transcript → editor →
status-indicator slot → footer (`interactive-mode.ts` 1020–1099).

| Question | Verdict | Evidence |
|---|---|---|
| Objective | **absent** | nothing on the default screen states what this session is for; the session has a name (auto-title, `/name`) but it is shown in the footer's cwd line, not as a mission |
| Current task | **half** | the verb-first spinner ("Editing auth.ts…") names the tool's subject, not the task's step; todos and plan give real answers only when the agent maintains them |
| Progress | **half** | `plan 3/7` + checklist widget in plan mode; todo panel when used; zero signal on ordinary turns |
| Blockers | **half** | permission asks, ask_user_question and fleet "waiting for your answer" park visibly; but a failed tool, a denied hook or a 429 surfaces as a transient line in the transcript, then scrolls |
| Risks | **absent** | no surface composes "the working tree is dirty + 2 verifies failed + engine down" into a risk statement |
| Confidence | **absent** | no confidence signal exists anywhere in-session |
| Next action | **half** | the hint line shows keys when idle (`? help · ctrl+k palette…`), but no workflow ever says "the next thing to do about your task is X" |

Flags: **A1** objective absent → mission panel; **A2** ordinary turns lack
progress → progress tracker; **A3** failure context scrolls away → recovery
surface; **A4** no composed risk statement → mission panel risk line;
**A5** no confidence → confidence scoring.

## Audit B — the footer and status chrome

The pi footer (cwd/branch line, context meter, diff chip, tokens, cost,
model) + the extension status line (engine memory states, mcp, turn meter,
fleet, advisor, model pill, update chip, plan, goal, review, lsp) +
status-indicator spinner states (`footer.ts`, `status-indicator.ts`,
`engine-status.ts`, `turn-meter.ts`).

| Question | Verdict | Evidence |
|---|---|---|
| Objective | **half** | `goal: active` names the mode, not the objective; the text lives in `/goal status` |
| Current task | **strong** | turn meter + verb spinner + memory-bar activity ladder (job + minutes) are the field's best ambient row |
| Progress | **half** | `plan 2/5` only in plan mode; no derived step count otherwise |
| Blockers | **strong** | engine states (`down · N queued`, `blocked · port`), retry indicator with countdown, update chip — each names its condition and fix |
| Risks | **half** | context meter colors past 70%/90% amber/red — the one live risk signal; cost can drop at narrow widths (ordered-drop drops cost first) |
| Confidence | **absent** | — |
| Next action | **half** | `no model connected · /setup` and `paused · /engine` are exemplary command-shaped next actions; most other states stop at naming the condition |

Flags: **B1** goal footer shows state not objective → mission panel carries
the objective; **B2** cost chip degrades first → telemetry rollup into the
mission panel so cost survives narrow widths; **B3** no confidence chip →
confidence scoring.

## Audit C — the widgets above the editor

The widget budget (10 lines, `setExtensionWidget`): todo panel, plan-steps
checklist, fleet box, split-view files overlay (`addons/todo.ts`,
`tools.ts` 1728, `fleet.ts`, `splitview.ts`).

| Question | Verdict | Evidence |
|---|---|---|
| Objective | **absent** | — |
| Current task | **strong** | todo in_progress row, fleet per-child live tool ("running · browser navigate") — both excellent when present |
| Progress | **strong** | `● Todos (3/5)` header counts; plan checklist ticks; blockedBy chains shown |
| Blockers | **half** | fleet "stalled — steer or stop it" and todo `⛓ blockedBy` are visible, but 10-line budget competition means todo + plan + fleet can silently truncate exactly at peak complexity |
| Risks | **absent** | — |
| Confidence | **absent** | — |
| Next action | **half** | todo `⇥` hints; fleet widget names steer/stop only in the stall state |

Flags: **C1** widget budget competition → mission panel owns the first rows
and composes rather than competes; **C2** no mission widget → mission panel.

## Audit D — the dashboard's eleven screens

`unown dashboard` / `/dashboard`: Overview, Memory, Dreams, Notes, Skills,
Learning Lab, Hooks, Router, Gateway, Routines, Web Cache
(`dashboard/screens/*`).

| Question | Verdict | Evidence |
|---|---|---|
| Objective | **half** | Routines carry their own purpose lines; Overview shows learning-loop KPIs, but nothing states "the mission of this engine's learning" |
| Current task | **strong** | Router's busy job + Overview's live rail; Learning Lab renders RUNNING runs from the live registry with turns/tools/tokens/elapsed |
| Progress | **strong** | cumulative-pass sparkline, cycle timeline, per-version memory diffs, streak rows |
| Blockers | **strong** | failed-job banner with age/duration/error; engine-down banner with retry countdown; 429-class failures classified not flattened |
| Risks | **half** | canary-gated dreams show verdicts; quarantine shown; but there is no composed "current risk register" screen |
| Confidence | **absent** | pass rates everywhere, no confidence framing |
| Next action | **strong** | per-job trigger/toggle, dream-now, rollback keys, `:` palette — the dashboard is the best next-action surface in the product |

The dashboard's weakness is not content but **placement**: it is a separate
surface. A user in a session — the solo developer persona — will not have
it open when the question arises (flag **D1** → ambient learning feed).

Flags: **D2** recovery is scattered across Router (failed jobs), Hooks
(denies), Notes (outbox/dead-letters), Learning Lab (failed runs) → a
Recovery screen composes them; **D3** no confidence/health composite →
confidence scoring feeds the Overview.

## Audit E — the five workflows

**E-1 Starting a session** (fresh boot). Splash → header → empty editor (or
first-flights catalog). Answers: objective — the user's own prompt is the
mission, invisible as such; progress — n/a; next action — strong (flights,
tips, footer hints). Flag **E1**: the first prompt is never echoed back as
the mission it becomes.

**E-2 Mid-turn, agent working** (the "is it stuck?" moment). Spinner verb +
elapsed chip + tool boxes streaming + fleet widget. Answers: current task —
strong; progress — weak on ordinary turns (no steps, no %); blockers —
permission asks park visibly, 429 retry counts down. Flags **E2** ordinary
turns lack a progress signal; **E3** long tool runs inside one box show
partial output but the spinner label stays generic (no milestone, no
counter).

**E-3 Returning after ≥3 minutes idle** (the mission's primary metric).
Auto-recap line + `/recap`. Today's recap: turn count, tool calls, files
touched, last answer preview — activity shape. No objective, no decisions,
no remaining work, no cost rollup, no failure summary. Flags **E4** the
recap is activity-shaped → the mission brief; **E5** no idle-time awareness
("you were away 32m") in the brief.

**E-4 A failure happened** (tool failed / verify failed / hook denied /
engine down / note dead-lettered). Each failure names itself where it
happens; none of them aggregate. The transcript moves on; the footer memory
state covers engine; dead-letters need `/engine`. Flags **E6** no
failure-to-recovery mapping surfaced at failure time; **E7** denials leave
no ambient trace (a counter would answer "has my agent been blocked and is
that why it is 'done' so early").

**E-5 Long-running / unattended** (routines, watch, ralph, engine jobs).
The unattended contract is exemplary (envelopes, receipts, dead-letters,
verdict grammars, skip reasons). The session-side view of it — a human
returning to a terminal after a routine ran — routes through the dashboard
or `unown routines history`. Flags **E8** no in-session ambient signal of
overnight learning (dreams shipped, skills staged, improvements, cycle
verdicts) beyond the one-line dream toast; **E9** job verdicts do not
surface in-session.

## The ambiguity ledger

All flags, consolidated, each mapped to its fix:

| Flag | Ambiguity | Fix (round feature) |
|---|---|---|
| A1 | no objective on screen | mission panel (`/mission`, from goal when active) |
| A2 | ordinary turns lack progress | progress tracker (derived from todos/plan; spinner step context) |
| A3 | failure context scrolls away | recovery surface (`/recovery`) |
| A4 | no composed risk statement | mission panel risk line (dirty tree, failing verifies, engine down) |
| A5 | no confidence anywhere | confidence scoring (deterministic signals, turn-end chip) |
| B1 | goal shows state not objective | mission panel carries objective text |
| B2 | cost chip drops first at narrow widths | cost rollup in mission panel + brief |
| B3 | no confidence chip | confidence chip in footer |
| C1 | widget budget competition | mission panel composes; widgets keep their budgets |
| C2 | no mission widget | mission panel |
| D1 | learning behind the dashboard door | ambient learning feed + `/feed` |
| D2 | recovery scattered across 4 screens | dashboard Recovery screen |
| D3 | no health composite on Overview | confidence/health composite feeds Overview |
| E1 | first prompt never echoed as mission | mission panel auto-pins from first prompt (auto-title lane) |
| E2 | same as A2 | progress tracker |
| E3 | generic spinner on long tools | activity milestone (tool call counter in the spinner label) |
| E4 | recap is activity-shaped | mission brief recap |
| E5 | no idle-time awareness | brief states the away duration |
| E6 | no failure→recovery mapping at failure time | recovery rows with fix paths, linked at failure |
| E7 | denials leave no ambient trace | blocked-counter in recovery + footer health chip |
| E8 | no ambient overnight-learning signal | learning feed events |
| E9 | job verdicts not in-session | learning feed events |

## Benchmark tasks

The dogfood phase's regression suite — each task is executable against a
live session, scored deterministically by pane-audit or receipt checks
(never prose judgment). Full methodology and results:
[the round's benchmark suite](../benchmarks/observability/RESULTS.md).

| # | Task | Measures | Pass condition |
|---|---|---|---|
| OB-1 | boot a session, send a multi-step task, capture the screen mid-turn | objective + progress visibility | mission visible with objective text; progress signal present (steps or derived) |
| OB-2 | same session, wait ≥3 simulated minutes idle, return | the 60-second comprehension metric | the brief answers all five (objective/happened/decisions/learned/remains) within one screen, ≤60s reading time |
| OB-3 | session where one edit fails the verify gate | blocker visibility | failure ambient (health chip/recovery row) with its fix path, without scrolling |
| OB-4 | kill the engine mid-session, continue chatting | degraded-mode honesty | footer memory state correct; recovery row names the action; no silent learning claims |
| OB-5 | run a dream (or fixture one) while a session is live | ambient learning | feed event visible in-session; toast once; memory bar advances |
| OB-6 | 30-minute simulated long-run (headless, then resume interactively) | long-run ergonomics | resumed session's brief includes cost/time rollups + remaining work; nothing claims done while todos remain |
| OB-7 | a fleet of 3 async children completes across an idle gap | fleet afterlife | brief/mission panel reports per-child outcomes + cost; `/tasks` registry agrees |
| OB-8 | confidence stress: inject 2 verify failures + 1 retry into a session | confidence honesty | confidence chip reads low/medium with drivers named; never high |

## The information architecture

The terminal hierarchy the round builds to — priority top-down, summaries
over token streams, raw logs never dominating:

1. **Mission** — the pinned objective: `/mission` text, the active `/goal`
   when one exists, else the auto-titled session purpose. Always one line,
   always visible in the mission panel.
2. **Progress** — derived, not decorative: plan steps when planning, todo
   completion when tracked, and otherwise honest absence ("no tracked steps
   — the agent is on turn 3") + elapsed + ETA-free step context. Never a
   fabricated percentage.
3. **Current task** — the verb spinner's subject + the todo in_progress row +
   the live fleet tool, already strong; the panel restates them together.
4. **Active decisions** — the turn's confidence drivers (verify failures,
   retries, denials) + the last plan/goal decision; the brief mines the
   session's decisions with citations.
5. **Evidence** — receipts, checkpoints, verify results, diff stats: the
   existing ledger, surfaced by pointer (the panel and brief cite counts and
   the command that shows more) rather than by flooding.
6. **Risks** — composed: dirty tree, failing verifies, engine down, context
   pressure, version skew. One line, worst-first, each with its fix.
7. **Learning events** — the feed: dreams shipped (versions, rules, canary
   verdicts), skills staged/retired, improvements, cycle verdicts, mint
   events. Compact by default; `/feed` and the dashboard for depth.
8. **Metrics** — turn meter, session cost/time rollups, per-child cost,
   context %. In the panel and brief; the dashboard keeps the deep tables.
9. **Logs** — raw transcripts, tool output, SSE frames: never in the panel,
   reachable through the existing surfaces (`ctrl+o`, dashboard transcripts,
   `.unown/receipts`).

The placement law: **1–3 live in the mission panel (above the editor),
4–7 in the panel's compact rows and the brief, 8 in footer chips and the
brief, 9 stays where it is.** The brief (auto on return, `/brief` on demand)
is the single surface that answers all five mission questions in one screen.
Nothing in this hierarchy demotes an existing surface — the footer keeps its
states, the dashboard keeps its screens, the widgets keep their lanes; the
panel and the brief compose them.
