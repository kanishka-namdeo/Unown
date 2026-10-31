# Settings round 2 — research pass (TUI apps, cohort deltas, measurement)

> **Purpose:** round 2's fresh research ground for the Settings Evolution
> mission — the TUI-app settings-UX patterns the round-1 pass skipped, the
> agent-cohort deltas window (2026-10), and the settings-UX measurement
> practice the benchmark suite (phase 9) will cite. Round 1's six-axis,
> eight-tool study lives in `settings_competitor_review.md`; this pass adds
> new ground, it does not repeat it.

- [Part 1 — TUI-app settings UX](#part-1--tui-app-settings-ux-12-patterns)
- [Part 2 — agent-cohort deltas](#part-2--agent-cohort-deltas-window-2026-10)
- [Part 3 — settings-UX measurement practice](#part-3--settings-ux-measurement-practice)
- [Recommended actions](#recommended-actions)
- [Sources](#sources)

**Method:** web research only; every claim cites a URL fetched live on
2026-10-31 (51 sources, list below). Citation keys `[S#]` map to the source
list. Negative probes worth knowing: `nngroup.com/articles/success-rate/` and
`/task-time/` are 404; k9s has no `/topics/navigation` page (navigation
guidance lives in `/topics/commands`); lazygit's keybinding doc is at
`docs/keybindings/Keybindings_en.md`; Textual's palette lives at `/api/command/`
+ `/guide/screens/`; inkjs.dev did not resolve from this network (Ink is a
negative on framework guidance — nothing to extract beyond `useInput` /
`useFocus` / `useFocusManager` and a Screen Reader Support section).

Related pages: [settings_competitor_review.md](settings_competitor_review.md) ·
[settings-evolution-session.md](settings-evolution-session.md)

## Part 1 — TUI-app settings UX (12 patterns)

Doc-thinness upfront (per method, not padded): btop documents almost nothing
about keys — its README covers install/themes plus screenshots of its three
menus [S6]; tmux is man-page-only [S15]; gh-dash's real docs moved to
gh-dash.dev [S8–S11]; Ink's only docs are its README [S18] — inkjs.dev
unresolvable today [S19].

| # | Pattern | Why it works | Real example | Verdict for Unown's hub |
|---|---|---|---|---|
| P1 | `?` cheatsheet overlay — one key, same place, every screen | recognition over recall; help in a consistent relative position (WCAG 3.2.6 logic) | gh-dash `? – Toggle Help` [S8][S9]; k9s "`?` Show active keyboard mnemonics and help" [S3]; tmux `C-b ?` [S15] | **ADOPT** — the cheapest single win |
| P2 | Two-keystroke leader namespace with live popups (max depth 2) | bounded depth keeps settings discoverable without menus-in-menus; the popup shows the second level | helix `Space` mode pickers table [S14]; tmux prefix+key [S15]; k9s user hotkeys listed in the `?` view [S5] | **ADOPT** — one leader, visible popup, hard cap at two levels |
| P3 | Fuzzy command palette with an explicit match grammar | search flattens a 200-item tree into a keyboard-only surface; a grammar serves novices and precision users | Textual `CommandPalette` (fuzzy `Matcher`, case-insensitive, "Search for commands…") [S16]; fzf tokens `'wild` exact, `^music` prefix, `!fire` inverse; TAB multi-select [S7]; k9s `:` `pod ns-x` / `pod /fred` / `@ctx1` [S3] | **ADOPT** the palette; **ADAPT** fzf's token grammar (`!` inverse is ideal for deny-lists) |
| P4 | Command prompt as expert escape hatch | progressive disclosure in reverse — the 1% doing 50% of config churn get a typed path | tmux `C-b :` [S15]; k9s `:` (`ctx`, `ns`, `screendump`, `xray`) [S3]; helix `:config-open` / `:config-reload` [S12] | **ADOPT** — a `:` prompt that sets/searches settings by name, mirroring the file format |
| P5 | Config-as-file with a published JSON Schema + editor IntelliSense | validation at authoring time beats validation at load time | lazygit ships a JSON schema for `config.yml` with YAML-extension IntelliSense, opt-in via `# yaml-language-server: $schema=…` [S1]; gh-dash publishes `https://gh-dash.dev/schema.json` [S11] | **ADOPT** — publish `unown.schema.json`; auto-inject the `$schema` header when the hub generates a config file |
| P6 | Generated defaults reference + "override only what you change" | defaults are documentation, not a template to paste | lazygit's machine-generated defaults block ("DO NOT UPDATE MANUALLY") + the "include only those settings that you actually want to change" warning [S1]; k9s auto-generates the full default file, `k9s info` reveals load paths [S4]; tmux `show-options` [S15] | **ADOPT** — a read-only defaults view + copy-per-key, plus a dump-config command |
| P7 | Layered config resolution (env → repo → parent dirs → global) | matches "project beats user beats default" | lazygit global + `<repo>/.git/lazygit.yml` + parent-dir `.lazygit.yml` [S1]; gh-dash `$GH_DASH_CONFIG` → repo `.gh-dash.yml` → `~/.config/gh-dash/config.yml`, `--config` override [S10]; helix global + project `.helix/config.toml`, `hx -c` [S12] | **ADOPT** — user → project → managed (read-only) |
| P8 | Live reload / reactive settings (file watch + explicit reload) | tightens the feedback loop; "change and see" builds trust | helix `:config-reload` or `pkill -USR1 hx` [S12]; k9s `ui.reactive` watches disk artifacts; hotkeys auto-reload [S4][S5]; tmux `source-file`, parse errors shown in-session and processing continues [S15] | **ADOPT** — watch by default + a visible "reload applied / failed with line N" toast; tmux's continue-past-error semantics |
| P9 | Confirmation asymmetry for destructive actions (+ documented opt-out) | friction proportional to irreversibility; the opt-out itself is a setting | k9s `ctrl-d` delete = "TAB and ENTER to confirm" vs `ctrl-k` kill = "no confirmation dialog" [S3]; tmux `confirm-before` with `-b -y -c -p` [S15]; lazygit per-action `skip*Warning` booleans [S1]; Textual's modal Quit/Cancel dialog [S17] | **ADOPT** — typed-phrase confirm for reset-all/delete-memory; a `skip*Warning`-style key |
| P10 | Persistent status surface showing mode + affordances | the status bar is the "system status" channel (Nielsen #1); the one place a keyboard user looks between actions | tmux status line [S15]; Textual `Footer` renders live bindings (`q Quit | ^p palette`) [S17]; k9s crumbs (hideable) [S4]; btop state banners (`proc_pause_bg`, `followed_bg`) [S6] | **ADOPT** — one bar: active mode, permission state, unsaved/invalid indicator |
| P11 | Onboarding via interactive tutor | learn-by-doing inside the real UI; zero docs round-trips | helix `hx --tutor` / `:tutor` [S13] — the only TUI in this set with one (the gap is the finding) | **ADAPT** — a 6-step first-run settings tour (palette → permission mode → memory → theme), skippable, re-openable |
| P12 | Settings as a first-class mode/screen (Textual model) | progressive disclosure by surface: common toggles in a screen; the long tail lives in the file (P5/P6) | Textual `MODES` with `DashboardScreen` / `SettingsScreen` + `App.switch_mode` [S17]; btop inverts it (every option in the menu — thin docs) [S6] | **ADOPT** the Textual model; **SKIP** btop's "everything in the menu" |

Config-file conventions across the set (one line each): lazygit YAML+schema
[S1]; k9s YAML auto-generated with defaults [S4]; gh-dash YAML+schema.json
[S10][S11]; helix TOML [S12]; tmux command-file parsed then executed, errors
surfaced in-session [S15]; fzf via shell env vars/flags [S7]; btop conf
written by the options menu [S6].

## Part 2 — agent-cohort deltas (window 2026-10)

- **Claude Code** — active; 2.1.287 → 2.1.316 over the window [S20][S21].
  `permissions.blockWritesOutsideWorkingDirectories` (2.1.314): "Write, Edit
  and NotebookEdit refuse paths outside the working directories in *every*
  permission mode" [S20]. `managed.policy_mode: layered` (2.1.316): every
  matching policy applies, merged over the ones below it [S20]. `/permissions`
  gained a "Recently blocked" review tab; auto-mode blocked calls "point to
  `/permissions` to review"; it "refuse[s] approving a call you can't read in
  full" [S20]. Server-managed settings apply without an approval prompt; a
  stored copy that doesn't verify is refused [S20]. Four settings files +
  managed delivery with a documented precedence section [S22];
  `permissions.disableBypassPermissionsMode` / `disableAutoMode` kill-switches
  documented "most useful in managed settings" [S23]. **No settings-search
  feature — negative.** *Implication: model the hub's managed layer as
  read-only with merge semantics; expose a "recently blocked" audit view.*
- **OpenAI Codex CLI** — the window's most relevant delta; v0.163–v0.166
  [S24]. **Settings search**: "Open `/config` to search preferences across
  categories, change supported settings immediately, and see which changes
  require a restart" (v0.164). **Leader key config** via `/keymap` (default
  Ctrl+X; hints stay open until chosen; voice mute → F9). `codex doctor
  --network-only`. Inline `/model` and `/permissions` arguments; resume
  restores permissions and network approvals; `-c/--config` overrides at
  multiple subcommand levels; read-only tools run in parallel (v0.163).
  *Implication: the reference spec — settings search with restart-required
  flags, configurable leader key, a doctor command.*
- **Gemini CLI** — v0.66–v0.67 [S25]. Settings migration hardening: "preserve
  `${VAR}` placeholders during deprecated settings migration"; "validate
  finite numbers in numeric settings editor"; "resolve settings placeholders
  after loading .env files"; `dynamicModelConfiguration` lists Auto in
  `/model`; ACP permission requests carry MCP server and tool metadata.
  *Implication: if the hub ever rewrites config files, placeholder/env
  semantics must survive — treat migration as a trust feature.*
- **Cline** — v3.0.73 → v4.1.26 [S26]. New "Local Models" settings page
  (Ollama/LM Studio) with a composer chip showing memory use; configurable
  keybindings in Settings; "Quit can require holding the shortcut, 1 second by
  default on macOS, so it's harder to quit by accident"; General settings
  shows Hub status + Restart Hub; Settings > API Configuration gained a
  Local|Cloud toggle. *Implication: settings page doubling as an ops/status
  console; hold-to-quit is destructive-action signaling worth copying.*
- **Roo Code** — negative for the window (latest v3.54.0, 2026-05-15) [S27]
  [S28]. Pre-window: JSON schema for `.roomodes` (3.52.1), `ROO_ACTIVE` env
  "for safer terminal guardrails", cloud-settings refresh to 1h (3.51.0).
  *Implication: treat Roo as stable.*
- **Aider** — negative (latest v0.86.0, 2025-08-09) [S29]; unreleased main
  adds `--auto-accept-architect`, GPT-5.x model settings, unsupported-reasoning
  warnings [S30]. *Implication: Aider stays flag-first; map flags, don't
  expect UI parity.*
- **OpenHands** — v1.27 → v1.34 [S31]. "Settings → Runtime page" with
  per-conversation Docker runtime; "agent-profiles… profiles own their
  settings"; "edit condenser and verification per profile"; "mask secret
  values in request and Settings forms"; "make switches keyboard accessible";
  settings preserve edits after a failed save. *Implication: the
  profile-owns-its-settings model is right for Unown agent modes.*

## Part 3 — settings-UX measurement practice

1. **NN/g "Usability Metrics"** [S32] — base measures: "success rate …, the
   time a task requires, the error rate, and users' subjective satisfaction,"
   plus two navigation metrics that map exactly onto a settings hub: "the
   percentage of time that users follow an optimal navigation path" and "the
   number of times they need to backtrack." **Copy:** find-and-change N
   settings tasks; report success, time, backtracks (Esc/breadcrumb events),
   optimal-path %.
2. **NN/g "Progressive Disclosure"** [S33] — "defers advanced or rarely used
   features to a secondary screen, making applications easier to learn and
   less error-prone"; "Initially, show users only a few of the most important
   options." **Copy:** a depth-to-setting metric (keystrokes/menus traversed),
   with advanced settings expected >1 level.
3. **WCAG 2.2 SC 3.2.6 Consistent Help (Level A)** [S34] — help mechanisms
   repeated across pages must occur "in the same order relative to other page
   content." **Copy:** `?` pinned in the identical position on every settings
   surface; audit = relative-position consistency; help opens per task = the
   help-dependency metric.
4. **WCAG 2.2 SC 3.3.7 Redundant Entry (Level A)** [S35] — "Don't ask for the
   same information twice in the same activity." **Copy:** never re-ask values
   already known from config or context; metric = redundant entries per task.
5. **Apple HIG "Settings"** [S36] — "Aim to provide default settings that give
   the best experience to the largest number of people"; "Minimize the number
   of settings you offer"; the standard Command-Comma shortcut; task-specific
   settings live in the task, not Settings. **Copy:** a Cmd-,-equivalent
   binding; settings-inventory size as a design KPI; no duplicated
   terminal-wide prefs.
6. **Microsoft "Guidelines for app settings"** [S37] — settings are for
   options "that don't require frequent readjustment"; toggle for binary;
   radio ≤5 mutually exclusive; "When a user changes a setting, the app should
   immediately reflect the change"; settings pinned last in the nav pane.
   **Copy:** immediate-apply semantics (no Save button); binary-first control
   mapping; fixed nav placement.
7. **Material Design — gap, reported as a negative.** Material 3 has no
   settings-organization guidance; the Material 2 settings pattern page is
   client-rendered with no extractable guidance [S38]. **Copy: nothing; rely
   on Apple/MS + NN/g.** The gap itself is evidence that settings guidance is
   scarce — which is why the TUI patterns in Part 1 matter.

**The benchmark metric set for `benchmarks/settings-ux/` (derived):**
time-to-find-setting (NN/g task time); settings-search success rate (first
query surfaces the target in top-3); settings abandonment (task not completed
/ exit without applying); help dependency (`?` and doc opens per task);
backtracks and depth-to-setting (NN/g navigation metrics + progressive
disclosure levels); immediate-apply violations (MS rule); redundant entries
(WCAG 3.3.7).

## Recommended actions (highest leverage first)

1. Build the hub as a Textual-style mode (P12) with a fuzzy palette + token
   grammar (P3/P4) — Codex's `/config` search with restart-required flags
   [S24] is the spec to match.
2. Ship `unown.schema.json` with auto-injected `$schema` (P5) + a generated
   read-only defaults view (P6) + layered resolution user→project→managed
   (P7, matching Claude Code's four-file model [S22]).
3. Add destructive-action asymmetry: typed-confirm for resets, `skip*Warning`
   suppressors (P9).
4. Add `:tutor`-style onboarding (P11) and a `doctor` command (Codex
   `--network-only` [S24]).
5. Instrument from day one with the Part 3 metric set; baseline
   time-to-find-setting and search success rate BEFORE the palette ships.

## Sources (all fetched 2026-10-31)

Part 1 — TUI apps & frameworks: S1 lazygit Config.md · S2 lazygit
Keybindings_en.md · S3 k9s /topics/commands · S4 k9s /topics/config · S5 k9s
/topics/hotkeys · S6 btop README · S7 fzf README · S8 gh-dash keybindings ·
S9 gh-dash global keys · S10 gh-dash configuration · S11 gh-dash schema ·
S12 helix configuration · S13 helix usage · S14 helix keymap · S15 tmux(1) man
page · S16 Textual /api/command/ · S17 Textual /guide/screens/ · S18 Ink
readme · S19 npm registry Ink (inkjs.dev unresolvable — noted inline).

Part 2 — agent cohort (window 2026-10-01 → 10-31): S20 Claude Code
CHANGELOG.md · S21 npm @anthropic-ai/claude-code (version→date) · S22
code.claude.com/docs/en/settings · S23 code.claude.com/docs/en/permissions ·
S24 github.com/openai/codex/releases (pages 1–3) · S25
github.com/google-gemini/gemini-cli/releases · S26 github.com/cline/cline/
releases · S27 Roo Code CHANGELOG.md · S28 Roo Code releases · S29
github.com/Aider-AI/aider/releases · S30 aider.chat/HISTORY.html · S31
github.com/All-Hands-AI/OpenHands/releases.

Part 3 — measurement practice: S32 nngroup.com/articles/usability-metrics/ ·
S33 nngroup.com/articles/progressive-disclosure/ · S34
w3.org/WAI/WCAG22/Understanding/consistent-help · S35
w3.org/WAI/WCAG22/Understanding/redundant-entry · S36
developer.apple.com/design/human-interface-guidelines/settings · S37
learn.microsoft.com/…/guidelines-for-app-settings · S38 m3.material.io +
m2.material.io/design/patterns/settings.html (both probed; gap reported).
