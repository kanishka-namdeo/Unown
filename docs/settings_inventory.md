# Unown Settings Inventory — Phase 1 of the Settings Evolution Round

**Date:** 2026-10-31 · **Repo state:** v0.0.48 @ `68055455` · **Scope:** every configurable capability a user can reach today.

This is the complete inventory of Unown's configuration surfaces, produced by a
forensic pass over the source (TUI commands, pi built-ins, config files, env
vars, CLI flags, subsystem knobs). It feeds the Information Architecture
redesign (`docs/settings_ia_redesign.md`) and the edge-case catalogue
(`docs/settings_edge_case_catalogue.md`). Paths are relative to
`pi-repo/packages/` unless noted (`SL` = `self-learning/src`, `CA` =
`coding-agent/src`).

**Headline count: ~410 distinct configurable entries across 8 surfaces** —
and the median entry is reachable by exactly ONE surface, often a file edit.

---

## How to read the tables

| Column | Meaning |
|---|---|
| Name | The setting/command/flag/var as the user meets it |
| Source file | Where it is implemented (authoritative) |
| Persisted where | What survives a restart |
| User purpose | The decision the user is making |
| Frequency | setup (once) · daily · rare · auto (system-set) |
| Risk | low / med / high — blast radius if wrong (trust, cost, safety) |

Discoverability, trust impact and recovery path are summarized per-surface
after each table; the IA redesign cross-references every entry by section.

---

## Surface 1 — Unown TUI slash commands (65)

Registered via `pi.registerCommand` in the self-learning layer.

