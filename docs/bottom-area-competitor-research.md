# Bottom-area competitor research (docs/bottom-area-competitor-research.md)

The research baseline for the footer quiet round (2026-10-31): how competing
terminal coding agents design the area **below/around the text input box** —
what is persistent chrome, what is contextual, and the documented rationale
for each. Sources are primary where marked (official docs, repo source,
changelogs); claims that could not be verified this session are marked
UNVERIFIED and must not be cited as fact elsewhere in the tree.

Related: [the user journeys](bottom-area-user-journeys.md) · [the session
log](footer-quiet-round-session.md) · [the UX principles
card](unown-ux-principles.md) · prior art in [the observability competitor
research](observability-competitor-research.md) and [the settings competitor
review](settings_competitor_review.md).

## The field, in one table

| Agent | Bottom-of-input layout | Persistent | Contextual / transient |
|---|---|---|---|
| Claude Code | input → optional custom statusline row → built-in footer badges | minimal footer hints (`? for shortcuts`), mode indicator **only when non-default** | hint budgets ("three showings" per session, 10 s auto-hides), `esc to interrupt` while busy, PR/MR badges, statusline **hides during permission prompts** |
| Codex CLI (codex-rs) | `bottom_pane`: composer + status line + shared hint row + approval overlay | token/context usage (session-total AND live-context, 12 k baseline), model, approval mode | **status row hidden during streaming** ("avoid duplicate status indicators"); hints **expire** — redraws scheduled so hints vanish while idle; empty-state onboarding animation in the empty composer |
| Gemini CLI | input → single-row footer strip (labeled 2-row or compact), configurable item list | `workspace`, `model-name`, `context-used` (ordered `ui.footer.items`, in-app config dialog) | `git-branch`, `quota`, `diff`, `tokens` only "when non-zero/available"; transient error-count is **high priority**; low-priority items **dropped with `…`** at width |
| aider | scrolling REPL, no status bar | nothing (the `>` / `ask>` prompt prefix is the mode indicator) | one-time startup block (models, repo-map budget, `/help` hint); per-message `Tokens:`/`Cost:` lines that scroll away; placeholder pre-fill (`Fix that`) |
| Crush (Charm) | status bar = "the status bar and help model" | **shortcut hints** (short list) + mode badge (**absent in default coding mode**) | transient messages overlay the hints with a **5 s TTL** (`DefaultStatusTTL`); model/context/cost live in the **header/sidebar, not the bottom**; `compact_mode` + `exit_banner: none` |
| OpenCode | composer footer, width- and focus-aware | statusline row (model, state) — hints only **≥ 44 cols** | context usage + cost **only when `cost > 0`** and details on and it fits; live chips ("N subagents · N shells") **only when nonzero**; hints **dimmed when the session doesn't own input focus** |

