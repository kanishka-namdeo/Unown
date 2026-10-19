# SDLC feature parity: what we reverse-engineered and what we adopted

> Purpose: decision record for the 2026-10-18 feature-parity effort — which
> capabilities oh-my-pi, zcode, muse code, codewhale and the other 2026 coding
> agents ship, which of those Unown adopts, in what form, and why the rest stay
> out. Research method: four parallel audit threads (source, docs, npm/GitHub
> forensics) with every claim URL-cited in the research notes
> (`/home/z/my-project/research/2-{a,b,c,d}-*.md`); porting decisions below cite
> the seam each feature lands on.

Related pages: [usage](usage.md) · [BEHAVIOR](BEHAVIOR.md) · [configuration](configuration.md) · [oh-my-pi-swap-assessment](oh-my-pi-swap-assessment.md) · [opencode-swap-assessment](opencode-swap-assessment.md)

- [The candidates](#the-candidates)
- [The gap analysis](#the-gap-analysis)
- [Adopted — shipped in this effort](#adopted--shipped-in-this-effort)
- [Adopted — already present](#adopted--already-present)
- [Deliberately not adopted](#deliberately-not-adopted)
- [The standing invariant](#the-standing-invariant)

## The candidates

| Agent | Vendor | Shape | What it is known for |
|---|---|---|---|
| [oh-my-pi](https://github.com/can1357/oh-my-pi) | Stencil Labs (can1357) | pi fork, ~80k LoC Rust native core | IDE-grade tooling wired into a terminal agent: LSP (14 ops + writethrough format-on-save), DAP debugger (28 ops), tree-sitter ast-grep/ast-edit, hashline edit format, advisor/watchdog second-model review, TTSR stream rules, compaction upgrades (shake/snapcompact), task structured outputs, `/review`, magic keywords, `omp commit` |
| [zcode](https://zcode.z.ai) | Z.ai | desktop ADE + CLI (open-sourced Apache-2.0) | Goal Mode with evidence-verified completion, Repo Wiki (every claim links file:line), Automations (cron), idle-time free tasks, plugin bundles, browser panel, bot channels, remote control |
| muse code | Meta (MSL) | native terminal CLI + SDK | event-sourced append-only sessions, `/rewind`, worktree fan-out subagents, observer agents + reconciler, workflows control room, 18-event hooks, session messaging, staged shell review, co-trained harness |
| [codewhale](https://github.com/codewhale-hq/Codewhale) | codewhale-hq | Rust terminal agent + local Engine | receipts audit ledger (`/undo` `/restore` `/receipts`), fleet ledger, typed workflows, MCP client+server, skills manager with trust, Claude-plugin compat, GitHub PR review Action |
| Claude Code / Codex / Gemini / OpenCode / Amp / Cursor / Windsurf / Devin | — | — | checkpoints/rewind, hooks, subagents/teams, skills, MCP channels, sandboxing, cloud handoff, DeepWiki, auto-memory mining |

## The gap analysis

Unown entered this effort with: tiered memory + AutoDream, self-improving
harness, hooks/guardrails, subagents (`task`), Agent Skills, plan mode, `todo`,
`note`, `fetch_url`, OS-sandboxed engine runs, llm-bridge model routing, the
mission-control dashboard. Compared against the field, the load-bearing gaps
were:

1. **No code intelligence** — no LSP diagnostics/hover/definition/references;
   the only feedback loop on edits was the Bun transpiler syntax gate.
2. **No checkpoints/rewind** — no way to undo an agent turn's file damage, no
   audit ledger of what the session did.
3. **No MCP** — locked out of the entire Model Context Protocol tool
   ecosystem (README said so outright).
4. **No review workflow** — no `/review` with parallel reviewer subagents.
5. **No goal mode** — no evidence-verified objective loop.
6. **No scheduled/automated runs** — the engine learns on intervals but never
   acts on the repo on a schedule.

## Adopted — shipped in this effort

Each entry: feature → source → the seam it landed on in this repo.

### Round 5 (2026-10-19 — checkpoint redo)

| Feature | Source | Unown form |
|---|---|---|
| Checkpoint redo `/redo [n\|--all]` | opencode undo/redo · Cursor checkpoint rewind-forward | **Adopted** — the inverse of the existing `/undo`, on the same `unown-checkpoints` extension and the same content-addressed blob store: `/undo` captures, per undone turn and before restoring its before-images, the content it is about to overwrite into `redo-*.json` entries (one per turn, pushed in walk order; content-addressed blobs make the capture a dedup no-op when nothing changed); `/redo [n]` pops entries newest-first and re-applies them through the exact same hash-verified, project-jailed restore path, so `/undo n` + `/redo n` is a byte-exact round trip (tombstones included — a file the undo deleted is re-created, a file that did not exist at capture is deleted again). Classic redo semantics: any newly sealed checkpoint (turn or named, any session sharing the store) clears the stack, journaled as a receipts note; `/redo --all` mirrors `/undo --all`'s cross-session opt-in; the stack is capped at 20 entries per session / 60 across sessions, and blob GC counts redo-referenced blobs as live. `/checkpoints` shows this session's redo depth; the receipts ledger gains a `redo` entry kind. Redo is not itself undoable (documented in usage). Pinned by `pi-repo/packages/self-learning/test/redo.test.ts` (15: store persistence/retention/GC-integration, round-trips incl. binary + tombstone cases, multi-level `/undo 2`+`/redo 2`, invalidation on new turn/named checkpoints, empty-stack errors, corrupt-blob refusal, ownership `--all`, `/checkpoints` depth) |

### Round 5 (2026-10-19 — live tool-result injection shield)

| Feature | Source | Unown form |
|---|---|---|
| Prompt-injection detection over live tool results (bash stdout, webfetch pages, web_search results, MCP tool output) — **deterministic variant, adopted** | goose prompt-injection detection | `pi-repo/packages/self-learning/src/guard.ts` `scanToolOutput()` + `src/shield.ts` (the fail-open wiring: env knob `UNOWN_INJECTION_SHIELD`, default ON; banner annotation; in-session telemetry; the `pi.appendEntry` warning seam). Four live choke points wired: termhooks PostToolUse for `bash`/`powershell` stdout, `webfetch`/`web_search` `execute()` in websearch.ts, and the single MCP `execute()` wrapper in mcp.ts every `mcp__*` result flows through. **Deliberately NOT ported**: goose's second adversary/reviewer model — rejected above as cost-doubling on every turn; this scanner adds zero inference, reusing the memory guard's conjunction discipline with a tool-output-appropriate rule set (`instruction-override`, `role-tag-forgery`, `role-hijack`, `operator-forgery` incl. "AGENTS.md says", `exfiltration-prompt`, `memory-injection`, `secrecy-instruction`, `hidden-chars` with de-invisibled re-scan, `encoded-payload`). False-positive calculus inverts vs. the memory guard — tool output legitimately contains instructions, so only injection-into-agent shapes trip — and the action is **annotate, never amputate**: content passes through unmodified below a `[unown-injection-shield]` banner that reframes it as data. Fail-open by contract (scanner crashes never break a tool call). Pinned by `pi-repo/packages/self-learning/test/shield.test.ts` (45 tests incl. execute-path integration against a mock provider server) |

### Round 5 (2026-10-19 — git-native commit workflow)

| Feature | Source | Unown form |
|---|---|---|
| Git-native `/commit` + opt-in auto-commit | aider auto-commit · Codex CLI git workflow | **Adopted** — `pi-repo/packages/self-learning/src/gittools.ts`, registered through the unown-tools extension (the websearch.ts modularization pattern: one call in tools.ts, all logic in the module). `/commit [message]`: `git add -A .` jailed to the session project dir + `git commit -m` — never pushes. User message verbatim (multi-line); without one a deterministic conventional message is generated locally (no model round-trip): `unown(session): <sanitized latest assistant summary>` with a dated `work snapshot <ISO date>` fallback, plus a plain-ASCII `Generated-by: unown` trailer, subject capped at 72 chars. Typed clean no-ops for not-a-repo / git-missing / nothing-to-commit (friendly messages, never git's raw stderr); `-c user.name=unown -c user.email=unown@local` fallbacks only when identity is missing, so fresh clones still commit while configured identity always wins; the user's pre-commit hooks run on commits (husky/lint-staged gate agent commits like any other) while read-only probes run hooks-disabled + `--no-optional-locks` with a scrubbed GIT_* env (the worktree.ts hardening posture); explicit no-op under `UNOWN_SUBAGENT=1` / `UNOWN_AUTOMATION=1`. `UNOWN_AUTO_COMMIT=1` (**default OFF**) snapshots pending project-dir work on teardowns that actually end the session (quit / new / resume / fork — not `reload`, which keeps the same session) as `unown(auto): session end snapshot <date>`. This round also fixed the stale root-doc claims (AGENTS.md, CONTRIBUTING.md) that "the engine auto-commits learning artifacts" — no such code existed; the docs now describe the real off-by-default terminal-session feature. Pinned by `pi-repo/packages/self-learning/test/gittools.test.ts` (32: real temp git repos — repo detection, porcelain v1 parse, the commit flow incl. deletions + verbatim multi-line messages, the no-identity fallback with isolated GIT_CONFIG_GLOBAL/SYSTEM/HOME, git-unreachable, the gating matrix, and /commit + shutdown wiring through the extension fake); verified end-to-end in a live `unown -p` session (the agent writes a file, session shutdown lands the `unown(auto)` snapshot commit). Still deferred from the omp idea: structured-output commit messages authored from the diff by a subagent (a model round-trip skipped for day-1 determinism) |
| `omp commit` (structured-output commit messages) | oh-my-pi | Still deferred — the git-native half shipped above; the remaining idea is model-authored messages from the diff via structured outputs |

### Round 5 (2026-10-19 — granular permissions)

| Feature | Source | Unown form |
|---|---|---|
| Declarative allow/deny/ask permissions | Claude Code settings permissions · Cline auto-approve settings | **Adopted** — `pi-repo/packages/self-learning/src/permissions.ts` (1,036 lines): a user-configurable permission layer ON TOP of the hard-coded guardrails — it can only ever ADD restrictions (the deny-list + path jail run first and their verdicts are final; no rule, not even `bash allow *`, unlocks `rm -rf /`). Config: `<project>/.unown/permissions.json` (trust-gated like mcp.json/lsp.json — a cloned repo is attacker-controlled) + `~/.unown/agent/permissions.json`; user rules win per tool+pattern, most-specific match wins, deny beats everything at equal specificity. Effects `allow`/`deny`/`ask`; modes `default`/`acceptEdits`/`bypassPermissions` (bypass only silences asks; refuses to load under `UNOWN_STRICT_HOOKS=1`). Patterns per tool family: first-token-aware bash command globs, project-relative path globs (`*` within a segment, `**` across), URL globs, `server/tool` for MCP. `ask` uses a real select dialog when a UI exists (TUI/RPC) and degrades FAIL-CLOSED headless (a documented product decision — headless agents never auto-approve past an ask). Opt-in learning (`UNOWN_PERMISSIONS_LEARN=1`) persists confirmed bash commands as user-scope allow rules. `/permissions` command (mode, trust state, rule table with source file); `unown doctor` permissions section; `UNOWN_PERMISSIONS=0` kills the layer. Pinned by `test/permissions.test.ts` (61 tests: merge precedence, matcher semantics, validation, trust gate, deny-blocks-what-the-hard-list-allows / allow-never-weakens-the-hard-list, ask degrade, learn persistence, /permissions rendering). Reference: `docs/permissions.md` |
| Usage & cost tracking | OpenCode usage stats · Cursor usage dashboard | **Adopted** — persistent usage accounting for the bundled bridge: every proxied completion appends `{ts, model, promptTokens, completionTokens, cachedTokens, durationMs, status}` to `.run/usage-log.jsonl` (10 MB rotation, one generation kept; **prompts are never logged** — counters only). `GET /v1/usage?days=&model=` aggregates (totals + byModel + byDay + skippedLines, crash-tolerant line parsing); `/health` reports the log path + entry count. `unown usage` (new CLI, `--days/--model/--json`) renders the per-model table with estimated cost and avg latency — reads the API when the stack is up, falls back to a direct backward tail-read of the JSONL (capped 50k lines) when it is down. Pricing: shipped constants for kimi-k2.5 / qwen3.7-plus / qwen3.6-plus are honest `~$` estimates; `UNOWN_PRICE_<MODEL>_IN/_OUT` (USD per 1M tokens) pins real prices; unknown models report `costUsd: null`, never 0. The pure core mirrors between `mini-services/llm-bridge/usage.ts` and `usage-cli.ts`, kept honest by a shared golden fixture pinned from both sides. Pinned by `mini-services/llm-bridge/usage.test.ts` + `test/usage-cli.test.ts` (52 combined: append/rotate, aggregation math, malformed-line tolerance, pricing incl. env override + unknown-model null, table rendering, filters, JSON shape). Reference: `docs/usage-tracking.md` |

### Round 4 (2026-10-19 — native web tools: web_search + webfetch)

The field has converged on two native tools every agent ships: **web search**
(OpenCode `websearch`, Claude Code `WebSearch` with `allowed_domains`/
`blocked_domains`, Gemini CLI google_web_search, Codex server-side web_search)
and **web fetch** (OpenCode `webfetch` with HTML→markdown, Claude Code
`WebFetch` with model summarization). Unown had only `fetch_url` — a plain
GET-and-strip with no search and a documented-open SSRF gap. The
implementation is reverse-engineered from the competitors' sources (OpenCode's
`packages/core/src/tool/plugin/websearch.ts` + provider plugins, Claude
Code's tool docs, the Roo/OpenClaw provider stacks) and lands in
`pi-repo/packages/self-learning/src/websearch.ts`:

- **`web_search`** — 19-provider registry with a keyless-first chain that
  works with zero signup (searxng-self-host → duckduckgo → tavily keyless →
  youcom free-MCP → stackexchange → wikipedia → hn → npm → github) and eleven keyed
  providers that auto-join when their env key appears (tavily, serper, exa,
  brave, perplexity, dashscope enable_search, jina, zhipu, firecrawl, kagi,
  serpapi — quality-then-cost priority; dashscope takes standard keys only —
  coding-plan `sk-sp-…` keys are refused up front with an actionable note,
  because the coding endpoints silently ignore `enable_search` and the
  standard endpoints reject them, verified live 2026-10-19).
  Claude-Code-parity domain filters,
  per-provider failure notes surfaced to the model, `UNOWN_WEB_SEARCH_PROVIDER`
  override. Live-verified receipts: `benchmarks/websearch-live/` (7 free
  providers answering real queries from a hostile datacenter IP; a real
  end-to-end agent session — model calls `web_search`, the chain cascades
  dashscope-429 → ddg-challenge → tavily-keyless, returns 8 results, the
  model answers with a source URL).
- **`webfetch`** — the hardened fetch pipeline `fetch_url` now shares:
  `assertFetchableUrl` SSRF guard (private/reserved IPv4+IPv6 refused literal
  AND post-DNS — closes testing-strategy §7.3), robots.txt honoring with a
  15-min cache, 4 MB caps, and an extraction fallback chain for bot-walled
  sites (direct → Tavily extract keyless → Jina reader → Firecrawl) —
  Claude/OpenCode ship the fallback idea too; ours is keyless-first.
- Seams: registered through the unown-tools extension (TUI/print/subagents/
  plan mode all inherit), sandbox runs gated on `UNOWN_SANDBOX_NET=1`, kill
  switches per tool, all env read call-time per the package convention.

### Round 3 (2026-10-19 — dashboard engine-parity + observability + automations surface)

The dashboard's own contract outran its code: two fully-typed data sources
(`GET /api/sandboxes`, `GET /api/bridge`) had client functions and query keys
but no component, and five documented action endpoints (`POST /api/tasks/mint`,
`GET /api/tasks/:id`, `GET /api/skills/:id`, `POST /api/notes`,
`POST /api/notes/sync`) had no UI. The gap analysis came from the same
field-survey method applied to observability products (LangSmith, Langfuse,
Vercel AI Gateway, Braintrust: trace-linking, gateway/cost panels, live-tail
consoles, command palettes, URL-synced views). Ports, each mapped to its
source:

| Feature | Source | Unown form |
|---|---|---|
| Gateway/usage panel | Vercel AI Gateway's Usage + Logs views | `gateway-tab.tsx` — the bridge request log as a first-class ops surface (KPI row, per-model breakdown, latency chart, request table) |
| Sandboxes / workspace inspection | trace-artifact drill-down (LangSmith span detail) | `sandboxes-tab.tsx` — the engine's sandbox inventory, previously fetched but never rendered |
| Task minting controls | experiment/dataset management (Braintrust eval-driven loop) | Overview "Mint task" + per-outcome toasts — curriculum growth is operable, not dark |
| Task detail view | prompt/trace inspection | `task-detail.tsx` — prompt, seeded files, verify script, provenance, run-cycle action |
| Live-tail console | "follow requests live" (Vercel Logs) | Console transcript now renders `run:tool`/`run:text` SSE frames ahead of the poll |
| ⌘K command palette | table stakes across the field (Vercel, Linear, every IDE-grade tool) | `command-palette.tsx` (cmdk) — tab navigation, refresh, links |
| URL-synced views / deep links | every observability UI deep-links a filtered list | `tab-store.ts` — `?tab=` synced tab strip with working back/forward |
| Skill version history + arbitrary restore | versioned prompt management (Langfuse/LangSmith) | Memory tab History toggle + restore-to-any-version |
| Notes pipeline controls | manual-feedback ingestion surfaces | Dreams tab note delivery + outbox sync |
| Evidence cross-linking | trace ↔ experiment linkage | Improvement cards link baseline/candidate runs; `memory_version` badged |
| Trust surfaces | NN/g error/empty/loading distinction | engine-down alert banner, KPI skeletons, error/notes/regression KPI fields |
| SSE contract completion | — (Unown's own documented contract) | every engine event family now invalidates + renders friendly feed text |

The round also closed the automations loop the parallel session opened: the
engine's zcode-port scheduled actor shipped REST + types with no client or UI,
so the tenth tab (`automations-tab.tsx`) renders the full lifecycle — create
(cron/one-shot, read-only/standard), pause/resume/delete confirms, Run now,
per-automation run history — with all eleven automation SSE event families
mapped in the bridge. Verified end-to-end: a "nightly repo health check"
automation created from the dialog and dispatched via Run now executed a real
headless session (11 turns, 60.1k tokens in) whose report rendered in the run
history.

Verification receipts: unit suite 294/0 across 26 files (51 new tests), e2e
specs extended to all ten tabs (mock engine serves the automations family),
live browser pass against a running engine (10 tabs, real DashScope traffic
in the Gateway view, a real automation run, palette navigation, deep links,
zero console errors).

### Round 2 (2026-10-19 — subagent upgrades)

Four parallel reverse-engineering threads re-audited the field (oh-my-pi at
commit 1a97f79, zcode OSS v3.15.1 + live docs, muse code 1.4.10 + SDK/cookbooks,
codewhale v0.10.2). Two highest value-per-complexity ports landed first:

| Feature | Source | Unown form |
|---|---|---|
| Task structured outputs (`output_schema` + `schema_mode` per task or per batch item; path-annotated validation errors; corrective retries quoting exact defects; permissive/strict verdicts; malformed schemas fail pre-spawn) | oh-my-pi `task` `outputSchema`/`schemaMode` | `src/jsonschema.ts` (dependency-free JSON Schema subset validator: types, properties/required/additionalProperties, items/prefixItems, enum/const, constraints, combinators, local $ref; depth-capped, SchemaError on malformed schemas) + `runSubagent` retry loop in `tools.ts`; validated JSON returned to the parent as the report body |
| Worktree fan-out isolation (`worktree_isolation` per task or batch item: git worktree at HEAD per child; fail-closed typed rejections; remove_if_clean cleanup; kept trees reported for merge; append-only lifecycle journal; hooks-disabled probes; crash quarantine) | muse code worktree fan-out (`.muse/worktrees`, `cleanup_policy: remove_if_clean`, ADR 33406 hook hardening) | `src/worktree.ts` (git via spawn shell:false, hooks disabled through a private empty `core.hooksPath`, `--no-optional-locks`, GIT_* env stripped; journal at `.unown/worktrees/registry.jsonl`; self-healed `.unown/.gitignore` adds `worktrees/`); task tool runs the child with cwd = tree and surfaces the disposition (`removed`/`kept`/`quarantined`) |

Both are cross-platform native (git + Bun, no OS-specific code paths; hooks
are disabled via an empty directory rather than the POSIX-only `/dev/null`
trick). Pinned by `test/jsonschema.test.ts` (37), `test/worktree.test.ts`
(9, real git: clean/dirty/commit/hooked/quarantine lifecycle) and
`test/cli/task-structured.test.ts` (5, spawn-level golden runs against the
real CLI: valid/invalid/strict schema flows + a KEPT worktree end-to-end +
the not-a-repo typed rejection). Suite: 1203 pass / 0 fail.

Deferred from this round (candidates, with the blocking reason): oh-my-pi
DAP debug tool (medium, pure-TS feasible), `omp commit` (low-medium, consumes
structured outputs), codewhale MCP-server surface + fleet ledger, muse staged
shell review, zcode Repo Wiki (now unblocked by automations — scheduled
generation exists; the remaining work is the wiki surface itself).

### Round 3 (2026-10-19 — the scheduled actor)

| Feature | Source | Unown form |
|---|---|---|
| Automations — scheduled recurring agent runs (5-field local-time cron or one-shot delay; `unown automations` CLI + REST + session tools; misfire skip; dispatch retry 30 s × 2ⁿ⁻¹ capped 15 min × 5 attempts, frozen run id; max 20 automations / 2 concurrent / 30-min run timeout; pause/resume; manual run-now that never consumes maxRuns) | zcode Automations | `pi-repo/packages/self-learning/src/automations.ts` + the dependency-free cron engine `src/cron.ts` (zcode uses croner; we own the parser — Vixie DOM/DOW OR rule pinned) + `src/automations-cli.ts` + engine REST `/api/automations*` + the `automationsScheduler` poll loop. **The trust story that gated it for two rounds, shipped as the design itself**: config lives in the engine DB, never in the repo (no cloned-repo-RCE vector); default mode `read-only` (a `--tools` allowlist with no bash/write/edit/task — the allowlist IS the read-only story, pinned by test); `standard` must be explicit; runs carry `UNOWN_AUTOMATION=1` which hides the mutation tools inside the run (subagents inherit the flag — no recursion); nothing auto-merges — every run recorded with output/exit/turns/tokens. Pinned by `test/cron.test.ts` (14) + `test/automations.test.ts` (29: scheduler single-flight/concurrency/misfire/retry-exhaustion/maxRuns/one-shot/runNow-409 + CRUD + the trust gate). Verified live: a one-shot created via the real CLI dispatched within one poll tick and its run answered through the Dashscope bridge (recorded `succeeded, exit 0, 1 turn`) |
| Repo Wiki | zcode | Still deferred — see above (the scheduling substrate now exists; the wiki surface is its own project) |

### Round 1 (2026-10-18 — the shipped v2.1.0 slice)

| Feature | Source | Unown form |
|---|---|---|
| LSP code intelligence (`lsp` tool: status/diagnostics/hover/definition/references/symbols; auto-detected servers; `.unown/lsp.json` config; PostToolUse diagnostics feedback on every write/edit) | oh-my-pi `lsp` + writethrough | `pi-repo/packages/self-learning/src/lsp.ts`, registered by the unown-tools extension — pure-TS stdio JSON-RPC client, zero deps, cold start never blocks a tool result, degrades silently when no server exists |
| Checkpoints + `/undo` + `/restore` | Claude Code checkpointing · Gemini shadow-git · codewhale receipts | content-addressed blob snapshots per user turn + explicit `/checkpoint`, in a dedicated `unown-checkpoints` extension (first in `extensionFactories`, ahead of the guardrails); session entries record checkpoint ids so `/undo` rewinds files (conversation rewind stays pi's own `/tree`/fork story) |
| Session receipts ledger + `/receipts` | codewhale RECEIPTS | every tool call/result appended to `.unown/receipts/<session>.jsonl` (files touched, commands run, failures, token usage — blocked calls land as error results); `/receipts` prints the ordered audit with totals |
| MCP client (stdio + streamable HTTP, `.unown/mcp.json` + `~/.unown/agent/mcp.json` discovery, dynamic tool registration, `/mcp` status command) | Claude Code / codewhale / zcode MCP | `pi-repo/packages/self-learning/src/mcp.ts` — tools surfaced through `pi.registerTool` with `mcp__<server>__<tool>` naming; servers never block session start (lazy connect) |
| `/review` — parallel reviewer subagents, P0–P3 + confidence + verdict | oh-my-pi `/review` · Codex `/review` presets | orchestration over the existing `task` tool: frozen diff snapshot (uncommitted or base-branch merge-base), 1 reviewer for small diffs (< 6 k chars) and 3 with split focuses for larger ones, findings merged + deduped, one verdict |
| `/goal` — durable objective with evidence-verified completion | zcode Goal Mode · muse goals | goal state persisted in session entries; completion requires a verification pass with real evidence (changed files, command output, test results); unfinished todos block completion |

Behavior changes land under the repo's standing policy: CHANGELOG **Agent
Behavior** entries + tests pinning each feature + receipts where measured.

### Hardening follow-ups (2026-10)

The table above is the shipped v2.1.0 slice; three hardening and
productization passes (H1/H2/P1) landed after it — details and test counts
in the [CHANGELOG](../CHANGELOG.md) under Unreleased:

- **Trust gate** — project-scoped `.unown/mcp.json` / `.unown/lsp.json`
  configure command execution, so they are gated refuse-first (a cloned
  repo's config is attacker-controlled); `/mcp trust` and `/lsp trust`
  approve by sha256 fingerprint, and any later edit re-arms the gate.
- **Integrity** — checkpoint blob/manifest writes are atomic and every
  restore hash-verifies (`corrupt-blob` never silently writes wrong
  content); receipts are secret-redacted at the write chokepoint.
- **Crash recovery** — LSP servers auto-restart within cooldown/restart
  caps and the diagnostics loop survives a server crash; MCP servers cool
  down, self-heal (404 re-init + replay, 429/503 backoff), and a child
  reaper kills orphaned servers on Ctrl-C.
- **Productization** — `unown mcp` subcommands manage configs from the
  shell; `unown doctor` covers the session surfaces (`lsp-servers`,
  `mcp-config`, `unown-state`); footer status lines surface integration
  health live in the TUI.

## Adopted — already present

- Subagents with fresh context, parallel batch (`task`) — omp/muse/zcode have
  equivalents; ours predate this effort.
- Agent Skills with progressive disclosure — same standard zcode/muse/codewhale
  adopted; AutoDream mints them.
- Plan mode — omp/muse/zcode/codewhale all have one; ours ships `/plan`.
- Hooks — Claude-style events; ours enforce guardrails at both layers.
- Memory — the 4-tier stack + AutoDream is our own take on zcode's project
  memory / Gemini auto-memory / Devin dreaming; keep ours.

## Deliberately not adopted

| Feature | Source | Why not |
|---|---|---|
| Hashline edit format | oh-my-pi | The grammar's core parser is Rust (`crates/pi-edit`); a TS re-derivation is a project of its own. Our `edit` tool's str_replace contract is stable and model-agnostic; revisit only with measured string-not-found failure rates from our own transcripts |
| DAP debugger tool | oh-my-pi | Pure TS and portable, but a 28-action surface is a maintenance commitment; no user demand yet. First candidate if this list is revisited |
| ast-grep / ast_edit | oh-my-pi | Native (tree-sitter); substitutes (ast-grep CLI) add a runtime dependency the engine sandbox cannot assume |
| TTSR stream rules | oh-my-pi | Requires a mid-stream abort+retry seam in pi-ai's provider loop — a fork-level change to the vendored substrate, against the swap-assessment invariant |
| Advisor/watchdog second model | oh-my-pi | Cost-doubling on every turn; our hooks + harness already play the reviewer role in the learning loop. Revisit as an opt-in profile |
| Event-sourced session replay | muse | pi's session tree + our receipts cover the audit use; full event sourcing is a substrate rewrite |
| ~~Worktree fan-out subagents~~ | muse | **Adopted in Round 2** (see above) — task tool `worktree_isolation` |
| ~~Scheduled automations~~ (`/loop`-style cron) | zcode Automations · muse `/loop` · Claude routines | **Adopted in Round 3** (see above) — the trust story shipped as the design: engine-DB config, read-only default, no recursion, nothing auto-merges |
| Repo Wiki | zcode | Still deferred; the automations substrate (Round 3) unblocked the scheduling half — the wiki surface itself remains its own project |
| Plugin bundles + marketplace | zcode/codewhale/Claude | Our extension surface is inline + file-based (`.unown/`); a marketplace is ecosystem work, not a feature gap |
| Computer-use / browser automation | omp/zcode | Out of scope for a terminal-first agent this cycle; the dashboard already renders its own surfaces |
| Collab relay / bot channels / remote control | omp/zcode | Hosted-infrastructure features; the dashboard is our observability plane |

## The standing invariant

The oh-my-pi swap assessment's verdict governs here too: **the vendored pi
substrate stays; features land on pi's documented seams** (extension factories,
`pi.registerTool`, `pi.registerCommand`, session entries) or in Unown's own
packages — never as forks of the vendored core. Every port above was
re-derived against pi's current seams, not copied from a fork that assumes a
different runtime.
