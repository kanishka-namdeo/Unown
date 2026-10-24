# Browser subagent UX — competitive research record

> **What this page is.** The companion record to [browser-research.md](browser-research.md)
> (which fixed the *tool surface*: CDP, snapshots, refs). This page covers the two
> questions that record could not answer, both dated 2026-10-23: how do comparable
> products surface browser automation as a **first-class subagent** rather than a
> flat tool, and how do their TUIs **visualize subagent activity** (rows, glyphs,
> colors, live status, elapsed)? It ends in prioritized recommendations for unown.
> Sources: live docs, `llms.txt` endpoints, shallow source clones (`openai/codex`,
> `google-gemini/gemini-cli`, `charmbracelet/crush`), changelogs, GitHub issues and
> HN. No code changes; this is a research record.

## 0. Method

Nine products were examined in depth (Claude Code, Codex CLI, Gemini CLI, Cursor,
Amp, Playwright MCP, plus quick passes over Warp, Goose, Aider, OpenCode, Crush),
plus two grounding references (pi itself, since unown is pi-based; cli-spinners,
the de-facto spinner registry). For closed-source products the evidence is docs,
changelogs and issue trackers; for open-source ones it is the actual rendering
code (`SubagentProgressDisplay.tsx`, `status_indicator_widget.rs`, …), which is
what "exact glyphs/colors/layout" claims below are read from.

## 1. The one-sentence answer

Every serious product has converged on the same three-part shape: **browser
capability is a subagent, not a main-context tool** (Gemini's `browser_agent`,
Cursor's built-in `Browser` subagent, Claude Code's `claude-in-chrome` with
`browser_batch`); **the subagent's noisy intermediate output (DOM snapshots,
screenshots) stays in the child's context** and the parent sees only a summary;
and the TUI shows **one status row per live subagent near the composer** —
spinner + humanized "current action" + elapsed + tokens — with completion
glyphs and a bounded linger for failures.

## 2. Product-by-product findings

### 2.1 Claude Code (Anthropic)