| Name | Source file | Persisted where | User purpose | Frequency | Risk |
|---|---|---|---|---|---|
| `/plan` | SL/tools.ts:3412 | session state | Toggle plan mode (explore → numbered plan → execute) | daily | low |
| `/note <text>` | SL/tools.ts:3422 | engine notes DB / outbox | Deliver a learning note to the engine | daily | low |
| `/agents` | SL/tools.ts:3440 | — | List subagents (built-ins + `.unown/agents/*.md`) | daily | low |
| `/dashboard [screen]` | SL/tools.ts:3477 | — | Open TUI mission control (16 screens) | daily | low |
| `/dash` | SL/tools.ts:3484 | — | Alias of /dashboard | daily | low |
| `/promote` | SL/tools.ts:3491 | standing-orders.md + routines | Distill session into a standing-order Program draft | rare | med |
| `/routines` | SL/tools.ts:3512 | — | Open dashboard Routines screen | rare | low |
| `/memory search <q>` | SL/tools.ts:3520 | — | Cross-project semantic recall; bare opens Memory screen | daily | low |
| `/learning` | SL/tools.ts:3581 | — | Effective 4-tier memory stack w/ staleness + budget | daily | low |
| `/providers` | SL/tools.ts:3633 | ~/.unown/agent/{models,auth,settings}.json | In-chat provider manager | setup | high |
| `/brief` | SL/tools.ts:3645 | — | 60-second session brief | daily | low |
| `/mission <text>` | SL/tools.ts:3684 | session | Pin objective on mission panel | daily | low |
| `/recovery` | SL/tools.ts:3743 | — | What needs attention (errors, verify, dead letters) | daily | low |
| `/delegation` | SL/tools.ts:3765 | — | Every subagent spawn, why/cost/outcome | daily | low |
| `/feed` | SL/tools.ts:3779 | — | What Unown learned this session | daily | low |
| `/usage [days]` | SL/tools.ts:3791 | — | Token/cost report | daily | low |
| `/context` | SL/tools.ts:3829 | — | Context-window utilization + compaction advice | daily | low |
| `/btw <question>` | SL/tools.ts:3903 | never persisted | Off-transcript side question | daily | med |
| `/recap [turns]` | SL/tools.ts:3945 | — | Digest of last N turns | daily | low |
| `/output-style [name]` | SL/tools.ts:3985 | .unown/output-style.json | Show/set output style | rare | low |
| `/insights [days]` | SL/tools.ts:4019 | — | Cross-session analytics | rare | low |
| `/repomap` | SL/tools.ts:4045 | repomap cache | Graph-ranked symbol map | rare | low |
| `/lsp` `/lsp trust` | SL/tools.ts:4058 | trust state | LSP status; approve project `.unown/lsp.json` | setup | med |
| `/goal <obj>` | SL/tools.ts:4131 | session entry | Durable evidence-verified goal | daily | med |
| `/review` | SL/tools.ts:4186 | — | Parallel-subagent code review | daily | med |
| `/init-agents` | SL/tools.ts:4334 | — | Generate AGENTS.md preview | setup | low |
| `/doctor-instructions` | SL/tools.ts:4362 | — | Audit instruction set | rare | low |
| `/blame <file>` | SL/tools.ts:4385 | — | Which receipts touched a file | rare | low |
| `/abort` | SL/tools.ts:4459 | — | Abort turn/bash/compaction/retry | daily | low |
| `/sessions export\|list\|import` | SL/tools.ts:4491 | .unown/sessions/ | Session export/import/list | rare | low |
| `/recipe` | SL/tools.ts:4618 | — | Run declarative instruction bundle | rare | med |
| `/wiki` | SL/tools.ts:4763 | .unown/wiki/ | Generated repo docs | rare | low |
| `/edit-resend <n> <msg>` | SL/tools.ts:4942 | checkpoint store | Edit Nth message + revert + resend | rare | med |
| `/engine` | SL/termhooks.ts:1107 | — | Engine status, degraded-mode diagnosis | daily | low |
| `/hooks` `/hooks trust` | SL/termhooks.ts:1161 | trust state | User-hook layer status; trust gate | setup | high |
| `/permissions` | SL/permissions.ts:1066 | session override | Permission mode switch | daily | high |
| `/add-dir <path>` | SL/permissions.ts:1153 | session write-roots | Grant extra writable directory | daily | high |
| `/project-settings [trust]` | SL/project-settings.ts:221 | trust state | Show/approve `.unown/settings.json` | setup | med |
| `/mcp` `/mcp trust` | SL/mcp.ts:2037 | trust state | MCP status/reconnect/trust/elicitation | setup | high |
| `/receipts [n]` | SL/checkpoints.ts:1146 | receipts ledger | Session audit ledger | rare | low |
| `/checkpoints` | SL/checkpoints.ts:1154 | — | List checkpoints + redo depth | rare | low |
| `/checkpoint [label]` | SL/checkpoints.ts:1164 | manifests | Named snapshot of touched files | daily | low |
| `/undo [n]` | SL/checkpoints.ts:1198 | — | Revert last n turns' file changes | daily | med |
| `/redo [n]` | SL/checkpoints.ts:1261 | — | Re-apply undone changes | daily | med |
| `/restore <id>` | SL/checkpoints.ts:1308 | — | Restore a named checkpoint | rare | med |
| `/split` | SL/splitview.ts:1891 | session | Toggle all panels | daily | low |
| `/split-thinking` | SL/splitview.ts:1939 | session | Toggle thinking panel | daily | low |
| `/split-tools` | SL/splitview.ts:1954 | session | Toggle tools panel | daily | low |
| `/files` | SL/splitview.ts:1964 | session | Toggle files panel | daily | low |
| `/split-diff` | SL/splitview.ts:1971 | session | Toggle diff subpanel | rare | low |
| `/split-tools-view` | SL/splitview.ts:1981 | session | Compact ↔ full detail | rare | low |
| `/split-height` | SL/splitview.ts:1991 | session | Band height rows | rare | low |
| `/split-tools-width` | SL/splitview.ts:2005 | session | Tools panel width % | rare | low |
| `/split-divider` | SL/splitview.ts:2024 | session | Divider style | rare | low |
| `/split-trim-response` | SL/splitview.ts:2041 | session | Full transcript ↔ response-only | rare | low |
| `/split-save` | SL/splitview.ts:2078 | ~/.unown/agent/ui-panels.json | Save layout as startup default | setup | low |
| `/status` | SL/status-card.ts:199 | — | One-glance status card | daily | low |
| `/diff` | SL/status-card.ts:300 | — | Working-tree diff + git status | daily | low |
| `/commit` | SL/gittools.ts:624 | git repo | Stage + commit (never pushes) | daily | med |
| `/flights` | SL/flights.ts:359 | onboarding latches | Reopen starter catalog | setup | low |
| `/addons` | SL/addons/index.ts:88 | ~/.unown/agent/addons.json | Configurator for 3 TUI addons | setup | low |
| `/todos` | SL/addons/todo.ts:638 | todo store | Show todos grouped by status | daily | low |
| `/advisor` | SL/addons/advisor.ts:602 | addons.json | Advisor status/control | setup | med |
| `/tasks` | SL/fleet-runtime.ts:1326 | — | Async fleet status | daily | low |
| custom `/<name>` | pi command loader | `.unown/commands/*.md` | Custom markdown commands | rare | med |

