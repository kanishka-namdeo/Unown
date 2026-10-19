# Repo Wiki

Auto-generated repo documentation with `file:line` cross-links — the zcode Repo Wiki feature ported onto unown's parallel subagent lane. One command walks your repo, documents every module with cited evidence, and writes a navigable wiki under `.unown/wiki/`.

- [What it generates](#what-it-generates)
- [Where it writes](#where-it-writes)
- [Running it](#running-it)
- [How generation works](#how-generation-works)
- [Search](#search)
- [A usage walkthrough](#a-usage-walkthrough)

Related pages: [usage](usage.md) · [subagents](subagents.md) · [recipes](recipes.md) · [skills](skills.md)

## What it generates

| Page | Contents |
|---|---|
| `index.md` | top-level overview — project name/description, detected languages and frameworks, top dependencies, entry points, and a linked list of every module page |
| `modules/<name>.md` | one page per module: a responsibilities summary, the public API (name, signature, and the `file:line` where each export is defined), key files with their roles, and cross-links to the modules it depends on |
| `architecture.md` | the dependency graph — a Graphviz **DOT** block plus a plain markdown dependency list, and a **Cycles Detected** section listing any dependency cycles found (deduplicated, each cycle spelled out `A → B → A`) |
| `changes.md` | recent changes, extracted from `CHANGELOG.md` (capped at 6 KB with a truncation note; a placeholder when no changelog exists) |
| `wiki.json` | the manifest — `{ version, generatedAt, pages: [...] }`, one entry per page with its path, title and dependency list, so any renderer can build navigation without parsing markdown |

Module page names are path slugs: `src/auth` becomes `modules/src--auth.md`. Every claim in a module page cites a `file:line` — the prompt's hard rule — so the wiki is a navigable map of the codebase, not a free-form summary.

## Where it writes

The wiki lives at `<project>/.unown/wiki/` — project-scoped, nothing user-global. It is generated output: commit it if you want the docs reviewed in PRs, or add `.unown/wiki/` to your `.gitignore` if you treat it as local state. Every page is written **atomically** (tmp + rename), and the manifest is written last, so a crash mid-write never leaves a manifest pointing at missing pages.

## Running it

Two surfaces, one implementation:

```bash
unown wiki generate [--force] [--cwd <path>]   # generate (or regenerate) the wiki
unown wiki search <query>                      # rank pages against a query
unown wiki list                                 # pages + generation timestamp from wiki.json
unown wiki show <page>                          # print a page ("index", "src--auth", …)
```

In a session, the same four subcommands ride `/wiki`:

```
/wiki generate [--force]
/wiki search auth middleware
/wiki list
/wiki show src--auth
```

`--force` matters: generation **refuses to overwrite an existing wiki** (`wiki.json` present) — regenerate deliberately with `--force` or remove the directory. `/wiki show` caps at 8 KB in the session popup and points at the CLI for the full text; `unown wiki show` prints it all. And because generation is a plain CLI call, the automations substrate can keep it fresh: a scheduled automation in `standard` mode can run `unown wiki generate` on cron.

## How generation works

1. **Module discovery** — a pure filesystem walk groups source files by directory; each directory with at least one source file becomes a module. Dependencies, build outputs, caches and local state are excluded by default (`node_modules`, `.git`, `dist`, `build`, `.unown`, `.cache`, `coverage`, `venv`, …), hidden directories are skipped, and the walk stops at depth 4 — so the wiki indexes your code, not your checkout's luggage.
2. **Parallel subagents** — every module is documented by a **read-only `task` subagent** (`read`, `grep`, `find`, `ls`) fanned out in parallel. Each subagent's reply must satisfy a JSON Schema (`output_schema`: `title`, `summary`, `public_api[]`, `key_files[]`, `depends_on[]`) — the same structured-output lane the `task` tool uses — so the synthesizer never re-parses prose. A module whose subagent fails becomes an honest **error page** (the failure and the file list, still written); partial failures never abort the wiki.
3. **Synthesis** — the index, architecture and changes pages are built locally from the structured module metadata plus cheap manifest forensics (`package.json` / `Cargo.toml` / `go.mod` / `pyproject.toml` … → name, languages, frameworks, dependencies, entry points). No subagent involved.
4. **Atomic write** — every page and finally the manifest land under `.unown/wiki/` via tmp + rename.

## Search

`unown wiki search <query>` / `/wiki search <query>` walks the generated pages and ranks them: each query term is matched case-insensitively over every page's full text, scoring **2 per occurrence**, plus **5 when the page's H1 title contains the whole query**. Results come back best-first with the score, page path, title, and a snippet excerpted around the first match. A missing wiki directory gets a pointed message (`No wiki found at … — run unown wiki generate first`), not a stack trace.

## A usage walkthrough

```bash
$ unown wiki generate
Generating wiki for /home/me/my-project…
✓ Wiki written to /home/me/my-project/.unown/wiki
  Pages: 14
  Generated at: 2026-10-24T09:12:03.412Z

$ unown wiki list
Wiki at /home/me/my-project/.unown/wiki (generated 2026-10-24T09:12:03.412Z):
  index.md  —  my-project — Repo Wiki
  architecture.md  —  Architecture — my-project
  changes.md  —  Recent Changes
  modules/src--auth.md  —  Auth
  …

$ unown wiki search "refresh token"
Search results for "refresh token" (2 matches):
  [score 11] modules/src--auth.md — Auth
    …`rotateRefreshToken` at `src/auth/tokens.ts:42`…

$ unown wiki show src--auth
# Auth
> Auto-generated by `unown wiki generate` — every claim cites `file:line`.
**Module**: `src/auth`
## Summary
…
```

In a session the same loop reads: `/wiki generate`, then `/wiki search "refresh token"` — or skip the wiki's own search and just have the agent read the pages directly; they are ordinary markdown with ordinary file paths.

Regenerate after large refactors (`/wiki generate --force` — the manifest refusal keeps a stale wiki from being silently clobbered), and check `architecture.md` in review: a missing **Cycles Detected** section means the dependency graph has no cycles.