**Browser exposure.** Two surfaces, plus a fallback ladder. (a) *Claude in
Chrome*: `claude --chrome` starts the session with the
[Claude in Chrome extension](https://code.claude.com/docs/en/chrome.md)
connected via native messaging + the `claude-in-chrome` MCP server. Browser
tools are many small MCP tools (`browser_batch`, `tabs_context_mcp`, … —
`/mcp` → `claude-in-chrome` → View tools lists them). Actions run **in a
visible Chrome window in real time**; Claude's tabs are collected into a
Chrome tab group tied to the session; on login pages/CAPTCHAs it **pauses and
asks the human**. `/chrome` is the status panel ("Status: Enabled",
"Extension: Installed"), the reconnect command and the browser picker.
Permission prompts read "Claude in Chrome wants to …" with an
allow-all-on-this-site option. (b) *Computer use in the CLI*: a built-in
`computer-use` MCP server (macOS) for GUI-only work
([docs](https://code.claude.com/docs/en/computer-use.md)). The doc states the
ladder explicitly: *MCP server → Bash → Claude in Chrome → computer use* —
i.e. browser control is a last resort above shell, below APIs. Screenshots are
downscaled ~2.5×; one-session-at-a-time lock; Esc aborts from anywhere; apps
are hidden while it works and the terminal is excluded from screenshots so the
model never sees its own output.

**Subagent visualization.** From the
[subagents doc](https://code.claude.com/docs/en/sub-agents.md) and
[statusline doc](https://code.claude.com/docs/en/statusline.md):
- Delegation appears in the transcript as **one tool-call row**:
  `code-improver(Suggest code improvements)` — subagent name + short task.
- Live/background subagents render as **rows in a panel below the prompt
  input**, default body `name · description · token count`, where the
  middle field is a rolling *label* ("short progress summary when Claude Code
  has one").
- States: `running | completed | failed | killed`; a row that finishes
  successfully is removed immediately and the footer shows `/tasks to see
  subagents` for **30 s**; failed/killed rows **linger 30 s** so they can be
  inspected. `/tasks` lists, attaches to, or stops background items.
- The rows are scriptable: `subagentStatusLine` receives one JSON blob with
  all visible rows (`id, name, type: local_agent, agentType, status,
  description, label, startTime, model, tokenCount, tokenSamples[≤16], cwd`)
  and returns per-row overrides; output supports ANSI colors and **OSC 8
  hyperlinks**. Status-line updates are event-driven, debounced **300 ms**,
  with an optional `refreshInterval` timer for idle periods.
- Wider surfaces: `claude agents` opens **agent view** (one screen for every
  background session); `/workflows` shows phase + finished-agent counts;
  `/agents` used to have a Running tab listing live subagents.
- Changelog details worth copying
  ([CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)):
  a "Reduce motion" setting freezes the running-tool dot and spinners; tool
  rows show `Waiting…` / `Running…` states; long-running subagents render an
  incremental **progress trail** (reprocessed incrementally, not re-rendered
  in full); spinner verbs are user-replaceable (`spinnerVerbs`).

**Edge cases documented.** Extension-not-detected, service-worker idle
("Receiving end does not exist" → `/chrome` → Reconnect extension), org
mismatch ("Browser extension is not connected"), "No tab available", JS modal
dialogs blocking events (ask user to dismiss, then continue), 10 MB upload
cap, credential-shaped filenames refused
([chrome.md troubleshooting](https://code.claude.com/docs/en/chrome.md)).

**Complaints (GitHub issues, anthropics/claude-code).** Users ask for *more*
subagent visibility, not less: #92189 "Display subagent diffs in diff view and
subagent activity in agents view"; #96788 "Display subagent configuration
details (git worktree, model, effort level)"; #89844 "Running-agents dropdown
missing model and effort level display per subagent"; #93324 "TUI displays
incorrect model name when subagents launch or switch models"; #94872
"Subagent spawn records carry no status or lifecycle timestamps, so orphaned
background agents display [stale state]" — i.e. the canonical failure is
**rows without lifecycle metadata**, and the most-requested additions are
**model/effort per row** and **timestamps**.

### 2.2 OpenAI Codex CLI

**Browser exposure.** A **hosted** `browser_use` tool executed by the OpenAI
backend, configured per origin (source:
`codex-rs/app-server-protocol/src/protocol/v2/browser_use_config.rs` —
`BrowserUseConfig { allow_history_access, default_origin_policy, origins }`
with per-origin `access | downloads | uploads | full_cdp_access` gates), plus
model-owned confirmation policies ("# Browser confirmations…") in
`codex-rs/protocol/src/openai_models.rs`, and an in-app-browser config test
suite (`config_requirements_in_app_browser.rs`). No browser tool is rendered
specially in the TUI — hosted/MCP tool calls render through the generic
tool-call cell with the standard approval flow.

**Subagents.** The `multi_agent_v1` namespace ("Tools for spawning and
managing sub-agents") with `spawn_agent` (model override guidance: "Omit
`model` unless an explicit override is needed") and `wait_agent`
(`DEFAULT/MIN/MAX_WAIT_TIMEOUT_MS`), from
`codex-rs/core/src/tools/handlers/multi_agents_spec.rs`.

**TUI (read from `codex-rs/tui/`, ratatui-based).**
- `status_indicator_widget.rs`: a **single live task-status row above the
  composer** — animated header (defaults to "Working"), a separately owned
  **clock**, an interrupt hint, and short inline context. Elapsed formatting
  is compact: `0s, 59s, 1m 00s, 59m 59s, 1h 00m 00s`. Wrapped detail lines
  are prefixed `"  └ "` and capped at 3 (`STATUS_DETAILS_DEFAULT_MAX_LINES`),
  explicitly "to avoid vertical layout churn in the bottom pane". A
  summary-shimmer animation animates the label; a `ReducedMotionIndicator`
  freezes elapsed + spinner for snapshots and accessibility.
- `multi_agents.rs`: `/subagents` picker rows; primary thread renders as
  `Main [default]`, children as `{nickname} [{role}]`; **green `•` status
  dot** for live agents, dimmed rows for closed threads; fast-switch with
  alt+←/→; collab rows carry 160/240-grapheme previews for prompt, error and
  response.
- `exec_cell/render.rs` + `compact.rs`: live output preview with truncation
  for long-running shell tools (snapshotted in
  `exec_cell/snapshots/…truncated_live_output_preview_and_transcript.snap`).

### 2.3 Gemini CLI (Google)

The single most directly applicable precedent: **browser automation ships as
a dedicated subagent**, not main-context tools. All facts below read from the
shallow clone of `google-gemini/gemini-cli`.

**Browser subagent definition** (`packages/core/src/agents/browser/browserAgentDefinition.ts`):
- `BROWSER_AGENT_NAME = 'browser_agent'`, `displayName: 'Browser Agent'`,
  `kind: 'local'`, `experimental: true`; **available ONLY via
  `delegate_to_agent`, NOT as a direct tool**.
- Description (the routing contract): "Specialized autonomous agent for
  interactive web browser automation requiring real browser rendering.
  Delegate tasks that require clicking, form-filling, navigating multi-step
  flows, or interacting with JavaScript-heavy web applications that cannot be
  accessed via simple HTTP fetching. **Do NOT delegate to this agent for
  simply reading, summarizing, or extracting content from URLs — use the
  web_fetch tool** instead."
- Model: Gemini Flash (dynamic pick), temperature 0.1, topP 0.95.
  Budgets: `maxTimeMinutes: 10`, `maxTurns: 50`. Output is a typed schema
  `{success, summary, data?}` and must be delivered by calling
  `complete_task` ("Do NOT just return text — you must explicitly call
  complete_task to exit the loop").
- Tools are **dynamically discovered at invocation time from
  chrome-devtools-mcp** (spawned via node, `--isolated` mode), registered in
  the subagent's isolated ToolRegistry only — never in the main registry.
  Work loop rules baked into the system prompt: act on **uid refs from the
  AX-tree snapshot** (`uid=87_4 button "Login"` → `click(uid="87_4")`);
  **never parallel state-changing calls** ("Each action changes the DOM and
  invalidates UIDs"); **dismiss overlays/cookie dialogs first**; for
  spreadsheet/canvas apps `fill` fails — click then `type_text` with
  `submitKey`.
- Context hygiene: `snapshotSuperseder` — an `onBeforeTurn` hook that
  **replaces prior `take_snapshot` outputs with a placeholder** ("only the
  most recent one is meaningful") to reclaim context tokens.
- Security: hard `allowedDomains` list ("a security policy, not a hint" —
  no proxy-service circumvention, no searching blocked content on allowed domains);
  prompt-injection warnings; never enter credentials unless the user supplied
  them for this task.
- Terminal-failure list (stop immediately, report the error **verbatim with
  remediation steps**): "Could not connect to Chrome", "The browser is
  already running", "Browser/Target/Session closed", "Domain not allowed:",
  `net::ERR_*` on the same URL after 2 retries, "reached maximum action
  limit", any identical error 3× in a row.
- `inputBlocker.ts`: a page overlay suspends `pointer-events: none` around
  interactive tools so devtools interactability checks pass — overlay only
  in headed mode ("Always false in headless mode (no visible window to
  decorate)"); `browserManager.ts` connects with **exponential backoff**,
  guards concurrent browser agents per session mode, and errors carry
  "set sessionMode to persistent (default)" remediation.

**Subagent TUI** (`packages/cli/src/ui/components/messages/`):
- `SubagentProgressDisplay.tsx`: italic colored header — "Running subagent
  {name}…" (primary) → "Subagent {name} completed." (success) / "failed."
  (error) / "was cancelled." (warning). Activity items render under it:
  thoughts as `💭` (cancellations as `ℹ`), tool calls as an aligned status
  column (`STATUS_INDICATOR_WIDTH`) holding an **ink-spinner (cli-spinners
  `dots`) while running, `✓` on success, bold `-` when cancelled**.
  `formatToolArgs` humanizes arguments — prefer `description`, then
  `command`, `file_path`, `dir_path`, `query`, `url`, `target` before
  falling back to raw JSON.
- `SubagentGroupDisplay.tsx`: a **bordered box** (borderColor + dim border)
  whose header reads "Running Agent…" / "Agent Completed" / "Agent Error";
  with multiple agents it shows counts; overflow registers with a global
  system so **ctrl+o to expand** appears in a sticky footer.
- Constants: `TOOL_STATUS = { SUCCESS '✓', PENDING 'o', EXECUTING '⊷',
  CONFIRMING '?', CANCELED '-', ERROR 'x' }`. `CliSpinner.tsx` uses
  cli-spinners `dots` and **slows the interval under tmux**
  (`TMUX_SPINNER_INTERVAL_MS`).

### 2.4 Cursor (and Cursor CLI)

**Browser.** From [cursor.com/docs/agent/tools/browser](https://cursor.com/docs/agent/tools/browser):
browser is an agent capability ("Navigate, Click, Type, Scroll, Screenshot,
Console Output, Network Traffic") running as **a secure web view controlled
by an MCP server that ships as an extension** — zero install/config. The
browser opens **as an inline pane** in Cursor, and browser actions + screenshots
are displayed in chat ("Native integration"). Token-efficiency measures worth
copying: browser **logs are written to files that Agent greps selectively**
("reads only the relevant lines it needs"); screenshots integrate with the
file-reading tool so the model *sees* state as images; dev-server awareness
(detect running servers, don't start duplicates). Session state **persists
per workspace** (cookies, localStorage, IndexedDB). Approval modes: manual /
allow-listed actions / auto-run, plus allow+block lists; enterprise origin
allowlist (with honest edge-case notes: links, redirects and client-side
navigation can still leave the allowlist — "best-effort protection").
Recommended models: "Sonnet 4.5, GPT-5, and Auto".

**Subagents.** From [cursor.com/docs/subagents](https://cursor.com/docs/subagents):
Cursor ships **two built-in subagents — `Explore` and `Browser`** — and the
doc states exactly why Browser is a subagent: *"Browser interactions produce
noisy DOM snapshots and screenshots. The subagent filters this down to
relevant results"*; Explore "uses a faster model … 10 parallel searches in the
time a single main-agent search would take". Foreground (blocks, returns
immediately) vs background (`is_background: true`, "works independently").
The **subagent task card shows which model ran** (also in the usage
dashboard). Custom subagents are markdown files
(`.cursor/agents/*.md`, `~/.cursor/agents/`) with frontmatter
(`name, description, model, readonly, is_background`), and the same files
are read from `.claude/agents/` and `.codex/agents/` for compatibility.
Description tips: "use proactively" / "always use for" to encourage
delegation.

**Cursor CLI** ([using](https://cursor.com/docs/cli/using),
[overview](https://cursor.com/docs/cli/overview)): `@` file mentions, `!`
shell mode, `/` commands, Tab to rotate Agent/Plan/Ask modes, `--plan`
flag; MCP config from `mcp.json` is honored identically to the editor.

### 2.5 Amp (Sourcegraph)

From [ampcode.com/docs/models-and-subagents](https://ampcode.com/docs/models-and-subagents)
and [/docs/tools](https://ampcode.com/docs/tools) (site is now sign-in
gated; docs pages remain public):
- Two built-in subagents: **`Task`** ("carries out delegated work end to end
  and reports back; tools like file editing and terminal commands; skills
  for read-only roles: searching code in your workspace, researching another
  repository or dependency, reviewing a change, planning work") and
  **`Read Thread`** ("reads and summarizes other Amp threads").
- Subagents run **the same model and reasoning effort as the parent**;
  work in isolation — "can't communicate with each other, you can't guide
  them directly"; **the main agent receives their final summary rather than
  monitoring their step-by-step work**. A new task for a busy subagent
  arrives as extra instructions mid-run; subagent contexts compact like
  threads. Delegation is automatic "mostly in medium mode", or explicit:
  "ask the oracle" (reviewing subagent) and "use the librarian" — named
  personas users can invoke in prose.
- System models handle images/PDF/audio/video, image gen/edit, thread
  naming, compaction. Custom subagents come from plugins
  (`amp.createAgent(...)`, "exposed as a tool that the main agent calls").
- Third-party context: on HN, Amp's CLI is praised as "very well thought
  out to make you do things 'the correct way'" (e.g. `/handoff` vs
  `/clear`) — comment by usef- (2026-07-01) via the HN Algolia API; and by
  beyang (2025-07-18): "employs subagents for codebase search and extended
  thinking … to maximize use of the context window".

### 2.6 Playwright MCP (Microsoft)

The canonical **many-small-tools** schema — 40+ `browser_*` tools
([README](https://github.com/microsoft/playwright-mcp)). Design rules worth
stealing verbatim:
- Every interactive tool takes **`element` (human-readable description "used
  to obtain permission to interact with the element") + `target` (exact ref
  from the page snapshot, or a unique selector)** — the permission string and
  the machine ref are deliberately separate parameters.
- `browser_snapshot` returns the accessibility tree ("better than
  screenshot"); `browser_take_screenshot` warns "You can't perform actions
  based on the screenshot, use browser_snapshot for actions". Options:
  `depth` cap, `boxes` (bounding boxes for the vision tier).
- `browser_find` searches the current snapshot and returns "matching
  snapshot nodes with a few lines of surrounding context … cheaper than
  capturing the whole snapshot when you only need to locate an element and
  its ref".
- **`filename` parameters everywhere**: "Save to a file instead of returning
  it in the response" (console messages, network requests, snapshots,
  evaluate results) — the escape hatch that keeps giant payloads out of
  context.
- Numbered cross-references: `browser_network_requests` → 1-based index →
  `browser_network_request` for details.
- Read-only flags per tool (`Read-only: true/false`) drive approval policy.
- The README's headline architectural note: **"coding agents increasingly
  favor CLI-based workflows exposed as SKILLs over MCP, because CLI
  invocations are more token-efficient: they avoid loading large tool
  schemas and verbose accessibility trees into the model context"** — i.e.
  even the canonical MCP server now recommends the subagent/CLI shape over
  in-context tool schemas.

### 2.7 Quick passes: Warp, Goose, Aider, OpenCode, Crush

- **Warp** ([warp.dev/agent-cli](https://warp.dev/agent-cli)): terminal-native
  agent CLI; "run complex multi-agent and cloud agent workflows —
  automatically orchestrate tasks across **local and cloud subagents, each
  running in inspectable sessions** so you can easily monitor progress and
  steer actions"; can delegate to cloud agents powered by Warp Agent,
  Claude Code, or Codex; auto model routing. The phrase to keep: every
  subagent should be an *inspectable session*.
- **Goose** ([CLI commands](https://goose-docs.ai/docs/guides/goose-cli-commands)):
  no subagents today; extensions (MCP) + recipes; consistent flag conventions
  (`--session-id`, `-n/--name`, `-o/--output`). HN consensus (anuramat,
  2025-08-28): "a lot of multi-model features and extensions (it's
  practically a framework), but **UI is pretty basic**".
- **Aider** ([browser doc](https://aider.chat/docs/usage/browser.html)):
  `--browser` launches a **browser UI for aider** (browser as frontend, not
  automation). No subagents; single conversation loop.
- **OpenCode V2** ([agents](https://opencode.ai/v2/docs/agents/),
  [TUI](https://opencode.ai/v2/docs/cli/tui/)): markdown agent files with
  frontmatter incl. `mode: subagent | primary`, `permissions` deny rules
  (`action: edit/shell`, `resource: "*"`, `effect: deny`), per-agent model
  strings; TUI: Enter steers the active session, Ctrl+X→Enter queues a
  prompt, `/btw` side-questions, Ctrl+P command palette.
- **Crush** (source clone of `charmbracelet/crush`): one `agent` tool built
  with `fantasy.NewParallelAgentTool`; subagents run as their own sessions
  with **auto-generated titles** (title generated from the first real user
  prompt), hooks wrapped per-subagent, and an `isSubAgent` flag threaded
  through provider/billing paths (Copilot bills agent-initiated requests
  differently).

## 3. State of the art: terminal progress UX, 2025–2026

Collected from the rendering code above plus
[cli-spinners](https://github.com/sindresorhus/cli-spinners) and pi's own docs:

- **Spinners.** Braille `dots` at 80 ms (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) is the default
  everywhere (Gemini/ink, most CLIs). Two hardening details from Gemini:
  **raise the interval under tmux** (`TMUX_SPINNER_INTERVAL_MS`), and Claude
  Code + Codex both ship **reduce-motion modes** that freeze spinners while
  keeping state legible.
- **Elapsed.** Compact human forms (`0s → 59s → 1m 00s → 1h 00m 00s`,
  Codex `fmt_elapsed_compact`), one clock per row, never reflowing the
  layout ("Keeping these pieces on one line avoids vertical layout churn" —
  Codex source comment).
- **Status row anatomy.** `spinner + label + current-action + elapsed` on
  one line; optional detail lines below with a tree prefix (`  └ `), capped
  (3 lines in Codex); aligned status column for lists (Gemini
  `STATUS_INDICATOR_WIDTH`).
- **Completion glyphs.** Gemini `TOOL_STATUS`: `✓` success, `x` error,
  `-` cancelled (bold), `o` pending, `⊷` executing, `?` confirming. Codex:
  green `•` live, dim for closed. Claude Code: `⏺`/`⏵` bullets and `└`
  tree continuations.
- **Colors.** Semantic theme roles (success/warning/error/primary/secondary
  — Gemini `semantic-colors.ts`); threshold coloring for meters
  (Claude Code statusline example: green <70 %, yellow 70–89 %, red 90+ %);
  dim for stale/closed rows; per-agent accent colors for borders
  (Gemini group box, Codex `accent_color`).
- **Humanized arguments.** Never print raw JSON in a status row: prefer
  `description → command → file_path → url → query → target` (Gemini
  `formatToolArgs`).
- **Retention.** Success rows disappear immediately + a footer hint with a
  30 s window ("/tasks to see subagents"); failure rows linger 30 s
  (Claude Code). Crush titles subagent sessions from the first prompt.
- **Hyperlinks & escape codes.** OSC 8 links in status lines (Claude Code);
  ANSI passthrough in custom rows.
- **Accessibility.** Screen-reader announcements of spinner state (Claude
  Code), reduce-motion (Claude Code, Codex), WCAG 4.5:1 contrast floor and
  theme colors derived from the terminal's own palette (pi themes doc —
  unown already inherits this).
- **Rendering performance.** Differential rendering (pi-tui), incremental
  progress-trail updates for long-running subagents (Claude Code
  changelog), 300 ms debounce for status recomputes (Claude Code).

## 4. What users complain about / praise (summary)

- **Most common complaint class: subagent rows without lifecycle
  metadata** — no model/effort per row, no timestamps, orphaned rows that
  never clear (Claude Code issues #89844, #93324, #94872), and requests to
  surface subagent work *inside* existing views (#92189, #96788).
- **Praise concentrates on**: "inspectable sessions" (Warp), honest failure
  lanes (BLOCKED-style), one-row-per-agent with live tool + elapsed, and
  UIs that make you "do things the correct way" (Amp, HN).
- **Terminal-adjacent gripes**: spinner/label churn breaking layouts —
  which is why Codex hard-caps detail lines and pi debounces; and verbose
  accessibility trees flooding context — which is why every vendor moved
  browser work into a child context (Cursor's own rationale; Playwright
  MCP's CLI-over-MCP note).

## 5. Design recommendations for unown

Grounded in what unown already has: the `browser` session tool
([browser.md](browser.md) — CDP-direct, snapshot/ref model, one-tool-many-
actions), the sync `task` lane + async fleet with `task_control`,
`ask_question`, the fleet widget and `/tasks`
([subagents.md](subagents.md)), and pi's theme system. Recommendations are
shaped so they compose with those, not replace them.

### (a) Browser subagent definition — P0

1. **P0 — Ship a built-in `browser` subagent** (Gemini/Cursor pattern):
   a fleet-capable agent definition `browser` whose *routing description*
   follows Gemini's contract, adapted to unown's one-tool-many-actions
   surface:
   > "Specialized subagent for interactive web automation requiring a real
   > browser: clicking, form-filling, multi-step flows, JS-heavy apps.
   > Delegate when the task needs rendered pages or trusted input. Do NOT
   > delegate for reading or summarizing URLs — use web fetch/search tools
   > directly."
2. **P0 — Wrap, don't duplicate.** The subagent's tools are the existing
   `browser` session tool (plus `wait`/`find`/`screenshot`), registered only
   in the child session — never in the parent's catalog. Parent sees the
   typed report (`{success, summary, data?}`), matching unown's structured
   outputs; the child must terminate via the completion protocol, not prose
   (Gemini: "you must explicitly call complete_task to exit the loop").
3. **P0 — Budgets and model.** `maxTimeMinutes: 10`, `maxTurns: 50` as
   starting points (Gemini's numbers); route the subagent to the
   fast/cheap tier by default with fallback-chain rotation, per unown's
   per-agent routing.
4. **P1 — Snapshot hygiene in the child.** Port Gemini's
   `snapshotSuperseder`: before each child turn, replace all but the most
   recent snapshot output with a placeholder (the doc's own words: "only
   the most recent one is meaningful"). Add `filename`-style spillover for
   console/network captures (Playwright MCP pattern) so big payloads land
   on disk, grepped on demand (Cursor pattern).
5. **P1 — Terminal-failure contract.** Adopt Gemini's list verbatim as
   child-agent rules: connection failures, "browser already running",
   domain-blocked, `net::ERR_*` after 2 retries on the same URL, max-action
   limit, identical error 3× — the child stops and reports the error
   **verbatim with remediation**, never paraphrased. Route as BLOCKED
   where it fits unown's protocol.
6. **P2 — Vision tier.** Only if a model with image input is routed:
   `analyze_screenshot` + `click_at(x,y)` as separate read-only/vision
   tools (Gemini's split: analysis returns coordinates, actions stay
   ref-based).

### (b) TUI visual indicators for browser subagent activity — P0/P1

1. **P0 — One live status row per running subagent in the fleet widget**
   (unown already has the widget; give browser children a richer body).
   Content, in order: `⟳ browser · {current action} · {host+path} ·
   {elapsed} · {tokens}`. Concretely:
   - action verb humanized from the tool call (`navigate → example.com`,
     `click → "Login" (e12)`, `type → search box`) — Gemini's
     `formatToolArgs` precedence (description → command → url → …).
   - URL shown as host + truncated path, rendered as an **OSC 8 link**.
   - elapsed in Codex compact form; tokens from the live counter.
2. **P0 — Feed the row from tool events, not polling**: the `browser`
   tool already returns a snapshot per mutation; emit a lightweight
   progress event per action (action, ref label, url) so the row updates
   between turns, debounced ~300 ms (Claude Code).
3. **P1 — Completion states with bounded linger** (Claude Code rules):
   success rows clear immediately with a `/tasks` footer hint for 30 s;
   failed/killed rows linger 30 s with the exact error summary; states
   `✓ / x / -` (align with Gemini's `TOOL_STATUS`, which unown's `⊘`/`✗`
   markers already approximate).
4. **P1 — Reduce motion + tmux hardening**: freeze the spinner glyph (keep
   a static `⊷`) under reduce-motion and under tmux raise the interval
   (Gemini `TMUX_SPINNER_INTERVAL_MS`).
5. **P2 — A dedicated `browser` pane/expand view**: `/tasks` → select
   child → transcript view (unown already attaches); add a browser child
   affordance to show the last screenshot inline (Cursor "Native
   integration": screenshots in chat) and the action log as replayable
   one-liners (unown's browser tool already reports CDP-equivalent
   one-liners — surface them in the expanded view).

### (c) Subagent-wide visual improvements — P0/P1/P2

1. **P0 — Lifecycle metadata on every row** (the #1 complaint class):
   model + effort + start time + last event time, per row. Claude Code
   issues #89844/#93324/#94872 are precisely this gap; unown's `task_control
   status` already tracks turns/tokens/current tool — surface it in the
   row, not just the command.
2. **P0 — Lane colors.** Assign each concurrent child a stable accent
   color from the theme palette (rotating hues), used for the row prefix,
   the group-box border, and its transcript headers — Codex `accent_color`
   + Gemini bordered group display. Cap distinguishable accents at ~4
   concurrent lanes (matching unown's max-4 fleet) before falling back to
   the shared subagent color.
3. **P1 — Progress rows and completion glyphs**: adopt the unified glyph
   set `✓` done, `x` failed, `-` cancelled, `⟳` running (unown's current
   `⟳ ○ ? !` extends naturally), aligned status column, and per-row
   elapsed. Failure rows keep the BLOCKED reason quoted in bold (already
   unown behavior — keep it).
4. **P1 — Auto-titles**: name fleet children from their first prompt
   (Crush) instead of generic "New Agent Session", so `/tasks` lists are
   scannable.
5. **P2 — Counts and phases in headers**: "fleet: 2 running · 1 awaiting
   answer" (already present) extended with per-child phase for long runs
   (Claude Code `/workflows` phase counts); sticky-footer expand hint
   (ctrl+o) for overflowing subagent groups (Gemini overflow registry).

### (d) Edge cases to handle — P0/P1/P2

- **P0 — Browser missing / launch failure**: typed failure to the parent
  with the verbatim remediation (Gemini terminal-failure list); never
  silent-retry. If interactive, offer the Claude Code install-prompt shape
  (three choices: install / not now / don't ask again — asked at most once
  per session).
- **P0 — Stale refs**: unown already treats a stale ref as an actionable
  error (browser.md) — keep, and surface it in the row as `reflush` state
  rather than a failure.
- **P0 — Concurrency guard**: one browser child at a time per session mode
  (Gemini: "Cannot launch a concurrent browser agent in … session mode"),
  with a clear "browser is busy with {other child}" message.
- **P1 — Service/connection drops**: exponential backoff reconnect
  (Gemini `browserManager`), row state `!` (stalled) with a reconnect
  action — mirrors Claude Code's "Receiving end does not exist" →
  `/chrome` reconnect.
- **P1 — Login walls/CAPTCHAs**: pause the child, park it via
  `ask_question`/human handoff (unown's park is bounded at 10 minutes —
  good), and *never* let the child enter credentials it wasn't given
  (Gemini security section). Row shows `?` (already unown's glyph).
- **P1 — JS modal dialogs blocking events**: detect and surface "dismiss
  the dialog, then continue" (Claude Code); unown's CDP `Page.javascriptDialogOpening` is the hook.
- **P1 — Headless vs headed**: default headed for interactive sessions
  (visibility = trust; Gemini disables the input-blocker overlay in
  headless because there is no window to decorate), headless flag for
  CI/`-p` mode; record which mode ran in the report.
- **P2 — Allowed-domains policy** as a hard child constraint (Gemini's
  wording: "a security policy, not a hint", including no proxy-service
  circumvention), surfaced as a per-child badge in the row.
- **P2 — Upload/download gates and size caps** (Claude Code's 10 MB,
  credential-shaped filename refusal; Codex's per-origin
  uploads/downloads policies).

## 6. Source index

- Claude Code: <https://code.claude.com/docs/en/sub-agents.md>,
  <https://code.claude.com/docs/en/statusline.md>,
  <https://code.claude.com/docs/en/chrome.md>,
  <https://code.claude.com/docs/en/computer-use.md>,
  <https://code.claude.com/docs/en/agents.md>,
  <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>,
  issues #92189 #96788 #89844 #93324 #94872
  (via `api.github.com/search/issues`, repo anthropics/claude-code).
- Codex CLI: shallow clone of `openai/codex` @ main —
  `codex-rs/tui/src/status_indicator_widget.rs`, `codex-rs/tui/src/multi_agents.rs`,
  `codex-rs/core/src/tools/handlers/multi_agents_spec.rs`,
  `codex-rs/app-server-protocol/src/protocol/v2/browser_use_config.rs`,
  `codex-rs/protocol/src/openai_models.rs`; releases feed
  <https://github.com/openai/codex/releases>.
- Gemini CLI: shallow clone of `google-gemini/gemini-cli` @ main —
  `packages/core/src/agents/browser/{browserAgentDefinition,browserManager,mcpToolWrapper,inputBlocker,snapshotSuperseder}.ts`,
  `packages/cli/src/ui/components/messages/{SubagentProgressDisplay,SubagentGroupDisplay}.tsx`,
  `packages/cli/src/ui/components/CliSpinner.tsx`, `TOOL_STATUS` in
  `packages/cli/src/ui/constants.ts`.
- Cursor: <https://cursor.com/docs/subagents>,
  <https://cursor.com/docs/agent/tools/browser>,
  <https://cursor.com/docs/cli/using>, <https://cursor.com/docs/cli/overview>.
- Amp: <https://ampcode.com/docs/models-and-subagents>,
  <https://ampcode.com/docs/tools> (public docs; site pages sign-in gated).
- Playwright MCP: <https://github.com/microsoft/playwright-mcp> (README @
  main).
- Warp: <https://warp.dev/agent-cli>. Goose:
  <https://goose-docs.ai/docs/guides/goose-cli-commands> (+ HN commentary
  via Algolia API, 2025-08-28). Aider:
  <https://aider.chat/docs/usage/browser.html>. OpenCode:
  <https://opencode.ai/v2/docs/agents/>, <https://opencode.ai/v2/docs/cli/tui/>.
  Crush: shallow clone of `charmbracelet/crush` @ main —
  `internal/agent/agent_tool.go`, `internal/agent/coordinator.go`.
- Spinner registry: <https://github.com/sindresorhus/cli-spinners>
  (`spinners.json`: `dots` 80 ms).
- pi (grounding for unown): <https://github.com/badlogic/pi-mono> — README
  ("Pi … skips features like sub-agents and plan mode"), `pi-tui`
  differential rendering, themes with WCAG 4.5:1 contrast.
