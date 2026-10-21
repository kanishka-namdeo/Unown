# Recipes

Declarative agent instruction bundles — markdown files with YAML frontmatter that pair a task prompt with typed parameters, structured output, file templates and sub-agent routing. The goose Recipes contract, ported onto unown's `task` subagent lane.

- [What a recipe is](#what-a-recipe-is)
- [Where recipes live](#where-recipes-live)
- [Frontmatter field reference](#frontmatter-field-reference)
- [Running recipes](#running-recipes)
- [Validation and structured output](#validation-and-structured-output)
- [Templates](#templates)
- [Sub-recipes](#sub-recipes)
- [A complete example](#a-complete-example)

Related pages: [usage](usage.md) · [subagents](subagents.md) · [skills](skills.md) · [repo wiki](repo-wiki.md) · [configuration](configuration.md)

## What a recipe is

A recipe is a markdown file with YAML frontmatter. The **body is the task prompt** the agent executes; the frontmatter declares everything around it — what the recipe accepts (`parameters`), what its reply must look like (`response_schema`), files it may scaffold (`templates`), other recipes it delegates to (`sub_recipes`), which tools it may use (`allowed_tools`), and which model and reasoning effort run it (`model` / `effort`).

When a recipe runs, unown spawns a real subagent — the same fresh-context `unown --mode json` process the [`task` tool](subagents.md#the-task-tool) uses — with the interpolated body as its one self-contained task. The recipe layer owns the surface contract; the subagent does the work. In a session that means the full subagent contract: tiered memory, guardrails, the tool allowlist you declare, no nesting (a subagent cannot spawn further subagents) and a `[subagent]`-tagged note when it finishes. From the CLI the child is the same process shape (`-p --no-session`, JSON event stream) driven headlessly.

## Where recipes live

| Directory | Scope | Notes |
|---|---|---|
| `<project>/.unown/recipes/*.md` | project | commit these next to the code they know about |
| `$UNOWN_HOME/recipes/*.md` | user | every project (default `~/.unown/recipes/`; `UNOWN_HOME`-respecting) |

Both directories are scanned for `.md`, `.yaml` and `.yml` files. **Project wins on a name collision** — the same precedence as `.unown/agents/*.md` (built-in &lt; user &lt; project). A file without a `---` frontmatter block, or without both `name` and `description`, is skipped silently; `unown recipes validate <file>` tells you why a specific file did not load.

## Frontmatter field reference

Every field accepts goose's snake_case spelling or camelCase — `sub_recipes`/`subRecipes`, `response_schema`/`responseSchema`, `allowed_tools`/`allowedTools`.

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | The name `run` and `/recipe` look up; must be unique across scopes |
| `description` | yes | One line, shown by `list` — write it as a retrieval trigger |
| `parameters` | no | A JSON Schema object the invocation arguments must satisfy (see below) |
| `sub_recipes` | no | List of `{ name, description? }` entries (or plain strings) naming recipes this one delegates to |
| `response_schema` | no | A JSON Schema object the recipe's **final reply** must satisfy — turns the reply into typed, validated JSON |
| `templates` | no | List of `{ path, content }` files to scaffold before the subagent runs; both strings interpolate `{{param}}` tokens |
| `allowed_tools` | no | Restricts the subagent's active toolset (e.g. `[read, bash, grep]`); omit for the full set |
| `model` | no | Model id for this recipe's subagent run — same routing field as an [agent definition](subagents.md#per-agent-routing) |
| `effort` | no | `low` / `medium` / `high` reasoning effort for the run |

The Markdown body after the closing `---` is the prompt. `{{param}}` tokens in it are replaced with the argument values before the subagent is spawned: strings/numbers/booleans verbatim, objects and arrays JSON-stringified (so `{{items}}` can carry a list), dotted paths (`{{user.name}}`) and bracket indices (`{{items[0]}}`) reach into nested arguments, and a missing parameter renders as an **empty string** — interpolation never throws.

## Running recipes

Two surfaces, one implementation:

**From the shell** — `unown recipes <subcommand>`:

```bash
unown recipes list                      # every discovered recipe + its fields
unown recipes run release-notes --from-ref v0.0.1 --to-ref HEAD
unown recipes create release-notes      # scaffold project scope (--user for the user dir, --path to choose)
unown recipes validate .unown/recipes/release-notes.md
```

`run` takes `--key value` pairs after the name: kebab-case keys are normalized to the lowerCamelCase your `parameters` schema declares (`--from-ref` → `fromRef`), and a bare `--flag` becomes `true`. `--user-dir <path>` overrides the user recipes directory for one invocation. On success the recipe's reply is printed (the **validated JSON**, pretty-printed, when a `response_schema` is declared); scaffolded template files are listed on stderr; the exit code is 0 only on success.

**In a session** — the `/recipe` command:

```
/recipe list                            # discovered recipes + provenance (project/user)
/recipe show release-notes              # frontmatter summary + the raw body
/recipe release-notes --from-ref v0.0.1 --to-ref HEAD
```

The same `--key value` grammar, the same validation and retry loop; the result renders in the session.

## Validation and structured output

Two contracts, both enforced before you pay for prose:

1. **Arguments** are validated against `parameters` *before any subagent spawns* — a bad invocation fails immediately with the schema's own defect paths (`parameter validation failed: fromRef: required property missing`), no paid run on a broken contract.
2. **The reply** — when `response_schema` is declared, the subagent's final message is parsed as JSON (bare JSON, a fenced `json` block, or one JSON object surrounded by prose all work) and validated locally. An invalid reply is retried up to **two corrective re-runs** with the exact defects quoted back to the subagent, after which the run fails with the last defects. A valid reply is returned as structured output — the typed data *is* the result. A recipe without `response_schema` returns the raw reply verbatim.

A malformed `parameters` or `response_schema` is reported as a schema error — the recipe file is the bug, no argument tweaking will fix it.

## Templates

`templates` scaffold files before the subagent starts: each `path` and `content` is interpolated against the arguments and written **atomically** (tmp + rename) into the project root. Paths are relative to the project; a `path` that interpolates to empty is skipped. Template writes are best-effort by design — a failed write is reported as a warning and never aborts the subagent run (templates are scaffolding the agent will typically overwrite anyway). Files written are reported back with the result.

## Sub-recipes

`sub_recipes` declares the recipes this one can delegate to, and the body references them with goose's `{{> name arg=value }}` token shape. The recipe layer does **not** execute these tokens — they are emitted verbatim into the prompt, and the running subagent invokes them through its own tool use. Declaring the sub-recipe in frontmatter is what makes `list` and `show` honest about the dependency; the body token is what makes the subagent use it.

## A complete example

`<project>/.unown/recipes/release-notes.md`:

```markdown
---
name: release-notes
description: Draft release notes for a version range from the git log. Use when asked to summarize changes between two tags or since a commit.
parameters:
  type: object
  properties:
    fromRef:
      type: string
      description: The earlier tag or commit to diff from
    toRef:
      type: string
      description: The later tag or commit (empty = HEAD)
  required: [fromRef]
response_schema:
  type: object
  properties:
    headline:
      type: string
    sections:
      type: array
      items:
        type: object
        properties:
          title:
            type: string
          bullets:
            type: array
            items: { type: string }
        required: [title, bullets]
  required: [headline, sections]
allowed_tools: [read, bash, grep]
model: kimi-k2.5
effort: medium
---

# Draft release notes: {{fromRef}} → {{toRef}}

1. Run `git log --oneline {{fromRef}}..{{toRef}}` and read the full commit
   subjects; do not trust the one-line summaries alone — read each commit's
   message when the subject is ambiguous.
2. Group the changes into sections (Added / Changed / Fixed / …), one bullet
   per change, phrased for a user reading the changelog — not the diff.
3. Write a one-sentence headline that names the release's biggest change.

If the range contains no commits, return one section titled "No changes" with
a bullet saying so.

Reply with ONLY the JSON object matching the response schema — no prose, no
markdown fences.
```

Run it:

```bash
$ unown recipes run release-notes --from-ref v0.0.1 --to-ref HEAD
{
  "headline": "Recipes, repo wiki and per-subagent routing land",
  "sections": [
    { "title": "Added",
      "bullets": [
        "unown recipes — declarative instruction bundles (goose port)",
        "unown wiki — auto-generated repo docs with file:line cross-links"
      ] }
  ]
}
```

Validate the file first with `unown recipes validate .unown/recipes/release-notes.md` — it prints the parsed field summary (parameters, response_schema, templates, tools, model, effort, body length) without running anything.
