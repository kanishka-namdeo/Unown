# Settings Information Architecture Redesign — Phase 4 of the Settings Evolution Round

**Date:** 2026-10-31 · **Inputs:** `settings_inventory.md` (~410 entries),
`settings_competitor_review.md`, `settings_user_journeys.md`,
`settings_edge_case_catalogue.md`. **Output consumed by:** the `src/settings/`
implementation (Phase 8), the benchmark suite (Phase 9).

**Design principle (from the mission):** every setting exists because a user
needs to make a decision — never because an implementation detail exists.
Settings answers six questions: what can it do / what is it allowed to do /
what does it remember / what has it learned / what could it change / how do
I recover.

---

## 1. The new top-level structure

Ten sections, organized by user intent (not by config file):

| # | Section | The decision the user is making | Answers question |
|---|---|---|---|
| 1 | **Agent** | What is this agent, and how does a session behave? | #1 |
| 2 | **Memory** | What do you remember, and can I inspect/edit/forget? | #3 |
| 3 | **Learning** | What have you learned, and what may you learn automatically? | #4, #5 |
| 4 | **Automation** | What runs unattended, and how do I stop it? | #5 |
| 5 | **Safety** | What are you allowed to do, and who decides? | #2 |
| 6 | **Models & Cost** | Which model, at what price ceiling? | #2 (cost) |
| 7 | **Tools & Integrations** | What capabilities are connected? | #1 |
| 8 | **Observability** | Can I see what happened and why? | #2, #4 |
| 9 | **Recovery** | How do I undo, restore, reset? | #6 |
| 10 | **Advanced** | Power knobs that don't fit a novice narrative | — |

Cross-cutting surfaces (live on the hub, not inside a section): **Search**,
**Recently changed**, **Recommended**, **Health check**, **Diff vs defaults**,
**Export / Import / Reset**.

---

## 2. Disposition of every existing surface

Legend: **Keep** (stays where it is; Settings links to it) · **Relocate**
(moves into a section) · **Merge** (combines with kin) · **Advanced** (hidden
behind the Advanced gate) · **Simplify** (fewer choices/progressive
disclosure) · **Remove** (deleted with rationale).

### 2.1 pi `/settings` UI rows (32)

| Row | Disposition | Rationale / new home |
|---|---|---|
| defaultModel submenu, per-model thinking, thinking budgets | **Relocate → Models & Cost** | Model choice is a cost+capability decision; effective-chain shown |
| auto-compact | **Relocate → Agent** | Session behaviour |
| steering / follow-up modes | **Relocate → Agent** | Interaction behaviour |
| TUI mode, fullscreen rows, scrollbar, copy-on-select, theme, hardware cursor, editor/output padding, autocomplete height, clear-on-shrink, terminal progress | **Relocate → Agent → Interface** (grouped) | Pure interface preferences, one group |
| images rows (4) | **Relocate → Agent → Interface** | Same |
| hide thinking, Mermaid, cache-miss notices, collapse changelog, quiet startup | **Relocate → Agent → Interface** | Same |
| skill commands | **Relocate → Tools & Integrations** | Capability toggles |
| transport, HTTP idle timeout | **Advanced** | Infra detail |
| warnings submenu | **Merge → Observability** (notice preferences) | |
| defaultProjectTrust (ask/always/never) | **Relocate → Safety** with **risk badge high** | The single most dangerous row in the old UI; was visually identical to editor padding |
| double-escape action, tree filter mode | **Advanced** | Muscle-memory details |

The pi settings-selector itself stays (vendored upstream surface); the new
`/settings` hub supersedes it as the entry point and embeds these rows
through the settings registry. The upstream interception patch routes
`/settings` to the Unown hub when the extension registers it (see §5).

### 2.2 settings.json file-only keys (21)

| Key | Disposition | New home |
|---|---|---|
| defaultProvider/defaultModel/defaultThinkingLevel | **Relocate** | Models & Cost |
| externalEditor, shellPath, shellCommandPrefix, npmCommand | **Advanced** | Advanced → Environment |
| enableAnalytics + trackingId | **Relocate** | Observability (telemetry card, opt-in language) |
| packages, extensions[], skills[], prompts[], themes[] | **Relocate** | Tools & Integrations → Resources |
| enabledModels | **Relocate** | Models & Cost |
| defaultTools[] | **Relocate** | Tools & Integrations |
| compaction.* | **Relocate** | Agent → Context |
| branchSummary.* | **Advanced** | |
| retry.* | **Advanced** | |
| thinkingBudgets.* | **Relocate** | Models & Cost → Advanced subgroup |
| markdown.*, terminal.* caps, websocketConnectTimeoutMs | **Advanced** | |
| sessionDir, httpProxy | **Advanced** | |
| lastChangelogVersion | internal (excluded from catalog) | |

