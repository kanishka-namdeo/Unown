# Bottom-area user journeys (docs/bottom-area-user-journeys.md)

The footer quiet round's journey map (2026-10-31): four personas ride the
TUI's bottom area — the dock below and around the input editor — and every
element they meet is dispositioned as **persistent** (always shown), **situational**
(shown only in the states that need it) or **demoted** (moved to a drill-in
surface). This is the round's answer to "what should be showing at all times
and how, versus only at certain times and how".

Method: the three weighted inputs of the observability journeys — competitor
behavior with sources ([the research](bottom-area-competitor-research.md)),
the repo's own recorded findings (the baseline PTY capture, the observability
audit, the beauty-4 critique), and standard role dispositions. Personas are
analytical instruments, not demographics. Journey IDs (`Jx-n`) are traceable
from the friction inventory to the fix plan in [the session
log](footer-quiet-round-session.md).

## The bottom area today (the baseline, 128×36, captured 2026-10-31)

```
 ○ no tracked steps · conf ✓ · 0m in session     ← mission panel (above editor)
»───────────────────────────────────────────     ← editor top border
                                                  ← editor input line
─────────────────────────────────────────────     ← editor bottom border
~/my-project/Unown (main)                         ← footer L1: location (always)
ctx ▕█░░░░░░░░▏ 5.1%/524k (auto) ↓2 ↑27k   agnes-3.0-flash   ← footer L2: stats (always)
conf ✓ memory: up · stale (v0.0.51) turn 2.7s · ttft 2.7s · ctx 5% · in 26.8k out 2   ← footer L3: every extension chip, alphabetical, truncated mid-chip
? help · ctrl+k palette · / commands · ! bash · ctrl+o tools · esc-esc tree   ← footer L4: hints (idle set)
```

Eight rows of chrome at rest; the L3 dump grows with every registered chip
(engine, mcp, model, update, plan, turn, conf, health, feed, delegation,
goal, review, lsp, fleet, advisor, flights — sixteen keys paint today), and
after one trivial turn it truncates mid-chip (`out 2`).

## Journey A — the first-time user (the five-minute test)

Opens `unown` in a fresh clone. Questions: *Is it working? What do I type?
Which model am I on?* They have not yet earned a memory version, a rules
count, or a cache-hit rate.

| Touchpoint | What they meet | Friction / trust gap | Fix |
|---|---|---|---|
| A-1 Boot | splash, startup hints, first-flights catalog (16 rows in the editor slot), mission-panel line, editor, **4-line footer** | The one action they need (type) competes with 8 rows of chrome; the footer answers questions they don't have | Footer falls to 2 lines at rest (J1-1) |
| A-2 The stats line | `ctx ▕░░░░░░░░░▏ 0.0%/524k (auto)` | Zero-percent context with a 10-cell bar is noise before the first turn; `0.0%` precision is meaningless | Meter keeps rendering (it is the one live risk metric) but rides the merged line — the identity row it occupied is gone (J1-1) |
| A-3 The chip dump | `memory: up · … · 107 rules · dreamed 2h ago` | Cryptic micro-text (a memory bar, a version, a rules count) with no action attached; contradicts "what do I type?" | Ambient engine state stops painting; attention states still would be impossible to miss (J2-1) |
| A-4 Hints | `? help · ctrl+k palette · / commands · ! bash · ctrl+o tools · esc-esc tree` | GOOD — this is the one footer row that answers their question; the palette is the expansion gesture | Kept verbatim (J4-1) |
| A-5 First turn ends | `turn 2.7s · ttft 2.7s · ctx 5% · in 26.8k out 2` | A second place showing ctx and tokens, truncated mid-chip, sorted after `conf ✓` and `memory:` | Turn chip deduplicates to per-turn dynamics + cost; priority ordering puts nothing cosmetic ahead of actionable chips (J3-2, J3-1) |

**Journey-A verdict:** the quiet footer answers "where am I, what model, is
context fine, what do I type" in two rows; everything else waits until it is
either attention or a drill-in away.

## Journey B — the daily driver, mid-session

