# Custom slash commands — `.unown/commands`

> Reusable named prompts: markdown files in two scopes, frontmatter metadata,
> bash-flavored argument substitution — the Claude Code `.claude/commands`
> contract on unown.

- [Two scopes](#two-scopes)
- [File format](#file-format) (incl. [the YAML quoting trap](#the-yaml-quoting-trap))
- [Argument substitution](#argument-substitution)
- [Where commands work](#where-commands-work)
- [Security posture](#security-posture)
- [Ideas](#ideas)

Unown ships twenty-seven built-in slash commands (`/plan`, `/todos`, `/undo`, …,
plus the newest, `/addons` and `/advisor` — and the split-view display mode's
`/split` family on top), pi ships its own twenty-three, and every discovered
[skill](skills.md) registers as `/skill:<name>`. This page is about the
fourth kind: **your own commands** — reusable prompts you keep next to the
project (or in your user dir) and invoke by name, Claude Code
`.claude/commands` style.

A custom command is a markdown file with optional YAML frontmatter. The file
name becomes the command name; the body becomes the prompt; placeholders in
the body are substituted with the arguments you pass after the command.

## Two scopes

| Directory | Scope | Notes |
| --- | --- | --- |
| `<project>/.unown/commands/*.md` | this project | lives with the repo; commit it and everyone on the team gets it |
| `~/.unown/agent/commands/*.md` | you, everywhere | your personal toolbox, available in every project |

Both are scanned on every boot (and `/reload` picks up new files mid-session).
Subdirectories are not scanned — one flat directory of `*.md` files per scope,
same as Claude Code. A name collision between the scopes resolves to whichever
loads first (project scope is listed first).

## File format

```markdown
---
description: Review a PR URL with structured issue and code analysis
argument-hint: "<PR-URL>"
---
Review this pull request: $1

- Summarize the intent in one paragraph
- List P1/P2 issues with file:line references
- End with a SHIP / DO NOT SHIP verdict
```

Frontmatter keys (all optional):

| Key | Meaning |
| --- | --- |
| `description` | one line, shown in autocomplete and the loaded-resources listing |
| `argument-hint` | shown after the command name in autocomplete, e.g. `<PR-URL>` |

The body is plain markdown sent as your message after substitution. A command
with no frontmatter works fine — the first non-empty body line doubles as the
description.

### The YAML quoting trap

`argument-hint` values that start with `[` must be quoted, because unquoted
`[...]` is a YAML flow sequence:

```yaml
argument-hint: "[name] [greeting]"   # ✓ quoted — renders verbatim
argument-hint: [name] [greeting]     # ✗ two flow sequences — YAML parse error
```

A parse error in the frontmatter **no longer kills the command** (it used to):
the file degrades to no-frontmatter — the body still loads and runs, only the
description/hint metadata is lost. An unquoted single group like
`argument-hint: [flags]` parses as an array and is normalized to the plain
string `flags`. Quote the hint when you want literal brackets.

## Argument substitution

Bash-flavored placeholders, substituted before the prompt is sent:

| Placeholder | Expands to |
| --- | --- |
| `$ARGUMENTS` or `$@` | all arguments, joined with spaces |
| `$1`, `$2`, … `$N` | the Nth argument (empty string when missing) |
| `${1:-fallback}` | Nth argument, or `fallback` when missing/empty |
| `${ARGUMENTS:-fallback}` / `${@:-fallback}` | all arguments, or `fallback` when none |
| `${@:2}` | arguments from the 2nd onwards |
| `${@:2:3}` | 3 arguments starting from the 2nd |

Arguments are split bash-style: whitespace-separated, double/single quotes
group words. Substitution is single-pass — argument values containing `$1` or
`$ARGUMENTS` are inserted verbatim, never re-expanded (no injection through
argument text).

## Where commands work

- **TUI**: type `/` and the command appears in autocomplete with its
  description and argument hint; Enter expands and sends it like a typed
  message.
- **Print mode**: `unown -p "/review-pr https://github.com/org/repo/pull/42"`
  expands identically — CI scripts can drive custom commands headlessly.
  Combine with `--output-format json` (see [usage](usage.md#three-ways-to-run))
  for a one-line JSON result contract.
- **Subagents**: the `task` tool spawns `unown -p` under the hood, so custom
  commands expand there too.

## Security posture

Custom commands are **not trust-gated** the way `.unown/mcp.json` or
`.unown/permissions.json` are. The reasoning: a command only runs when *you*
type its name — the project cannot make the agent execute one, exactly as a
cloned repo cannot make you paste text. This matches the Claude Code
`.claude/commands` contract. Two consequences worth knowing:

- A cloned repo can *ship* commands that appear in your autocomplete (with a
  project-scope label), but they execute only on your explicit invocation.
- Anything the command's *prompt* causes the agent to fetch at runtime (a URL,
  a bash stdout) still passes through the [injection shield](usage.md#guardrails)
  and the [guardrails](usage.md#guardrails) like any other content.

## Ideas

- `/release-notes 2.1.0` — diff-since-tag → changelog paragraph draft
- `/pr-description` — read the branch's commits, write the PR body
- `/oncall-handoff` — summarize open todos, failing checks, and current goal
- `/digest-errors error.log` — cluster and explain a build log (piped stdin
  joins the prompt in print mode: `cat error.log | unown -p "/digest-errors"`)

## Related pages

- [usage.md](usage.md) — the full command/flag surface, incl. `--output-format json`
- [skills.md](skills.md) — the other user-extensible surface (SKILL.md format)
- [permissions.md](permissions.md) — the trust-gated config layers, and why commands deliberately are not
- [subagents.md](subagents.md) — `/agents` definitions, the other `.unown/` markdown format
- [recipes.md](recipes.md) — declarative task bundles, the frontmatter-driven `.unown/recipes/` format
