# Vendored pi upstream gaps: what the product *underneath* Unown ships that Unown does not expose

Task ID: R7 · Agent: pi-upstream-explorer · Research date: 2026-10-25
Vendored upstream: **pi coding agent 0.84.3** (`pi-repo/packages/coding-agent/package.json:4`, upstream earendil-works/pi, released 2026-08-24) **+ a local `[Unreleased]` changelog block + ~29 local commits that touch the vendored upstream tree** (verified via `git log` in `pi-repo/`; the divergence is documented in `docs/windows.md:167`). Unown version: 0.0.15 (`package.json:4`).

The core architectural fact that shapes every finding: **unown boots pi's *unmodified* `InteractiveMode`** (`pi-repo/packages/self-learning/src/cli.ts:2741-2746`) with inline extensions layered on (`cli.ts:1018-1036`). So the TUI is a near-complete pass-through: every pi slash command, keybinding, selector, and setting is *reachable* — the question is what unown **registers on top, hides, renames, fails to document, or wires inconsistently**. Unown's own headless/ACP lanes are reimplementations, and those are where pi features get dropped.

Statuses: **EXPOSED** (works, documented) · **HIDDEN** (works pass-through, but unown HELP/docs never mention it) · **DISABLED** (unown actively blocks/regresses it) · **DUPLICATED** (unown ships a parallel surface) · **RENAMED** (same name, different semantics vs pi).

---

## pi feature inventory

All paths relative to `pi-repo/packages/coding-agent/` unless prefixed.

### 1. Slash commands (built-in registry)

The public registry is `BUILTIN_SLASH_COMMANDS` in `src/core/slash-commands.ts:19-43` (22 commands, also re-exported at `src/index.ts:7`). The actual TUI submit handler additionally recognizes 4 hidden commands not in that list — `src/modes/interactive/interactive-mode.ts:3102-3235`:

| Command | Handler | Source |
|---|---|---|
| `/settings` | settings menu (36+ toggles) | interactive-mode.ts:3102, 4745-4964 |
| `/scoped-models` | enable/disable models for Ctrl+P cycling (save/reorder/provider toggles) | interactive-mode.ts:3107, components/scoped-models-selector.ts |
| `/model [search]` | model picker (fuzzy search; provider/id cycling) | interactive-mode.ts:3112, components/model-selector.ts |
| `/thinking [level]` | thinking-level picker (off/minimal/low/medium/high/xhigh/max) | interactive-mode.ts:3118, components/thinking-selector.ts |
| `/export [path]` | **HTML export by default**, `.jsonl` if path ends in .jsonl (current theme colors, syntax highlight, tool renderers) | interactive-mode.ts:3124, 6525-6541; core/export-html/index.ts:236,288 |
| `/import <path.jsonl>` | resume a session from a pi JSONL file | interactive-mode.ts:3129, 6572-6614 |
| `/share` | redact → export HTML → upload as **secret GitHub gist** (or Radius share artifact) → share URL (PI_SHARE_VIEWER_URL) | interactive-mode.ts:3134, 6616-6625; session-share.ts:46-115, config.ts:511-517 |
| `/copy` | copy last assistant message to clipboard (or fullscreen selection) | interactive-mode.ts:3139, 6627-6635 |
| `/name [text]` | session display name | interactive-mode.ts:3144 |
| `/session` | session info + stats (file, id, tokens, cost) | interactive-mode.ts:3149 |
| `/changelog` | changelog viewer | interactive-mode.ts:3154 |
| `/hotkeys` | all keyboard shortcuts | interactive-mode.ts:3159 |
| `/fork` | fork session at an earlier user message (picker) | interactive-mode.ts:3164, components/user-message-selector.ts |
| `/clone` | duplicate current session at current position | interactive-mode.ts:3169 |
| `/tree` | **session tree navigator** (branch switch, labels, filters, branch summarization) | interactive-mode.ts:3174, components/tree-selector.ts |
| `/trust` | persist project trust decision | interactive-mode.ts:3179, components/trust-selector.ts |
| `/login [provider]` | **OAuth flows** (browser/device-code) for 10+ providers | interactive-mode.ts:3184, components/login-dialog.ts, oauth-selector.ts; pi-ai/src/auth/oauth/* |
| `/logout` | remove provider auth | interactive-mode.ts:3190 |
| `/new` | new session | interactive-mode.ts:3195 |
| `/compact [instructions]` | manual compaction with optional custom instructions | interactive-mode.ts:3200 |
| `/reload` | reload keybindings/extensions/skills/prompts/themes/context files | interactive-mode.ts:3206 |
| `/resume` | session picker (search, Ctrl+P path, Ctrl+S sort, Ctrl+N named-filter, **Ctrl+R rename, Ctrl+D delete via trash CLI**) | interactive-mode.ts:3226, components/session-selector.ts; docs/sessions.md |
| `/quit` | exit | interactive-mode.ts:3231 |
| `!command` / `!!command` | **user bash mode** (second form excluded from context) | interactive-mode.ts:3237-3253 |
| `/debug` *(hidden)* | dump all rendered lines + terminal info to the debug log | interactive-mode.ts:3211, 6925-6940 (NOT in BUILTIN_SLASH_COMMANDS) |
| `/arminsayshi`, `/dementedelves` *(hidden easter eggs)* | — | interactive-mode.ts:3216-3225 |

Extension/prompt/skill commands surface through `pi.getCommands()` (`src/core/agent-session.ts:2549-2556`): extension commands, prompt templates (`.pi/agent/prompts/*.md` → `/name`), and skills as `/skill:name` (settings `enableSkillCommands`, default true). Extension commands that collide with a builtin get a namespaced invocation name and a warning (`interactive-mode.ts:715-728`).

### 2. Tools (model-facing, built-in)

`src/core/tools/index.ts:95-105` — 8 tools: `read, bash, powershell, edit, write, grep, find, ls`. **Default active set is only `read/bash/edit/write`** (`src/core/sdk.ts:263`); grep/find/ls/powershell are registered but off by default (`docs` + `default-tools-setting.test.ts`). Per-tool options: bash `commandPrefix`/`shellPath`/`exposeSessionEnvironment`/`spawnHook` (`tools/bash.ts:198-209`), read `autoResizeImages` (`tools/read.ts:64-69`), plus operations-injection seams for every tool (used by ACP/remote sessions). `tools-manager.ts` allows runtime activation. Pi ships managed `rg`/`fd` binary download (`ensureTool`, `getBinDir()` config.ts:557-560).

### 3. TUI features (`src/modes/interactive/`)

- **Themes**: full theme system with schema (`theme/theme.ts`, `theme-schema.json`, built-in `dark.json`/`light.json`, user themes from `getAgentDir()/themes/*.json` config.ts:532-535), **automatic light/dark terminal detection** (settings-selector.ts:195-345, `theme-controller.ts`), theme preview, theme export colors for HTML.
- **Two layout modes**: `regular` scrollback and `fullscreen` alt-screen (`--tui-mode`, settings `tuiMode`), with fullscreen extras: transcript **search** (Ctrl+Shift+F, `tui.altScreen.search` keybindings.ts:89-92), prompt history navigation (Ctrl+Up/Down), `fullscreenExitOutput`, `fullscreenScrollbar`, `fullscreenCopyOnSelect` (settings-manager.ts:142-145), right-click paste, URL opening.
- **Command palette** (Ctrl+K, `components/command-palette.ts`), **editor autocomplete** with fuzzy model/thinking/login/file/command completions (`interactive-mode.ts:730-779+`).
- **Keybindings**: full remap layer (`core/keybindings.ts:75-238`, `keybindings.json`), including editor kill-ring (`yank`/`yankPop`), undo, jump-to-char (Ctrl+]/Ctrl+Alt+]), word ops, pageUp/Down, `ctrl+g` external editor (`app.editor.external`, external-editor.ts), `ctrl+v` **image paste from clipboard** (clipboard-image.ts, BMP conversion), `ctrl+x` copy, `alt+enter` queue follow-up, `alt+up` dequeue, `ctrl+o` expand tools, `ctrl+t` toggle thinking blocks, `shift+tab` cycle thinking, `ctrl+p`/`ctrl+shift+p` model cycling, `ctrl+l` model picker, `ctrl+n` named-session filter, double-escape → tree/fork (`doubleEscapeAction`). No vim mode and no mouse support (mouse handling is upstream pi-tui only for selection/paste; "mouse-tracking" teardown noted in CHANGELOG Unreleased).
- **Streaming rendering**: mermaid diagram rendering (`components/mermaid.ts`, settings `markdown.mermaid` off/final/streaming), markdown transform hooks, subagent lanes (color-lanes), shimmer loaders, diff rendering with theme colors, compaction/branch-summary messages, session diff stats in footer, status line (footer + `setStatus` keys), dynamic border, working-indicator animation, `showTerminalProgress` OSC 9;4 tab-bar progress (settings-manager.ts:44).
- **Images**: inline image rendering (kitty/iterm2/auto), image width cells, auto-resize 2000x2000, EXIF orientation, image tool results; `@file` image attachments from CLI (`cli/file-processor.ts:25-87`).
- **Trust flow**: first-time setup dialog, project trust selector, `defaultProjectTrust` setting, `--approve/--no-approve` overrides.
- **Session tree**: branching + labels (`setLabel`), tree filters (default/no-tools/user-only/labeled-only/all), branch summarization with custom instructions.
- **Update machinery**: changelog display, version check (github releases), package update notifications, tmux keyboard check, first-time setup.

### 4. Settings surface (`src/core/settings-manager.ts:94-146`, docs/settings.md)

~40 keys: `defaultProvider`, `defaultModel`, `defaultThinkingLevel`, `modelThinkingLevels` (per-model), `thinkingBudgets` (custom token budgets per level), `transport` (sse/websocket/websocket-cached/auto), `steeringMode`, `followUpMode`, `theme`, `compaction.{enabled,reserveTokens,keepRecentTokens}`, `branchSummary.{reserveTokens,skipPrompt}`, `retry.{enabled,maxRetries,baseDelayMs,provider.*}`, `hideThinkingBlock`, `showCacheMissNotices`, `externalEditor`, `shellPath`, `shellCommandPrefix`, `quietStartup`, `defaultProjectTrust`, `npmCommand`, `collapseChangelog`, telemetry/analytics, **`packages` (npm/git resource packages) + `extensions/skills/prompts/themes` path arrays**, `enableSkillCommands`, `terminal.*` (showImages/imageWidthCells/clearOnShrink/showTerminalProgress/hyperlinks/images/trueColor), `images.*`, `enabledModels`, `defaultTools`, `doubleEscapeAction`, `treeFilterMode`, `editorPaddingX`, `outputPad`, `autocompleteMaxVisible`, `showHardwareCursor`, `markdown.*`, `sessionDir`, `httpProxy`, `httpIdleTimeoutMs`, `websocketConnectTimeoutMs`, `tuiMode`, `fullscreen*`. Project scope: `.pi/settings.json` (deep-merged under global; `FileSettingsStorage` settings-manager.ts:213-280).

### 5. CLI flags (`src/cli/args.ts:71-249`, help at 262-446)

`--provider --model (provider/id[:thinking], fuzzy) --api-key --system-prompt --append-system-prompt (repeatable, text-or-file) --mode text|json|rpc --print/-p --continue/-c --resume/-r (picker) --session <path|partial-uuid> --session-id --fork <path|id> --session-dir --no-session --name/-n --models <patterns> (Ctrl+P cycling, globs, :thinking suffix) --no-tools --no-builtin-tools --tools --exclude-tools --thinking <off|minimal|low|medium|high|xhigh|max> --extension/-e --no-extensions --skill --no-skills --prompt-template --no-prompt-templates --theme --use-theme --no-themes --no-context-files --export <file> (HTML) --list-models [search] --tui-mode --approve/--no-approve --offline -- @file attachments (text + images, stdin merge via cli/initial-message.ts:18-43) --verbose`. Plus subcommands `pi install/remove/uninstall/update/list/config/auth` (`package-manager-cli.ts`, `cli/config-selector.ts`, `cli/auth-command.ts`) and the **experimental client/server CLI** (`src/cli/experimental/cli.ts:7` — `pi [--listen] / pi client --connect / pi server`, unix-socket/CBOR `packages/client`+`packages/protocol`, not yet wired into `main.ts` in this snapshot).

### 6. Modes

- **interactive** (TUI, above)
- **print** (`src/modes/print-mode.ts:33`) — text or `--mode json` NDJSON event stream (`src/modes/json-event.ts`)
- **rpc** (`src/modes/rpc/rpc-mode.ts`, protocol `rpc-types.ts:20-74`) — stdin JSONL commands: prompt/steer/follow_up/abort/clear_queue/new_session, get_state, set_model/cycle_model/get_available_models, set_thinking_level/cycle/get levels, set_steering_mode/set_follow_up_mode, compact/set_auto_compaction, set_auto_retry/abort_retry, bash/abort_bash, get_session_stats, **export_html**, switch_session, fork, clone, get_fork_messages, get_entries, **get_tree**, get_last_assistant_text, set_session_name, get_messages, get_commands — plus **extension UI bridging** (`extension_ui_request` select/confirm/input/editor/notify/setStatus/setWidget/setTitle/set_editor_text + responses, rpc-types.ts:246-291). A reusable `RpcClient` is exported (`src/modes/rpc/rpc-client.ts`, `src/index.ts`).
- **experimental client/server** (`packages/client` README: session leases, snapshots, unix/websocket transports) — future-facing, unexposed.

### 7. Extensions API (`src/core/extensions/types.ts:1252-1505`)

Events: project_trust, resources_discover, session_start/info_changed/before_switch/before_fork/before_compact/compact/compact_failed/shutdown/before_tree/tree, context, before_provider_request/headers, after_provider_response, before_agent_start, agent_start/end/settled, ui_prompt_start/end, turn_start/end, message_start/update/end, tool_execution_start/update/end, model_select, thinking_level_select, tool_call, tool_result, user_bash, input. API: registerCommand (with argument completions), **registerShortcut** (1320), **registerFlag** (1329), registerTool (with renderCall/renderResult/promptSnippet/promptGuidelines/constrainedSampling), **registerProvider** (native + config, OAuth config, refreshModels) (1480-1533), **registerMarkdownTransformer** (1355), registerMessageRenderer/registerEntryRenderer (1352,1358), sendUserMessage, setSessionName, **setLabel** (tree labels), exec, get/setActiveTools, getAllTools, getCommands, setModel, get/setThinkingLevel, `events` bus. UI: select/confirm/input/custom/overlay dialogs, notify, **onTerminalInput**, setStatus, setWorkingMessage(+indicator), setHiddenThinkingLabel, **setWidget (aboveEditor/belowEditor)**, **setFooter**, **setHeader**, setTitle, paste/set/getEditorText, **addAutocompleteProvider**, **setEditorComponent**, getAllThemes/getTheme/**setTheme**, get/setToolsExpanded. Command-context extras: newSession/fork/navigateTree/switchSession/reload, waitForIdle, getSystemPrompt(Options), getContextUsage, compact.

### 8. Session format + export

JSONL tree format v3 (`docs/session-format.md`; header + entries, id/parentId branching, versions 1→3 auto-migration). Exporters: `exportSessionToHtml` (themes, XSS-tested, vendor highlight.js+marked), `exportFromFile`, `exportSessionToJsonl` (`core/session-export.ts:7`), share pipeline with `redactSecretsForShare` (`utils/share-redact.ts`).

---

## Unown exposure audit

Unown-side file paths relative to `pi-repo/packages/self-learning/src/` (u-prefix) — pi-side relative to `pi-repo/packages/coding-agent/` (p-prefix).

### pi slash commands

| pi feature | Status in Unown | Where | Notes |
|---|---|---|---|
| `/settings` | EXPOSED (hidden from HELP) | u-cli.ts:2741 boots pi TUI; p-interactive-mode.ts:3102 | Works; HELP (u-cli.ts:142-402) never mentions it; the 36-toggle menu is unown's *only* UI for ~30 pi settings |
| `/model`, `/scoped-models`, `/thinking` | EXPOSED | u-cli.ts pass-through | Documented in u-docs/providers.md:225 (Ctrl+L, Ctrl+P, Shift+Tab, /scoped-models) — the *best*-documented pi commands |
| `/export` (HTML) | EXPOSED in TUI / **missing from unown's CLI export** | p-interactive-mode.ts:6525; u-sessions-cli.ts:264-323 (md\|json only) | DUPLICATED: unown's `/sessions export` + `unown sessions export` ship their own md/json exporter and cannot emit pi's HTML |
| `/import` (pi JSONL) | EXPOSED / DUPLICATED | p:6572; u-tools.ts:3432 (`/sessions import`), u-sessions-cli.ts import + u-import-cli.ts (config migration named `unown import`) | Three different "import" surfaces share one verb (see Inconsistencies) |
| `/share` (gist/Radius) | **HIDDEN** | p-session-share.ts:54; absent from u-cli.ts HELP + docs grep (0 hits) | Fully functional under unown (gh CLI/GITHUB_TOKEN), uses PI_SHARE_VIEWER_URL; zero documentation |
| `/copy`, `/name`, `/session`, `/changelog`, `/hotkeys`, `/tree`, `/trust`, `/login`, `/logout`, `/new`, `/compact`, `/reload`, `/resume`, `/quit`, `/fork`, `/clone` | EXPOSED; most HIDDEN from HELP | pass-through; u-cli.ts HELP lists only unown commands | `/hotkeys` + `/tree`/`/fork`/`/resume`/`/compact`/`/new` are mentioned in u-docs (memory.md:54, addons.md:223, configuration.md:288); `/copy`, `/name`, `/session`, `/changelog`, `/trust`, `/login`, `/logout`, `/hotkeys`, `/reload`, `/quit` unmentioned anywhere |
| `/debug` | EXPOSED in TUI / **DISABLED in input-event lanes** | p-interactive-mode.ts:3211 handled before prompt(); u-termhooks.ts:699-733 unknown-command guard builds its known-set from `BUILTIN_SLASH_COMMANDS` (u-termhooks.ts:704) which omits debug | In ACP/JSON lanes `"/debug"` hits the guard → "Unknown command /debug". Guard list ≠ pi's actual handler list (26 vs 22) |
| `/arminsayshi`, `/dementedelves` | same as /debug | p:3216-3225 | cosmetic |
| `!` / `!!` bash mode | EXPOSED (undocumented in HELP) | p:3237-3253 | u-termhooks PreToolUse guards do NOT see user bash (user-initiated, by design) |

### Unown-registered commands on top (no builtin collisions)

Registered via `pi.registerCommand`: `/plan` `/note` `/agents` `/dashboard`+`/dash` `/promote` `/routines` `/memory` `/learning` `/providers` `/usage` `/context` `/btw` `/output-style` `/insights` `/repomap` `/lsp` `/goal` `/review` `/init-agents` `/doctor-instructions` `/blame` `/sessions` `/recipe` `/wiki` `/edit-resend` (u-tools.ts:2617-3881), `/split*` ×11 + `/files` (u-splitview.ts:1891-2078), `/project-settings` (u-project-settings.ts:221), `/flights` (u-flights.ts:359), `/permissions` `/add-dir` (u-permissions.ts:1066,1153), `/mcp` (u-mcp.ts:2037), `/commit` (u-gittools.ts:624), `/engine` `/hooks` (u-termhooks.ts:1027,1081), `/tasks` (u-fleet-runtime.ts:984), `/addons` (u-addons/index.ts:88), `/advisor` (u-addons/advisor.ts:602), `/todos` (u-addons/todo.ts:619), `/receipts` `/checkpoints` `/checkpoint` `/undo` `/redo` `/restore` (u-checkpoints.ts:1146-1308). Custom commands: `.unown/commands/*.md` + `~/.unown/agent/commands/*.md` ride pi's prompt-template loader (u-cli.ts:994-999, docs/custom-commands.md). None collide with the 22 builtins (pi would namespace them; p-interactive-mode.ts:715-728).

### pi tools

| pi feature | Status | Where | Notes |
|---|---|---|---|
| read/bash/edit/write defaults | EXPOSED | u-session-tools.ts:35 | pi default four kept verbatim |
| grep/find/ls | EXPOSED + **CHANGED DEFAULT** | u-session-tools.ts:72-78 (activate when rg/fd on PATH; u-cli.ts:979,1064 passes as `defaultTools`) | Genuinely better than upstream default-off; documented in AGENTS.md:22 |
| powershell | **HIDDEN/DISABLED** | u-session-tools.ts has no win32 branch; p-tools/index.ts:99 registers it | Registered in the registry, never in unown's default active set; unown never documents activating it |
| `--exclude-tools`, `--no-tools`, `--no-builtin-tools` | **MISSING** | u-cli.ts:558 only `--tools` allowlist | pi flag trio unreachable |
| settings `defaultTools` | EXPOSED (undocumented) | p-sdk.ts:263-270; u-docs/configuration.md never lists it | Reachable by hand-editing `~/.unown/agent/settings.json` |
| bash tool options (shellPath, shellCommandPrefix) | HIDDEN | p-bash.ts:198-209 | settings keys work under `~/.unown/agent/settings.json` but unown docs only mention `keybindings.json`/`settings.json` model keys (u-docs/configuration.md:343) |
| managed rg/fd download | EXPOSED but behavior diverges | u-session-tools.ts:20-26 deliberately avoids pi's auto-download | unown keeps base four when binaries missing (documented rationale) |

Unown adds ~25 session tools: `note`, `task` (+async fleet), `task_control`, `ask_question` (fleet child), `ask_user_question`, `todo`, `fetch_url`, `web_search`, `webfetch`, `lsp` (UNOWN_LSP gate), `browser`, `get_context_remaining`, `view_image`, `routine_list/create/update/run/delete`, MCP `mcp__*` tools, git tools — see file:line list in "pi feature inventory" section 2 counterpart greps (u-tools.ts:1580,1615,2173-2315,2336,2445; u-context-tools.ts:332,389; u-websearch.ts:2110,2148; u-fleet-child.ts:148; u-fleet-runtime.ts:879; u-browser/tools.ts:145; u-mcp.ts:1956; u-addons/*.ts:508,679). `--tools` allowlist applies to all of them (u-cli.ts:558-567).

### pi TUI features

| pi feature | Status | Where | Notes |
|---|---|---|---|
| Themes + light/dark auto + user themes | EXPOSED + BRANDED | u-term.ts:186-193 seeds `themes/unown.json`, u-term.ts:226 pins it; `/settings` Theme entry works; unown documents only the branded theme | pi's `--use-theme`, `--theme`, `--no-themes` flags unreachable |
| tuiMode fullscreen | EXPOSED + CHANGED DEFAULT | u-term.ts:230 seeds `"tuiMode": "fullscreen"` (pi default `regular`) | Documented (u-docs/configuration.md:347) — good |
| Fullscreen search (Ctrl+Shift+F), prompt history (Ctrl+Up/Down), copyOnSelect, scrollbar, exit output | EXPOSED / HIDDEN | p-keybindings.ts:81-92; pass-through | undocumented in unown |
| Command palette Ctrl+K | EXPOSED (enhanced locally) | p:app.palette; local commit abd6556 added it to unown's vendored tree | |
| Editor autocomplete (files, models, commands) | EXPOSED | pass-through | |
| Ctrl+G external editor (`externalEditor` setting, VISUAL/EDITOR) | **HIDDEN** | p-keybindings.ts:126-129; u-docs grep for "external editor"/"Ctrl+G" = 0 hits | works, zero docs |
| Ctrl+V clipboard image paste (BMP conversion, kitty/iterm2) | EXPOSED / HIDDEN | p-keybindings.ts:142-145, p-clipboard-image.ts | no unown doc mentions paste |
| `@file` attachments + `initialImages`/`initialMessages` + stdin merge at launch | **MISSING** | p-cli/file-processor.ts:25; p-cli/initial-message.ts:18; u-cli.ts:2745 passes raw prompt string | `unown "@x.md" "q"` sends literal text; no image attach at launch |
| Keybindings remap (`keybindings.json`, `/hotkeys`) | EXPOSED | u-docs/configuration.md:288 documents it | |
| Session picker rename (Ctrl+R)/delete (Ctrl+D via trash)/sort/filter | EXPOSED / HIDDEN | pass-through; u-docs don't mention | |
| Mermaid rendering, markdown.mermaid, editorPaddingX, outputPad, autocompleteMaxVisible, showHardwareCursor, terminal progress OSC 9;4 | EXPOSED via /settings / undocumented | p-settings-selector.ts:504-814 | |
| Working indicator / hidden thinking label / footer / header seams | PARTIAL | u-splash.ts:469-478 uses setHeader; u-termhooks.ts:648-662 setStatus+notify; setFooter/setWorkingIndicator/setHiddenThinkingLabel/addAutocompleteProvider/setEditorComponent/setTheme APIs unused by unown | |
| Tree labels (`setLabel`) + filters | EXPOSED / HIDDEN | pass-through; unown's own /undo uses a different mechanism (checkpoints) | |

### pi settings/config

| pi feature | Status | Where | Notes |
|---|---|---|---|
| models.json (multi-provider), auth.json, agent-dir layout | EXPOSED (rebranded to `~/.unown/agent` via `PI_CODING_AGENT_DIR`) | u-cli.ts:906-915; u-term.ts:126-170 | pi's sanctioned override (p-config.ts:504); consistent |
| setup/provider presets | **DUPLICATED/SUBSET** | u-presets.ts (8 baseUrl presets) vs pi-ai's 40+ built-in providers (p-model-runtime.ts:167 always registers `builtinProviders()`) | pi's native catalog + `/login` OAuth (anthropic, openai-codex, github-copilot, xai, openrouter, radius, kimi-coding, cloudflare…) remain live under unown but are invisible to `unown providers list`/doctor/preflight — two provider surfaces |
| defaultProvider/defaultModel/theme/tuiMode | EXPOSED | u-docs/configuration.md:343 | only 4 of ~40 settings documented |
| compaction.*, retry.*, thinkingBudgets, modelThinkingLevels, transport, httpIdleTimeoutMs, enabledModels, sessionDir, httpProxy, markdown.*, warnings.*, packages, extensions/skills/prompts/themes arrays, enableSkillCommands, hideThinkingBlock, showCacheMissNotices, quietStartup, doubleEscapeAction, treeFilterMode, fullscreen* | HIDDEN (work via /settings or hand-editing; unown docs silent) | p-settings-manager.ts:94-146; u-docs/configuration.md:335-351 | `/settings` pass-through keeps them functional — a documentation gap, not a functional one |
| `--system-prompt` (replace) | **MISSING** | p-args.ts:110; u-cli.ts:569 only `--append-system-prompt <file>` | pi also accepts raw text, repeatable; unown: file-path, single |
| `--thinking` 7 levels | **MISSING** (3-level `--effort` instead) | p-args.ts:147,60; u-subagent-routing.ts:53,305-308; u-cli.ts:1113 maps effort→thinkingLevel | xhigh/max unreachable from unown CLI; `--thinking high` silently becomes prompt text |
| `--name/-n`, `--session-id`, `--fork <id>`, `--session-dir`, `--models`, `--api-key`, `--list-models`, `--tui-mode`, `--use-theme`, `--offline`, `--approve`, `-nt/-nbt/-xt`, `-e/-ne/-ns/-np/-nc` | **MISSING** (unknown flags fall into prompt text) | u-cli.ts:498-664 (no passthrough; `rest.push(a)` at 663) | pi forwards unknown `--flags` to extension flags (p-args.ts:227-240); unown silently mis-parses |
| pi packages ecosystem (`pi install/remove/list/config`, settings.packages, package update notifications) | **MISSING/HIDDEN** | p-package-manager-cli.ts:1-47; p-cli/config-selector.ts | no unown command touches it; `pi config`'s resource on/off TUI unreachable; starter skills hardcoded instead (u-term.ts:172-184) |
| `pi auth print-api-key`/`print-bearer-token` | PARTIAL | u-providers-cli.ts `key` subcommand prints stored keys | OAuth bearer token printing (refresh) not covered |
| `pi update self/extensions/models` | RENAMED | u-update.ts is unown's own release updater | pi's per-extension/model-catalog updates don't apply (different install model) — fine, but pi's **background model-catalog refresh** (p-interactive-mode.ts:1155, remote-catalog-provider.ts) still runs at unown startup and is not covered by `UNOWN_NO_PREFLIGHT` (only `PI_OFFLINE`/`--offline` gates it, which unown doesn't surface) |

### pi export/share/modes

| pi feature | Status | Where | Notes |
|---|---|---|---|
| `/export` HTML (themed, syntax-highlighted, tool renderers) | EXPOSED in TUI; **MISSING from unown CLI** (`sessions export` = md\|json only) | p-export-html/index.ts:236,288; u-sessions-cli.ts:45 | cheapest big win: call `exportFromFile` |
| `--export <file>` headless HTML | **MISSING** | p-args.ts:164 | no unown equivalent |
| `/share` secret gist + Radius + redaction | HIDDEN (functional) | p-session-share.ts | unown redacts its own exports (u-sessions.ts `--raw` inverse default) but has no upload lane |
| `--mode json` NDJSON | EXPOSED | u-cli.ts:510-516 passes to `runPrintMode` (u-cli.ts:2626-2629) | unown adds `--output-format json` envelope on top (stronger than pi) |
| `--mode rpc` (full JSON-RPC surface + extension-UI bridge) | **MISSING** | p-rpc-mode.ts; u-acp.ts is ACP-only | `unown --mode rpc` is silently mis-parsed (see Inconsistencies); pi's `RpcClient` export unused (u grep: 0 hits) |
| experimental client/server (`pi [--listen]`, packages/client+protocol+server) | MISSING (unwired upstream too) | p-cli/experimental/cli.ts:7 | future-facing; note for re-vendor planning |

### pi extension API usage by unown

Used: on(session_start/input/tool_call/tool_result/agent_end/before_provider_request/after_provider_response/session_before_compact/session_compact/session_shutdown) (u-termhooks.ts:638-1142), registerCommand/Tool/Shortcut/Flag/MessageRenderer, getCommands, setActiveTools, getContextUsage, ui.setWidget/setStatus/notify/setHeader/select/confirm/custom overlay, sendUserMessage (u-fleet-child.ts:85), exec. Unused (available headroom): `registerMarkdownTransformer`, `registerEntryRenderer`, `registerProvider` (native/OAuth), `ui.setFooter`, `ui.setWorkingIndicator`, `ui.setHiddenThinkingLabel`, `ui.addAutocompleteProvider`, `ui.setEditorComponent`, `ui.setTheme/getAllThemes`, `pi.setLabel` (tree labels), `on(user_bash)`, `on(before_agent_start)` result shaping, `on(resources_discover)`, `on(ui_prompt_start/end)`, `on(turn_start/end)`, `on(model_select/thinking_level_select)`, `ctx.fork/navigateTree/switchSession/newSession/reload` (u uses its own subprocess fleet instead of pi's in-process fork), `ctx.compact()` (u has its own auto-compact port, u-auto-compact.ts). Verified via grep across `pi-repo/packages/self-learning/src` (only hits: splash.ts:469, addons/todo.ts:669, tools.ts:2622/3969, splitview.ts:1427, fleet-runtime.ts:872, advisor.ts:596 — plus no-op stubs in u-acp.ts:827-846).

---

## Top gaps (ranked — cheap wins: wiring, not new features)

1. **HTML export on unown's CLI** — pi ships a complete, XSS-hardened, theme-aware HTML exporter (`p-core/export-html/index.ts:236,288`; `p-core/session-export.ts`). Unown's `sessions export` only does md/json (u-sessions-cli.ts:264-323) and its HELP never mentions pi's `/export`. **Sketch**: add `--format html` in u-sessions-cli.ts export branch calling `exportFromFile(sessionFile, { themeName })` from `@earendil-works/pi-coding-agent`; document `/export` in u-cli.ts HELP + docs/usage.md. **Effort: S**.
2. **Document + wire pi's OAuth providers** — pi registers 40+ native providers with OAuth device/browser flows (`p-core/model-runtime.ts:167`; `p-modes/interactive/components/login-dialog.ts`; `packages/ai/src/auth/oauth/*`), all live under unown but invisible to `unown providers`, doctor, and preflight (u-probe.ts resolves only unown's registry). `/login` works but is undocumented. **Sketch**: (a) document `/login`/`/logout` + env-key providers in docs/providers.md (S); (b) make `unown providers list` enumerate `modelRuntime.getAvailableSnapshot()` grouped by provider (M). **Effort: S (docs) / M (wiring)**.
3. **`@file` attachments, launch images, multi-message init, stdin merge** — pi's `processFileArguments` + `initialImages`/`initialMessages` (p-cli/file-processor.ts:25-87, p-cli/initial-message.ts:18-43, p-modes/interactive/interactive-mode.ts:369-374) give text+image inlining at launch; unown sends raw strings (u-cli.ts:2745, 2565). `unown -p "describe @shot.png"` should just work. **Sketch**: parse `@tokens` in u-cli.ts parseArgs → `processFileArguments` → pass `initialImages`/`initialMessages` to InteractiveMode and merge into print-mode message. **Effort: M**.
4. **7-level thinking control** — pi: `--thinking off..max`, `/thinking`, Shift+Tab, `modelThinkingLevels`, `thinkingBudgets` (p-cli/args.ts:60, p-settings-manager.ts:55-60,98-99). Unown: 3-level `--effort` (u-subagent-routing.ts:53) that also fiddles a bridge env var; no CLI flag for xhigh/max; `--thinking …` silently becomes prompt text. **Sketch**: accept `--thinking <level>` in u-cli.ts parseArgs → pass straight to `createAgentSessionFromServices({ thinkingLevel })` (u-cli.ts:1113 already takes one); keep `--effort` as alias. **Effort: S**.
5. **pi's RPC mode behind unown** — full headless control (set_model/cycle, thinking, compaction, export_html, get_tree, fork/clone, stats, extension-UI bridge — p-modes/rpc/rpc-types.ts:20-298) vs unown's ACP subset (u-acp.ts:12-31: initialize/new/prompt/cancel/load/set_mode/set_permission). `unown --mode rpc` currently turns into the literal prompt "--mode" (u-cli.ts:510-516 + 663). **Sketch**: either wire `runRpcMode` from pi's public export (S for a clean `unown rpc` command) or at minimum reject `--mode rpc` with a pointer to ACP; longer-term the RPC extension-UI bridge is what an unown dashboard/TUI-external client would want. **Effort: M**.
6. **pi's package/resource ecosystem** — `pi install|remove|list|config` + `settings.packages` (npm/git sources of extensions/skills/themes with per-resource filters, p-package-manager-cli.ts:1-47, p-cli/config-selector.ts:1-40, p-settings-manager.ts:83-92,119-123). Unown hardcodes starter skills (u-term.ts:172-184) and has no install surface; `pi config`'s resource toggler is unreachable. **Sketch**: smallest honest step = document `settings.packages` in u-docs/configuration.md (S); full step = port package-manager-cli as `unown install/list/config` writing the same settings keys (L). **Effort: S→L**.
7. **Windows: activate the powershell tool** — pi registers `powershell` (p-core/tools/index.ts:99; p-core/tools/powershell.ts:39-53) but unown's default set never includes it and never documents it (u-session-tools.ts:72-78 has no platform branch; unown ships Windows binaries per AGENTS.md:42). **Sketch**: in u-session-tools.ts `defaultSessionTools()`, add `"powershell"` when `process.platform === "win32"`. **Effort: S**.
8. **Surface pi's settings + `/settings` in docs** — unown documents 4 settings keys (u-docs/configuration.md:343); `/settings` exposes ~36 more that silently work (p-settings-selector.ts:460-814). Also `--tui-mode`, `--use-theme`, `externalEditor`, `shellPath`, `shellCommandPrefix`, compaction/retry/transport tuning. **Sketch**: add a "pi pass-through settings" table to docs/configuration.md + one HELP line pointing at `/settings` and `/hotkeys`. **Effort: S**.
9. **CLI flag passthrough instead of silent prompt-text capture** — pi forwards unknown `--flags` to extension flags (p-cli/args.ts:227-240); unown shoves them into the prompt (u-cli.ts:663) — `unown --name foo --mode rpc --thinking high` all silently mis-parse. **Sketch**: in u-cli.ts parseArgs, collect unknown `--x` tokens and (a) warn + drop, or (b) forward as `extensionFlagValues` to `createAgentSessionServices` (u-cli.ts:1010-1017) so pi extension flags like pi's plan-mode example work. **Effort: S–M**.
10. **`/share` surfaced** — redaction + gist upload already works in-session (p-session-share.ts:54-88; unown's own c7730bc commit added secret redaction paths). **Sketch**: document `/share` (S) and/or add `unown sessions share <id>` reusing `shareViaGist` + `exportFromFile` (M). **Effort: S (docs) / M (CLI)**.
11. **Launch-time session picker + `--name` + `--fork`** — pi's `-r` (picker), `--fork <id>`, `--session-id`, `-n <name>` (p-cli/args.ts:100-131) have no unown CLI equivalents (u `--resume` requires an argument; no picker at launch; no name-at-launch). **Sketch**: `unown -r` with no arg → run pi's session picker pre-boot (reuse u-resume.ts candidates in a select dialog); add `-n/--name` → `sessionManager` name or InteractiveMode `/name` initial call. **Effort: M**.
12. **Offline/startup-network control** — pi `--offline`/`PI_OFFLINE` gates update check + catalog refresh (p-cli/args.ts:223; p-interactive-mode.ts:1155,1162); unown has `UNOWN_NO_PREFLIGHT` (own endpoint probe) but no gate for pi's background catalog refresh, and suppresses only pi's *version* check via `appName` (p-interactive-mode.ts:1162, u-cli.ts:2743). **Sketch**: honor `PI_OFFLINE`/add `--offline` in u-cli.ts → set env before bootRuntime. **Effort: S**.
13. **Keep the unknown-slash-command guard in sync with pi's real builtin chain** — the guard's known-set is `BUILTIN_SLASH_COMMANDS` (22 names, u-termhooks.ts:52,704) while pi's TUI chain handles 26 (p-interactive-mode.ts:3102-3235); in ACP/JSON lanes `/debug` (a real diagnostics dump, p-interactive-mode.ts:6925) is misreported "Unknown command". **Sketch**: import the 4 extra names locally or (better) derive the known set from pi by also matching against the interactive-mode chain — short-term: add `"debug"` to the local list. **Effort: S**.
14. **Dashboard headroom via unused extension APIs** — `ui.setFooter` (persistent bottom line — could carry the engine status bar full-width), `registerMarkdownTransformer` (e.g., auto-linking file:line from agent output), `ui.addAutocompleteProvider` (surface `/blame <file>` path completions, dream names), `ctx.newSession/fork/navigateTree` (in-process subagents without subprocess respawn cost for the sync lane). **Effort: per-item S–M**.
15. **Session-dir override parity** — pi `--session-dir`/`sessionDir` setting (p-cli/args.ts:129, p-settings-manager.ts:138) vs unown's fixed `~/.unown/agent/sessions` + per-cwd project store. Low priority but cheap: pass `sessionDir` from `.unown/settings.json`. **Effort: S**.

---

## Inconsistencies found

1. **Unknown pi flags silently become prompt text.** `u-cli.ts:498-664`: anything unrecognized is `rest.push(a)` (line 663) and joined into the prompt. `unown --mode rpc "fix the bug"` prompts the model with `--mode` + `"fix the bug"`; `--thinking high`, `--name x`, `--session-dir y` same. pi forwards unknown flags to extensions (p-cli/args.ts:227-240) — behavior diverges under the shared `--` flag grammar.
2. **`--mode` accepts only json/text.** u-cli.ts:510-516: `--mode text` is silently ignored (fine), `--mode rpc` is captured-and-dropped into prompt text (the `i++` eats `rpc`, leaving literal `--mode`). No error, no docs — the mode pi advertises (`text|json|rpc`) is not the mode set unown implements.
3. **The unknown-slash-command guard list ≠ pi's builtin chain.** u-termhooks.ts:704 builds `known` from `BUILTIN_SLASH_COMMANDS` (p-core/slash-commands.ts:19-43, 22 names) + `pi.getCommands()` (extension/prompt/skill only — p-core/agent-session.ts:2549-2556). pi's TUI additionally handles `/debug`, `/arminsayshi`, `/dementedelves` locally (p-interactive-mode.ts:3211-3225) *before* the input event fires, so TUI works — but ACP/JSON-lane users typing `/debug` get "Unknown command /debug … did you mean: /…?" Same latent class of bug for any future builtin pi adds to the chain but not the exported list.
4. **Docs/code default drift.** u-docs/configuration.md:345 says the first-run bootstrap seeds "`zai-bridge` / `kimi-k2.5`" while u-term.ts:134 seeds `agnes-3.0-flash` (and `bridgeKnownModels` default is `agnes-3.0-flash,agnes-2.5-flash`, u-term.ts:78). The doctor lane even had to scrub stale `kimi-k2.5` anchors recently (CHANGELOG 0.0.15 harness fixes).
5. **`--effort` HELP tells half the story.** u-cli.ts:360-361 says effort maps to `BRIDGE_QWEN_THINKING` env only; in fact it is also passed as pi's `thinkingLevel` (u-cli.ts:1113), which drives prompt-side reasoning for non-bridge providers. The two effects are conflated under one flag.
6. **Same names, different semantics vs pi:** `--resume` (pi: no-arg picker; unown: argument required, exit 2 otherwise — u-cli.ts:617); `--session` (pi: path *or partial UUID*; unown: exact file path only — u-cli.ts:521-529, fleet lane); `import` (pi `/import`: resume pi JSONL; unown `unown import`: config migration from other agents — u-import-cli.ts; unown `/sessions import`: portable-JSON/foreign-transcript conversion). All three coexist in the same product with one word.
7. **Two provider registries, one managed.** pi's builtin provider catalog (40+, OAuth) is always registered alongside unown's models.json (p-core/model-runtime.ts:167-188), so `/model` can pick e.g. `anthropic/*` after a `/login` — but `unown providers list`, doctor, and preflight (u-probe.ts:1151) see only unown's 8-preset registry (u-presets.ts). A user can be "no provider connected" per doctor while `/login` grants a working one.
8. **Two export pipelines with different redaction policies.** pi `/export` + `/share`: local HTML export is intentionally *not* redacted, share is (p-session-share.ts:46-53). Unown's `sessions export`/`/sessions export`: redacted by default even for local files (`--raw` opts out; u-sessions-cli.ts:71-74,311). Neither HELP cross-references the other; a user following unown's docs will never learn the TUI's `/export` (HTML) exists.
9. **Vendored-tree drift is load-bearing.** ~29 local commits modify upstream packages (verified via `git log --name-only` in `pi-repo/`): `coding-agent/src/core/tools/{edit,write,bash,grep,find,ls,read}.ts` (edit-reliability transparency, beauty rounds), `core/sdk.ts` (verify-first in the agent loop), `core/keybindings.ts`, `core/index.ts`, `modes/interactive/theme/theme.ts`, `utils/paths.ts`, plus heavy `packages/tui/*` changes (viewport tiers, scrollbar engine port, shimmer, color lanes). docs/windows.md:167 records the deliberate re-vendor deferral (upstream 1.0 fullscreen rewrite, five breaking SDK changes). Consequence: features "pi ships" in this report are pi-0.84.3-plus-local — upstream 1.x features (e.g., pi-tui 1.3.x scrollbar origins were *back-ported* here at fd2dd41) must not be assumed present.
10. **Startup network behavior differs from pi's documented contract.** unown suppresses pi's version check via `appName` (u-cli.ts:2743 → p-interactive-mode.ts:1162) but pi's package-update check (1170) and background model-catalog refresh (1155) still run; pi's `--offline`/`PI_OFFLINE` gate is neither surfaced nor documented in `.env.example`/configuration.md, and `UNOWN_NO_PREFLIGHT` (u-cli.ts:1145) is a different, unown-only probe.
11. **HELP omits pass-through surface it relies on.** u-cli.ts HELP (142-402) lists ~27 unown commands + unown tools but zero of pi's 22 builtins — yet the same HELP's "Session tools" block tells users about `/note`, `/agents` etc. A user reading `unown --help` cannot discover `/compact`, `/tree`, `/fork`, `/export`, `/share`, `/settings`, `/hotkeys` (all functional); only docs/providers.md:225 and scattered sections cover a subset.

---

### Follow-up actions (for the implementer)

1. Quick wins first: gaps 1, 4, 7, 8, 12, 13 are all S-effort and each closes a "user-visible pi feature invisible in unown" hole.
2. Gaps 3, 9, 11 change `u-cli.ts` parse/HELP; pair with `docs/usage.md` + `docs/configuration.md` updates per the self-learning AGENTS.md:37 rule (CLI surface change ⇒ HELP + both docs in one change) and CHANGELOG Agent Behavior entries.
3. Re-vendor planning: track upstream pi 1.x (issues #11086, #10657 noted in docs/windows.md:167) — the exposure audit above is the checklist to re-run after any re-vendor (the BUILTIN_SLASH_COMMANDS guard sync, settings table, and RPC/export surfaces are the likeliest to drift).
