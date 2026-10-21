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

### Round 7 (2026-10-19 — ACP editor integration)

| Feature | Source | Unown form |
|---|---|---|
| ACP editor protocol | goose ACP adapter · Zed Agent Client Protocol | **Adopted** — `unown acp` (`src/acp.ts`, ~1,200 lines): a stdio JSON-RPC 2.0 server (newline-delimited, v1) turning unown into an ACP agent any ACP-capable editor can drive. Every session boots through cli.ts's `bootRuntime` — the SAME factory as the terminal (memory injection, guardrail hooks, granular permissions, session tools, LSP, MCP), not a stripped headless variant. Server methods: `initialize` (capability negotiation), `session/new` + the pre-v1 `newSession` alias, `session/prompt` (text/resource/resource_link/image blocks → pi input; ACP v1 StopReasons), `session/cancel`, `session/load` (resume a persisted session file, replay the conversation as updates), `session/set_mode` (accepted, none advertised). Agent→editor: streamed `session/update` (user/agent/thought chunks, `tool_call` with kind/title/locations, lifecycle updates with result content — event folding with stream-dedupe and announce-dedupe), `session/request_permission` (the permissions `ask` flow as editor options; cancel/timeout/garbage DENIES — the fail-closed unattended policy), mediated `fs/read_text_file` for absolute paths outside the project jail when the client advertises it. `fs/write_text_file` deliberately NOT advertised — an editor callback must not override the write-path jail (the "restrictions only" reasoning shared with the permissions layer). Stdio discipline mirrors pi's rpc-mode: stdout takeover (console.log degrades to stderr), ordered async write tail, LF-only line reader, stdin EOF exits 0, signal child cleanup, -32601/-32002 JSON-RPC errors, garbage-line tolerance. Pinned by `test/acp.test.ts` (26: every pure translation unit-tested + a hermetic integration test — the real `bin/unown acp` against the mock bridge, full handshake/streaming/-32601/garbage/EOF) and live-verified against a real Dashscope session. Reference: `docs/acp.md` |

### Round 6 (2026-10-19 — custom slash commands + headless JSON contract)

