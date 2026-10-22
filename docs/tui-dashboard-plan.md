# The TUI Dashboard — design plan (Next.js dashboard retirement)

Status: **done** (D7 executed 2026-10-21 — the web dashboard tree, its Prisma scaffold, its CI lane and its asset pipeline are deleted; `unown dashboard` + the embedded `/dashboard` mount are the shipped mission control). Decision owner: repo maintainer session 2026-10-21.
Related: `docs/tui-beautification-plan.md` (visual law), `docs/memory.md` (the system
being visualized), `docs/detached-engine-architecture.md` (the API being consumed,
now incl. "The engine API surface" section), `docs/tui-capture-workflow.md` (the verification lane).

> **Addendum (retirement shipped).** D7 landed as planned in §8: `src/app/dashboard/`,
> `src/components/dashboard/`, `src/lib/agent-*` + `db.ts`, the prisma scaffold and
> `db:*` scripts, `serve-dashboard.ts`, the browser screenshot pipeline
> (`shots_capture.mjs`, `dash_*.png`, `webcache-tab-verify.mjs`), the dashboard e2e
> specs and `e2e/mock-engine.mjs` (its extended port lives on at
> `pi-repo/packages/self-learning/test/dashboard-mock-engine.ts`), the `.github/assets`
> dashboard captures/tour and the landing `dash-*.png` set are all gone. The launcher
> starts bridge + engine only; the src-scoped CI jobs were renamed landing-scoped
> (`Lint (landing)`, `Typecheck (landing)`, `Unit tests (landing)`,
> `Production build (landing)`, `E2E + a11y (landing)` — 3 tests); the landing
> showcase now frames twelve audited TUI stills
> (`public/landing/tui/dashboard/stills/`) with the "Install it and run unown
> dashboard" CTA. The engine REST+SSE API on :3030 is unchanged — it is documented
> in `docs/detached-engine-architecture.md` — and the TUI dashboard is its
> first-party client.

## 1. Context and the decision

The Next.js dashboard (`/dashboard`, 11 tabs after the providers screen moved terminal-only, React Query + SSE) was the only
browser surface in a terminal product. It forced a Node/Next toolchain, a
shadcn/ui vendor tree, a Prisma scaffold and a `serve-dashboard.ts` production
path into a repo whose agent, engine and CLI are all bun + pi-tui. The decision:
**retire the web dashboard entirely and ship a state-of-the-art TUI dashboard on
the same pi-tui stack the rest of the product uses.** The engine REST+SSE API on
:3030 is unchanged — it stops being "the dashboard backend" and becomes what it
always really was: the engine's API, now consumed by a first-class terminal
client.

Non-goals: no change to engine internals beyond the one additive endpoint this
plan needs (§5.6); no change to the landing page's hosting story (Vercel stays);
no new runtime dependencies — the dashboard is built from pi-tui components the
repo already ships.

## 2. Touchpoints — every way a user meets the memory dashboard

| # | Touchpoint | Kind | Status |
|---|---|---|---|
| T1 | `unown dashboard` (alias `unown dash`) | CLI → standalone fullscreen TUI app | **new** — the browser dashboard's replacement |
| T2 | `/dashboard` (alias `/dash`) inside a live session | slash command → editor-replacing screen | **new** — same screens, embedded |
| T3 | `/learning` | slash command → quick stack view | **kept**, now deep-links into the Memory screen (t) |
| T4 | `/memory` | slash command → Memory screen | **new** alias |
| T5 | Footer engine line (`memory: up · N queued`) | persistent widget | kept (M3/M6 work, unchanged) |
| T6 | `unown engine status` / `unown doctor` | text CLI | kept — supervision stays textual |
| T7 | Engine-down UX inside the dashboard | resilience surface | **new** — banner, retry, `unown engine start` hint, data-age stamps (M6 parity) |
| T8 | Landing page showcase | marketing | re-captured TUI stills replace `dash-*.png` (§9) |

