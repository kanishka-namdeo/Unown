# Settings Competitor Review — Phase 2 of the Settings Evolution Round

**Date:** 2026-10-31 · **Sources:** 38 official-doc URLs, all fetched live
2026-10-30 (appendix). **Feeds:** `docs/settings_ia_redesign.md`,
`docs/settings_trust_recovery_framework.md`.

Tools studied: Claude Code, OpenAI Codex CLI, Gemini CLI, Roo Code, Aider,
Cline, OpenHands (formerly OpenDevin), plus Warp as a bonus. Each was
evaluated on six axes: settings architecture, trust design, memory controls,
agent control, observability, recovery.

---

## 1. Tool-by-tool verdicts

### Claude Code — the files-first benchmark

- **Architecture:** four JSON scopes (user / shared project / project-local
  / managed) with a documented precedence stack; lists merge instead of
  overriding; settings hot-reload with a `ConfigChange` hook; `$schema` key
  gives editor autocomplete + validation; `/config key=value` sets one key;
  broken JSON triggers a dialog (fix with Claude / exit / continue).
- **Trust:** six permission modes; the permission prompt displays the exact
  rule being saved and withholds "don't ask again" when the rule can't be
  fully shown; Tab opens a comment fed back to the model as the denial
  reason; `/permissions` lists rules with source file; workspace trust
  dialog lists granted rules; deny-wins at every level; managed settings can
  set `allowManagedPermissionRulesOnly`.
- **Memory:** CLAUDE.md files + auto memory as plain markdown, `/memory`
  browser, `autoMemoryEnabled` per-project opt-out.
- **Observability:** `/status` (which sources loaded), `/context` colored
  grid, `/usage`, usage-limit countdown with auto-continue.
- **Recovery:** timestamped backups (last 5), corrupt-file copy, granular
  "reset to default configuration".

### Codex CLI — the two-axis model

- **Architecture:** `config.toml` with profiles (`--profile`); a ~989-line
  reference (sprawl anti-pattern) but a principled core.
- **Trust:** two orthogonal axes — `sandbox_mode` (read-only /
  workspace-write / danger-full-access) × `approval_policy` (untrusted /
  on-failure / on-request / never) — plus an intent→flags table that labels
  the max combo "YOLO — not recommended". Danger is embedded in identifiers
  (`--dangerously-bypass-approvals-and-sandbox`). OS-level sandboxes
  (Seatbelt/Landlock/seccomp). Progressive directory trust upgrades
  read-only → full.
- **Observability:** OTel event catalog; managed configs with forced login.
- **Recovery:** edit/delete the file; no reset command.

### Gemini CLI — the best trust surface

- **Architecture:** `/settings` dialog covering ALL settings grouped by
  category (the closest thing to a complete in-product settings browser in
  the terminal cohort); docs map UI-label → key → default.
