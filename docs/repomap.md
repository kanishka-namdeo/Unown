# Repo map — the graph-ranked symbol map

`/repomap` (in-chat) and `unown repomap` (shell) render an [aider-style repo map](https://aider.chat/docs/repomap.html) of the working directory: every file's key definitions, ranked by a PageRank over the *who-references-whom* graph, fitted into a token budget. Fresh subagents get one appended to their task automatically — the cheap structural overview LSP can't give you on a cold start (LSP answers *per-file* questions once a server is running; the map answers *"where do I even look?"*).

```
unown repomap                     # the map, 1024-token budget
unown repomap --tokens 2048       # a bigger map
unown repomap --refresh           # bypass caches (right after edits)
unown repomap clear               # drop .unown/repomap-cache.json
unown repomap --json              # machine-readable

/repomap [--tokens N] [--refresh] | /repomap clear
```

## What the map looks like

```
README.md
src/repomap/graph.ts:
│export function buildRefGraph(files: string[], tags: Tag[], opts: GraphOptions = {}): RefGraph {
│⋮...
│export function pagerank(g: RefGraph, opts: PageRankOptions = {}): Map<string, number> {
src/repomap/tags.ts:
│export function tagsFromCaptures(relFname: string, captures: RawCapture[]): Tag[] {
```

`file:` headers, the def's real source line (100-char truncation guard against minified files), `⋮...` elisions between non-adjacent lines, bare filenames for files with no tags. READMEs, LICENSEs and manifests (the "important files") always earn a bare line.

## How it ranks (aider's algorithm, ported)

1. **Tags** — tree-sitter extracts def sites (`function foo`, `class Bar`, `interface I`) and ref sites (`foo(...)`, `new Bar`) per file. Queries are ported from aider's `*-tags.scm` and adapted to the current grammar node names (`function_expression`, `internal_module`) and to web-tree-sitter's predicate limits (the `constructor`/`require` guards are enforced in code).
2. **Reference graph** — edges point **referencer → definer**: rank flows toward files that define things others use, the load-bearing files. Edge weights carry aider's multipliers: ×10 for symbols mentioned in your task text, ×10 for "meaningful" names (snake/camel, ≥8 chars), ×0.1 for `_private` noise and symbols defined in >5 files, ×50 when the *referencing* file is already in context, `sqrt(ref count)` damping, and 0.1 self-edges for unreferenced defs.
3. **Personalized PageRank** (d=0.85, deterministic power iteration) — files you mentioned (by path *or* by symbol name) start ahead.
4. **Budget fit** — binary search over tag count, accept within 15% of the budget, seed `budget//25`.

## Where the grammars come from

Four grammars are vendored as wasm in `packages/self-learning/native/grammars/` — **TypeScript, TSX, JavaScript, Python** (MIT; release tags + sha256 in that directory's README; ABI-pinned to web-tree-sitter 0.27.x). No runtime downloads: the map works offline and the supply chain is fixed at commit time. Files in other languages (Go, Rust, Java, C/C++, Ruby, PHP, C#, Swift, Kotlin, Scala, shell, Lua, Elixir) get a conservative **regex def fallback**; files with no rule at all still appear as bare filenames (aider's floor). Add grammars by vendoring the wasm + bumping `REPOMAP_CACHE_VERSION`.

## Subagent injection

Every `task`-tool spawn (fresh *and* summary agents) gets a 512-token map appended to its task, framed **read-only** — "use them to navigate and target your work":

```
<the task>

Repo map (read-only structural summaries …):
src/foo.ts:
│export function computeValue(…
```

The contract:

- **Never blocks the spawn.** The map build races a 2.5s timeout (`UNOWN_REPOMAP_TIMEOUT_MS`); a loss means no map this spawn, never an error. The build keeps running — the *next* spawn hits the cache.
- **Mentions steer it.** File paths and identifiers in the task text boost the corresponding files (aider's mention detection), so `fix the pagerank in graph.ts` puts `graph.ts` in the map.
- **Cheap by construction.** Per-file tags are cached in `.unown/repomap-cache.json` (mtime+size fast path, sha256 rescue on stat mismatch), so steady-state builds stat files and skip re-parsing. In-memory map caching only kicks in for genuinely expensive builds (aider's `refresh=auto` discipline: a cheap build is always rebuilt fresh, so edits are visible).

## Knobs

| env | default | meaning |
|-----|---------|---------|
| `UNOWN_REPOMAP` | enabled | `0`/`false`/`off`/`no` disables everything (kill switch) |
| `UNOWN_REPOMAP_TOKENS` | `1024` | interactive budget (64–32768) |
| `UNOWN_REPOMAP_MAX_FILES` | `5000` | cap on files mapped (bigger repos rank the first N) |
| `UNOWN_REPOMAP_TIMEOUT_MS` | `2500` | spawn-lane build timeout; `0` opts out of waiting |

`node_modules/`, `vendor/`, `dist/`, lock files and binaries are skipped outright.

## Composing

- **LSP stays the deep lane** — `/lsp` + per-file symbol queries when precision matters; the map is the always-available zero-dependency overview (works with no language servers at all).
- **Context briefs compose** — a `context: "summary"` agent gets *brief + task + map* (session distilled, then repo oriented).
- **Worktrees compose** — an isolated subagent's map is built for its worktree cwd, so it sees its own tree.

## Sources

- aider — [repo map docs](https://aider.chat/docs/repomap.html), [the 2023 blog post](https://aider.chat/2023/10/22/repomap.html), `aider/repomap.py` + `aider/queries/tree-sitter-languages/*-tags.scm` (the algorithm, multipliers, budget fit, cache layers).
- [web-tree-sitter](https://www.npmjs.com/package/web-tree-sitter) 0.27.x on Bun (verified end-to-end; sst/opencode ships the same stack) + tree-sitter org grammar release assets (vendored, ABI-pinned).
- Prior art cross-checked: Continue.dev (`web-tree-sitter` + wasm grammars for indexing), Zed (per-language outlines).