Design rule: T1 and T2 are the **same component tree** — one implementation, two
mounts. The standalone mount owns the process (boot, theme load, restore on
resize); the embedded mount borrows the live session's TUI and theme, and Esc
returns to the editor (the ask-user-question questionnaire pattern).

## 3. Workflows — end to end, memory system first

Screens are grouped the way the system actually thinks: a LEARNING group (the
memory loop) and an OPERATIONS group (the machinery around it). This ordering is
the product statement: the learning memory system is the dashboard's heart, the
ops screens are its organs.

### 3.1 Overview — the learning loop at a glance (default screen)

Data: `/api/overview` + `/api/events` (SSE) + `/api/tasks`.
View: KPI band (pass rate with passed/failed/errors, learning suite, improvements
shipped, dreams + pending notes, memory tier versions, hook decisions + denies,
LLM requests + tokens); block-glyph trend sparkline of cumulative task passes
(last 20 runs); live activity rail (SSE events as one human line each — the same
describe() vocabulary the web dashboard grew); benchmark task table (difficulty,
pass/fail, rate, seed/minted, capability/regression badges).
Actions: `r` refresh; `t` run a task cycle; `m` mint task; number keys jump to
screens; `f` toggles the activity rail focus.
Workflows covered: "is the loop alive?", "what happened while I was away",
"what's the engine doing right now".

### 3.2 Memory — the four tiers + every project tier, first-class

Data: `/api/memory`, **new** `/api/memory/projects` (§5.6), `/api/memory/:tier/history`.
View: tier cards (version pill, chars, updated-at with staleness age, budget
meter of resolved chars against the 80k injection cap); full content viewer with
provenance header; version history with `changed_by` badges (seed / harness /
autodream / manual / rollback) and notes; per-project tiers (`project:<slug>`)
listed beside the engine tiers — closing the gap where terminal project memories
were second-class citizens of the web dashboard. `enter` on a version row opens
that version's DIFF against its predecessor (`+N / −M` tally, coloured hunks);
the pairing is by version number, because the engine serves history newest-first,
and the lowest version says it has no earlier state rather than printing its whole
body as an addition.
Actions: `enter` open tier (content + history); `tab` version history; `enter`
again on a version row → its diff; `b` rollback with inline y/N
confirm (always reversible — the engine writes a new version, never deletes);
`p` jump to project tiers; `esc` back.
Workflows: "what does the agent believe right now?", "who changed this and when?",
"what exactly did that dream change?", "undo a bad dream",
"how much context does memory cost?".

### 3.3 Dreams — AutoDreaming runs

Data: `/api/dreams`, `/api/dreams/:id/notes`, `/api/overview` (pending count).
View: dream cards with status (running / done / no-notes / error / **gated**),
stats chips (notes-in → merged/pruned/added), expandable dream output (the full
next-memory markdown), consumed-notes viewer, canary verdict from the dream note;
pending-notes count badge.
Actions: `D` run AutoDream now (respects the busy mutex — 409 surfaces as a
toast, "no undreamed notes" as an info line); `enter` open dream; `esc` back.
Workflows: "what did it learn overnight?", "why was this dream gated?",
"force consolidation before I start working".

### 3.4 Notes — the full corpus browser (new capability)

Data: `/api/notes?limit=200`, outbox stats (queued/dropped) via `/api/overview`
engine-health section, `/api/notes/sync`.
View: note rows (kind badge benchmark/terminal, project slug, age, dreamed-state);
filter by kind and by project; note content viewer (20k cap honored); outbox
panel with queued/dropped counters.
Actions: `c` compose a note (editor overlay, project path prefilled with cwd);
`s` sync outbox now; `/` filter; `enter` read; `esc` back.
Workflows: "what raw material is queued for the next dream?", "did my session
notes make it to the engine?", "hand-deliver an observation".

### 3.5 Skills — dream-minted Agent Skills

Data: `/api/skills`, `/api/skills/:id`.
View: skill cards (name, project, status shipped/retired, version, description);
body viewer (SKILL.md); per-skill version history with changed_by.
Actions: `b` rollback to version (confirm); `x` retire with confirm (deletes the
directory — the engine never deletes files otherwise, so the confirm says so);
`enter` open; `esc` back.
Workflows: "what procedures has it internalized?", "restore an older version",
"retire a skill that went stale".