Streaming a long refactor in a repo they know. Questions: *What is it doing
right now? Can I interrupt? How close is context to full? Did my queued
message land?*

| Touchpoint | What they meet | Friction / trust gap | Fix |
|---|---|---|---|
| B-1 Busy state | verb spinner + `esc interrupt` hint swap | GOOD — the contextual hint line already yields to the moment | Kept (J4-1) |
| B-2 Context pressure | meter turns warning >70 %, error >90 % | GOOD — one live risk metric, color thresholds | Kept on the merged line; survives every tier (J1-2) |
| B-3 Queued steering | pending panel + `alt+↑ edit queue` hint | GOOD | Kept |
| B-4 Ambient chips while working | `memory: up … dreamed 12m ago` rewrites itself ~every 30–50 s | The heartbeat churn competes with the stream; nothing actionable | Ambient-OK engine state stops painting; dreams surface through the feed chip (✦) and the mission panel's learned line, which the UX card already owns (J2-1) |
| B-5 After each turn | stats chips (↓ ↑) AND turn chip (`in 26.8k out 2`) | Two homes for the same numbers | Turn chip drops ctx/in/out; the stats line is the token home; cost's one home becomes the turn chip (J3-2) |

**Journey-B verdict:** during work, the bottom area should say what is
happening and how to steer it — spinner, context, queue — and stay out of the
way otherwise.

## Journey C — the power user (plans, fleet, review)

Runs plan execution with three fleet subagents and a reviewer. Questions:
*What phase is the plan in? Which subagents are live? What needs my
attention?*

| Touchpoint | What they meet | Friction / trust gap | Fix |
|---|---|---|---|
| C-1 Plan execution | `plan 2/5` chip + PLAN chip in planning | GOOD — active state, must paint | Kept, priority active (J3-3) |
| C-2 Fleet | `fleet: 3 subagents running · 1 awaiting answer` | GOOD — but alphabetically it lands after `conf`/`delegation`/`engine` | Priority ordering: critical chips (health ✗, engine down/blocked, model unconfigured, mcp failures) render first; active next; alphabetical only within a class (J3-1) |
| C-3 Attention states | `✗ 2 to fix · /recovery`, `update: 0.0.53`, `memory: blocked · port` | The actionable chips can be the ones truncated away at width | Whole-chip dropping with a dim `+N` counter — no mid-chip cuts, ever (J3-2) |
| C-4 Narrow terminal | 80-col split next to an editor | The joined dump truncates hardest exactly when room is scarcest | The attention line keeps whole-chip drop discipline; the merged status line keeps the round-5 ordered-drop ladder (J1-2) |

**Journey-C verdict:** every active or attention state stays visible, in
priority order, and never loses a chip to a mid-text cut.

## Journey D — the ops/enterprise seat

Cares about cost, tokens, engine drift, dead letters. Questions: *What did
this session cost? Is the engine healthy? Is memory learning? Did anything
dead-letter?*

| Touchpoint | What they meet | Friction / trust gap | Fix |
|---|---|---|---|
| D-1 Cost | `$` stats chip — drops FIRST at narrow (observability audit B2) | The metric the ops seat cares most about is the most fragile | Cost's one home becomes the turn chip (`~$0.0084`, session-cumulative, refreshes per turn); /usage stays the attribution surface (J3-2) |
| D-2 Engine health | `memory: up · stale (v0.0.51)` | GOOD — build skew is a standing condition worth a line | Attention-only gating keeps every non-up state painted; the up-state's memory bar/rules/dreams move to /engine, the dashboard and doctor where they already exist (J2-1) |
| D-3 Learning evidence | `✦ 3 learning events · /feed` chip | GOOD — "learning must paint" is a UX-card law | Kept — attention/active class (J2-2) |
| D-4 Recovery | `✗ 2 to fix · /recovery` | GOOD — fix paths ride the failure | Kept — critical class (J3-3) |

**Journey-D verdict:** nothing the ops seat needs disappears — the deep
surfaces (engine, dashboard, usage, recovery) keep their depth, and the
footer keeps every failure/attention signal plus the live cost.

## The manifest — every element, dispositioned