| Feature | Source | Unown form |
|---|---|---|
| Custom slash commands (`.claude/commands` / `.opencode/command`) | Claude Code custom slash commands · OpenCode commands | **Adopted** — `.unown/commands/*.md` (project, committed with the repo) + `~/.unown/agent/commands/*.md` (global), discovered on every boot and `/reload` through pi's prompt-template seam (`additionalPromptTemplatePaths` on the resource loader — the same mechanism as `.pi/prompts`, so TUI autocomplete with description + argument-hint comes for free). Authoring format is Claude Code's: YAML frontmatter (`description`, `argument-hint`) + body with `$ARGUMENTS`/`$@`/`$1..$N` substitution, plus the full bash-flavored extras pi already had (`${N:-default}`, `${@:N}` slicing). Expansion happens in `session.prompt()` — TUI, print mode, and subagents all expand identically (`unown -p "/cmd args"` works headlessly). Not trust-gated, deliberately: a command only runs when the user types its name — a cloned repo can ship autocomplete entries but cannot make the agent execute one (the Claude Code `.claude/commands` contract); runtime fetches the command triggers still pass the injection shield. Includes a pi-core hardening this round exposed: malformed frontmatter YAML (the canonical trap: unquoted `argument-hint: [name] [greeting]` — two flow sequences) used to make `loadTemplateFromFile` silently drop the whole file; it now degrades to no-frontmatter (body loads, metadata lost) and array-valued scalars (`argument-hint: [flags]`) normalize to strings. Pinned by the custom-commands golden test (real CLI against the mock bridge, asserting the *expanded* text reaches the model with unquoted-hint fixtures as the degradation regression) + pi's own vitest suite (94 pass). Reference: `docs/custom-commands.md` |
| Headless result contract `--output-format json` | Claude Code `claude -p --output-format json` | **Adopted** — `unown -p --output-format json` prints **one** final JSON object: `{type, subtype, result, session_id, model, usage{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}, cost_usd, duration_ms, num_turns, unown_version}` — stable key order pinned by test, the CI/wrapper contract Claude Code established. Exit codes unchanged (0/1), so `set -o pipefail` + `jq -r .result` composes exactly like text mode; `subtype` says success vs error_during_execution. `--no-session` reports `session_id: null` (nothing to resume); misuse shapes exit 2 with clear errors (`--mode json` combination, TUI without `-p`, unknown value). Implementation on documented seams only (`src/output-format.ts`): a hidden inline extension folds session id / model / usage / turns from the standard `session_start`/`model_select`/`message_end` events; the text channel is captured by wrapping `process.stdout.write` for the duration of `runPrintMode` (mode stays `text`, so pi's own final-assistant-text extraction and error handling are reused verbatim), then exactly one JSON line is emitted. Pinned by `test/output-format.test.ts` (10: usage folding incl. malformed inputs, stable shape + key order, honest nulls, fake-pi event capture incl. the getSessionId accessor, stdout wrapper identity/callback semantics) + 4 golden tests (one-line stdout, full field contract vs the mock bridge, `--no-session` null, both exit-2 misuse shapes). Reference: `docs/usage.md` §Three ways to run |

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

### Round 5 (2026-10-19 — Milestone 1-4: hooks + subagents + slash commands + recipes + repo wiki)

The 2026-10-19 feature-parity sweep's main line: fifteen ports across four
milestones, each landing on pi's documented seams and pinned by a hermetic
test file. The earlier rounds above already cover the parallel-session
side-ports (granular permissions, usage tracking, `/redo`, `/commit`, the
deterministic injection shield over live tool results); this round consolidates
the *Milestone 1-4* track from `docs/sdlc-feature-roadmap.md` — multi-type
hooks, the security reviewers built on top of them, per-subagent routing,
slash-command UX, and the two big structural features (Recipes + Repo Wiki).
Ports, each mapped to its source:

| Feature | Source | Unown form |
|---|---|---|
| Multi-type hook handlers + semantic output + 7 new event surfaces | codex `protocol.rs:1693-1812`, claude code hooks docs, cursor hook contract | `pi-repo/packages/self-learning/src/hooks-config.ts` — five handler types (command/http/mcp/prompt/agent) + semantic output entries (`feedback`/`warning`/`error`/`stop`/`context`) + seven new event surfaces (`PreModelRequest`, `PostModelRequest`, `PreCompact`, `PostCompact`, `SubagentStart`, `TaskCompleted`, `PermissionRequest`) wired to pi's extension events. Project config `.unown/hooks.json` is trust-gated like `.unown/mcp.json` (a cloned repo's hooks are attacker-controlled); user config `~/.unown/agent/hooks.json` always trusted; project wins per-event. Template interpolation `{{tool}}` / `{{input.path}}` / `{{prompt}}` / `{{context.*}}`. Compose: `deny`/`stop` terminal (first wins); `mutate` stacks; `warn` continues; `async` fire-and-forget. When no `.unown/hooks.json` exists, the multi-type code path is skipped entirely (zero impact on existing runs). Pinned by `test/hooks-config.test.ts` (58). |
| Adversary Mode (file-gated PreToolUse LLM reviewer) | goose `adversary_inspector.rs` | `pi-repo/packages/self-learning/src/adversary.ts` — when `~/.config/unown/adversary.md` exists, every `bash`/`powershell`/`write`/`edit` call goes through an LLM review pass after the built-in policies but before user-configured hooks. The gate file is the user's own markdown (first H1 = system instruction; `## Disallow` / `## Allow` / `## Notes` as policy hints). Secret-redaction (6 patterns: `sk-…`, `ghp_…`, `github_pat_…`, `AKIA…`, `Bearer …`, PEM blocks) before the LLM call; input truncation (2 KB/field, 8 KB total); timeout with `failClosed` toggle. Reply parsing: first non-empty line containing `BLOCK`/`ALLOW`; ambiguous → allow. Per-action review (~5-10% extra tokens), NOT per-turn — the simpler, opt-in revisit of the deferred oh-my-pi advisor/watchdog entry. Pinned by `test/adversary.test.ts` (46). |
| Prompt-injection scanner (106 patterns, 8 categories, scan-mode aware) | goose `patterns.rs` + `scanner.rs` + `classification_client.rs` | `pi-repo/packages/self-learning/src/injection-scanner.ts` — 106 regex patterns across 8 categories (`instruction-injection` 16, `data-exfiltration` 13, `path-traversal` 16, `credential-harvesting` 13, `code-execution` 16, `sandbox-escape` 14, `obfuscation` 12, `tool-impersonation` 6). Risk levels `low`/`medium`/`high`/`critical`; `blockOn` defaults to `["critical","high","medium"]`; `low` never blocks. **Scan-mode aware**: `write`/`edit` content is scanned only against prompt-injection-related categories — code-execution patterns like `eval(`, `subprocess.Popen`, `child_process.exec` would false-positive on legitimate user code (the agent is *writing* the user's code, not executing attacker input). `bash`/`powershell` commands scan against all 106. Multi-match: highest-risk wins; reason lists every matched pattern ID. False-positive guards: `obf-*` escape patterns require 2+ consecutive sequences; `ce-rm-rf-root` requires a separator after `/` (so `rm -rf /tmp/foo` does NOT match); `inj-jailbreak` uses `\bDAN\b`. Env kill-switch `UNOWN_INJECTION_SCANNER=0`. Pinned by `test/injection-scanner.test.ts` (49). |
| Per-subagent model + effort routing + mcpServers + injectAgentsMd | claude code `sub-agents.txt`, zcode per-subagent `mcpServers` whitelist | `pi-repo/packages/self-learning/src/subagent-routing.ts` (pure module) + `tools.ts:runSubagent` delegation — new `SubagentConfig` fields: `model?: string` (override `PI_MODEL_ID` for this subagent), `effort?: "low"|"medium"|"high"` (low → `BRIDGE_QWEN_THINKING=0`; high → `BRIDGE_QWEN_THINKING=1`), `mcpServers?: string[]` (restrict which MCP servers load; `[]` = none), `injectAgentsMd?: boolean` (default true; false → `UNOWN_NO_AGENTS_MD=1`). Frontmatter parser accepts both camelCase and snake_case. New env `UNOWN_SUBAGENT_MODEL` overrides the default for all subagents (individual `agent.model` takes precedence). New built-in `background-explore`: read-only, `qwen3.7-plus`, `effort: low`, no MCP, no AGENTS.md — minimal-overhead exploration. CLI flags `--model`/`--effort`/`--mcp-servers`/`--no-agents-md`. Pinned by `test/subagent-routing.test.ts` (54). |
| MCP elicitation (structured mid-turn input) | goose `elicitation.rs`, MCP standard elicitation capability | `pi-repo/packages/self-learning/src/elicitation.ts` (pure module) + `mcp.ts` — client advertises `elicitation: {}` in the initialize handshake and handles `elicitation/create` JSON-RPC requests. Default behavior is `decline` (the agent runs headless); per-server config in `.unown/mcp.json` enables `autoAccept: true` for trusted servers. Schema validation on auto-accept: when the dummy `{confirmed: true, reason: "auto-accepted by unown"}` doesn't satisfy the requested schema, the client responds `decline` instead of invalid data. `decideElicitation(request, config)` exported for hermetic testing. CLI: `unown mcp elicitation [server]`. Pinned by `test/elicitation.test.ts` (29, up from 11). |
| `get_context_remaining` + `view_image` tools | codex `tools/handlers/get_context_remaining.rs` + `view_image.rs` | new `pi.registerTool` registrations in the unown-tools extension. `get_context_remaining`: returns `{tokensUsed, maxTokens, remainingTokens, remainingPercent}` — tries `ctx.getContextUsage()` first, falls back to `estimateTokensUsed(messages)` (chars/4 walker). `maxTokens` resolves from `PI_MAX_TOKENS` env → `ctx.contextWindow` → 200 000 default. `view_image`: jail-checked (project root + system tmp), 4 MB cap, magic-byte validation for PNG/JPEG/GIF/WebP, returns Anthropic-vision format `content:[{type:"image", source:{type:"base64", media_type, data}}]`. Pinned by `test/context-tools.test.ts` (54). |
| `/init` AGENTS.md generator | opencode `plugin/command/initialize.txt`, claude code `/init` | `pi-repo/packages/self-learning/src/init-agents.ts` — scans the repo and produces an `AGENTS.md` at the project root: language detection (TS/JS/Python/Go/Rust/Java/etc.), framework detection (Next.js/Express/React/Django/FastAPI/etc.), test runner (vitest/jest/playwright/pytest/go test/cargo test), lint config (eslint/biome/ruff/golangci), build commands, dependency graph summary, file structure summary. The generator is PURE (no side effects) — the caller decides whether to write the file or display it. Surfaced as `/init` and `/init-agents` slash commands. Pinned by `test/init-agents.test.ts` (18). |
| `/doctor` instruction-set audit extension | claude code `/doctor` skill with `prompt-audit` subcommand | extends `info.ts` doctor path with a new instruction-set audit section: AGENTS.md freshness (does it exist? is it stale vs the actual codebase? does it reference missing files?), skill coverage (`.unown/skills/*.md` — valid frontmatter? overlaps?), MCP server health, hook syntax (validates `.unown/hooks.json` + `~/.unown/agent/hooks.json`), stale `.unown/` config (orphaned mcp.json entries), adversary mode state, injection scanner state. New `/doctor-instructions` slash command runs just the instruction audit inline. Pinned by `test/doctor-instructions.test.ts` (18). |
| `/review` PR URL/number support | opencode `plugin/command/review.txt:18-27` (`gh pr view` / `gh pr diff`) | extends `review.ts:captureReviewTarget()` — now accepts a PR URL (`https://github.com/owner/repo/pull/123`), a PR number (`#123` or `owner/repo#123`), or a commit range (`abc1234..def5678`). PR-shaped input shells out to `gh pr view --json` + `gh pr diff` to fetch metadata + diff, runs the existing parallel-subagent review over the diff, and optionally posts the verdict as a PR comment with `--comment`. If `gh` isn't on PATH, returns an actionable error: "GitHub CLI (gh) is required for PR review." Pinned by `test/pr-review.test.ts` (22). |
| `/blame` receipts reader | cursor blame view | `pi-repo/packages/self-learning/src/blame.ts` — new `/blame <file>` slash command reads `.unown/receipts/*.jsonl` for entries that touched `<file>` via write/edit/bash; returns a timeline of `{ ts, turn, sessionId, tool, summary }` entries. Without a file argument, returns a summary (total entries, byTool counts, filesTouched list). Flags: `--session <id>`, `--since <timestamp>`, `--json`. Pinned by `test/blame.test.ts` (23). |
| `unown sessions export\|import\|list` + `/sessions` | opencode `session/transfer.ts:1-60` | `pi-repo/packages/self-learning/src/sessions.ts` + `sessions-cli.ts` — `unown sessions export <id> [--out file]` writes a JSON file with `{ version, manifest, messages, todos, notes, skills, files }` for cross-project rehydration. `unown sessions import <file>` rehydrates with a new session ID (no collision). `unown sessions list` shows id, createdAt, messageCount, touchedFiles. In-session: `/sessions` slash command exposes the same surface. Forward-compat: import refuses a `version > SESSION_EXPORT_VERSION` (currently 1). Pinned by `test/sessions-export.test.ts` (18). |
| `/edit-resend` with SHA-256 out-of-band-edit detection | zcode edit-and-resend | `pi-repo/packages/self-learning/src/edit-resend.ts` + extends `checkpoints.ts` — `/edit-resend <message-index> <new-message>` reverts the file state to just before the Nth user message (using the existing checkpoint blob store) and replays from there with the edited message. SHA-256-based out-of-band-edit detection: if any file in the manifest has a different SHA-256 than the checkpoint's recorded hash, the operation aborts (the "all-or-nothing file reset" semantics). Atomic: if revert fails midway, `rollbackFiles` rewrites each snapshotted file with its pre-restore content (or deletes if the snapshot was null) — the user never lands in a half-rolled-back state. Pinned by `test/edit-resend.test.ts` (11). |
| Auto-compact on token limit (proportional threshold curve) | goose auto-compact-on-token-limit | `pi-repo/packages/self-learning/src/auto-compact.ts` + `runner.ts` wiring — when token usage approaches the model's context window, automatically trigger compaction BEFORE the model loses early turns or fails with a context-overflow error. Curve: <70% → "none"; 70–85% → "warn" (system message); 85–95% → "compact" (auto-trigger `/compact`); ≥95% → "block" (hard-error with "context exhausted"). Configurable via `UNOWN_AUTO_COMPACT_THRESHOLD` (default 85) + `UNOWN_AUTO_COMPACT_HARD_LIMIT` (default 95); explicit `cfg` overrides always win. Defensive: NaN/Infinity/negative → 0; `maxTokens ≤ 0` → "none". Every pi seam call is `typeof === "function"`-guarded; the whole helper is try/catch-wrapped (telemetry must NEVER break the run). Pinned by `test/auto-compact.test.ts` (39). |
| Recipes (declarative YAML/JSON instruction bundles) | goose Recipes (the signature goose feature) | `pi-repo/packages/self-learning/src/recipes.ts` + `recipes-cli.ts` + `/recipe` slash command — declarative bundles of agent instructions: a markdown body (the task instructions) with YAML frontmatter carrying `name`, `description`, `parameters` (JSON Schema), `sub_recipes` (referenced by name — they run as sub-tasks), `response_schema` (structured output validated with corrective retries reusing the Milestone 2 task-tool lane), `templates` (file templates with `{{param}}` interpolation), `allowed_tools`, `model` + `effort` overrides. Stored in `.unown/recipes/*.md` (project) + `~/.config/unown/recipes/*.md` (user). Invoked via `unown recipes run <name> [--param value]...` CLI or `/recipe <name> [args]` slash command. Pinned by `test/recipes.test.ts` (41). |
| Repo Wiki (automatic repo documentation with file:line cross-links) | zcode Repo Wiki (deferred per this doc, unblocked by Round 3 automations) | `pi-repo/packages/self-learning/src/repo-wiki.ts` + `wiki-cli.ts` + `/wiki` slash command — markdown pages auto-generated from the repo, each documenting a module/area with `file:line` cross-links to the actual code. Wiki structure: `index.md` (project overview), `modules/<name>.md` (one page per module: responsibilities, public API, internal structure, key files with file:line refs), `architecture.md` (dependency graph in DOT + markdown list, cycle detection), `changes.md` (recent changes from CHANGELOG.md or git log), `wiki.json` (manifest). Generation: 1) discover modules by walking the repo (excludes `node_modules/`, `.git/`, `dist/`, `build/`, `.unown/`); 2) for each module spawn a parallel read-only `task` subagent with `output_schema` enforcing the page structure; 3) synthesize index + architecture; 4) atomic write (tmp + rename via `atomicWriteFileSync`). Triggers: on-demand (`unown wiki generate` + `/wiki generate`), scheduled (an automation runs `unown wiki generate` — the Round 3 substrate), interactive (`/wiki <topic>` searches). Pinned by `test/repo-wiki.test.ts` (34). |