### 3.6 Learning Lab — cycles, improvements, evidence runs

Data: `/api/cycles`, `/api/improvements`, `/api/runs`, `/api/runs/:id`,
`/api/runs/live` (the engine's in-memory registry of in-flight runs —
`src/run-progress.ts`).
View: cycle timeline; improvement cards (status, target tier, memory version,
diagnosis/proposal, patch with score-before→after); run table (status, kind,
task, tools, tokens, duration); run detail with full transcript and verify
output. A RUNNING run is rendered from the live registry, not from its DB row:
the row's counters are written at finalize, so mid-flight it reads `0 tools ·
0 tok · —`, which is indistinguishable from a stalled run. The row and the detail
block both show turns, tool calls, tokens, elapsed and the tool the agent is
inside, refreshed on the screen's 4 s fast lane; when the run finalizes its live
entry disappears and the persisted row becomes authoritative.
Actions: `t` run task cycle; `m` mint task from failure; `enter` drill into
improvement → evidence runs; `esc` back.
Workflows: "show me the receipts" — every shipped rule traces to baseline and
candidate runs; "mine this failure into a regression task"; "what is the engine
doing right now?".

### 3.7 Hooks — the policy layer, including MemoryBudget receipts

Data: `/api/hooks?limit=500`.
View: decision totals (events, denies, augments); filterable decision log (hook,
tool, decision, reason); expandable JSON details; MemoryBudget rows surface the
injection-cap pruning receipts (what got dropped to fit 80k).
Actions: `/` filter by decision/hook; `enter` details; `esc` back.
Workflows: "what did the guardrail block today?", "what did the budget prune?".

### 3.8 Router — the eight jobs

Data: `/api/jobs`.
View: one row per job (kind interval/event, schedule, next fire, run count with
its OUTCOME glyph, last run, enabled/running badges), plus the sandbox
workspaces they run in — auto-dream, note-sync, dream-check highlighted as the
memory loop's heartbeat. The `jobs` table carries `last_ok` / `last_error` /
`last_duration_ms` (written in the same UPDATE that reschedules), so the tally
glyph is a verdict — `✓` last run passed, `✗` last run failed, no glyph for a
job that has not completed a run since the columns landed (a legacy row reads as
unknown, never as a pass) — and any failed job is named again in a banner under
the list with its age, its duration (20m = the watchdog, 0.2s = a crash) and the
recorded error.
Actions: `enter`/`space` trigger now; `t` toggle enable/disable with confirm;
live job events arrive over SSE.
Workflows: "when does the next dream fire?", "pause the harness while I debug",
"did a job start failing and nobody notice?".

### 3.9 Providers — terminal-only by the owner's call (amended during D4)

The registry is NOT a dashboard screen: the M4/M5 web+HTTP surface was
unwound upstream (473a7d5) — provider management lives in the `unown
providers` CLI and the in-session `/providers` command, reading the registry
files directly. The dashboard's header keeps the informational line (engine
provider + model from `/api/overview`).

### 3.10 Gateway — LLM bridge traffic

Data: `/api/bridge`.
View: KPIs (requests, errors, tokens in/out, avg duration); per-model table;
latency sparkline; request log (model, stream, finish reason, tokens, duration).
Actions: `r` refresh; `enter` request detail.
Workflows: "what did the engine spend tokens on?".

### 3.11 Automations — scheduled unattended runs

Data: `/api/automations`, `/api/automations/:id/runs`.
View: automation cards (lifecycle, mode, cron + human hint, run counts, next/last
run, tokens); run history with output/error.
Actions: `a` create (form overlay: title, prompt, cron or delay, mode, model,
maxRuns); `space` pause/resume; `n` run now; `e` edit; `x` delete with confirm;
`enter` history.
Workflows: "run the weekly changelog agent", "did last night's automation
survive?".

### 3.12 Web Cache — the research memory's cache layer

Data: `/api/webcache`.
View: hit rate, size/entries, saved-requests sparkline, TTL config, recent
events with kind pills, per-provider traffic.
Actions: `s` sweep (LRU, confirm); `x` clear (destructive, double-confirm).
Workflows: "how many upstream requests did the cache save?", "reclaim space".

### 3.13 Sandboxes — workspaces (compact)

Data: `/api/sandboxes`.
View: stat chips + workspace cards (files, age); notes the sandbox-gc cadence.
Workflows: "is anything leaking workspaces?".

### Cross-cutting behaviors

- **Live updates**: SSE `/api/events` drives per-screen refresh; the active
  screen refreshes on its events, background screens refresh on switch (no
  stale-data flash). Activity rail available on every screen (togglable).
- **Engine-down resilience** (T7): connection-state banner (up / reconnecting /
  down · retry in Ns), every data panel stamps its age ("cached 4m ago"), and
  the banner carries the `unown engine start` hint. The dashboard never crashes
  on engine absence — it degrades to the last snapshot, exactly like the
  terminal's M6 memory story.
- **Confirmations**: destructive actions (rollback, retire, remove provider,
  clear cache, delete automation, toggle job) use an inline y/N bar — no
  accidental writes, no modal overkill.
- **Command palette**: `:` opens a fuzzy palette (screen jump + actions) — the
  k9s muscle-memory lane, alongside number-key jumps.
- **Help**: `?` overlays the keybinding card on any screen.

## 4. Visual language

The dashboard follows the repo's beauty law (one hue ladder, chrome gets
surfaces, transcript stays terminal-transparent, edge rails not fills, no NERD
fonts) and the unown brand theme (emerald accent on zinc, amber warnings).
Specifics:

- Layout: header band (brand, engine dot, bridge dot, busy pill, LIVE clock) →
  HStack[ sidebar (screen list, grouped, active row inverted) · main content ] →
  footer (keybinding hints, contextual to the screen).
- Meters and sparklines are block-glyph (`█▓░`), threshold-colored — the footer
  context-meter idiom, never braille (fails the core-terminal Unicode rule).
- Status glyphs: `●` up, `◐` starting, `○` down, `⏸` paused; `✓` pass, `✗`
  fail, `⟳` running, `⎇` rollback, `★` difficulty.
- All color through theme tokens (`theme.fg/bg`) so the 256-color ladder and
  user themes apply for free; chrome surfaces use `chromeBg`/`overlayBg` only.
- The sidebar never wraps; screen names are short nouns. Wide content wraps or
  truncates with ellipsis at the panel edge, never overflowing.

## 5. Architecture

### 5.1 Module layout (all inside `pi-repo/packages/self-learning/src/`)

```
dashboard/
  dashboard-data.ts     — EngineClient (REST + SSE) + DashboardStore (snapshots,
                          ages, connection state, action helpers). Zero UI imports.
  dashboard-types.ts    — response types for every endpoint consumed.
  dashboard-app.ts      — DashboardApp root component (header/sidebar/main/footer,
                          screen registry, palette, help overlay, confirm bar).
  dashboard-boot.ts     — standalone mount: ProcessTerminal + TuiAltScreen + theme
                          load + store wiring + clean shutdown.
  screens/
    overview-screen.ts memory-screen.ts dreams-screen.ts notes-screen.ts
    skills-screen.ts lab-screen.ts hooks-screen.ts router-screen.ts
    providers-screen.ts gateway-screen.ts automations-screen.ts
    webcache-screen.ts sandboxes-screen.ts
  widgets/
    bits.ts             — Pill, Badge, StatChip, KpiCard, Sparkline, Meter,
                          EmptyState, LoadingState, DataAge.