Plus two new behaviors: **unknown-key validation** (warn on unrecognized
keys — today a typo does nothing forever) and **reset-to-defaults**
(per-section, backed up).

### 2.3 Unown slash commands (65)

The commands stay (keyboard-first users keep their grammar); Settings
becomes the discoverable surface that *launches* them. Dispositions here
are about the Settings catalog:

| Cluster | Disposition in catalog |
|---|---|
| `/plan /status /diff /brief /recap /context /btw` | Keep — not settings; capability map links them |
| `/permissions /add-dir /trust /project-settings /mcp trust /hooks trust /lsp trust` | **Merge → Safety → Trust manifest** (one surface for the five trust gates; commands still work) |
| `/memory /learning /feed` | **Merge → Memory + Learning** sections (view/edit/rollback/inbox) |
| `/undo /redo /restore /checkpoints /receipts /recovery /edit-resend` | **Merge → Recovery** |
| `/usage /insights` | **Merge → Models & Cost / Observability** |
| `/routines /promote` | **Relocate → Automation** |
| `/providers /model /thinking /scoped-models` | **Relocate → Models & Cost** |
| `/mcp /lsp /hooks` | **Relocate → Tools & Integrations** |
| `/split* /files /output-style /theme /hotkeys` | **Relocate → Agent → Interface** |
| `/goal /mission` | **Relocate → Agent → Goals** (budget controls added) |
| `/agents /tasks /delegation` | **Relocate → Tools & Integrations → Delegation** |
| `/advisor /addons /todos` | **Relocate → Agent → Addons** |
| `/doctor /doctor-instructions /engine /blame /wiki /repomap /sessions /recipe /flights /init-agents /changelog /abort /commit /note /dash` | Keep — linked from relevant sections, not duplicated |

### 2.4 Env vars (~150)

**Not one is removed** (compatibility contract). Disposition:
- ~40 load-bearing ones become **first-class Settings rows** with getters
  (show effective value + source) and, where safe, setters (persisted to the
  new `settings-overrides.json` that boot reads — see §5.3):
  Safety stack (strict hooks, sandbox, shield, scanner, adversary, trust
  bypass), budgets (governor ceilings, memory caps, fleet caps, subagent
  turns), dream gate/canary, hoist, auto-verify/auto-test, compaction
  thresholds, retention windows, engine host/auth/CORS (read-only display
  with warnings — service-level, not session-level).
- The rest become **Advanced rows** (read-only display + doc reference) —
  visible and searchable, which is already better than today.

### 2.5 CLI flags (24) + management commands (29)

All Keep. The Settings hub surfaces the *session-effective* values of flags
(permission mode, model, effort, add-dirs, worktree) in the status bar of
each section, so the flag→session→persisted chain is visible.

### 2.6 Config files (35)

All Keep as persistence layers. The hub adds: file-path display per row
("lives in ~/.unown/agent/addons.json"), schema validation warnings, and
export/import bundles that capture the user-owned subset.

### 2.7 Nothing is Removed

No existing setting, command, flag, var, or file is removed in this round.
Rationale: every one has users in the wild; the mission adds organization
and safety surfaces, it does not break muscle memory. (Candidate removals —
e.g. the 4 update-suppression spellings — are recorded as follow-ups, not
executed.)

---

## 3. Section contents (the settings registry)

Each row in the new `/settings` hub carries: name, current effective value,
risk badge (low/med/high), one-line purpose, contextual help (what it does,
where it persists, how to revert), related commands/files, and an action
(toggle / select / input / launch command / open file).

### 3.1 Agent
Capability map card (what Unown can do — the five mechanisms, linked);
session behaviour (permission-mode indicator, plan mode, steering, compaction
thresholds, worktree isolation); goals (active goal, budget — NEW);
interface group (theme, layout, panels, images, thinking display);
addons (ask/todo/advisor).

### 3.2 Memory
Tier stack viewer (= `/learning` enriched); per-tier browse/edit/rollback;
caps + budget meter (NEW: adjustable); hoist toggle (NEW: was env-only);
project-identity panel (NEW: resolved slug + adopt tool);
manual-notes protection notice; related: `/memory search`.

### 3.3 Learning
Learning feed (= `/feed`); **dream approval inbox (NEW)** — pending dream
diffs with approve/revert, default-off "review mode" toggle; dream guard
status (canary K, gate on/off — NEW visibility); skills: staged inbox
(NEW: promote/discard replacing `mv`), shipped list with health (NEW:
last-used); mint caps display; standing-orders card.

### 3.4 Automation
Routines list with state; run history; **stop-now kill switch (NEW)**;
**spend meter + per-routine budget (NEW)**; misfire policy; active hours;
default mode (read-only/standard) with risk badge; chain-depth display.

