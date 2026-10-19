# Permissions — user-configurable allow/deny rules

Unown's guardrails ship in two layers. The **hard-coded layer** (always on):
the catastrophic-command deny-list (`rm -rf /`, fork bombs, disk formats),
the write-path jail (writes stay inside your project), and the syntax gate.
The **permissions layer** (this page): a declarative, user-configurable
allow/deny/ask policy you tune per tool, per pattern — Claude Code / Cline
style.

The permissions layer can only ever **add** restrictions. The hard-coded
checks run first and their verdicts are final: no rule — not even
`{"tool": "bash", "effect": "allow", "pattern": "*"}` — can unlock
`rm -rf /` or an out-of-jail write. When no rule matches, behavior is
byte-for-byte the pre-existing policy (zero-surprise rollout).

## Config files

Both are optional, JSON, same schema:

| File | Scope | Trust |
| --- | --- | --- |
| `<project>/.unown/permissions.json` | project | **trust-gated** exactly like `.unown/mcp.json` / `.unown/lsp.json` — a cloned repo is attacker-controlled, so a new fingerprint is refused until you approve it (`/permissions` prints the state; `UNOWN_TRUST_PROJECT_CONFIG=1` bypasses for CI) |
| `~/.unown/agent/permissions.json` | user | always trusted (you wrote it) |

```json
{
  "version": 1,
  "mode": "default",
  "rules": [
    { "tool": "bash",     "effect": "deny",  "pattern": "npm publish*" },
    { "tool": "bash",     "effect": "allow", "pattern": "bun test*" },
    { "tool": "edit",     "effect": "deny",  "pattern": "**/*.env*" },
    { "tool": "edit",     "effect": "allow", "pattern": "src/**" },
    { "tool": "write",    "effect": "deny",  "pattern": ".git/**" },
    { "tool": "webfetch", "effect": "allow", "pattern": "https://github.com/*" },
    { "tool": "mcp",      "effect": "allow", "pattern": "github/*" },
    { "tool": "task",     "effect": "allow" }
  ]
}
```

**Merge**: user rules win over project rules for the same tool+pattern;
project rules fill the gaps. **Evaluation**: the most specific matching rule
wins (specificity = literal, non-wildcard characters; a rule with no pattern
is the least specific). At equal specificity `deny` beats everything, and a
session-learned allow beats a config `ask` (you just confirmed it).

## Effects

| Effect | Meaning |
| --- | --- |
| `allow` | the call proceeds without confirmation |
| `deny` | the call is blocked; the agent sees `[unown-permissions] denied by rule <pattern>` and can tell you what it wanted |
| `ask` | forces a confirmation even in `acceptEdits` mode |

## Pattern semantics

A tiny built-in matcher — no new dependency:

- `*` matches within one path segment (never crosses `/`)
- `**` matches across segments (`src/**`); `**/` before a slash may also match zero segments
- **bash** patterns match the whole command string, first-token aware: `bun test*` matches `bun test src/foo.ts` but not `bunx test`
- **edit / write / read** patterns match project-relative paths (absolute in-project paths are relativized)
- **webfetch / fetch_url** patterns match URLs (scheme + host case-insensitive)
- **mcp** patterns match `server/tool` against `mcp__server__tool` calls

Tool names: `bash`, `edit`, `write`, `read`, `webfetch`, `web_search`,
`fetch_url`, `mcp`, `task`, `note`, `todo`, `lsp`, `automation_create`,
`automation_update`, `automation_delete`, `automation_list`. Unknown tool
names in the config produce a warning, never a crash.

## Modes

| Mode | Behavior |
| --- | --- |
| `default` | `ask` rules trigger a confirmation; everything else as above |
| `acceptEdits` | `ask` rules on edit/write with in-project paths are auto-approved (the path jail still confines writes) |
| `bypassPermissions` | `ask` prompts are skipped (treated as allow) — `deny` rules and the hard-coded guardrails STILL apply; the mode refuses to load under `UNOWN_STRICT_HOOKS=1` (falls back to `default` with a loud warning) |

## The `ask` effect without a UI

pi's tool-call seam supports an interactive confirmation when a UI exists
(TUI and RPC modes): a select dialog with allow / always-allow-this-session /
deny. In headless modes (`unown -p`, `--mode json`) there is no one to ask,
so the gate **degrades fail-closed**: the call is blocked with guidance to
add an allow rule. That is a deliberate product decision — a headless agent
must not silently auto-approve its way past an `ask` rule.

## Learning (opt-in)

`UNOWN_PERMISSIONS_LEARN=1` — when a bash command passes in default mode
with **no** matching rule, an `allow` rule for its leading command
(`bun test*` for `bun test src/foo.ts`) is appended to the **user** config:
idempotent, atomic, capped, and it never touches a malformed file. The ask
dialog's "Always allow (this session)" keeps the same rule in memory only;
with the learn knob on it is also persisted.

## Environment knobs

| Variable | Effect |
| --- | --- |
| `UNOWN_PERMISSIONS=0` | disable the whole permissions layer (hard-coded guardrails unaffected) |
| `UNOWN_PERMISSIONS_LEARN=1` | persist learned allow rules (see above) |
| `UNOWN_TRUST_PROJECT_CONFIG=1` | treat the project permissions config as trusted (CI) |
| `UNOWN_STRICT_HOOKS=1` | `bypassPermissions` refuses to load (see Modes) |

## Commands and diagnostics

- `/permissions` (in-session) — mode, trust state, and the full rule table
  (tool / effect / pattern / which file it came from)
- `unown doctor` — a permissions section: config files found / valid /
  trusted, rule counts, mode, learn state

## Team-repo example

Check `.unown/permissions.json` into the repo to encode your team's policy —
new contributors get it after approving the trust prompt on first run:

```json
{
  "version": 1,
  "mode": "default",
  "rules": [
    { "tool": "bash", "effect": "allow", "pattern": "pnpm *" },
    { "tool": "bash", "effect": "allow", "pattern": "docker compose *" },
    { "tool": "bash", "effect": "deny",  "pattern": "pnpm publish*" },
    { "tool": "bash", "effect": "deny",  "pattern": "git push --force*" },
    { "tool": "write", "effect": "deny", "pattern": "terraform/**" }
  ]
}
```

## Security notes

- **Deny always wins** at equal specificity, and the hard-coded layer runs
  first regardless of any rule.
- **Trust is refuse-first** for project config: a fingerprint change (e.g. a
  fresh clone, or a modified file in a repo you just pulled) re-arms the
  gate. This is the same contract as the MCP and LSP project configs.
- **`bypassPermissions` is not a jailbreak**: it only silences `ask` prompts.
  Catastrophic commands stay blocked, writes stay jailed.