Sources: Claude Code [statusline
docs](https://code.claude.com/docs/en/statusline), [interactive-mode
docs](https://code.claude.com/docs/en/interactive-mode), [settings
reference](https://code.claude.com/docs/en/settings-reference),
[CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md);
Codex
[`bottom_pane/mod.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/mod.rs),
[`chatwidget.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget.rs),
[`token_usage.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/token_usage.rs),
[`empty_state_animation.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/empty_state_animation.rs);
Gemini
[`Footer.tsx`](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/ui/components/Footer.tsx),
[`footerItems.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/config/footerItems.ts);
aider [usage](https://aider.chat/docs/usage.html), [modes](https://aider.chat/docs/usage/modes.html),
[commands](https://aider.chat/docs/usage/commands.html); Crush
[`internal/ui/model/status.go`](https://github.com/charmbracelet/crush/blob/main/internal/ui/model/status.go),
[releases](https://github.com/charmbracelet/crush/releases); OpenCode
[`feature-plugins/prompt/footer.tsx`](https://github.com/sst/opencode),
[keybinds](https://opencode.ai/docs/keybinds/), [TUI
docs](https://opencode.ai/docs/tui/).

## What each product teaches, in detail

### Claude Code — the statusline is a trade, hints are a budget

- The custom status line (`statusLine` in settings, or generated via
  `/statusline "show model name and context percentage with a progress bar"`)
  "renders in its own row above the built-in footer badges and does not
  replace them" — but **configuring it makes Claude Code stop showing most of
  the footer's keyboard hints** (`esc to interrupt`, the `? for shortcuts`
  fallback, `hold space to speak`). Persistent info the user adds *buys back*
  transient hint real estate: a documented decluttering trade.
- Hints are budgeted, not permanent: the changelog fixes the voice-dictation
  hint "using up its three showings in one session"; the agents-count hint
  "hides 10 seconds after a session opens".
- The status line "temporarily hides during certain UI interactions, including
  the help menu and permission prompts" — attention surfaces take over the
  area.
- Mode indicator (Manual / accept-edits / plan / bypass) only renders when
  non-default — the default state is unnamed chrome-free.
- Context pressure is first-class: `context_window.used_percentage` feeds the
  status line; the changelog fixes a >100 % display bug.

### Codex CLI — duplicate indicators are a named defect

The code comments are the rationale:

- `chatwidget.rs`: "**During streaming we hide the status row** to avoid
  duplicate [status indicators]" — the busy spinner and the status row would
  say the same thing twice, so one yields.
- `bottom_pane/mod.rs`: the pane "schedules redraws so those hints can
  **expire even when the UI is otherwise idle**", and "Owned transcripts
  separate activity from the transcript and **reserve their shared hint
  row**" — one row reserved for transient, self-expiring hints.
- `token_usage.rs`: both `total_token_usage` (session) and `last_token_usage`
  (live context) are tracked with `percent_of_context_window_remaining()`
  against the window minus a 12 000-token baseline; `format_tokens_compact`
  renders the compact forms.
- The empty composer carries the onboarding "blossom" animation that settles
  and skips for fresh conversations — empty state is branded, expert state is
  quiet.

### Gemini CLI — a declarative, ordered, dropping footer

- `footerItems.ts` defines every possible item with an id, header and
  description: `workspace`, `git-branch`, `sandbox`, `model-name`,
  `context-used`, `quota`, `memory-usage`, `session-id`, `hostname`, `auth`,
  `code-changes`, `token-count`. Render-time transients (an error-count
  summary) are appended and marked **high priority**.
- Availability is honest per item: branch "not shown when unavailable", diff
  and tokens "not shown when zero".
- Width fitting **adds items until the terminal is exhausted, drops the rest
  with a trailing `…`**, except high-priority items; the `workspace` column
  flexes (min 20 chars).
- `ui.footer.items` is user-configurable with an in-app
  `FooterConfigDialog`; the legacy boolean settings (`hideCWD`,
  `hideModelInfo`, …) auto-migrate into the ordered list — a documented
  evolution from hide-flags to a declarative model.

### aider — the scrollback is the status display

No persistent bar. The startup block prints once (models, git repo, repo-map
token budget, the `/help` hint); the mode rides the prompt prefix (`>`,
`ask>`, `architect>`); tokens/cost print per message and scroll away; a
context-limit error arrives **with remediation commands** (`/drop`, `/clear`).
The lesson: emit state when it changes, don't paint it as chrome.

### Crush — healthy states are silent, transients have a TTL

- The always-on bottom line is **shortcut hints** (the `help` bubbles view);
  the permission-mode badge is "an empty string in the default coding mode" —
  **no badge for the common case**.
- `Status.Show(InfoMsg)` transient messages overlay the hints and expire after
  `DefaultStatusTTL = 5 * time.Second`; the mode banner deliberately uses the
  same badge geometry "to keep the indicator from jumping when the banner
  appears or expires" — **no layout jump on transitions**.
- Model, context-used, session cost and estimated usage moved OUT of the
  bottom bar into the **sidebar** (`ctrl+b`) and header (git branch, LSP error
  count) in the current design line; the branch glyph was removed because "it
  won't display when nerdfonts are not available" — degrade, never break.
- `options.tui.compact_mode` and `exit_banner: none` are real quiet modes.
- The "LRU chip" described in older write-ups is absent from the current
  codebase (UNVERIFIED/historical).

### OpenCode — conditional everything, focus-aware

- The prompt footer renders context usage and cost only `cost > 0`, only when
  details are on, and only if the layout fits `width - 8`; live chips ("N
  subagents · N shells") only when nonzero; the goal indicator only when a
  goal exists.
- Shortcut hints render only at **≥ 44 columns**, and are **dimmed when the
  input doesn't own focus** ("hints read as disabled while the session does
  not own input").
- Help is two levels deep: the `/help` dialog says only "Press ctrl+p to see
  all available actions and commands in any context" — the palette is the
  expansion gesture.

## The convergent rules (what the field agrees on)

1. **Persistent chrome is identity + the one live risk metric.** Cwd, model,
   context pressure survive everywhere; everything else earns its row.
   (Claude statusline examples, Gemini's always-items, Codex's token usage,
   Crush's sidebar split.)
2. **Healthy states are silent.** No mode badge in the default mode (Crush),
   no model-hint when configured (Gemini "not shown when unavailable"),
   no PR badge without a PR (Claude). Ambient OK text is chrome.
3. **Attention beats ambient.** Error counts are high priority (Gemini);
   permission prompts and help menus take over the area (Claude hides the
   statusline during them); approval overlays replace the composer (Codex).
4. **Hints are budgeted and expiring, never furniture.** Three-showings
   budgets and 10 s hides (Claude), a reserved shared hint row with scheduled
   expiry (Codex), short-help-only by default (Crush), palette as the index
   (OpenCode).
5. **Duplicates are defects.** Codex hides the status row while streaming
   precisely to avoid two indicators saying one thing.
6. **Drop whole items, never truncate mid-fact.** Gemini drops whole footer
   items with `…`; Crush removes glyphs that break; ordered-drop is the
   field's narrow-width discipline.
7. **Values render only when non-trivial.** Cost when > 0, diff when
   non-zero, quota when it exists, subagent chips when nonzero.
8. **Quiet modes are first-class.** `compact_mode` (Crush), `--no-pretty`
   (aider), attention sounds off by default (OpenCode).

### Progressive-disclosure grounding

[Nielsen Norman Group — Progressive
Disclosure](https://www.nngroup.com/articles/progressive-disclosure/): "the
very fact that something appears on the initial display tells users that it's
important" — the argument against painting ambient state by default; staged
disclosure "only if a user asks" is the palette/dialog pattern.
[clig.dev](https://clig.dev/): "Display output on success, but keep it
brief", "Signal-to-noise ratio is crucial", and errors should carry their
remediation. tmux(1) spends its one persistent bottom line on session
identity + the window list — the terminal-native precedent for
identity-only chrome.

## What this means for Unown (the design deltas)

The vendored footer today runs four stacked lines at rest (location, stats,
extension statuses, hints) and the joined extension-status line admits every
chip alphabetically, ambient or not, truncating mid-chip at width. Against
the field:

- **Merge identity into the status line** (location left, meter + chips,
  model right) — the Claude/Gemini/Codex one-line layout; saves a full row.
- **Attention-gate the extension-status line**: healthy-ambient chips (engine
  up, mcp all-connected, lsp ready, conf ✓, goal active) stop painting; the
  line renders only attention/active states, **priority-ordered, dropping
  whole chips** — Gemini's high-priority discipline.
- **Deduplicate facts**: the context %, in/out tokens and session cost
  currently render on BOTH the stats line and the turn chip ("out 2" was cut
  mid-chip in the baseline capture). One fact, one home: the turn chip keeps
  per-turn dynamics (duration, TTFT) + the live cost; the stats line keeps
  context/tokens/cache.
- **Keep the hint line contextual** — round 5's I3 already implements the
  busy/queued/idle swap the field converges on; it stays.

The journeys that operationalize these deltas are in [the user journeys
doc](bottom-area-user-journeys.md); the disposition of every element is the
manifest table there.
