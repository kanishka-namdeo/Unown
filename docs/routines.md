# Routines — scheduled recurring agent runs

The reference for scheduled, recurring, unattended agent runs: the four schedule kinds, completion anchors, missed-run policies, timezone/DST edge cases, and every management surface (TUI, CLI, session tools, REST).

- [The four schedule kinds](#the-four-schedule-kinds) · [Missed runs: the misfire policy](#missed-runs-the-misfire-policy) · [Boundaries](#boundaries)
- [Managing routines in the TUI](#managing-routines-in-the-tui) · [The session tools](#the-session-tools) · [REST surface](#rest-surface)
- [The trust story](#the-trust-story) · [Scheduler semantics reference](#scheduler-semantics-reference) · [Sources (the decision record)](#sources-the-decision-record)

Related pages: [usage](usage.md) · [configuration](configuration.md) · [tui-dashboard-plan](tui-dashboard-plan.md) · [resilience](resilience.md)

Routines (the user-facing name for the engine's automations — `unown automations` still works as the historical alias) are **scheduled, unattended agent runs** in your project. The engine polls every 20 s while it runs; each due routine spawns a real headless unown session (`--mode json -p --no-session`) in the routine's workspace, and the run's output, exit status, turns and token counts are recorded for inspection.

```bash
unown routines create --title 'morning brief' --every '1d at 09:00' \
    --prompt "Summarize yesterday's commits and open TODOs; report risks."
unown routines list                      # this project's routines (--all: every workspace)
unown routines history <id>              # recorded runs: status, output, turns, tokens
unown routines run <id>                  # run now (manual runs never consume --max-runs)
unown routines skip <id>                 # skip the next occurrence (recorded in history)
unown routines snooze <id> 30            # push the next occurrence out 30 minutes
unown routines pause <id> | resume <id>
unown routines edit <id> [--title|--prompt|--cron|--every|--after|--timezone|--misfire|--mode ...]
unown routines delete <id>
unown dashboard routines                 # manage everything in the TUI (or /routines in a session)
```

Related pages: [usage](usage.md) (every command) · [configuration](configuration.md) (engine knobs) · [tui-dashboard-plan](tui-dashboard-plan.md) (the screen).

## The four schedule kinds

A routine carries exactly one schedule. The recurrence semantics were reverse-engineered from the best schedulers in the industry — Todoist/Things/OmniFocus for completion anchors, launchd/systemd/Quartz for missed-run policies, RFC 5545/Temporal for wall-clock arithmetic (the source list lives at the bottom of this page).

| Kind | Spec | Next occurrence | Can be overdue? |
|---|---|---|---|
| **cron** | `--cron "0 9 * * 1-5"` | the next matching wall-clock minute | yes (gaps stay visible) |
| **every** | `--every "30m"` · `"2d"` · `"3w"` · `"2d at 09:00"` | one interval after the previous **slot** | yes |
| **after** | `--after "45m"` · `"3d"` | N units after the previous run **completes** | **never** — it just waits |
| **once** | `--delay-minutes N` | — (runs once, then completes) | n/a |

**The completion anchor is the design decision** (Todoist `every` vs `every!`, Things "Regularly" vs "After Completion", OmniFocus "Repeat Every" vs "Defer Another" — all three make it an explicit per-task choice):

- `every` is **schedule-anchored**: the calendar owns the rhythm. A run that happens late does not shift the next one; a slot missed entirely stays visible in history. This matches cron, and it is the right default for "every Monday at 9" style work.
- `after` is **completion-anchored** (regenerating): the next run arms N units after the previous run *finishes* — however long it took, whenever it was triggered (manual runs re-arm it too). It can never pile up or be overdue; it is the right shape for "three days after the last time this was done" (dependency refreshes, regeneration checks).

### Intervals in detail

- `every 30m` / `every 6h` are **plain durations** (epoch arithmetic).
- `every 2d` / `every 3w` step by **wall clock in the routine's timezone** — a daily 09:00 routine fires 23 h or 25 h apart across a DST boundary and never drifts off 09:00. "Every week" is *never* implemented as 7×24 h.
- `every 2d at 09:00` pins the wall time-of-day (`at` is only valid for day/week units). The first occurrence is the next future 09:00; the phase then derives from the calendar, never from a hidden epoch anchor.
- `after 3d` steps by wall clock from the **completion instant**.

### Timezones and DST (the pinned policies)

Every routine can carry an IANA timezone (`--timezone America/New_York`); the default is the engine's local time (a "floating" schedule that follows the machine). The DST policies are the Temporal **"compatible"** model, pinned by `test/routine-schedule.test.ts`:

| Edge | Behavior |
|---|---|
| **Spring-forward gap** (02:30 doesn't exist) | fires **shifted forward by the gap** (03:30) — a late run beats a silently vanished one; cron-classic would skip it entirely |
| **Fall-back fold** (01:30 happens twice) | fires **once, at the earlier pass** (what RFC 5545 / Luxon / `Date` agree on); a fire is never returned in the past |
| **Weekly across DST** | wall-clock stepping — 167 h or 169 h apart, wall time preserved |
| **Minute/hour intervals** | pure durations — an hourly timer crossing a fall-back gap fires one extra wall hour later in absolute terms (same as any duration timer) |
| **Feb 29** | yearly crons find the next leap day; impossible dates (Feb 30) report "no occurrence" within the 4-year scan cap |
| **Half-hour zones** (IST, Nepal) | all field logic runs in the target zone's wall time — never UTC hour arithmetic |

## Missed runs: the misfire policy

A slot older than the misfire grace window (5 minutes by default, `PI_AUTOMATION_MISFIRE_GRACE_MS`) was missed — the computer slept, or the engine was down. Each routine picks its policy:

- **`skip`** (default) — cron-classic: the missed slot is **recorded as a skipped run with its reason** and never replayed. A long outage coalesces into *one* recorded skip per wake (launchd-style coalescing), not one per missed minute.
- **`catch-up`** — launchd's `StartCalendarInterval` semantics: a missed slot **newer than 24 h runs once on wake** (coalesced, never N replays). Older than 24 h even catch-up gives up: skip + record.

```bash
unown routines create --title 'nightly audit' --every '1d at 02:00' --misfire catch-up ...
```

`UNOWN_AUTOMATION_MISFIRE_CATCHUP=1` flips the *default* to catch-up for routines that don't say (the historical env knob, now the fallback). Completion-anchored (`after`) routines cannot misfire — their next occurrence just waits — so the policy only applies to `cron` and `every`.

## Boundaries

- **`--until`** (a date — `2026-12-31` or `2026-12-31 09:00` — or epoch ms): the inclusive end boundary. When the next computed slot is past it, the routine **completes** (no run, no error). Setting a past `until` on an existing routine ends it — the "stop after today" flow.
- **`--max-runs N`**: stops after N *scheduled* runs. Manual `run`s never consume the budget.
- A `completed` routine is terminal (zcode's rule) — create a new one instead of resurrecting.

## Managing routines in the TUI

`unown dashboard routines` (or `/routines` inside a live session) opens the **Routines** screen:

- The **list** is ordered by next occurrence (soonest first) — paused and terminal routines sink to the bottom, Things' "Repeating"-list ordering. Each row shows the lifecycle dot, mode badge, the engine's human schedule description, run count and `next in …`.
- **enter** opens the detail pane: the full spec (schedule, timezone, misfire, boundaries), the prompt, a **streak row** — the last 10 runs as glyphs (`✓` succeeded · `✗` failed · `–` skipped · `⟳` running) — and the run history with outputs, errors and skip reasons.
- **a** opens the create wizard: title → prompt → schedule (one field, every kind: `0 9 * * 1-5`, `every 2d at 09:00`, `every 30m`, `after 3d`, `+90m` — validated inline with the engine's own parser) → timezone → misfire policy → mode → model → confirm.
- **e** opens the edit flow: a field picker over everything (title, prompt, schedule, timezone, misfire, mode, model, until, max runs) → inline input or option list. Schedule edits re-arm the next run from now.
- **s** skips the next occurrence (recorded); **S** snoozes by typed minutes; **space** pauses/resumes; **n** runs now; **x** deletes (confirm-gated).

## The session tools

Agents can manage routines mid-session (the mutation tools are hidden inside routine runs and subagents — no recursion):

- `routine_list` — this project's routines with schedules and next runs
- `routine_create` — any kind (`cron`, `every`, `after`, `delay_minutes`) plus `timezone`, `misfire`, `mode`, `max_runs`
- `routine_update` — edit fields or pause/resume
- `routine_run` — trigger a run now (test a routine; answer "why did it do nothing")
- `routine_delete` — remove a routine and its history

## The trust story

- **Config lives in the engine's database, never in the repo.** A cloned repository carries no routine definitions, so the cloned-repo-RCE vector that gates `.unown/mcp.json` does not exist here. Routines are created only by you — via the CLI, the REST API, the TUI, or the session tools.
- **Permission is per-task.** The default `read-only` mode runs the unattended agent with read/grep/find/ls/todo/note/fetch_url/web_search/webfetch/lsp — no bash, no writes (web tools are read-only network reads, so an unattended "morning brief" can still search the web). `standard` (the full session toolset) must be chosen explicitly; a standard run's file changes land in your working tree, reviewable through git.
- **No recursion.** Runs carry `UNOWN_AUTOMATION=1`, which hides the routine mutation tools inside the run — a routine cannot create or schedule routines.
- **Nothing auto-merges.** Every run (and every skip, with its reason) is recorded; inspect with `history` before acting.

Limits (zcode's, transliterated): 20 routines total, 2 concurrent runs (manual run-now respects the same cap), a 30-minute run timeout, and a dispatch retry ladder (30 s × 2ⁿ⁻¹, capped at 15 min, 5 attempts). Routines need the engine up (`bun run agent:start`); while it is down, due slots wait for the next poll.

## Scheduler semantics reference

The exact behaviors the engine guarantees (each pinned by tests):

- **Single-flight per routine**: an atomic claim; a run in progress rejects further dispatch and run-now.
- **Manual runs never consume the schedule**: `run-now` on a cron/every routine leaves the pending slot untouched (cron recomputes idempotently); only an `after` routine re-arms (from the manual run's completion — that is its semantics).
- **Pause/resume**: resuming re-arms per kind — cron recomputes from now; `every` resumes **phase-preserving** (the next future slot on the old rhythm); `after` starts a fresh N-window from now (the pause consumed the wait).
- **Crash recovery**: claims older than 10 minutes are reclaimed at boot, their runs closed as failed, and the schedule re-armed.
- **Clock discipline**: every next-run computation derives from the spec in the routine's timezone — never from cached instants — so timezone-database changes land on the next tick.

## REST surface

`GET /api/automations` (list + human `schedule` + `lastRun`) · `POST /api/automations` (`cron`|`every`|`after`|`delayMinutes`, `timezone`, `until`, `misfire`, `mode`, `model`, `maxRuns`, `workspace`) · `GET/PATCH/DELETE /api/automations/:id` · `POST /api/automations/:id/run` · `POST /api/automations/:id/skip` · `POST /api/automations/:id/snooze {minutes}` · `GET /api/automations/:id/runs?limit=N`. `until` accepts epoch ms or an ISO string.

## Configuration

See [configuration](configuration.md) for the engine knobs. The routine-relevant ones: `UNOWN_AUTOMATION_MISFIRE_CATCHUP` (default misfire policy), `PI_AUTOMATION_MISFIRE_GRACE_MS` (grace window), `UNOWN_AUTOMATION` (the unattended-run marker — never set by hand).

## Sources (the decision record)

- Completion anchors: Todoist recurring dates + fixed/floating times, Things 3 "Regularly vs After Completion", OmniFocus "Repeat Every / Defer Another / Due Again", TickTick "By Due Date / By Completion Date" — all make the anchor an explicit per-task choice; we expose both kinds and default to schedule-anchored.
- Missed-run policies: Vixie cron (skip silently), launchd `StartCalendarInterval` (catch-up once, coalesced), systemd timers `Persistent=` (catch-up across reboots), Quartz misfire instructions (`FIRE_NOW` vs `DO_NOTHING`), Windows Task Scheduler `StartWhenAvailable`, GitHub Actions schedule (no catch-up, UTC-only), Claude Code scheduled tasks (one catch-up for the most recent miss, 7-day lookback, skips recorded with reasons).
- Wall-clock arithmetic: RFC 5545 §3.3.10, the Temporal "compatible" DST policy, cron-parser/croner's documented behaviors.
- Habit-tracker health UX (the streak row): Loop Habit Tracker's skip-doesn't-break, Streaks' cadence rules.
- TUI management: k9s/lazygit's table-plus-verbs, Things' Repeating list ordering (next-occurrence first, paused sink).