**Discoverability:** good for daily commands (autocomplete lists them), poor
for the 20+ setup-frequency commands a novice never types. **Recovery:** only
checkpoints/undo/redo have real recovery; `/split-save` overwrites without
backup; `/permissions mode` is session-scoped (safe) but invisible after
restart.

---

## Surface 2 — pi built-in slash commands (23)

`CA/core/slash-commands.ts` — vendored upstream, dispatched before extension
commands in the editor path.

| Name | Purpose | Frequency | Risk |
|---|---|---|---|
| `/settings` | Open the pi settings menu (Surface 3) | setup | med |
| `/model <p/m>` | Select model | daily | med |
| `/tree` | Session tree navigation | daily | low |
| `/thinking <level>` | Thinking level off…max | daily | med |
| `/scoped-models` | Models for Ctrl+P cycling | setup | low |
| `/export` `/import` | Session export/import | rare | low |
| `/share` | Share session as GitHub gist | rare | **high** (secret leakage) |
| `/copy` | Copy last message | daily | low |
| `/name` | Name session | rare | low |
| `/session` | Session info & stats | rare | low |
| `/changelog` | Show changelog | rare | low |
| `/hotkeys` | Keyboard shortcuts | rare | low |
| `/fork` `/clone` | Fork/duplicate session | daily | low |
| `/trust` | Save project trust decision | setup | high |
| `/login` `/logout` | Provider auth | setup | high |
| `/new` `/compact` `/resume` `/reload` `/quit` | Session lifecycle | daily | low |
| `/skill:<name>` | Invoke skill | daily | med |

---

## Surface 3 — pi `/settings` UI rows (32)

`CA/modes/interactive/components/settings-selector.ts` →
`CA/core/settings-manager.ts`, persisted to `~/.unown/agent/settings.json`.

| Group | Rows | Risk |
|---|---|---|
| Model & thinking | default model submenu, per-model thinking defaults, thinking budget | med |
| Interface | TUI mode (regular/fullscreen), fullscreen exit output, scrollbar, copy-on-select, theme (auto/light/dark/custom), show hardware cursor, editor padding, output padding, autocomplete height, clear-on-shrink, terminal progress | low |
| Images | show images, image width, auto-resize, block images | low |
| Behaviour | auto-compact, steering mode, follow-up mode, skill commands, hide thinking, Mermaid mode, cache-miss notices, collapse changelog, quiet startup, install telemetry | low–med |
| Trust | default project trust (ask/always/never), double-escape action | **high** |
| Advanced | transport (sse/ws/auto), HTTP idle timeout, warnings submenu, tree filter mode | med |

**Gap:** every row is implementation-facing. There is no "what is Unown
allowed to do" grouping; autonomy-affecting rows (`defaultProjectTrust`) sit
visually identical to `editorPaddingX`.

---

## Surface 4 — settings.json keys with NO UI (21, file-edit only)

`CA/core/settings-manager.ts` `Settings` interface:

`defaultProvider`/`defaultModel`, `defaultThinkingLevel`, `externalEditor`,
`shellPath`, `shellCommandPrefix`, `npmCommand`, `enableAnalytics` +
`trackingId`, `packages` (npm/git extension sources), `extensions[]`,
`skills[]`, `prompts[]`, `themes[]`, `enabledModels`, `defaultTools[]`,
`compaction.{enabled,reserveTokens,keepRecentTokens}`,
`branchSummary.{reserveTokens,skipPrompt}`,
`retry.{enabled,maxRetries,baseDelayMs,provider.*}`,
`thinkingBudgets.{minimal,low,medium,high}`, `markdown.codeBlockIndent`,
`terminal.{hyperlinks,images,trueColor}`, `sessionDir`, `httpProxy`,
`websocketConnectTimeoutMs`, `lastChangelogVersion`.

