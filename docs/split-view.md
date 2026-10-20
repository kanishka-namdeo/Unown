# Split-view display mode

A built-in TUI display mode that splits the session window into live side panels — a top band with the model's reasoning stream and every tool call, a right dock of the files the session touches, and an optional response-only transcript. A port of [pi-split-view 1.1.0](https://github.com/Hugo-W/pi-split-view), wired into every unown session as a hidden built-in extension: nothing to install, and off until you turn it on.

- [The three surfaces](#the-three-surfaces)
- [Quick start](#quick-start)
- [The top band](#the-top-band)
- [The files dock](#the-files-dock)
- [Response-only transcript](#response-only-transcript)
- [Commands](#commands)
- [The config file (ui-panels.json)](#the-config-file-ui-panelsjson)
- [Fullscreen vs regular mode](#fullscreen-vs-regular-mode)
- [Model notes (the thinking panel)](#model-notes-the-thinking-panel)
- [Cross-platform notes](#cross-platform-notes)
- [Troubleshooting](#troubleshooting)

Related pages: [usage](usage.md) · [configuration](configuration.md) · [providers](providers.md) · [troubleshooting](troubleshooting.md)

## The three surfaces

Long agent turns bury the two things you actually want to watch — what the model is thinking, and what it is doing to your files. Split view keeps both visible beside the transcript, composed as one layout layer over pi's native transcript and editor (the editor, input handling and footer are never touched):

1. **The top band** — a Thinking panel (the live reasoning stream) beside a Tool Usage panel (every tool call with its status and arguments). Either panel can be toggled; the band disappears when both are off.
2. **The files dock** — a right column listing every file the session has read, written or seen, newest first, with an edit-diff subpanel for the last edit.
3. **Response-only transcript** — swaps the full transcript for just user + assistant text, for when the tool chatter is noise.

A fourth, smaller surface rides under the editor: a dim one-line summary of the touched files (count + up to three names), shown in both layout modes once the session has touched files, independent of the panel toggles.

The port keeps the upstream extension's design (one layout layer, bounded buffers, cached panel renders) and adapts it to the vendored pi 0.84.3 — session history (thinking blocks, tool calls, files, the last edit diff) is rebuilt from the session branch on resume and branch switches.

## Quick start

Needs the fullscreen interface layout — the default for new installs (see [Fullscreen vs regular mode](#fullscreen-vs-regular-mode)).

```text
/split          # band on: Thinking + Tool Usage (the classic default when nothing is saved)
/files          # files dock on
/split-save     # persist this layout as the startup default for NEW windows
```

- Panels start **off** on a fresh install — nothing renders until you turn it on, and nothing persists until `/split-save`.
- Every toggle is session-local: two unown windows can run different layouts. Only `/split-save` writes the shared defaults file, and only for windows opened afterwards.
- `/split` off returns the bare pi layout — band, dock and response-only all off.

## The top band

**Thinking.** Streams the model's reasoning live while it thinks. The panel renders the newest window (a bounded buffer of 400 logical lines, ~96 visual rows); the full history stays in the transcript, where `Ctrl+T` toggles thinking-block display. When the model is not reasoning, the panel reads `Thinking idle` — that is the model, not a bug (see [Model notes](#model-notes-the-thinking-panel)).

**Tool Usage.** One entry per tool call: a status mark (`●` running, `✓` done, `✗` failed), the tool name, and its arguments truncated to fit. `/split-tools-view` picks the detail level — compact (one line per call) or full (adds an output preview: the first two lines plus a `+N more` marker). Storage is bounded: the newest 60 calls, 32 KB and 20 lines per stored output. On `/resume`, `/tree` branch switches and reloads, the history is rebuilt from the session branch.

**Geometry.** `/split-height <n>` sets the band height in rows (6–40, default 20). With both panels on, `/split-tools-width <pct>` sets the tools panel's share of the band width (20–60%, default 35); thinking gets the rest, with minimum widths (24 columns thinking, 20 tools) below which the ratio clamps on narrow terminals. A single panel takes the full band width. Each panel scrolls independently — its right frame edge doubles as the scrollbar column.

## The files dock

A right column, 34–48 columns wide (25% of the terminal width, clamped), hidden below 90 terminal columns — if you toggle it on while narrower, the command says so (`Files panel on — hidden below 90 cols`).

The list is newest-first, one row per file with its op letters and a `×N` counter when a file was touched repeatedly. The legend at the bottom of the list:

```text
r read · w write · s seen(bash) · a subagent
```

- `r` — `read` calls, plus path-like arguments of other tools that resolve to real files
- `w` — `write` and `edit` calls
- `s` — tokens in `bash` commands that resolve to existing files
- `a` — subagent tool calls. Reserved: the vendored pi never emits the subagent event channel, so in practice you see `r`/`w`/`s`

When more than three files from the same directory are in the list, they collapse under a `dir/` header row. The buffer caps at 500 files (oldest evicted) and the list ends with `… +N more` when the visible window runs out of rows.

**Edit-diff subpanel** (`/split-diff`): below the list, the last edit's unified diff with its path. The preview is computed from the edit's old/new text pairs the moment the call starts, then replaced by the authoritative diff from the tool result. Turning the subpanel off keeps just the list.

**The under-editor line.** Independently of the panels, a dim one-liner under the editor shows the touched-file count and up to three basenames (`+N` for the rest) — in fullscreen and regular mode alike.

## Response-only transcript

`/split-trim-response` swaps the transcript for a response-only view: user and assistant text only, rendered with pi's own message components. Thinking blocks and tool calls stay in the session — and in the band and dock — they are just not printed in the transcript. Scrollback is complete, the scroll offset survives branch switches, and the editor dock is reused verbatim, so toggling back and forth is lossless. `/split-divider rule|space` picks the separator between successive assistant answers — a dim dashed rule (default) or a plain blank line.

## Commands

| Command | Argument | Effect |
|---|---|---|
| `/split` | — | Full toggle pair. Off = every panel off, bare pi layout. On = the saved startup defaults — or, when nothing is saved, the classic Thinking + Tool Usage band |
| `/split-thinking` | — | Toggle the thinking panel within the band |
| `/split-tools` | — | Toggle the tool-usage panel within the band |
| `/split-tools-view` | — | Tools panel detail: compact (one line per call) ↔ full (adds the output preview) |
| `/split-tools-width` | `<pct>` 20–60 | Tools panel's share of the band width in percent (default 35); no argument prints the current value |
| `/files` | — | Toggle the files panel — docked right in fullscreen, non-capturing overlay in regular mode |
| `/split-diff` | — | Toggle the files panel's edit-diff subpanel |
| `/split-trim-response` | `on` \| `off` | Full transcript ↔ response-only (no argument toggles) |
| `/split-divider` | `rule` \| `space` | Response-only divider between successive answers (no argument toggles) |
| `/split-height` | `<n>` 6–40 | Band height in rows (default 20); no argument prints the current value |
| `/split-save` | — | Write the current layout to `ui-panels.json` as the startup defaults for new windows |

`/split` and `/split-trim-response` require fullscreen mode — in regular mode they warn (`requires fullscreen mode`) instead of pretending. `/files` works in both modes (see [Fullscreen vs regular mode](#fullscreen-vs-regular-mode)).

**The `--no-split` startup flag.** `unown --no-split` starts the session with every panel off, ignoring the saved defaults in `ui-panels.json` — the bare pi layout for this window only. Nothing is written back; the next normal start uses the saved defaults again.

## The config file (ui-panels.json)

`~/.unown/agent/ui-panels.json` is a **template of startup defaults, not live state**:

- Read once at session start; toggles during a session never write it back.
- Only `/split-save` writes it (the whole current layout, every key).
- Concurrent windows therefore never clobber each other — each window's toggles are its own.
- Hand-editing is safe: missing keys, malformed JSON and wrongly-typed values all fall back to the defaults below, and out-of-range numbers clamp.

| Key | Type | Range | Default | Meaning |
|---|---|---|---|---|
| `split` | boolean | — | `false` | Master switch for the top band |
| `thinking` | boolean | — | `true` (with `split`) | Thinking panel within the band |
| `tools` | boolean | — | `true` (with `split`) | Tool-usage panel within the band |
| `files` | boolean | — | `false` | Files dock / overlay |
| `diff` | boolean | — | `true` | Edit-diff subpanel in the files panel |
| `answerDivider` | string | `rule` \| `space` | `rule` | Response-only divider between answers |
| `toolMode` | string | `compact` \| `full` | `compact` | Tools panel detail |
| `trimResponse` | boolean | — | `false` | Start in response-only mode |
| `bandHeight` | number | 6–40 | `20` | Band height in rows |
| `toolsWidthPct` | number | 20–60 | `35` | Tools panel's share of the band width (%) |

`thinking` and `tools` only take effect when `split` is true.

## Fullscreen vs regular mode

The band, the dock and response-only mode are composed through the fullscreen (alt-screen) layout engine, so they need `"tuiMode": "fullscreen"` in `~/.unown/agent/settings.json`:

| Surface | Fullscreen | Regular (scrollback) |
|---|---|---|
| Top band | yes | no — `/split` warns `requires fullscreen mode` |
| Files dock | docked right | `/files` opens a non-capturing overlay (top-right; `/files` again closes it) |
| Response-only | yes | no — `/split-trim-response` warns |
| Under-editor file line | yes | yes |

- **New installs** seed `"tuiMode": "fullscreen"` in `settings.json` (the seed never rewrites an existing file).
- **Existing installs** keep whatever they saved. Switch live with `/settings` — the "TUI mode" entry, described "Interface layout" (pi's own wording for the entry still calls fullscreen experimental; unown ships it as the new-install default) — or edit `settings.json` by hand, which takes effect on the next launch.

## Model notes (the thinking panel)

The thinking panel lights up only when the model actually streams reasoning:

- **Bundled bridge (default setup):** `kimi-k2.5` streams no thinking. The qwen thinking models do, but the bridge turns thinking off for them by default (snappier agent turns) — set `BRIDGE_QWEN_THINKING=1` in the repo's `.env` and restart the stack (`bun run agent:stop && bun run agent:start`). With it on, `qwen3.7-plus` streams `reasoning_content` and the panel renders it live. Env reference: [configuration](configuration.md#llm-bridge-mini-servicesllm-bridge).
- **Direct providers:** any reasoning-capable model that streams thinking works — see [providers](providers.md).
- No reasoning stream → `Thinking idle`. That is the model, not a bug.

## Cross-platform notes

The feature is pure TypeScript over `node:fs` / `node:os` / `node:path` — no platform-specific code and no shell-outs. It runs everywhere unown runs: Linux, macOS and native Windows (the TUI layer underneath it uses the native terminal modules on win32/darwin). Displayed paths are relativized to the project directory when inside it, `~`-collapsed under your home directory, absolute otherwise.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| The band or dock never appears | Panels start off — run `/split` (band) and `/files` (dock). The dock also hides below 90 terminal columns; widen the terminal |
| `/split` says `requires fullscreen mode` | The session runs the regular (scrollback) layout — switch with `/settings` (TUI mode) or set `"tuiMode": "fullscreen"` in `~/.unown/agent/settings.json`. See [Fullscreen vs regular mode](#fullscreen-vs-regular-mode) |
| `/files` says `hidden below 90 cols` | The dock is composed but the terminal is narrower than 90 columns — widen the window |
| The thinking panel reads `Thinking idle` | The model is not streaming reasoning — see [Model notes](#model-notes-the-thinking-panel) |
| A saved layout did not come back | Toggles are session-local and `ui-panels.json` is read only at startup — run `/split-save` to persist, and remember hand edits apply to new windows only |
| `--no-split` does nothing | Check `unown --help` — the flag must appear there; older builds did not route it through the CLI parser |
