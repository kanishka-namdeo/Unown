# Addons (docs/addons.md)

The TUI addon framework: three user-configurable session addons — `ask_user_question` (structured mid-run questionnaires), `todo` (the live task-graph panel), and `advisor` (a second model watching the session) — their shared config file `~/.unown/agent/addons.json`, and the `/addons` configurator that edits it live. One JSON file turns each addon on or off, retunes its behavior, and rewrites the copy the model sees.

- [What the addon framework is](#what-the-addon-framework-is)
- [The three addons at a glance](#the-three-addons-at-a-glance)
- [The configuration file (addons.json)](#the-configuration-file-addonsjson)
- [ask_user_question](#ask_user_question)
- [todo](#todo)
- [advisor](#advisor)
- [The /addons configurator](#the-addons-configurator)
- [Commands and keybindings](#commands-and-keybindings)
- [Hot-reload semantics](#hot-reload-semantics)
- [Cross-platform notes](#cross-platform-notes)
- [Design contracts](#design-contracts)
- [Where the code lives](#where-the-code-lives)

Related pages: [usage](usage.md) · [behavior](BEHAVIOR.md) · [configuration](configuration.md) · [subagents](subagents.md)

## What the addon framework is

One inline extension (`unown-addons`, `pi-repo/packages/self-learning/src/addons/index.ts`) bundles the three addons and wires them into every session `bootRuntime` creates, right after the core `unown-tools` extension. Each addon is a port with lineage, not an invention:

| Addon | Tool | Ported from | Default |
|---|---|---|---|
| `ask_user_question` | `ask_user_question` | @juicesharp/rpiv-ask-user-question v2.13.9 (MIT) | on |
| `todo` | `todo` (+ `/todos`) | @juicesharp/rpiv-todo v2.13.9 (MIT) — replaces unown's first-generation `list`/`add`/`toggle` todo | on |
| `advisor` | no tool — an out-of-band runtime (+ `/advisor`) | the advisor/watchdog subsystem of oh-my-pi (can1357/oh-my-pi, MIT) | **off** |

The addons are pure TypeScript over the vendored pi extension surface — `pi.registerTool`, `pi.registerCommand`, `pi.registerShortcut`, `ctx.ui.*`, `pi.appendEntry` — with no native dependencies, so they run identically on Linux, macOS and native Windows (see [Cross-platform notes](#cross-platform-notes)).

Every user-tunable knob lives in one file, `~/.unown/agent/addons.json` (respecting `UNOWN_HOME`). The file is seeded on first run and never overwritten afterwards; edit it by hand, drive it from the `/addons` configurator, or flip the advisor with `/advisor on`. The full schema is [below](#the-configuration-file-addonsjson).

Subagent sessions (`UNOWN_SUBAGENT=1`) get a deliberate subset: `ask_user_question` and `todo` still register (a subagent's todo list rides its own session entries, and the questionnaire degrades safely when nobody can answer it — see [Presentation tiers](#presentation-tiers-and-headless-behavior)), while the **advisor never registers in a subagent** — it would double-spend a second model on every subagent turn to review a transcript nobody reads.

## The three addons at a glance

| | ask_user_question | todo | advisor |
|---|---|---|---|
| What the model gets | a tool that asks you up to 4 structured questions and **blocks until you answer** | a tool managing a 4-state task graph with dependencies | an `<advisory>` message mid-run from a second model |
| What you get | a tabbed dialog in place of the editor — options, previews, free text | a live panel above the editor + `/todos` | a transcript card per advice batch + a footer status line |
| State | none (one blocking call) | session entries (branch-correct) | in-memory per session |
| Commands | — | `/todos` | `/advisor status\|on\|off` |
| Default | on | on | off |

## The configuration file (addons.json)

Path: `$UNOWN_HOME/agent/addons.json` — `~/.unown/agent/addons.json` by default, next to `settings.json`. It is seeded by the first-run bootstrap (and re-seeded only if you delete it); `/addons` and `/advisor on|off` write it atomically. The seeded shape, which doubles as a template:

```json
{
  "askUserQuestion": {
    "enabled": true,
    "collapseKey": "ctrl+]",
    "guidance": {}
  },
  "todo": {
    "enabled": true,
    "maxWidgetLines": 12,
    "collapseKey": "ctrl+shift+t",
    "guidance": {}
  },
  "advisor": {
    "enabled": false,
    "thinkingLevel": "medium",
    "reviewMode": "turn",
    "reviewInterval": 1,
    "maxNotesPerUpdate": 4,
    "immuneTurns": 3,
    "continueSeverity": "concern",
    "showStatus": true
  }
}
```

### askUserQuestion keys

| Key | Type | Default | Effect |
|---|---|---|---|
| `enabled` | bool | `true` | Registers the `ask_user_question` tool (after `/reload`). |
| `collapseKey` | string | `"ctrl+]"` | Collapses/expands the questionnaire dialog mid-question. `"off"` removes the shortcut. See [Keybindings](#commands-and-keybindings). |
| `guidance.description` | string | — | **Full replacement** (no merging) of the built-in tool description the model sees. |
| `guidance.promptSnippet` | string | — | Replaces the one-line snippet in the system prompt's "Available tools" section. |
| `guidance.promptGuidelines` | string[] | — | Replaces the usage-guideline bullets appended to the system prompt. |

### todo keys

| Key | Type | Default | Effect |
|---|---|---|---|
| `enabled` | bool | `true` | Registers the `todo` tool, the overlay and `/todos` (after `/reload`). |
| `maxWidgetLines` | number | `12` (clamped 3–64) | Content rows the overlay may use, heading included. **Hot** — re-read on every render; edits apply to the next frame without `/reload`. |
| `collapseKey` | string | `"ctrl+shift+t"` | Collapses/expands the todo overlay. `"off"` removes the shortcut. |
| `guidance.*` | — | — | Same three keys as askUserQuestion; rewrites the `todo` tool's LLM-facing copy. |

### advisor keys

| Key | Type | Default | Effect |
|---|---|---|---|
| `enabled` | bool | `false` | Registers the advisor runtime, the transcript card, the footer status and `/advisor`. A second model roughly doubles token traffic per reviewed turn — that is why it ships off; flat-rate coding-plan deployments are the cheap topology. |
| `model` | string | unset (session model) | `"provider/model"` or a bare model id, resolved against the session's model registry. Unresolved specs fall back to the session model. |
| `thinkingLevel` | `off\|low\|medium\|high` | `"medium"` | The reasoning effort passed to the advisor model's completion calls. |
| `reviewMode` | `turn\|agent-end` | `"turn"` | `turn`: review the transcript delta every Nth turn. `agent-end`: review once, when the primary agent finishes. |
| `reviewInterval` | number | `1` (clamped 1–64) | With `reviewMode: "turn"`, review every Nth eligible turn. |
| `maxNotesPerUpdate` | number | `4` (clamped 1–32) | Max non-blocker advises admitted per review batch; blockers are exempt. |
| `immuneTurns` | number | `3` (clamped 0–32) | Turns after a steering advise during which further **concerns degrade to asides** (the steer already interrupted; back-to-back interrupts would be noise). Blockers never degrade. |
| `continueSeverity` | `nit\|concern\|blocker` | `"concern"` | Parsed, validated and round-tripped, but **not consumed by the current runtime** — reserved for a future "may a finished agent be woken" latch. Setting it today has no effect. |
| `instructions` | string | unset | Free-form per-user text appended to the advisor's system prompt inside `<user instructions>` — review priorities, house rules, what to watch for. |
| `showStatus` | bool | `true` | Shows the `advisor:` segment in the TUI footer while the addon is active. |

The advisor has no `guidance` block — its model-facing copy is the system prompt, so `instructions` (and a project `WATCHDOG.md`, see [below](#watchdog-guidance-and-per-user-instructions)) is the tuning surface.

### Parsing and seeding rules

- **Never clobber**: seeding writes the file only when absent. Hand edits always survive `/addons` toggles (writes are read-modify-write over the fresh disk state) and reboots. Delete the file to reset to defaults — it re-seeds on the next boot.
- **Degrade, never crash**: unknown keys are dropped; malformed values fall back to their defaults; a non-object or unparsable JSON file yields the default config wholesale (with a one-line `[unown-addons]` warning on stderr). A bad config can never kill session boot.
- **Clamps**: `maxWidgetLines` 3–64, `reviewInterval` 1–64, `maxNotesPerUpdate` 1–32, `immuneTurns` 0–32; non-integer numbers are truncated first.
- **Atomic writes**: every save (`/addons`, `/advisor on|off`) writes a temp file in the same directory and renames it over the target — a torn write can never leave a half-written config.
- Unknown keys you hand-add are dropped at load, and the next `/addons` save persists only the known set — custom extras do not survive a configurator write.

## ask_user_question

The problem it solves: an agent mid-run that needs a decision has two bad options — guess, or end the turn to ask in chat and lose its working context. `ask_user_question` gives it the third: a tool call that **blocks the agent until you answer**, so the turn continues with your decision in hand.

The model calls it with 1–4 questions, each carrying 2–4 options:

```json
{
  "questions": [
    {
      "question": "Which library should we use for date formatting?",
      "header": "Library",
      "options": [
        { "label": "date-fns (Recommended)", "description": "Tree-shakeable, functional API" },
        { "label": "dayjs", "description": "Moment-compatible API, tiny core" }
      ],
      "multiSelect": false
    }
  ]
}
```

### The question contract

| Field | Constraint | Notes |
|---|---|---|
| `questions` | 1–4 | More than one question gets a tabbed dialog; one gets a single panel. |
| `question` | free text | The full question, shown at the top of the tab. |
| `header` | ≤ 16 chars (hard) | The short chip/tag naming the tab. Longer requests are rejected at runtime. |
| `options` | 2–4 per question | Each `{label, description, preview?}`. |
| `label` | ≤ 60 chars (hard) | The choice text. `(Recommended)` suffix convention for the model's preferred first option. |
| `description` | free text | Shown under the focused option — the trade-off explanation. |
| `preview` | optional, single-select only | Markdown-ish content rendered in a monospace box beside the options (mockups, code snippets, config variants); fenced code markers are stripped, 12 rows max with a `✂ N lines hidden` footer. |
| `multiSelect` | bool, default false | Checkboxes instead of radio rows; the answer carries all selected labels plus any typed text. |

Three labels are reserved and rejected if the model authors them: `Other`, `Type something.`, `Next` — the UI appends and manages those rows itself. A `"Type something."` row is auto-appended to **every** question, so free-text answers are always possible; validation also rejects duplicate questions, duplicate option labels, and questions with fewer than 2 options, each with the exact reason in the tool result. (Models that emit nested objects as JSON *strings* are tolerated — stringified `questions`/`options` are decoded before validation.)

### The dialog

The full TUI presentation: a bordered box that replaces the input editor at the bottom of the screen while the questionnaire is open (the editor and its draft are restored on close) — a tab bar (an answered question shows a filled marker; the last tab is `✓ Submit`), the current question, numbered options with their descriptions under the focused row, the preview box when the focused option carries one, and a footer listing the live keymap.

| Key | Action |
|---|---|
| ↑ / ↓ | Move between rows (wraps); landing on "Type something." opens the text editor with the tab's draft preloaded |
| Enter | Select the focused option / confirm typed text / activate Next-Submit |
| Space | Toggle a checkbox (multiSelect questions only) |
| Tab / Shift+Tab / ← / → | Switch question tabs (multi-question dialogs only) |
| `n` | Open the notes side-band for the current question (Enter saves, Esc discards); on the submit tab it edits the **global note** that applies to all answers |
| Esc | Cancel the whole questionnaire (a decline) |
| Ctrl+] (configurable) | Collapse the dialog to a single status line; while collapsed only Esc passes through |
| Shift+Enter / Ctrl+U | Newline / clear line while typing free text |

Confirming a question auto-advances to the next tab (multi-question dialogs); drafts, notes and checkbox state persist per tab while you navigate. The terminal bell rings once when the dialog opens (TTY only) so a backgrounded terminal gets your attention.

The **submit tab** reviews every answer before you commit: each question with its chosen answer, per-question and global notes, a warning row counting unanswered questions (submitting with gaps is allowed — they are reported, not fabricated), and the Submit/Cancel pair. The tool result the model receives enumerates the answers (`"Which library?"="date-fns"` …), any unanswered questions, and the note; a cancelled questionnaire returns `User declined to answer questions` (your partial answers and note still ride the machine-readable details).

### Presentation tiers and headless behavior

The same tool degrades by host capability:

- **TUI** — the full dialog, mounted inline in place of the editor (the draft is preserved and restored).
- **RPC / ACP** (`unown acp`) — a sequential walker over the host's native select/input dialogs: options become numbered lines (previews flattened, capped), multi-select answers are typed as `1,3; custom answer`. Dismissing any dialog cancels the whole questionnaire.
- **Headless** (print mode, JSON subagents) — the tool is **stripped from the active set** before each agent run: a session with no UI never advertises a question nobody can answer, so the model doesn't burn a turn on it. The stripping is reconciled both ways (a UI session that regains the tool gets it back), and a stray direct call still returns a typed decline — never a silent success.

## todo

The first-generation todo tool (`list`/`add`/`toggle`/`clear`) is gone; the addon-era `todo` is a task graph. Actions: `create`, `update`, `list`, `get`, `delete`, `clear`.

A task carries `id` (per-session counter), `subject` (required, short and imperative), `description` (long-form), `activeForm` (a present-continuous label like "writing tests", shown while the task is in progress), `status`, `blockedBy` (ids of tasks this one waits on), `owner`, and free-form `metadata` (pass `null` for a key on update to delete it).

### The task machine

Four states, one terminal:

| From | Legal transitions |
|---|---|
| `pending` | `in_progress`, `completed`, `deleted` |
| `in_progress` | `pending`, `completed`, `deleted` |
| `completed` | `deleted` |
| `deleted` | — (tombstone; terminal) |

A same-status update is a legal no-op (`No change: #3 already matches…`). Illegal jumps (`completed` → `pending`) are rejected with the exact transition in the message. `delete` is a soft tombstone — `list` hides deleted tasks unless you pass `includeDeleted: true`, and `get` shows the full record plus the reverse dependency list (`blocks: #4, #7`). `clear` resets the whole list and rewinds the id counter.

### Dependencies (blockedBy)

`blockedBy` says "this task waits on those". On `create`, pass the initial id set (every id must reference a live task). On `update`, dependencies merge additively — `addBlockedBy: [4]` adds, `removeBlockedBy: [2]` removes; never resend the full array. Three guards run on every edge change:

- a task cannot block **on itself**;
- every referenced id must exist and not be deleted;
- the proposed merged graph is checked for cycles (DFS over live edges) — `addBlockedBy would create a cycle in the blockedBy graph` is rejected, and the state is returned untouched.

Rejected mutations never half-apply: the reducer's exact rejection reason rides both the tool text and the machine-readable details.

### The live overlay

Whenever the session has at least one non-deleted task, a panel renders above the editor: a `Todos (done/total)` heading (accent-colored while work is pending), one row per visible task — `○` pending, `◐` in progress (its subject in accent, the `activeForm` in parens), `✓` completed — with `#id` prefixes appearing only once some visible task carries dependencies (`⛓ 2,5` chains). The row budget is `maxWidgetLines` minus the heading: completed tasks drop first when overflowing, then the tail truncates, and a `+N more (X completed, Y pending)` summary row accounts for everything hidden.

Completed rows you have already seen fade at the **next agent turn boundary** — the panel tracks what it displayed during the turn and hides those ids when the next turn starts (they stay in `list`/`get` output). Ctrl+Shift+T collapses the panel to its heading; the panel disappears entirely when the list empties.

All model-authored text (subjects, descriptions, active forms) is sanitized before rendering: CSI/OSC escape sequences, stray escapes, bidi controls and non-printable C0/C1 characters are stripped — a model cannot inject terminal control codes through a task subject.

### Persistence and branching

Every state-changing call appends a `unown-todo-state` entry to the session tree. On `session_start`, `session_compact` and `session_tree`, the state replays from the branch: the last valid snapshot on that branch wins (custom entries take precedence over toolResult details; corrupt or foreign entries are skipped). The consequence: `/fork`, `/tree` navigation, `/resume`, compaction and `/reload` all reconstruct exactly the list that branch had — ids included. The `/goal` completion gate reads the same foreground list (every todo done, at least one tracked).

`/todos` prints the session's list grouped by status — Pending / In Progress / Completed — with dependency chains and the completion tally; it is the quick human view of what the agent believes is left.

## advisor

A second model instance — the advisor — watches the primary session as a compact stream of per-turn deltas, verifies claims with read-only tools, and sends terse advice back to the primary agent mid-run. It stays **out-of-band**: it is never the substrate, never in the tool list, and the emission guard below is the only path from the advisor model to your session. It ships **off** because a second model roughly doubles token traffic per reviewed turn; turn it on with `/advisor on`, the `/addons` configurator, or the config file (`/reload` applies), and route it to any registry model with `advisor.model`.

### What it watches

Not the raw transcript — a rendered delta per turn: full user and assistant text, one-line cards per tool call (`→ edit ⇒ 42 lines`; error results append the first error line), bounded expanded tool IO (bodies ≤ 8 KiB, middle-truncated past 80 lines), and the `[in progress — more steps follow]` marker riding last so the cacheable prefix never flips between mid-run and final renders. Deltas that arrive while a review is already running coalesce into the next batch; reviews are fire-and-forget from turn boundaries — the primary agent never waits on the advisor.

The advisor's own loop is bounded (≤ 8 model iterations per review) and stops after the last `advise` call in a message — the upstream graceful stop, expressed as a loop bound. Its read-only tools (`read`, `grep`, `find`) are jailed to the session's project directory, with result bodies capped at 8 KiB. Its own context trims oldest-first against 60% of its model's context window, with a one-line elision marker. After 3 consecutive failed reviews it halts itself (`advisor: halted after repeated failures`) instead of burning tokens in a crash loop; `/advisor status` shows the state.

### The advise contract and severity ladder

The advisor's only output tool is `advise` — one concrete, terse note plus an optional severity:

| Severity | Meaning | Delivery |
|---|---|---|
| `nit` (or omitted) | minor improvement, optional | aside — queued for the next turn boundary |
| `concern` | likely-wrong or materially wasteful approach | **steer** — interrupts the primary agent mid-run |
| `blocker` | progress clearly contradicts an instruction, circles unsolved, claims completion over dropped scope, or ships stubs/thin verification | **steer**, always — never degrades, never dedupes |

### The emission guard

Every advise passes an admission ladder before it can reach you: empty check → noise filter (`lgtm`, `continue`, `ok`… are dropped) → rank-aware dedupe (a re-raise is admitted only at a strictly higher severity; blockers exempt) → per-update budget (`maxNotesPerUpdate` non-blocker slots; a strictly-higher-rank note displaces the lowest-rank pending slot). Suppressions are reported back to the advisor model as tool results (`Dropped: already raised.`), so it learns not to repeat itself.

### Delivery policy

Nits queue as **asides** — one merged message at the next turn boundary (and at agent end), never interrupting. Concerns and blockers **steer** — a message delivered mid-run that triggers a turn, routing alone (a steer never rewrites queued asides' channel). After a steer, `immuneTurns` (default 3) of degraded operation follow: further concerns deliver as asides — the interrupt already landed, and back-to-back interrupts are noise. Blockers bypass the immunity.

The primary agent receives advice as `<advisory severity="concern" turns_ago="2" guidance="weigh, don't blindly obey">` XML in a custom message; you see a compact transcript card per batch (`ⓘ Advisor 2 notes · 1 blocker` with the notes, severity-colored) and, with `showStatus`, a footer segment (`advisor: reviewing…` / `advisor: watching (12 reviews · 30 advises · 481k tokens)`).

### Watchdog guidance and per-user instructions

A `WATCHDOG.md` (project root, or `.unown/WATCHDOG.md`) is appended to the advisor's system prompt as `<advisor-only guidance>` — review priorities and project traps that tune what the advisor watches for without touching the primary agent's prompt. `advisor.instructions` in addons.json appends your own `<user instructions>` block on top, globally.

`/advisor` (present whenever the addon is enabled) reports status: enabled/active state, the resolved model, cadence, budgets, thinking level, the last status line, usage totals, and whether watchdog guidance loaded. `/advisor on|off` flips and persists the flag — `/reload` applies it fully.

## The /addons configurator

`/addons` opens a select-driven menu (works in every terminal; headless runs are told to edit the file instead — the command requires interactive TUI mode, including for `/addons status`):

```text
unown addons — pick an addon to configure (Esc to exit)
  ask_user_question  [on]
  todo               [on]
  advisor            [off]
  status — show the effective configuration
```

Each submenu edits that addon's settings — enable/disable, the questionnaire's collapse key, the todo overlay's row budget and collapse key, the advisor's model / review cadence / notes-per-review / thinking level. Every change persists to `addons.json` immediately (atomic write), and the change message states when it applies: the todo row budget re-reads on every render (live now), everything else rebinds after `/reload`. `status` prints the effective configuration plus the advisor's live status line. Esc backs out of any menu.

## Commands and keybindings

| Command | What it does |
|---|---|
| `/addons` | Interactive configurator for all three addons — every change persists immediately |
| `/addons status` | Print the effective addons.json + advisor status (TUI mode) |
| `/advisor` | Advisor status: model, cadence, budgets, usage, watchdog state |
| `/advisor on` / `/advisor off` | Flip + persist `advisor.enabled` — `/reload` applies it |
| `/todos` | Show the session todo list, grouped by status with dependency chains |

The two collapse shortcuts are addon-provided and configurable:

| Key | Default | Action |
|---|---|---|
| `ctrl+]` | configurable (`askUserQuestion.collapseKey`) | Collapse/expand the questionnaire dialog |
| `ctrl+shift+t` | configurable (`todo.collapseKey`) | Collapse/expand the todo overlay |

Collapse-key specs use pi's keybinding grammar — the same engine `/hotkeys` and `~/.unown/agent/keybindings.json` use — so platform conventions come along for free. The grammar: modifiers `ctrl`, `shift`, `alt`, `super` (each at most once, joined with `+`), then a base key that is a single printable character, a named key (`escape`, `enter`, `return`, `tab`, `space`, `backspace`, `delete`, `insert`, `clear`, `home`, `end`, `pageup`, `pagedown`, `up`, `down`, `left`, `right`), or a function key `f1`–`f12`. `"off"` disables the shortcut. Typos do **not** fall back to a bare-key match: pi's parser takes the last `+`-segment as the base key, so `ctr+]` would capture every bare `]` press globally — invalid specs are rejected at load and resolve to the default instead.

## Hot-reload semantics

| Field | Applies |
|---|---|
| `todo.maxWidgetLines` | Immediately — the overlay re-reads it on every render (from disk) |
| Everything else (`enabled`, `collapseKey`, `guidance.*`, all `advisor.*`) | At `/reload` — these bind when the extension registers |

Two nuances worth knowing: the advisor runtime is created lazily at the session's first turn boundary and keeps the config it was created with, so `/addons` edits made before that point apply wholesale while later ones need `/reload`; and `/advisor on|off` mutates the live flag but the full effect (extension registration/removal) still needs `/reload`.

## Cross-platform notes

The addons are pure TypeScript over the pi-tui layer — no native modules, no platform-specific code paths. The dialogs and overlay render through the same components pi itself uses, so Linux, macOS and native Windows get identical behavior; keybinding specs are parsed by pi's key matcher, which maps the grammar onto each platform's terminal conventions (the Windows/WSL variants you see in `/hotkeys` apply to the addon shortcuts too). The config file lands at `$UNOWN_HOME/agent/addons.json` on all three platforms. One honest limit: the collapse keys are terminal-keyboard specs, not mouse or touch surfaces — on terminals that cannot produce a spec (some mobile clients), set the key to `"off"` and rely on the commands.

## Design contracts

The guarantees the addon framework is built on — each one degrades rather than breaks:

1. **Never-clobber seeding** — `addons.json` is written only when absent; user edits always survive reboots, `/addons` writes and `/advisor` toggles.
2. **Degrade-not-crash parsing** — unknown keys dropped, malformed values reset to defaults, unparsable JSON yields the default config with a warning; a bad config never kills session boot.
3. **Atomic writes** — temp file + rename, so a crash mid-write can never leave a half-written config.
4. **State-on-session-entries** — todo state rides `unown-todo-state` entries on the branch, so `/fork`, `/tree`, `/resume`, compaction and `/reload` reconstruct the branch-correct list; corrupt entries replay as empty, never as garbage.
5. **Headless reconciliation** — `ask_user_question` is stripped from the active tool set (both directions) whenever a session has no UI, and a stray call returns a typed decline; the model never asks a question nobody can answer.
6. **The emission guard is the only path** — advisor output reaches the primary agent solely through the noise → dedupe → budget ladder; the advisor model has no other channel, no tools that write, and no way to loop itself.
7. **Sanitized rendering** — model-authored text rendered into the terminal (task subjects, descriptions, active forms) is stripped of escape sequences and bidi controls.
8. **Subagent discipline** — the advisor never registers in subagents (no double-spend); the overlay belongs to the foreground session's UI and simply never mounts without one.
9. **Best-effort surfaces** — persistence, re-render requests and status lines are all guarded; a failure inside an addon logs (in `--verbose`) and otherwise stays out of the way of the session.

## Where the code lives

`pi-repo/packages/self-learning/src/addons/` — `index.ts` (the extension + `/addons`), `config.ts` (schema, parsing, atomic save, seeding), `ask-user-question-core.ts` + `ask-user-question.ts`, `todo-core.ts` + `todo.ts`, `advisor-core.ts` + `advisor.ts`. The `-core` modules hold the pure logic (state machines, validation, the emission guard) and are unit-tested headlessly: `test/addons/config.test.ts` (33 tests — config parsing plus the questionnaire state machine, key routing and response envelope), `test/addons/todo-core.test.ts` (22), `test/addons/advisor-core.test.ts` (20), `test/addons/advisor-runtime.test.ts` (7 — delivery channels, noise suppression, immune-turn degradation, agent-end boundaries).