### 3.5 Safety
**Effective permission envelope** (the one-screen answer to "what is it
allowed to do"): mode chain, permission rules (view + validate), write
roots, sandbox state, strict-hooks; **trust manifest (NEW)** — one surface
enumerating what the current project activates (MCP servers, hooks, LSP,
permissions, settings) with approve/reject; defense-stack card (shield /
scanner / adversary / instruction guard / dream gate — states + warnings
when disabled); elicitation policy matrix (NEW); bypassPermissions guarded
(typed confirmation).

### 3.6 Models & Cost
Provider wizard (= `unown setup` presets, in-TUI); model selector with
effective chain ("project .unown/settings.json → user default → env");
thinking/effort; **budget card (NEW)**: governor ceilings (adjustable),
session budget, spend-so-far; pricing source display (env pin / verified
spec / estimate); update channel (stable/experimental + base URL, risk
badge).

### 3.7 Tools & Integrations
MCP server cards (health, tools, timeouts, trust, elicitation); hooks
editor (list + status + **loop breaker NEW**); LSP servers; skills/
commands/agents/styles/resources registries; delegation defaults (NEW:
turn cap, concurrency — was env-only); web search providers; browser
profile.

### 3.8 Observability
Status card (= `/status`); context meter (= `/context`); usage windows
(= `/usage`); insights link; **settings change ledger (NEW)** — the audit
trail of who changed what when (also feeds Recently changed); hook audit
feed (NEW, terminal side); telemetry opt-in; doctor link.

### 3.9 Recovery
Undo/redo/restore/checkpoints (launch surfaces) + **undo-coverage badge
(NEW)**; receipts ledger; dream rollback link; memory rollback link;
update rollback; dead-letter lane; **reset center (NEW)**: per-section
reset with automatic backup; export/import bundle.

### 3.10 Advanced
Env-var browser (searchable, effective values, doc links); network/proxy;
retry/transport/timeouts; retention windows (with permanence warning);
engine service controls; experimental lanes (local-ML, spec overrides);
keybindings reference.

---

## 4. Progressive disclosure model

- **Level 0 (hub):** 10 sections + Search + Recently changed + Recommended +
  Health + Export/Import/Reset. A novice never needs to go deeper to answer
  the six questions.
- **Level 1 (section):** cards with effective values + risk badges; actions
  that launch existing commands.
- **Level 2 (item):** editors with contextual help, persisted-rule preview
  ("this will write X to file Y"), and revert-to-previous.
- **Level 3 (Advanced gate):** env-var browser, infra knobs — behind an
  explicit "Advanced" acknowledgment, never deleted, always searchable.

Risk badges render on every level ≥1: `●` low (green), `◐` med (yellow),
`○` high (red outline) — high-risk actions additionally require typed
confirmation (bypassPermissions, disable dream gate, retention changes,
trust bypass).

## 5. Implementation contract (for Phase 8)

1. **Module:** `pi-repo/packages/self-learning/src/settings/` — registry
   (catalog + metadata), values (getters/setters per surface), history
   (change ledger + recently-changed), health (doctor-lite checks), transfer
   (export/import/reset), ui (the hub flow), command (the `/settings`
   registration + subcommands `search|status|export|import|reset|diff`).
2. **Vendored patches (minimal, precedent `/abort` round):**
   a. `interactive-mode.ts` `setupEditorSubmitHandler`: the `/settings`
   interception gains `&& !this.isExtensionCommand(text)` so the Unown hub
   wins when registered (upstream behavior unchanged otherwise).
   b. Autocomplete merge: an extension command whose name matches a built-in
   replaces it in the list (today it is filtered out) — "extension override
   wins" as a general rule.
3. **Persistence:** no new config-file formats for existing data — the
   registry reads/writes the existing files. New user preferences (review
   mode, budgets, ledger) live in `~/.unown/agent/settings-hub.json`
   (atomic writes, unknown-key tolerant, schema-documented).
4. **Headless parity:** `/settings status|export|diff` work without a TTY
   (text render); interactive hub requires TUI mode and says so otherwise.
5. **Tests:** unit tests for registry/values/history/transfer in the
   self-learning suite; vendored-patch tests in the pi suite; PTY lane
   script `scripts/tui-capture/verify_settings_hub.py` boots the real TUI,
   opens the hub, edits a setting, asserts persistence + recently-changed +
   revert.
6. **Cross-platform:** paths via UNOWN_HOME everywhere; no shell-isms in the
   UI layer; ledger/transfer are pure JSON; PTY lane runs on POSIX (Windows
   covered by unit tests + xplat dispatch).

## 6. Traceability

- Every Jx-n friction from `settings_user_journeys.md` maps to a section
  row above.
- Every E-subsystem gap from `settings_edge_case_catalogue.md` TOP-15 maps
  to a NEW control (search "NEW" in §3).
- Benchmark suite (Phase 9) measures the BEFORE/AFTER of: time-to-first-
  configuration, time-to-find, search success, coverage of the six
  questions, risk-badge presence, recovery-path reachability.