**No unknown-key validation** — a typo silently does nothing forever. **No
reset-to-defaults.** Both fixed by this round (see IA redesign).

---

## Surface 5 — Config files (35 surfaces)

| File | Owner code | Purpose | Risk |
|---|---|---|---|
| `~/.unown/agent/settings.json` | SL/term.ts:231, CA SettingsManager | pi global settings | med |
| `~/.unown/agent/models.json` | SL/term.ts:146, SL/providers.ts | Provider+model registry | high |
| `~/.unown/agent/auth.json` | SL/term.ts:214 (0600) | Provider API keys | **high** |
| `~/.unown/agent/addons.json` | SL/addons/config.ts | 3 addons × 16 fields | med |
| `~/.unown/agent/permissions.json` + `.unown/permissions.json` | SL/permissions.ts:424 | Rule list `{tool,effect,pattern}` + mode | **high** |
| `~/.unown/agent/hooks.json` + `.unown/hooks.json` | SL/hooks-config.ts:159 | 13 events × 5 handler types | **high** |
| `~/.unown/agent/mcp.json` + `.unown/mcp.json` | SL/mcp.ts:465 | MCP servers + elicitation policy | **high** |
| `~/.unown/agent/lsp.json` + `.unown/lsp.json` | SL/lsp.ts:252 | LSP server overrides | med |
| `.unown/settings.json` | SL/project-settings.ts:67 | Per-project overlay (trust-gated) | med |
| `.unown/memory/project.md` | dreams write | Tier-1 project memory | med |
| `.unown/memory/local.md` | user | Tier-3 local overrides | med |
| `~/.unown/memory/policy.md` | seeded | Tier-0 enterprise policy | med |
| `~/.unown/memory/user.md` | hoist target | Tier-2 user memory | med |
| `~/.unown/agent/skills/*/SKILL.md` | SL/skills.ts | Agent skills | med |
| `.unown/agents/*.md` | SL/subagent-catalog.ts | Custom subagents | med |
| `.unown/commands/*.md` + user twin | pi loader | Custom slash commands | med |
| `.unown/styles/*.md` + user twin | SL/output-style.ts | Output styles | low |
| `~/.unown/agent/themes/unown.json` | SL/theme.ts | 51-token TUI theme | low |
| `.unown/output-style.json` + user twin | SL/output-style.ts:110 | Active style pointer | low |
| `~/.unown/agent/ui-panels.json` | SL/splitview-config.ts:21 | Startup split layout | low |
| `~/.unown/agent/keybindings.json` | CA/core/keybindings.ts:380 | Custom keybindings | med |
| standing-orders.md (project + user) | SL/standing-orders.ts:25 | Durable programs | med |
| `.unown/watch.json` | SL/watch.ts:480 | AI-comment watch roots | low |
| `.unown/review/checks/*.md` | SL/review.ts | Team review checks | low |
| `.unown/recipes/*.md` + user twin | SL/recipes.ts | Instruction bundles | low |
| `.unown/wiki/*.md` | SL/repo-wiki.ts | Generated wiki | low |
| `~/.unown/onboarding.json` | SL/onboarding-state.ts | First-run latches | low |
| engine.token (0600) ×2 | SL/engine-auth.ts | Engine bearer | **high** |
| `~/.unown/.run/` | SL/engine-supervisor.ts | Pid/log/circuit state | low |
| model-specs.json + cache | SL/model-specs.ts | Verified specs + pricing | med |
| adversary.md | SL/adversary.ts:85 | Adversary gate | **high** |
| injection-scanner.json | SL/injection-scanner.ts:316 | Injection patterns | **high** |
| `~/.unown/cache/web/` | SL/webcache.ts | Web results store | low |
| `~/.unown/browser/profile` | SL/browser | Persistent browser logins | med |
| trust-state fingerprints | SL/config-trust.ts | Project-config approval | **high** |

---

## Surface 6 — Environment variables (~150)

Read `.env.example` (765 lines, the tracked reference). Grouped:

| Group | Count | Representative high-risk vars |
|---|---|---|
| Engine core | 18 | `UNOWN_ENGINE_HOST` (0.0.0.0 = network), `UNOWN_ENGINE_AUTH=off`, `UNOWN_ENGINE_CORS=*` |
| Bridge | 16 | `BRIDGE_UPSTREAM_KEY`, `BRIDGE_API_KEY`, failover/local lanes |
| Engine resilience/governor | 16 | `PI_ENGINE_MAX_TOKENS_HOUR/DAY` (0 = unlimited), `PI_JOB_TIMEOUT_MS` |
| Memory/dream/learning | 25 | `PI_DREAM_GATE` (0 disarms rollback), `PI_MEMORY_*` caps, mem0 knobs |
| Retention | 9 | `UNOWN_RETENTION_DAYS` (0 = never prune → unbounded growth) |
| Terminal security | 30 | `UNOWN_TRUST_PROJECT_CONFIG=1`, `UNOWN_OS_SANDBOX=0`, `UNOWN_STRICT_HOOKS=0`, `UNOWN_PERMISSIONS=0` |
| Web search/fetch | 30 | `UNOWN_WEBFETCH_ALLOW_PRIVATE=1` (SSRF), provider keys |
| Browser | 27 | stealth tier, captcha keys, proxy |
| Subagents/fleet | 12 | `UNOWN_FLEET_MAX_CONCURRENT=0`, `UNOWN_SUBAGENT_MAX_TURNS` unset |
| Update channel | 4 | `UNOWN_RELEASES_BASE_URL`, `UNOWN_ALLOW_EXPERIMENTAL` |
| LSP/MCP | 11 | timeouts, reconnect cooldowns |
| Misc UX | 10 | `UNOWN_NO_SPLASH`, `NO_UPDATE_NOTIFIER` (+3 sibling spellings) |

**All 150 are file/shell-only** — no `unown config set`. The `.env.example`
comments are excellent documentation, but invisible from the TUI.

---

## Surface 7 — CLI launch flags & management commands (53)

**24 launch flags:** `-p`, `-c`, `--resume [id|name|path]`, `--plan`,
`--goal`, `--mode json`, `--output-format json|stream-json`,
`--worktree [name]`/`-w`, `--max-tool-repetitions N`, `--max-turns N`,
`--output-schema F`, `--no-session`, `--tools a,b`, `--append-system-prompt F`,
`--model`, `--provider`, `--effort`, `--mcp-servers`, `--no-agents-md`,
`--no-split`, `--session <path>`, `--permission-mode <m>` (high),
`--add-dir <path>` (high), `--help`/`--version`.

**29 management commands:** `setup` (8 presets incl. agnes), `providers`
(add/key/test/default/refresh), `models` (+`verify`), `init`, `init-agents`,
`memory`, `dashboard [screen]`, `doctor`, `doctor-instructions`, `mcp`
(add/add-http/add-json/list/get/remove/test/elicitation), `routines`
(create/edit/pause/resume/run/skip/snooze/history/delete), `watch`,
`repomap`, `ralph`, `engine` (status/start/stop/restart/repair/serve),
`usage`, `webcache`, `sessions`, `import` (5 sources), `blame`, `recipes`,
`wiki`, `delegations`, `acp`, `info`, `note`, `update`
(`--check/--rollback/--skip`), `changelog`, `completions`, `uninstall`
(`--purge-data`).

---

## Surface 8 — Subsystem knobs (33)

The self-improvement machinery's own configuration: memory tier caps and
injection budget (`budget.ts`), AutoDream guard + canary (`guard.ts`,
`dream.ts` — `PI_DREAM_GATE`, `PI_DREAM_CANARY_K`), skills lifecycle
(shipped/retired), hooks runtime (13 events), MCP manager (timeouts +
elicitation), goals state machine, automations scheduler (cron/every/after/
once/event + active hours + misfire policy), subagent catalog + routing +
fleet caps, dashboard screens (16), engine OS service, engine auth, update
channel (SHA-256 verified), OS sandbox (bwrap), shield, instruction guard,
adversary, injection scanner, bash policy (hardcoded deny-list), write roots,
turn meter, usage/cost math, max-turns guard, governor (3 ceilings +
breaker), standing orders, first flights, watch, session tools.