- **Trust:** folder-trust discovery dialog enumerates exactly what the
  folder activates — custom commands, MCP servers, hooks, skills, setting
  overrides — with inline security warnings ("auto-approving certain tools
  or disabling the security sandbox"). YOLO is flag-only, excludable from
  settings files, with a `disableYoloMode` org lock. `enablePermanentToolApproval`
  defaults **false**.
- **Memory:** auto memory proposes diffs into a **review inbox**
  (`/memory inbox`); never auto-applies; secrets redacted — the single most
  relevant pattern for Unown's AutoDream.
- **Recovery:** checkpointing + rewind.

### Roo Code — risk vocabulary done right (in docs)

- **Architecture:** VS Code settings + rich panels; export/import (merge
  semantics) / reset.
- **Trust:** auto-approve tiles with master switch and per-permission
  Low/Medium/Medium-High/High **risk levels**; allowlist/denylist with
  longest-prefix precedence; write-delay; per-mode API profiles.
- **Recovery:** checkpoints with Compare view; BUT the reset is the
  anti-pattern: one red irreversible button that deletes keys, modes and
  task history.

### Aider — the anti-baseline

No settings UI; 100+ flags + YAML; git-as-safety (`/undo` works because
aider attributes its commits). Demonstrates that recovery can substitute
for configuration — but only for write actions, never for trust/cost.

### Cline — cautionary tale + best framing

Per-tool-call auto-approve matrix; model-classified `requires_approval`;
checkpoints with "cost of a mistake drops to nearly zero". But the YOLO
checkbox ("No confirmation dialogs", one click, global, no scoping) is the
worst anti-pattern found. Enterprise `yoloModeAllowed: false` lock +
telemetry on toggles.

### OpenHands — cost UX leader

Per-conversation USD budget (soft stop with continue prompt); org budgets
with 80/90/100% alerts; per-user defaults; events API for audit.

### Warp (bonus) — autonomy matrix

Per-action-type 4-level matrix: **Agent Decides / Always ask / Always allow
/ Never**, plus profiles and team-enforced denylists that are never
bypassable. "Agent Decides" (delegate judgment, escalate to me if unsure)
is the level nobody else names.

---

## 2. The twelve patterns Unown should adopt

| # | Pattern | Source | Why it works | Verdict for Unown |
|---|---|---|---|---|
| 1 | Two orthogonal axes: capability sandbox × approval policy, turned into an intent menu | Codex | Matches "what could go wrong" vs "how often to interrupt" | **Adopt** — permission-mode already half-there; add capability axis + named presets |
| 2 | Named switchable profiles | Codex/Warp/Roo | Chunking + situational identity; shareable | **Adopt** — presets.ts exists; surface as first-class profiles |
| 3 | Per-action 4-level autonomy incl. "Agent decides" | Warp | Delegation with escalation path | **Adopt** for tool permissions |
| 4 | Risk-labeled toggles in-UI | Roo | Pre-activates System-2 at decision moment | **Adopt** — risk badge on every settings row |
| 5 | Checkpoint every write + 3-way restore (files/conversation/both) | Cline/Roo/Gemini | Loss aversion → reversibility → autonomy | **Already strong** (`/undo`, `/restore`); expose in Settings |
| 6 | Trust dialog as discovery manifest (enumerate what activates, flag danger inline) | Gemini | Informed consent at max leverage | **Adopt** — unify the 5 `/x trust` commands |
| 7 | Show the exact persisted rule | Claude | Closes decision→config loop | **Adopt** for permissions auto-learn |
| 8 | Deny-wins precedence + unbypassable enterprise tier | Claude/Warp/Cline | Predictable composition | **Verify** Unown has it; document |
| 9 | Hot-reload + verification surfaces (`/status` sources, doctor) | Claude | Closes edit→effect gap | **Partial** (doctor exists); add settings health check |
| 10 | Review-inbox for learned memory (propose→review→apply, redaction, atomic) | Gemini | The answer to "what has it learned?" | **Adopt** — dreams already version+rollback; add inbox surface |
| 11 | Budgets with threshold alerts + soft stops | OpenHands | Warnings before the cliff | **Adopt** — governor has ceilings; add visibility + session budget |
| 12 | Plain files + `$schema` + catalog docs | Claude/Codex/Gemini | Catches typos at entry | **Adopt** — generate JSON schemas for unown config files |

## 3. The five anti-patterns to avoid

1. **The unguarded YOLO checkbox** (Cline) — one checkbox, global, all
   actions, no confirmation. Unown's `bypassPermissions` must require typed
   confirmation and carry a visible warning (it already refuses under
   strict-hooks — surface that).
2. **Risk information only in docs** (Roo/Cline/Codex) — Unown must render
   risk badges in the TUI, not just `.env.example` comments.
3. **All-or-nothing irreversible reset** (Roo) — scoped resets, pre-reset
   backup, export-first nudge.
4. **Settings sprawl with no search** (Codex/Aider) — fuzzy search over
   name + description + value is the differentiation; nobody in the terminal
   cohort has it.
5. **Silently broad persistence** — always render the persisted rule;
   default persistence off; one-keystroke session allow-list clear.

## 4. Focused findings

- **Risk communication:** danger-in-names (Codex), WARNING callouts, red
  destructive buttons, colored usage grids, in-dialog warnings (Gemini's
  trust dialog is the only settings-review surface that flags risk inline).
- **Settings search:** terminal tools barely do it — white space. VS Code
  extensions outsource to the host. **Unown can lead.**
- **Recently changed:** nobody does it well (Claude's `ConfigChange` hook
  and timestamped backups are accidental changelogs). **Unown can lead**
  with a first-class change ledger.
- **Reset/recovery:** Claude's staged severity (Error vs Warning), backups,
  granular reset is the shape to copy.
- **Cost budgets:** OpenHands' soft-stop + threshold alerts; Roo's
  "include current cost in system prompt".
- **Autonomy selection:** Warp's matrix + Claude's Shift+Tab cycling
  indicator + Codex's intent menu.
- **Enterprise audit:** OTel event catalog (Codex), toggle telemetry
  (Cline), managed deny-wins (Claude), never-bypassable team rules (Warp).

## 5. Direct consequences for this round

1. The new `/settings` hub gets **fuzzy search** over every catalog entry.
2. Every row carries a **risk badge** (low/med/high) rendered in the TUI.
3. **Recently changed** ledger with revert-to-previous value.
4. **Health checks** (doctor-lite inside settings) + config **diff vs
  defaults** + **export/import/reset** (scoped, backed up).
5. A unified **trust manifest** for project configs (extends
   `/project-settings trust` to enumerate everything a project activates).
6. A **dreams review inbox** entry point in Settings → Learning.
7. **Budget visibility** in Settings → Models & Cost (governor ceilings +
  session budget).
8. Named **autonomy presets** in Settings → Safety.

---

## Appendix — sources (all accessed 2026-10-30)

| Tool | Page | URL |
|---|---|---|
| Claude Code | Settings | https://code.claude.com/docs/en/settings.md |
| Claude Code | Permissions | https://code.claude.com/docs/en/permissions.md |
| Claude Code | Memory | https://code.claude.com/docs/en/memory.md |
| Claude Code | Commands | https://code.claude.com/docs/en/commands.md |
| Claude Code | Hooks | https://code.claude.com/docs/en/hooks.md |
| Claude Code | Interactive mode | https://code.claude.com/docs/en/interactive-mode.md |
| Codex CLI | Config reference (tag rust-v0.68.0) | https://github.com/openai/codex/blob/rust-v0.68.0/docs/config.md |
| Codex CLI | Sandbox & approvals | https://github.com/openai/codex/blob/rust-v0.68.0/docs/sandbox.md |
| Gemini CLI | Settings | https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/settings.md |
| Gemini CLI | Trusted folders | https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/trusted-folders.md |
| Gemini CLI | Auto memory | https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/auto-memory.md |
| Gemini CLI | Checkpointing / Rewind | https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/checkpointing.md · …/rewind.md |
| Roo Code | Auto-approving actions | https://docs.roocode.com/features/auto-approving-actions |
| Roo Code | Checkpoints | https://docs.roocode.com/features/checkpoints |
| Roo Code | Settings management | https://docs.roocode.com/features/settings-management |
| Roo Code | API profiles | https://docs.roocode.com/features/api-configuration-profiles |
| Aider | Options / commands / YAML | https://github.com/Aider-AI/aider/blob/main/aider/website/docs/config/options.md (+commands.md, aider_conf.md) |
| Cline | Auto Approve & YOLO | https://docs.cline.bot/features/auto-approve.md |
| Cline | Checkpoints / Plan-Act | https://docs.cline.bot/core-workflows/checkpoints.md · …/plan-and-act.md |
| Cline | Enterprise YOLO controls | https://docs.cline.bot/enterprise-solutions/configuration/infrastructure-configuration/control-other-cline-features/yolo-mode.md |
| OpenHands | App/LLM settings, budgets | https://docs.openhands.dev/openhands/usage/settings/application-settings.md (+llm-settings.md, …/budgets.md) |
| Warp | Agent profiles & permissions | https://docs.warp.dev/agents/capabilities/agent-profiles-permissions |

*Fetch note: `developers.openai.com/codex/*` returns 403 to bots; Codex
facts sourced from the identical docs at the official repo tag
`rust-v0.68.0`. The full raw research notes (7,303 words) live in the
round's research lane and are summarized here.*