The round's contract for "always vs sometimes". *Home* names the surface that
owns the fact after this round.

| Element | Was | Now | Class | Home / drill-in |
|---|---|---|---|---|
| cwd + git branch | L1 always (own row) | merged status line, left | persistent | status line |
| session name | L1 always (regular+) | merged line at `wide`+ tiers only | situational | status line; /status |
| context meter | L2 always | merged line (survivor at every tier) | persistent | status line |
| diff chip `+N -M` | L2 after first edit | merged line (unchanged rule) | situational | status line; /diff |
| tokens ↓ ↑, CH%, W, R | L2 when nonzero | merged line, ordered drop | situational | status line; /usage |
| session cost `$` | L2 stats chip (drops first) | **turn chip** `~$…` (one home) | situational | turn chip; /usage |
| model + thinking level | L2 right | merged line right (survivor) | persistent | status line |
| engine `memory: up [· bar · rules]` | L3 always | **no line when up** | demoted (ambient) | /engine, dashboard, doctor; the feed chip + mission panel's learned line carry learning |
| engine down/blocked/paused/starting/stale | L3 | attention line, **critical** priority | situational | /engine |
| mcp healthy `3/3 · 14 tools` | L3 always | no line | demoted (ambient) | /mcp, /status |
| mcp failures / withheld | L3 | attention line, critical | situational | /mcp |
| model unconfigured pill | L3 | attention line, critical | situational | /setup |
| update available | L3 | attention line, active | situational | /update, `unown update` |
| plan `PLAN` / `plan N/M` | L3 | attention line, active | situational | /plan |
| turn meter | L3 (dup: ctx, in/out, $) | attention line, active — `turn Xs · ttft Ys · ~$Z` only | situational | /usage |
| conf `✓ / ◐ / ✗` | L3 always (dup of mission panel) | **no line while the mission panel is on**; paints when the panel is killed | demoted (ambient, panel-owned) | mission panel; /recovery |
| goal active `goal: active · 1d` | L3 (dup of mission panel objective) | no line while the panel is on; paused/complete still paint | demoted (ambient, panel-owned) | mission panel; /goal |
| health `✗ N to fix` | L3 when nonzero | attention line, critical | situational | /recovery |
| feed `✦ N learning events` | L3 while unseen | attention line, active | situational | /feed |
| delegation unseen | L3 while unseen | attention line, active | situational | /delegation |
| review running | L3 | attention line, active | situational | /review |
| lsp `ready` | L3 | no line | demoted (ambient) | /lsp |
| lsp `restarting` / `paused` | L3 | attention line (active / critical) | situational | /lsp |
| fleet running / awaiting | L3 | attention line, active | situational | /tasks |
| advisor watching | L3 | attention line, active | situational | /advisor |
| first-flights hint | L3 while staged | attention line, active | situational | (the catalog itself) |
| hint line | L4 (idle set / busy / queued) | **kept verbatim** — already the field's contextual pattern | situational | `?` palette, ctrl+k |
| idle layout | 4 rows | **2 rows** (status + hints; +1 attention line only when a chip needs it) | | |
| kill switch | none | `UNOWN_FOOTER_CLASSIC=1` restores the pre-round layout and ambient chips | | |

## The cross-persona synthesis

| Persona | Dominant question | Dominant fear | The surface that answers it |
|---|---|---|---|
| A first-time | what do I type? | I'll break something | the hint line + first flights |
| B daily | what is it doing? | it's stuck and I can't tell | verb spinner + contextual hints + meter |
| C power | what needs me? | an active state got truncated away | the attention line, priority-ordered, whole-chip |
| D ops | what did it cost / drift? | silent failure | critical-class chips + the turn-chip cost + /engine |

Structural conclusions: (1) the bottom area's persistent budget is two rows
— identity+state, and hints; (2) every additional row must be *earned by a
state*, not by a feature existing; (3) a fact with two homes has no home —
deduplication is part of the layout, not a nicety; (4) quiet must be the
default and loud must be available (`UNOWN_FOOTER_CLASSIC=1`) — a kill switch
that nobody can find is not a kill switch.