```

The dashboard imports pi-tui components (`VStack/HStack/ScrollView/Box/Text/
SelectList/Editor`) and the theme — nothing else. It must stay importable from
both `cli.ts` (standalone boot) and `tools.ts` (embedded `/dashboard`) without
importing each other.

### 5.2 Data flow

```
EngineClient ──REST poll (adaptive: active screen 3s, background 15s)──▶ engine :3030
            └─SSE /api/events ── instant invalidation + activity rail ──▶ engine :3030
DashboardStore ── versioned snapshots + age stamps + connection state ──▶ screens
Actions (rollback, dream, trigger…) ── EngineClient.post ──▶ engine ── SSE confirms
```

No framework, no react-query: the store is a plain class with per-endpoint
`lastFetch/lastData/fetching` triples, a subscription callback per screen, and
SSE-driven dirty flags. The web dashboard's invalidation map (event → which
endpoints refetch) is ported as a table.

### 5.3 Standalone boot (`unown dashboard`)

`dashboard-boot.ts` owns the process: `ProcessTerminal` → `TuiAltScreen` →
theme load (unown brand theme seeded at `~/.unown/agent/themes/unown.json`, same
loader the TUI uses) → `DashboardApp` → `setLayoutRoot` → run. Ctrl-C/q quits
cleanly (drain SSE, close store). Works over SSH, tmux, Windows Terminal,
conhost (win32-console-mode), macOS Terminal.app.

### 5.4 Embedded mount (`/dashboard` in a session)

`tools.ts` registers `/dashboard`, `/dash`, `/memory` (deep-link). The handler
calls `ctx.ui.custom((tui, theme, _kb, done) => new DashboardApp(tui, {theme,
embedded: true, onExit: done}), { overlay: false })` — the editor-replacing
screen pattern. Esc-Esc or `q` calls `done()` and returns to the editor. The
embedded mount reuses the session's live TUI: no second alt-screen, no flicker.

### 5.5 Keybindings (default; documented in `?` overlay)

```
1…9,0,-,=        jump to screen (sidebar order)      j/k or ↑/↓   move selection
←/→  or [ ]      prev/next screen                    g/G          top/bottom
enter            open selection / detail             esc          back / close
r                refresh screen data                 :            command palette
?                help overlay                        f            toggle activity rail
q (standalone)   quit                                esc-esc (embedded) return to chat
screen-local actions are single keys announced in the footer (D dream, b rollback,
c compose, t trigger, x destructive-with-confirm, …)
```

### 5.6 The one engine addition

`GET /api/memory/projects` — lists the `project:<slug>` tiers from
`memory_versions` (slug, latest version, chars, updated-at, current content
length) so the Memory screen can show terminal project memories as first-class
objects. Additive, loopback, follows the existing json() + store pattern; the
detachment contract (server.ts may not import term.ts) is respected. The API
contract doc (currently `src/lib/AGENTS.md`) moves into the self-learning
package's README + `docs/detached-engine-architecture.md` when the web lib is
deleted (§8).

## 6. Cross-platform strategy

- Rendering: pi-tui's alt-screen + win32 console-mode native prebuilds
  (Windows Terminal + conhost), darwin modifier prebuilds (macOS), truecolor →
  256 → plain degradation — all inherited, all exercised by the dashboard.
- Code discipline: no POSIX-only APIs in `dashboard/` — no `/proc`, no tmux, no
  signals beyond SIGINT/SIGTERM handlers that exist on every platform, path
  handling via `node:path`, no `fork`.
- `unown dashboard` boots identically from checkout and compiled binary
  (`packaging.ts` shapes — the boot module must not assume `import.meta.dir`
  is writable).
- CI matrix (ubuntu/macos/windows) runs the dashboard unit suite (§7) on all
  three OSes.

## 7. Test strategy (the harness this feature ships with)

1. **Unit — headless render tests** (`test/dashboard-*.test.ts`, bun test):
   a `MockEngine` (evolution of `e2e/mock-engine.mjs`, ported into the package's
   test dir) serves deterministic fixture JSON + a scripted SSE stream; a
   `VirtualTerminal` (pi-tui's xterm-headless harness) mounts the real
   `DashboardApp`; tests drive keys through `handleInput` and assert on rendered
   lines (stripped) for every screen: data rows, empty states, engine-down
   states, confirm flows, palette, help. These run on all 3 OSes in CI.
2. **Store tests**: SSE-event → invalidation table, age stamps, adaptive
   polling, degraded-mode retention — pure logic, no terminal.
3. **Visual — PTY lane**: `scripts/tui-capture/pty_capture_dashboard.py`
   (pyte + PIL, the dependency-light lane) produces PNGs + `.pane.txt` ground
   truth for every screen against the mock engine; a checker asserts the pane
   truth contains the KPI vocabulary (the same 3-layer discipline as the
   landing assets).
4. **Beauty acceptance**: the new stills run through the existing
   `beauty_critique.py` VLM lane (Agnes, image-capable) with numeric polish
   gates, same as beauty-4 did for the chat TUI.
5. **Regression sweep**: engine suite (`bun test test/`), bridge suite, landing
   gates (palette, changelog, benchmarks, claims), `unown doctor`, and a live
   smoke (`unown dashboard` against the real engine, PTY-captured) before each
   push.

## 8. Removal plan — the web dashboard, dead code, no regression

Delete: `src/app/dashboard/`, `src/components/dashboard/` (40 files),
`src/lib/agent-*` (7 files), `src/app/api/route.ts`, `scripts/serve-dashboard.ts`,
`scripts/webcache-tab-verify.mjs` + `dash_*.png` artifacts, dashboard half of
`e2e/` (the mock engine is ported, not deleted), `.github/assets/dashboard-*.png`
(8), the Prisma scaffold (`prisma/`, `prisma.config.ts`, `src/lib/db.ts`,
`db:*` scripts — it was dashboard-only legacy), the shadcn `src/components/ui/`
vendor tree minus what the landing page imports (accordion), dashboard npm
scripts (`dev`/`start`/`build`/`serve` change meaning: they become the landing
page's scripts), the `start.ts` dashboard spawn branch, `verify-deploy.mjs`'s
`/dashboard` route assertion, `NEXT_PUBLIC_AGENT_API_BASE`/`DATABASE_URL` from
`.env.example`.

Keep: the landing page (`/`), every engine endpoint (the TUI is now the API's
client), `e2e` landing a11y specs, the tui-capture harness (it gains the
dashboard scenarios).

Update (the doc blast radius — 22 files mention "dashboard"): root `AGENTS.md`
(service map, contracts), `src/AGENTS.md` (becomes the landing-page doc),
`scripts/AGENTS.md`, `mini-services/AGENTS.md`, `docs/*.md` (usage,
configuration, quickstart, testing-strategy, memory, troubleshooting,
resilience, detached-engine-architecture, repo-wiki, sdlc-*),
`README.md` (screenshot gallery + tour), `CHANGELOG.md`, landing showcase
section (TUI stills replace dash PNGs), `cli.ts` HELP, `completions.ts` (+
its drift-pinning test — new `dashboard` command word), `.github/workflows/ci.yml`
(dashboard job → TUI suite, 3-OS matrix), `vercel.json` (landing-only routes).

Order: the TUI lands feature-complete first (the API client and mock engine
exist in parallel), then the removal commit flips the docs and deletes the web
surface in one atomic, greppable change — never a state where both dashboards
are half-alive.

## 9. Milestones (each pushed on completion)

| # | Milestone | Contents |
|---|---|---|
| D1 | Design | this plan; brainstorm committed |
| D2 | Skeleton | store + EngineClient + standalone boot + app shell + Overview |
| D3 | Memory screens | Memory (+ projects endpoint), Dreams, Notes, Skills |
| D4 | Lab + ops | Learning Lab, Hooks, Router, Sandboxes, Gateway, Providers, Automations, Web Cache |
| D5 | Embedded mount | `/dashboard` + `/memory` deep links, `/learning` upgrade |
| D6 | Harness | mock engine port, VirtualTerminal suite, PTY captures, beauty pass |
| D7 | Removal | web dashboard + dead code deleted; no-regression sweep |
| D8 | Docs + landing | README, docs sweep, landing re-capture, AGENTS.md chain, CHANGELOG, CI matrix |