The Milestone 1-4 track closes the field-survey's three converged themes
verbatim: the multi-type hook contract (theme 1) lands first and is the
foundation for the security reviewers; the `/init` + `/doctor` + `/blame` trio
(theme 2) lands as a single round; and the recipes + structured subagent
routing pair (theme 3) lands last as Milestone 4. Every port landed on pi's
documented seams (`pi.registerTool`, `pi.registerCommand`, the extension
event surface) or in Unown's own pure modules — never as forks of the vendored
core, per the standing invariant below. The Repo Wiki entry is what unblocked
the deferred item below: the scheduling substrate (Round 3) is reused
verbatim, the wiki surface itself is the new code.

Verification receipts: the full self-learning suite is **2106 pass / 0 fail /
38 skip / 7202 expect() calls across 73 files** (the M1-M4 test files alone
account for 514 pass / 0 fail across 15 files: `hooks-config.test.ts` +
`adversary.test.ts` + `injection-scanner.test.ts` + `subagent-routing.test.ts`
+ `elicitation.test.ts` + `context-tools.test.ts` + `init-agents.test.ts` +
`doctor-instructions.test.ts` + `pr-review.test.ts` + `blame.test.ts` +
`sessions-export.test.ts` + `edit-resend.test.ts` + `auto-compact.test.ts` +
`recipes.test.ts` + `repo-wiki.test.ts`). `bun run typecheck` is green
(`tsc --noEmit` — zero errors introduced by the new src modules; the
pre-existing pi-substrate errors are in unrelated packages). `bun run check:docs`
is green. `bun run check:claims` is green (51 page literals resolve in the
engine sources).

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

### Round 1 (2026-10-18 — the shipped 0.0.1 slice)

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

The table above is the shipped 0.0.1 slice; three hardening and
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
| ~~Repo Wiki~~ | zcode | **Adopted in Round 5** (see above) — `repo-wiki.ts` + `wiki-cli.ts` + `/wiki` slash command; the Round 3 automations substrate is reused for scheduled generation |
| Plugin bundles + marketplace | zcode/codewhale/Claude | Our extension surface is inline + file-based (`.unown/`); a marketplace is ecosystem work, not a feature gap |
| Computer-use / browser automation | omp/zcode | Out of scope for a terminal-first agent this cycle; the TUI dashboard already renders its own surfaces |
| Collab relay / bot channels / remote control | omp/zcode | Hosted-infrastructure features; the TUI dashboard is our observability plane |

## The standing invariant

The oh-my-pi swap assessment's verdict governs here too: **the vendored pi
substrate stays; features land on pi's documented seams** (extension factories,
`pi.registerTool`, `pi.registerCommand`, session entries) or in Unown's own
packages — never as forks of the vendored core. Every port above was
re-derived against pi's current seams, not copied from a fork that assumes a
different runtime.