---

## Cross-cutting findings

### Reachability gaps (file-only, no command)

- All of Surface 4 (21 pi settings.json keys).
- hooks.json rule authoring, permissions.json rule authoring (beyond
  auto-learn appends), adversary.md, injection-scanner.json,
  keybindings.json, watch.json, memory tier .md files, custom agents/
  commands/styles, LSP json (no CLI writer at all).
- **Every env var (~150).**

### No recovery path

- pi settings.json: no reset-to-defaults, no unknown-key validation.
- `UNOWN_RETENTION_*` pruning — permanent deletes.
- Outbox overflow drops; fleet reaper kills; bash-tool file changes (not
  checkpointed); files > `UNOWN_CHECKPOINT_MAX_BLOB_BYTES` (64 MiB);
  compaction is irreversible within a session.
- `sessions delete --force`, `uninstall --purge-data`, `webcache clear`.

### The 10 most dangerous settings (rank)

1. `UNOWN_TRUST_PROJECT_CONFIG=1` — bypasses the trust gate for cloned-repo
   configs (RCE / prompt-injection vector).
2. `--permission-mode bypassPermissions` (with `UNOWN_STRICT_HOOKS` unset).
3. `UNOWN_ENGINE_HOST=0.0.0.0` + `UNOWN_ENGINE_CORS=*`.
4. `UNOWN_OS_SANDBOX=0` / `UNOWN_SANDBOX_NET=1`.
5. Disarming the defense stack: `UNOWN_INJECTION_SHIELD=0`,
   `UNOWN_INJECTION_SCANNER=0`, `UNOWN_ADVERSARY=0`, `PI_DREAM_GATE=0`.
6. `PI_ENGINE_MAX_TOKENS_HOUR/DAY=0` — unlimited unattended spend.
7. `UNOWN_FLEET_MAX_CONCURRENT=0` + uncapped subagent turns.
8. `defaultProjectTrust: "always"` (pi settings).
9. `UNOWN_RETENTION_DAYS=0` (unbounded growth) or too-small (destroys audit).
10. `UNOWN_ALLOW_UNVERIFIED_SPECS=1` / `UNOWN_WEBFETCH_ALLOW_PRIVATE=1`.

### Scattering / duplication observations

1. **Permission mode lives in 5 places** (CLI flag, `/permissions`, project
   settings, 2× permissions.json) with code-documented but user-invisible
   precedence.
2. **Model/provider selection spans 8 surfaces.**
3. **Two independent compaction systems** (pi `compaction.*` vs Unown
   `UNOWN_AUTO_COMPACT_*`).
4. **Memory-size budget: 4+ env knobs** with no named concept.
5. **Trust gate duplicated per file-type** — five near-identical `/x trust`
   commands sharing one fingerprint store, no unified surface.
6. **Update suppression: 4 env spellings** + 2 settings.
7. **Cost visibility: 6 surfaces** (`/usage`, `unown usage`, `/context`,
   turn meter, `/insights`, `/session`).
8. **Secrets in 4 places** (auth.json, .env, models.json, `$VAR` refs).
9. **Split-view state split** across 11 session commands + ui-panels.json +
   pi `tuiMode` + `--no-split`.
10. **Two homes**: adversary/injection-scanner default to `~/.config/unown/`
    but move under `$UNOWN_HOME` when set.

### The six mission questions, answered by today's surfaces

1. *What can Unown do?* — nowhere visible as a whole (docs + `--help` only).
2. *What is it currently allowed to do?* — `/permissions status` +
   `/status` card; partial, no file/rules view.
3. *What does Unown remember?* — `/learning` (excellent, read-only).
4. *What has it learned?* — `/feed` + dashboard Dreams; no approval inbox.
5. *What could it change automatically?* — invisible (dreams, hoist,
   auto-verify, auto-compact, governor — all env-gated, none listed).
6. *How do I recover?* — `/undo`, `/restore`, `/recovery`, `/checkpoints`;
   discoverable only if you already know them.

This inventory is the "BEFORE" baseline for the benchmark suite
(`benchmarks/settings-ux/`).
