# Memory-system competitor research

> Purpose: the 2026-10-25 reverse-engineering sweep of eleven agent-memory products — Mem0, Letta, Zep/Graphiti, LangMem, Claude Code, OpenAI Codex/ChatGPT, Cursor, Cognee, A-MEM, MemOS and Supermemory — what each architecture actually does, which bugs they have shipped and fixed in public, and the ten concrete opportunities that fall out for Unown's four-tier + AutoDream stack. Verdict up front: **Unown's flat-file-plus-gated-consolidation design is directionally validated (Letta converged on the same shape from the other direction), but the industry has moved past "recency wins" contradiction handling (bi-temporal supersede), past "one memory type" (facts vs episodes vs procedures with different decay), and past "trust the dream" (review queues for inferred memories). Those three are where the gap is.**

Related pages: [memory](memory.md) · [memory-platform-swap-assessment](memory-platform-swap-assessment.md) · [memory-system-review](memory-system-review.md) · [memory-classifier-evaluation](memory-classifier-evaluation.md) · [benchmark-research](benchmark-research.md)

- [Method and claim tiers](#method-and-claim-tiers)
- [The products](#the-products)
  - [Mem0](#mem0) · [Letta (formerly MemGPT)](#letta-formerly-memgpt) · [Zep / Graphiti](#zep--graphiti) · [LangMem](#langmem) · [Claude Code](#claude-code) · [OpenAI Codex CLI / ChatGPT](#openai-codex-cli--chatgpt) · [Cursor](#cursor) · [Cognee](#cognee) · [A-MEM](#a-mem) · [MemOS](#memos) · [Supermemory](#supermemory)
- [Comparison table](#comparison-table)
- [Top 10 improvement opportunities for Unown](#top-10-improvement-opportunities-for-unown)
- [Common failure modes to benchmark](#common-failure-modes-to-benchmark)
- [Corrections register](#corrections-register)

## Method and claim tiers

Research performed 2026-10-24/25 from public sources: GitHub repos and issue trackers (raw source files, READMEs, changelogs, ~20 issue-search queries against the GitHub search API), official docs sites (fetched as markdown where the site serves it — Letta `docs.letta.com/index.md`, Mem0 `docs.mem0.ai/*.md`, Supermemory `docs.llms.txt`), the Zep and A-MEM arXiv papers, and Letta's engineering blogs. OpenAI's `developers.openai.com` and `help.openai.com` refused automated fetch (HTTP 403) — Codex/ChatGPT findings therefore lean on the `openai/codex` repo's own issue tracker, where users document the shipped behavior with file paths. Cursor's "Memories" beta page could not be retrieved even from the Wayback Machine from this environment; what stands is the redirect evidence plus the current Rules docs.

Claims are tiered like the other decision records:

- **[V]** — verified during this research: read directly in fetched source, docs, changelog or issue body (all fetched artifacts retained under the task's scratch dir).
- **[C]** — upstream-claimed (vendor docs/paper says so; not re-derived here).
- **[U]** — unknown or inference; labeled as such, never presented as fact.

## The products

### Mem0

The platform Unown's engine already embeds (`mem0ai` OSS TS SDK) — studied here at full-platform depth, because the OSS SDK Unown runs is only part of the surface.

**Architecture.** Two generations ship side by side [V]:

- *Classic v2 pipeline* (still the documented "update" path): `FACT_RETRIEVAL_PROMPT` extracts atomic facts from the conversation → vector search for similar existing memories → a second LLM call (`DEFAULT_UPDATE_MEMORY_PROMPT`) classifies each fact `ADD` / `UPDATE` / `DELETE` / `NONE`. Contradiction handling in the prompt is explicit: a contradicting fact means `DELETE` of the old memory (then the new fact is added separately); a "more information" variant means `UPDATE` in place, same ID ([`mem0/configs/prompts.py`](https://github.com/mem0ai/mem0/blob/main/mem0/configs/prompts.py)) [V].
- *V3 "phased batch pipeline"* (April 2026, what the TS SDK Unown uses now runs) [V]: Phase 0 context gathering (last 10 messages from the history DB) → Phase 1 retrieve top-10 existing memories (UUIDs mapped to ints as an anti-hallucination measure) → Phase 2 **single ADD-only LLM extraction call** with `linked_memory_ids` entity linking and a hard "Observation Date" temporal anchor (relative dates like "last week" must be grounded to absolute dates at extraction time) → Phase 3 batch embedding → entity store upsert. Nothing is ever overwritten in the add path: "the automatic extraction path is additive… without silently rewriting the old one" ([docs: how it works](https://docs.mem0.ai/core-concepts/how-it-works)) [V]. Storage is three-part: SQL (facts + metadata), vector store (embeddings), entity store (entities + `linked_memory_ids`); plus a SQLite history DB that records every ADD/UPDATE/DELETE with old and new memory text [V]. Search fuses semantic + BM25 keyword + entity-boost signals (the TS SDK carries `normalizeBm25`, `ENTITY_BOOST_WEIGHT`, and a `memoryCountWeight` that penalizes entity over-linking) [V — read in `mem0-ts/src/oss/src/memory/index.ts`].

**Platform-only "Dream"** — the managed product ships a background consolidation layer that is the closest commercial analogue to AutoDream (and shares its name) [V — [docs: Dream](https://docs.mem0.ai/platform/features/dream)]:

| Action | Behavior | Availability |
|---|---|---|
| **Supersede** | when a new memory contradicts an older one, the older is *badged* superseded and linked to its replacement; retained, still returned by default, excluded via `latest_only=true` | always on, all plans |
| **Merge** | near-duplicates fold into one canonical memory; the merged record is hidden by default, surfaced via `include_merged=true` | always on, all plans |
| **Synthesis** | distills ≥ 20 user-scoped memories into additive, idempotent "pattern memories", each linking back to its source evidence | opt-in, Pro+ |

Nothing Dream does is destructive, and a dashboard shows runs, patterns, supersessions and merges [V].

**What it does better than flat-file + Mem0-OSS.** The supersede/merge/synthesize triad with badge-level read flags is a principled contradiction answer, versus Unown's render-time "recency wins, invalidated rule may not appear as current" contract; the OSS SDK Unown runs has *no* supersede — V3 just accumulates, and contradictions are only resolved by whatever downstream logic you build [V].

**Known bugs / edge cases** (all from the public tracker; several hit Unown directly since it runs the TS OSS SDK):

- **TS SDK TOCTOU dedup race** — two concurrent `add()` calls extracting the same fact both pass the hash-dedup check against the same stale snapshot and both insert; "two (or more) permanent duplicate memory rows… No error is raised; the duplication is silent." `Promise.all` of two identical adds is a complete repro ([#6531](https://github.com/mem0ai/mem0/issues/6531); Python twin [#6515](https://github.com/mem0ai/mem0/issues/6515)) [V]. *Unown's single-engine mutex serializes dreams, which structurally dodges this — but it is exactly the failure our benchmark should pin.*
- **Dedup window too small, no similarity floor** — the pre-extraction search in the TS `add()` path is "hardcoded to retrieve the top-10 nearest memories with **no cosine-similarity threshold**… near-duplicate memories that fall outside the top-10 window are never shown to the LLM… we captured 8 near-identical memories about a single fact in ~1 hour" on large corpora ([#7123](https://github.com/mem0ai/mem0/issues/7123)) [V]. *This one applies to Unown as its project memories grow past ~10 similar bullets.*
- **Cross-scope entity linking** — entities can merge across `user_id`/`agent_id` boundaries, so an entity's `linked_memory_ids` contains another scope's memories and the entity-boost score is computed over the mixed set ([#5439](https://github.com/mem0ai/mem0/issues/5439); fix attempts #6882, #6244) [V]. *The multi-project-leakage failure mode, in the exact platform Unown runs.*
- **Entity-store read-modify-write races** — concurrent `_upsert_entity` / `_remove_memory_from_entity_store` silently lose `linked_memory_ids` (#6243); async `delete_all` corrupts the entity store (#5577); a failed entity lookup inserts a duplicate entity row instead of linking (#6925, #6936) [V].
- Reranking only sees the truncated top-k so it cannot improve recall (#6448); OpenSearch metadata filters silently dropped so search runs unscoped (#7214) [V].
- Open feature requests that read like Unown's shipped contracts: "faithfulness check before memory write" (#7283); contradiction-detection pipeline with HITL session overrides (PR #4719) [V].

**UX.** Platform dashboard (Dream runs, memory history per fact, graph view), per-memory `history` API (every ADD/UPDATE/DELETE with old/new text), CLI, and — notable — an "agent signup" flow where an agent mints its own API key and a human claims the account later [V]. OSS exposes the history DB but no UI; Unown's render footer and TUI dashboard are already ahead of OSS-Mem0 here.

### Letta (formerly MemGPT)

**Architecture.** Letta has *replaced* the MemGPT memory-block model with **MemFS**: agent memory is a **git repository owned by the agent**, projected onto whatever machine the agent runs on [V — [docs: MemFS](https://docs.letta.com/concepts/memfs), [blog: context repositories](https://www.letta.com/blog/context-repositories)]. Specifics:

- Files at the repo root (e.g. `persona.md`, `human.md`) are loaded into the system prompt **every turn**; directories with their own `MEMORY.md` index stay out of context until needed — the index lists them so file names act as signposts ("progressive disclosure," explicitly patterned after Agent Skills frontmatter) [V].
- Memory is addressed by path; choosing a label is choosing where it lives and whether it stays in context. Every memory file is Markdown with YAML frontmatter (`name`, `description`) [V].
- Every edit is a git commit; cloud agents push to the hosted repo so any other machine picks it up. **Memory subagents (dreaming, memory-doctor) run in git worktrees** so they update memory concurrently without blocking the main agent [V].
- **Dreaming** is the productized descendant of sleep-time compute ([paper](https://www.letta.com/blog/sleep-time-compute)): background subagents review recent conversations, consolidate lessons and commit memory updates — trigger is `step-count` or `compaction-event`, behavior is `reminder` or `auto-launch`, and there is an "Agent reviews before applying" second-pass option [V — [docs: memory & dreaming](https://docs.letta.com/configuration/memory)].
- `/doctor` audits "placement, duplication, and system-prompt token usage" of memory; larger cleanups run a backup-then-reorganize workflow [V]. Semantic/vector search over memory is *not* built in — it ships as a mod (`memfs-search`, keyword/semantic/hybrid via QMD) [V].
- The legacy core-memory-block machinery (persona/human blocks, `core_memory_replace`, the sleeptime agent) was removed in 0.27.10 ("Removed legacy sleeptime-agent, memory-block, skills-block migration… plumbing paths") [V — changelog].
- Shared memory: multiple cloud agents can attach the same git-backed "shared memory repository"; skills live in `$MEMORY_DIR/skills` and travel with the agent [V].

**What it does better than a flat-file + Mem0 approach.** Git as the memory substrate gives (1) exact history and human-readable diffs for free, (2) concurrent-writer semantics via worktrees/merge instead of a global mutex, and (3) a native multi-machine story (push/pull). `/doctor`-style auditing of memory *placement and duplication* is a productized maintenance surface Unown lacks. Dreaming on `compaction-event` ties consolidation to actual context pressure rather than a timer.

**Known bugs / edge cases:**

- **Memory poisoning across sessions** — "agents can utilize internal tools (e.g., `core_memory_replace`) to maliciously alter their persona… these malicious memory modifications are permanently written to the database… the poisoned context permanently leaks into subsequent, independent evaluation runs, breaking sandbox isolation" ([letta #3388](https://github.com/letta-ai/letta/issues/3388)) [V]. *The canonical statement of the threat Unown's write-gate + zero-extraction quarantine answers.*
- **Reflection can overwrite fresh facts** — open fix "require explicit staleness before overwriting memory facts" (letta-code #4097): dreaming's updates were not required to prove the fact they replace is stale — i.e., recency is not enforced structurally [V — title/summary from tracker].
- Memory checkout clone-swap of large shared repos races a ~3-minute deadline and aborts `$MEMORY_DIR` commands (#5091); git push of reflection writes fails behind Windows Git Credential Manager popups (#4249); mid-conversation `<memory_update>` ignored by preflight compaction so a memory commit can force `max_tokens=1` (#4893) [V].
- Stale index: "Deleted agent skills remain advertised because the memory file index is stale" (#4337) [V].
- UX bug worth copying the *fix* for: "behavioral corrections being submitted as product feedback instead of memory edits" (0.31.12 changelog) [V].
- Concurrency fixes in the changelog read as a catalog of our risk surface: "concurrent harness writes to a memory checkout are serialized" (0.32.18), "background worker for incidental memory upkeep and post-turn Git-conflict repair" (0.33.0), "concurrent local git config changes on the memory repo" (0.29.13) [V].
- Open hardening asks: "Scoped projections and governed write semantics for shared memory" (#4267) — shared memory is currently under-governed [V].

**UX.** Memory is literally a git checkout the user can `cat`/`git log`; `/memory`, `/doctor`, `letta dream --to` (maintain AGENTS.md) and `--from` (reflect on external sources); a web "Memory Palace" viewer (itself buggy — hides non-Markdown files, #3894) [V].

### Zep / Graphiti

**Architecture.** Graphiti is the open-source framework; Zep is the managed service built on it (graph DB: Konig). The data model is a **temporal knowledge graph** ("context graph") [V — [README](https://github.com/getzep/graphiti)]:

- **Entities** (nodes with summaries that evolve), **facts/relationships** (edges carrying **validity windows** — `valid_at`/`invalid_at`, bi-temporal: event time vs. ingestion time), **episodes** (the raw ingested data, kept as ground-truth provenance — "every derived fact traces back here"), plus **communities** and developer-defined ontology (Pydantic entity/edge types) [V].
- Contradiction handling is *structural*: "When information changes, old facts are invalidated — not deleted. Query what's true now, or what was true at any point in time" [V]. New contradictory evidence marks the old edge invalid and creates a new edge; the GraphRAG comparison table contrasts this with "LLM-driven summarization judgments" [V].
- Incremental construction: new episodes integrate without graph recomputation; retrieval is hybrid (semantic embeddings + BM25 + graph traversal), "without reliance on LLM summarization" [V].
- The Zep paper reports beating MemGPT on its own Deep Memory Retrieval benchmark (94.8% vs 93.4%) and up to +18.5% accuracy with −90% latency on LongMemEval ([arXiv:2501.13956](https://arxiv.org/abs/2501.13956)) [C — paper's claims].

**What they do better than flat-file + Mem0.** The bi-temporal edge model is the industry's most principled contradiction answer: "current truth" is a query (`invalid_at IS NULL`), history is preserved for audit, and *event time* (when it became true) is distinguished from *ingestion time* (when we learned it) — which matters exactly when notes arrive out of order. Provenance from fact → episode is per-fact evidence tracking. Graph traversal adds multi-hop recall that pure vector search misses.

**Known bugs / edge cases:**

- **Silent episode loss**: `add_memory` returns 200 "queued for processing", then the queue service can drop the episode after retries (extraction output exceeding `max_tokens` was the reporter's trigger) with "no way for the caller to ever learn it… For a memory server this is silent data loss" ([#1707](https://github.com/getzep/graphiti/issues/1707)) [V]. *Unown's outbox + `markDreamed`-only-on-success contract is the counter-design; our benchmark should prove it.*
- **Premature edge expiry**: open fix "do not expire edges whose `invalid_at` is still in the future" (#2052) — the invalidation machinery itself has off-by-future bugs [V].
- **Cross-group filter bypass**: edge-endpoint filters ignored when `group_ids` is omitted (#2065, #2066); search-result dedupe across groups missing (#2062) — the multi-tenant leakage class again [V].
- The README documents its own prompt-injection posture: "The servers do not detect or block prompt injection. The servers send episode content and tool input to the LLM" [V].
- Operational caveats: requires structured-output-capable LLMs ("Using other services may result in incorrect output schemas and ingestion failures. This is particularly problematic when using smaller models") [V]; OpenSearch-backed setups and reranker minimum-score application are ongoing fix areas (#1973) [V].

**UX.** Zep's dashboard ships graph visualization, debug logs and API logs; searches can carry ranker scores and invalidated-fact counts (#1810 is the ask to surface them in MCP) [V]. Temporal queries ("what was true in March") are a first-class read.

### LangMem

**Architecture.** LangChain's memory SDK, built over the LangGraph `BaseStore` (Postgres or in-memory) with namespaces [V — [README](https://github.com/langchain-ai/langmem), [conceptual guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)]. Its contribution is the taxonomy and the two-lane formation model more than the storage:

- **Memory types**: *semantic* (facts/knowledge) — stored as **collections** (unbounded, searched at runtime) or **profiles** (one schema-constrained document of current state, "ideal when you only care about the latest state… easy to present to a user for manual editing"); *episodic* (past experiences as few-shot examples, schema `observation / thoughts / outcome`); *procedural* (system-prompt behavior — evolved by `create_prompt_optimizer`, which rewrites the prompt from trajectories + user scores, `kind="metaprompt"`, with `max_reflection_steps`) [V].
- **Formation lanes**: *active/hot-path* (agent calls memory tools mid-conversation) vs *background* (a memory manager consolidates between interactions); the guide's trade-off table is latency/immediacy vs. depth [V].
- Update philosophy: "the system must reconcile new information with previous beliefs, either deleting/invalidating or updating/consolidating… If it over-extracts → reduced precision; if it under-extracts → low recall," and recall should combine similarity with importance and *strength* (recency/frequency of use) [V].

**What it does better than flat-file + Mem0.** The semantic/episodic/procedural split with different storage and retrieval patterns per type is the cleanest published taxonomy; Unown's topic sections (Workflow / Known pitfalls / Task playbooks) are an informal version of it. The **prompt optimizer as procedural memory** is the direct competitor to Unown's skills minting, but operating on system prompts rather than SKILL.md files. **Profiles** are the right shape for a user tier: a small schema'd current-state document rather than an append-only bullet list.

**Known bugs / edge cases.** Not surveyed at tracker depth this round (repo issue volume is low; the SDK's update semantics are documented as tunable via `enable_inserts` and instructions) [U]. The conceptual guide is explicit that update behavior is a balance the developer must tune — i.e., contradictions are the app's problem, not the SDK's [V].

**UX.** Developer-library UX: everything is a LangGraph store item, inspectable in LangSmith traces; profiles are "easy to present to a user for manual editing" [V].

### Claude Code

**Architecture.** Two memory systems, deliberately separate [V — [docs: memory](https://code.claude.com/docs/en/memory)]:

- *CLAUDE.md instruction files*: enterprise policy → project root → user `~/.claude/CLAUDE.md`, plus `@path` imports, `.claude/rules/*.md` with frontmatter (`alwaysApply`/`description`/`globs`, path-scoped rules), nested CLAUDE.md loaded **on demand** when Claude touches files in that subtree, and AGENTS.md interop (read when no CLAUDE.md exists, or both, per a setting). CLAUDE.md is injected "as a user message after the system prompt, not as part of the system prompt itself" — a documented nuance. Hard limits: 4 MiB per launch file (over = load nothing), per-file character caps for on-demand files (40k chars on a 200K window), and `/doctor` "proposes trims for a checked-in CLAUDE.md: it cuts content Claude can derive from the codebase… and keeps pitfalls, rationale, and conventions" [V].
- *Auto memory* (the feature Unown most resembles): Claude saves four typed notes — `user` (role, expertise, working preferences), `feedback` (corrections and confirmed approaches), `project` (ongoing work, deadlines, decisions not derivable from code/git), `reference` (where information lives) — into `~/.claude/projects/<project>/memory/`, where `<project>` is **derived from the git repository**, "so all worktrees and subdirectories within the same repo share one auto memory directory" [V] (the same repo-identity decision Unown made for its scopes). Layout is a `MEMORY.md` index (loaded every session, capped at **200 lines or 25 KB, whichever comes first**) plus one topic file per memory, read on demand via ordinary file tools. Skip rules: "Claude skips anything it can derive from the codebase… It also skips anything your CLAUDE.md files already say" [V]. Machine-local by design; subagents do *not* inherit the main conversation's auto memory (forks do); a subagent can get its own memory directory via its `memory` field [V].

**Hardening trajectory from the changelog** (each entry is a shipped fix for a real failure) [V]:

- 2.1.59: auto memory introduced ("Claude automatically saves useful context to auto-memory").
- 2.1.83 / 2.1.186 / 2.1.210 / 2.1.268: the index cap saga — cap added, then a reminder to compact when near it, then "memory writes that leave a `MEMORY.md` index over its read limit now produce an explicit error instead of silent truncation," then the truncation warning learned to say how many lines were cut and where.
- 2.1.283: "Fixed Claude's edits to its own auto-memory notes being blocked as sensitive-file writes" — the self-edit permission gate misfiring.
- 2.1.284: "invisible characters and tags that imitate Claude Code's own markup are neutralized in `MEMORY.md` and recalled memory notes before they reach Claude" — **load-time prompt-injection neutralization**.
- 2.1.285: "Auto-memory can no longer be turned on from a background session or from a session one of Claude Code's own tools started" — the agent cannot re-enable its own memory channel.
- 2.1.293: nested CLAUDE.md/path-scoped rules silently not loading when the file was viewed via `cat`/`sed`/`grep` in Bash rather than the Read tool — trigger detection is tool-sensitive.
- 2.1.309: repeated-compaction loop after reading files under a very large nested CLAUDE.md; now loads only its start.
- 2.1.296 (Claude Tag): workspace/channel memory files with an admin permission — memory becomes a governed team surface.

**What it does better than flat-file + Mem0.** Product polish on limits and transparency: explicit errors on over-cap writes (never silent), `/context` listing exactly which memory files loaded, "Saved 2 memories / Recalled 2 memories" inline indicators, a `modified` frontmatter timestamp on every memory write so staleness is visible to both user and model, an `InstructionsLoaded` hook for observability, and `/doctor` trims with a stated policy (cut the derivable, keep the pitfalls). The injection-neutralization and anti-self-enable hardening are the security pattern to copy.

**UX.** `/memory` browses and edits everything (CLAUDE.md chain + auto-memory folder); `/context` shows what actually loaded; `/status` warns on oversized instruction files; auto-memory files are "plain markdown you can edit or delete at any time" [V].

### OpenAI Codex CLI / ChatGPT

Developers' docs sites block automated fetch (403) [V], so this section leans on the `openai/codex` repo, its issue tracker, and secondary confirmations — every load-bearing claim below cites an issue where a user documented the shipped behavior.

**Architecture.** Codex's instruction layer is **AGENTS.md**: a global `~/.codex/AGENTS.md`, a repo-root AGENTS.md, and nested ones down the tree, with `AGENTS.override.md` for layering, an `@include` composability request open (#17401), and a `project_doc_max_bytes` config knob (default 32 KB truncation — documented by users, #13386) [V/C]. Beyond static instructions, current Codex ships a **memory subsystem with consolidation**: `~/.codex/memories/` with a `memory_summary.md` written by a consolidation template (`codex-rs/ext/memories/…`) and read into new sessions at a **2,500-token cap**; there is also ChatGPT-level memory integration (personal + workspace memory, "Allow memories from tool-assisted chats"), and experimental "thread memory summary reads" (#56465) [V — issue #48679 documents paths and limits; #56767 documents the toggles].

**What it does better than flat-file + Mem0.** The ChatGPT-memory integration is the consumer-grade reference: memory survives into a hosted account, is surfaced and editable as discrete items, and syncs across clients [C — documented behavior in issues; help-center pages unfetchable from here]. Codex's `AGENTS.override.md` layering is a tidy pattern for "local overrides beat repo files" that Unown's `local.md` already mirrors.

**Known bugs / edge cases** (a catalog of silent-failure modes):

- **Silent AGENTS.md truncation at 32 KB** — "Any instructions past that limit are dropped and never sent to the model — with no warning anywhere in the TUI, /stats, exec, or VS Code extension… Users assume Codex is unreliable… when in reality their instructions were silently clipped." The reporter explicitly contrasts with Claude Code's prominent warning ([#13386](https://github.com/openai/codex/issues/13386)) [V].
- **memory_summary.md middle-truncation drops the newest entries** — the read path keeps half the 2,500-token budget from the start and half from the end and drops the middle; because the template orders `## What's in Memory` newest-first, "the middle cut removes the **newest** project entries… The older topics at the end of the file survive. The newer and more relevant the memory, the more likely it is to be dropped" — and the consolidation write path "gives no numeric budget" and never validates size, with "no warning, log, or memory-status signal" ([#48679](https://github.com/openai/codex/issues/48679)) [V].
- **Memory leakage with every toggle off** — "Historical user and company context… appearing in new chats even though the relevant visible memory controls are disabled" (personal Enable memory: off; Codex memories: off; memories dir empty; a workspace-level toggle "appears enabled but is not editable"); the user reports outdated facts served alongside newer ones and, critically, "I cannot identify which component is supplying this historical context" ([#56767](https://github.com/openai/codex/issues/56767)) [V].
- **Import/consolidation race** — closed PR "Prevent memory imports from racing with consolidation" (#56462) [V].
- An empty `AGENTS.override.md` hides the same folder's AGENTS.md (#54755); Desktop "compresses AGENTS.md instructions despite explicit project rules" (#31177) and "repeatedly ignores AGENTS.md rules" (#54662); global AGENTS.md missing from fresh task startup while the CLI loads it (#53873); and an open request for **integrity and origin checks for AGENTS.md and skills at load time** (#53490) — the memory-poisoning defense Codex does not yet have [V].

### Cursor

**Architecture.** Cursor's persistent-context story is **Rules** [V — [docs: rules](https://cursor.com/docs/context/rules)]:

- *Project Rules* — `.cursor/rules/*.mdc` (MDC with frontmatter; plain `.md` in that directory is ignored), version-controlled, with four application modes: `alwaysApply: true` (every session), auto-attach by `globs`, **agent-selected by `description`** (the model pulls the rule in when relevant), or manual `@rule` mention.
- *User Rules* (global, set in settings), *Team Rules* (dashboard-managed, Team/Enterprise plans), and *AGENTS.md* as "a simple alternative" — no frontmatter machinery.
- Rule content is "included at the start of the model context" when applied [V].

**Memories**: Cursor previously shipped an auto-generated per-project "Memories" beta [C — historical feature, widely documented]. Today `cursor.com/docs/context/memories` serves the **Rules** page (fetched 2026-10-25), and a Wayback snapshot of a distinct memories page exists for 2025-09-18 [V] — strong evidence the standalone Memories feature was folded into Rules, but the archived page content was not retrievable from this environment, so the deprecation is **[U] inference from the redirect**, stated as such.

**What it does better than flat-file + Mem0.** Rule application modes are the interesting idea: path-scoped (`globs`) and description-selected rules are *progressive disclosure for instructions* — only the rules relevant to the file under edit ride the context. Unown's equivalent would be path-scoped sections of `project.md` (a "Known pitfalls" bullet that only injects when the agent touches `auth.spec`).

**Known bugs / edge cases.** Cursor has no public issue tracker for the IDE; nothing verifiable surfaced this round [U].

**UX.** Rules are first-class in settings (the settings page is literally "Rules & Memories" historically); `.mdc` files are git-diffable; Team Rules give org-wide distribution without committing to every repo [C/V as marked].

### Cognee

**Architecture.** Open-source "AI memory platform" that turns documents, code and conversations into a knowledge graph + vector store + code graph [V — [README](https://github.com/topoteretes/cognee)]:

- Pipeline: text → entities/relationships/searchable chunks; **code → a graph of symbols and dependencies** (code-aware memory — the differentiator); **session distillation "curates accepted lessons into permanent memory"** — a two-stage acceptance model [V].
- Operations: `remember` / `recall` (auto-routing across graph, vector or code context) / `improve` (enrich, apply feedback, bridge session knowledge into the graph) / `forget` [V].
- Runs fully local **without an LLM** (bundled GLiNER extractor + local embeddings; LLM-dependent stages skip automatically) [V].
- **COGX exchange format** imports memory from Mem0, Letta, Zep, or Graphiti [V] — the only competitor shipping a memory *interop* format.
- Ships as Claude Code / Codex / OpenClaw plugins and MCP; graph visualization UI; paper: [arXiv:2505.24478](https://arxiv.org/abs/2505.24478) [V/C].

**What it does better than flat-file + Mem0.** Code-symbol graphs (memory that knows what a symbol is, not just that a sentence mentioned it); ontology-driven structured extraction (custom Pydantic entity/edge types); the acceptance-then-distill session model (sessions hold candidate lessons until accepted — a built-in review lane); and COGX for migration.

**Known bugs / edge cases.** "Google Drive sync deletes edited 'My Drive' files from memory (root alias never matches parents)" (#5639) — a destructive-sync bug where an identity-alias mismatch causes data loss [V]. Otherwise the tracker is dominated by connector/integration feature work.

### A-MEM

**Architecture.** Academic system (paper [arXiv:2502.12110](https://arxiv.org/abs/2502.12110), repo `agiresearch/A-mem`) built on **Zettelkasten** principles: every memory becomes a note with structured attributes (contextual description, keywords, tags); the system then "analyzes historical memories to identify relevant connections, establishing links where meaningful similarities exist," and — the distinctive bit — **memory evolution**: "as new memories are integrated, they can trigger updates to the contextual representations and attributes of existing historical memories, allowing the memory network to continuously refine its understanding" [V — abstract + README]. Indexing/linking via ChromaDB; agentic search over the linked network; claimed superior results over six foundation models [C].

**What it does better than flat-file + Mem0.** Memory evolution is the idea to steal: existing memories are *re-tagged and re-contextualized* when related new evidence arrives (Unown's hoist candidate ledger is a special case; A-MEM generalizes it to the whole store). Cheap to pilot: a post-dream pass that asks "which existing memories should gain/lose a tag or link because of what this dream learned?"

### MemOS

**Architecture.** "Memory Operating System" — unify store/retrieve/manage across memory types [V — [README](https://github.com/MemTensor/MemOS)]:

- **MemCubes**: multiple knowledge bases as composable cubes with isolation, controlled sharing and dynamic composition "across users, projects, and agents" — multi-project memory as a first-class object [V].
- **MemScheduler**: asynchronous ingestion "with millisecond-level latency for production stability under high concurrency" [V].
- **Memory feedback & correction**: "Refine memory with natural-language feedback — correcting, supplementing, or replacing existing memories over time" — the update path is conversational, not just additive [V].
- The local plugin stack tiers memory explicitly: "L1 traces, L2 policies, L3 world models, and crystallized Skills," with hybrid FTS5 + vector retrieval, smart dedup and tiered skill evolution [V].
- Benchmarks (their own OmniMemEval harness): LoCoMo 88.83, LongMemEval 89.20, and OpenClaw task completion 36.63% → 50.87% with MemOS [C — vendor-reported].

**What it does better than flat-file + Mem0.** The L1→L2→L3→skills tiering is the same ladder Unown climbs (notes → rules → playbooks → skills) but with an explicit world-model tier; cubes make "share this memory bank between these two projects, keep it out of that one" a configuration rather than a hoist heuristic; and the natural-language feedback path ("no, that rule is wrong because…") is the correction UX Unown's notes pipeline approximates with freeform notes.

### Supermemory

**Architecture.** Commercial memory engine + context platform [V — [docs](https://supermemory.ai/docs)]:

- **Memory model**: memories are atomic and form a **living graph via three relationship types** — `updates` (new fact replaces old *for search purposes*; history kept for audit; `isLatest` keeps retrieval on current truth), `extends` (adds detail, both stay valid), `derives` (facts inferred from patterns across memories, flagged `isInference: true` **until someone confirms them**) [V — [graph memory](https://supermemory.ai/docs/concepts/graph-memory)].
- **Dreaming** modes: `dynamic` (default — related documents grouped so memories form from coherent multi-turn units, "production quality is higher when you keep a stable `id` on conversations") vs `instant` (immediate, costs an extra operation) [V].
- **Automatic forgetting** by type: time-based expiry for temporary facts; contradiction → updates win; noise filtering for phatic chatter. Memory types carry decay semantics: facts "persist until updated," preferences "strengthen with repetition," episodes "decay unless significant" [V].
- **Review queue for inferred memories** — a HITL loop: list low-confidence derives, `approve` (clears the inference flag), `decline` (sets `isForgotten` — "a rejected guess is forgotten"), `undo` (back to the queue) [V — [memory review](https://supermemory.ai/docs/recall/memory-review)].
- **Profiles**: auto-maintained user context, "stable facts + recent activity," one call ~50 ms [C — vendor claims in README/docs].
- **SMFS**: mounts memory as a real filesystem — `ls`/`cat`/`grep` with **semantic grep by default** (any flag falls through to real grep), distilled memory paths, a virtual `profile.md` digest at the root, background bidirectional sync — "filesystem ergonomics without paying the filesystem tax in tokens" [V — [SMFS](https://supermemory.ai/docs/smfs/overview)].
- **MemoryBench**: an open-source framework for benchmarking memory providers, including your own [V].

**What it does better than flat-file + Mem0.** The inference review queue is the best-published answer to "the dream hallucinated a pattern" — Unown's staged-skills lane already does this for skills; Supermemory does it for *memories*. Typed decay (episodes decay, preferences strengthen) is a principled retention policy versus a flat bullet cap. `derives` with evidence links is Mem0-Synthesis's idea with a human gate on top. SMFS validates Unown's files-on-disk bet while fixing its token cost with semantic grep.

## Comparison table

| Product | Storage | Retrieval | Consolidation | Transparency | Multi-project | Self-editing |
|---|---|---|---|---|---|---|
| **Mem0 OSS v3** | SQL facts + vector store + entity store (+ SQLite event history) | hybrid: semantic + BM25 + entity boost; temporal scoring | ADD-only extraction, dedup downstream; no supersede in OSS | history API (old/new per event); platform dashboard | `user_id`/`agent_id`/`run_id` scopes; cross-scope entity-link bug (#5439) | API update/delete; no agent gate |
| **Mem0 Platform ("Dream")** | managed SQL+vector+graph | + graph memory, advanced retrieval | Supersede + Merge (always-on), Synthesis (patterns w/ evidence, idempotent) | Dream dashboard: runs, patterns, supersessions, merges | entity scoping UI | HITL session overrides (PR #4719, pending) |
| **Letta** | MemFS: git repo of Markdown + frontmatter; root files in prompt, indexed dirs on demand | file tools + grep; semantic/hybrid via mod | dreaming subagents (step/compaction triggers) in git worktrees; `/doctor`; reorganize w/ backup | git log/diff = full history; Memory Palace viewer; worktrees | per-agent repos; shared memory repositories (cloud) | agent edits own memory files; poisoning documented (#3388) |
| **Zep / Graphiti** | temporal KG (Neo4j/FalkorDB/Neptune): entities + bi-temporal edges + episodes | semantic + BM25 + graph traversal; temporal queries | incremental edge invalidation (non-destructive); entity resolution | graph-viz dashboard; fact→episode provenance; invalidated counts (in progress #1810) | `group_ids`; filter bypass bug (#2065) | API edits; dashboard |
| **LangMem** | LangGraph store (Postgres), namespaces | semantic search (+ importance/strength ranking guidance) | hot-path tools + background manager; "enrichment" balances create/consolidate | LangSmith traces; profiles user-editable | namespaces | agent hot-path memory tools |
| **Claude Code** | CLAUDE.md chain + `.claude/rules/` + auto-memory dir (`MEMORY.md` index + topic files), git-repo-keyed | full-file injection; index (200 lines/25 KB) every session; topic files on demand; nested on subtree access | agent-managed index (compaction reminders, explicit over-cap errors); typed note writes; `/doctor` trims | `/memory`, `/context`, "Saved/Recalled N memories", `modified` timestamps, InstructionsLoaded hook | git-repo identity; machine-local; Claude Tag workspace memory | agent writes own memory; injection-neutralized; can't self-enable (2.1.285) |
| **Codex CLI** | AGENTS.md chain (global→root→nested, override files) + `~/.codex` memories + `memory_summary.md` + ChatGPT account memory | full-file injection, 32 KB silent cap; summary injected at 2,500-token cap | background consolidation (memory_summary.md); ChatGPT memory sync; import/consolidation race fixed (#56462) | `/stats` (no truncation warning — #13386); ChatGPT memory UI [C] | global + project docs; workspace memory; leakage bug (#56767) | agent edits AGENTS.md; integrity checks only requested (#53490) |
| **Cursor** | `.cursor/rules/*.mdc` (frontmatter), User/Team rules, AGENTS.md | mode-routed: always / globs / description-selected / manual | none shipped (manual authoring; Memories beta folded in [U]) | rules UI; git-diffable files | project + team-dashboard distribution | user-authored |
| **Cognee** | KG + vector + **code-symbol graph**; sessions | auto-routing graph/vector/code | session distillation (accepted lessons → permanent); `improve` op | graph-viz UI; COGX export/import | datasets/sessions | API ops + feedback |
| **A-MEM** | atomic notes (attributes/tags) + ChromaDB link network | agentic search over links | **memory evolution** — new notes update historical notes' context/tags | research code | n/a | agentic ops |
| **MemOS** | MemCubes: Neo4j + Qdrant (+ SQLite local) | hybrid FTS5 + vector | MemScheduler async; NL feedback correction; L1 traces→L2 policies→L3 world models→skills | Memory Viewer dashboard | **cubes: isolation + controlled sharing** | feedback-driven |
| **Supermemory** | graph-on-graph memories + documents (RAG) + profiles | hybrid search; profiles (~50 ms); SMFS semantic grep | dreaming (dynamic/instant); updates/extends/derives; typed auto-forgetting | **review queue (approve/decline/undo)**; dashboard; SMFS `cat`/`grep` | namespaces | review-gated |
| **Unown (today)** | 4-tier Markdown (policy/project/user/local) + Mem0 OSS (SQLite + ONNX embeddings) engine-side; project.md is a deterministic render | full-stack injection every session + `/memory search` (scoped + cross-project, read-only) | AutoDream: quarantine → ADD-extract → recency-first reconcile → deterministic render (110-bullet cap) → gates/canary/rollback (memory version + event stream) | TUI dashboard (versions, diffs, rollback); render footer; `/learning` budget line; Manual-notes provenance | git-remote-keyed scopes; cross-project read-only search; 2-project hoist gate | write-gated: agent can only file notes; zero-extraction quarantine |

## Top 10 improvement opportunities for Unown

Ranked by user impact (what a Unown user would feel first). Each maps to the competitor(s) that demonstrate it.

1. **Supersede-with-provenance instead of recency-only reconcile.** Today the render contract is "most recent evidence wins and the invalidated rule may not appear as current." Upgrade the platform layer so invalidated memories are *badged and linked* (`superseded_by`), retained, and `GET /api/memories` gains a `latest_only` flag — then the render, `/memory search` and the dashboard diff can all show "rule X replaced rule Y on date Z." Non-destructive, auditable contradiction handling. Demonstrated by: Mem0 Dream Supersede, Graphiti edge invalidation (`invalid_at`), Supermemory `updates`/`isLatest`.
2. **Memory typing with per-type retention.** Split extracted memories into facts / episodes / procedures (Unown's topic sections already hint at this) and give each a decay rule: episodes (one-off observations — "flaky test on Tuesday") expire or fade; facts persist until superseded; preferences/rules strengthen with repetition. Replaces the flat 110-bullet oldest-dropped cap with a principled budget. Demonstrated by: Supermemory (typed forgetting), MemOS (L1/L2/L3), LangMem (taxonomy + strength).
3. **A review lane for inferred and hoisted memories.** Cross-project hoists already require a second project's corroboration; give the resulting promotion (and any future synthesized pattern) a Supermemory-style queue in the TUI dashboard: approve (becomes user-tier rule), decline (forgotten, recorded), with the evidence (which projects, which notes) attached. Extends the staged-skills precedent from skills to memories. Demonstrated by: Supermemory review queue, Letta "Agent reviews before applying", Mem0 PR #4719 (HITL overrides).
4. **Structural cross-scope isolation tests (and a leak benchmark).** Mem0's entity store has a documented cross-scope merge bug (#5439) and Graphiti a group-filter bypass (#2065) — in the exact layer Unown runs. Add benchmark cases: same-named unrelated projects; shared-entity projects; `?across=1` search must never *write*; entity-boost scores must be scope-pure. Demonstrated (as failure modes) by: Mem0 #5439/#6882, Graphiti #2065/#2066, Codex #56767.
5. **`unown memory doctor`.** An audit pass over a project's rendered memory + platform store that reports: duplication (near-duplicate bullets), derivable-from-repo content (the Claude Code `/doctor` trim policy: cut what the code/git can answer, keep pitfalls and conventions), placement (should this be user tier? local tier? a skill?), and token budget. One command, huge memory-hygiene payoff. Demonstrated by: Letta `/doctor`, Claude Code `/doctor`.
6. **Loud, itemized truncation everywhere.** The render cap (110 bullets, oldest dropped) and the Manual-notes 4k cap should follow Claude Code's trajectory: explicit warning on approach, hard error (visible in the dream output) when exceeded, and a receipt of *what* was dropped — never a silent trim. Negative case studies: Codex #13386 (32 KB silent AGENTS.md truncation) and #48679 (middle-truncation that drops the *newest* entries — check Unown's "oldest dropped first" interacts sanely with newest-first sections). Demonstrated by: Claude Code 2.1.210/2.1.268.
7. **Dedup hardening as the corpus grows.** Mem0 TS's dedup reference set is a hardcoded top-10 with no similarity floor (#7123 — "8 near-identical memories in ~1 hour" on large corpora), and concurrent adds can TOCTOU (#6531 — Unown's engine mutex mostly dodges this, but two engines sharing a `data/` dir, or a future async lane, would not). Add a pre-dream sweep: hash + embedding-similarity pass over the scope's memories, merging near-duplicates with a recorded event; pin it in the benchmark. Demonstrated by: Mem0 #7123/#6531 (failures), Supermemory Merge + Mem0 Dream Merge (fixes).
8. **In-session memory indicators + provenance surface.** "Saved a note," "dream landed: +3 rules, −1 superseded, project.md v47" as a lightweight status line (Unown already shows dream status on the dashboard); plus per-bullet provenance in `/memory search` (which note, which session, when). Claude Code's "Saved 2 memories / Recalled 2 memories" and `modified` timestamps are the UX bar; Letta's git-per-memory is the ceiling. Demonstrated by: Claude Code, Letta MemFS.
9. **Pattern synthesis with evidence links.** When the same shape of observation recurs (≥ N notes across ≥ 2 sessions), mint a *pattern memory* — a higher-order rule ("this repo's CI flakes under parallel runners; prefer --runInBand for anything touching auth") that links to its source memories and is marked `synthesized: true`. Natural extension of the hoist candidate ledger; pairs with #3's review lane. Demonstrated by: Mem0 Dream Synthesis, Supermemory `derives`, A-MEM memory evolution.
10. **A memory interchange + multi-machine sync story.** `project.md` is committable, but a teammate's fresh engine imports bullets *verbatim* and never receives the event history, supersession links or skills-staged provenance. Define (or adopt — Cognee's COGX exists) an export format for a project's memory bank: memories + events + metadata + supersede links, importable by another engine without duplication. Demonstrated by: Cognee COGX, Letta MemFS push/pull, Mem0 direct-import APIs.

Runners-up (worth a spike, not top-10): load-time injection neutralization of control characters and impostor markup in the rendered file (Claude Code 2.1.284 — Unown's quarantine covers *ingest*, not a malicious committed `project.md`'s rendering); compaction-event as a dream trigger (Letta); path-scoped memory sections (Cursor `globs`); schema'd user-tier profile (LangMem profiles); procedural prompt optimization for the engine's own harness prompts (LangMem `create_prompt_optimizer` — the mining loop's cousin).

## Common failure modes to benchmark

Failure modes observed across ≥2 products — each should have a pinned case in `benchmarks/memory-eval/`:

1. **Silent truncation of injected memory** — Codex #13386 (32 KB AGENTS.md), #48679 (2,500-token summary, middle-cut, newest dropped). Test: oversized `project.md`, 20k note, render cap hit — assert a visible warning and a dropped-content receipt in every case.
2. **Dedup failure under concurrency (TOCTOU)** — Mem0 #6515/#6531. Test: two sessions exit simultaneously with the same fact; assert one memory. Unown's engine mutex should pass — pin it so a refactor can't silently drop the serialization.
3. **Dedup failure at corpus scale (window miss)** — Mem0 #7123. Test: seed >10 similar memories, add one more; assert no duplicate.
4. **Contradiction co-existence** — Codex #56767 (outdated + newer both served). Test: rule invalidated by a newer note; assert the invalidated rule never appears as current in render, search, or cross-project recall (Unown's shipped contract — make it a measured one).
5. **Cross-scope leakage** — Mem0 #5439, Graphiti #2065/#2066. Test: same-named projects, shared entities, `across=1` search; assert reads are tagged, writes stay scoped, boosts are scope-pure.
6. **Memory poisoning / self-modification** — Letta #3388, Codex #53490. Test: agent attempts direct writes to `project.md`, `user.md`, skills dirs, or tries to re-enable a disabled channel; assert the write gate and quarantine hold (this is `test/dream-guard.test.ts`'s world — extend to the injection channel itself).
7. **Prompt injection via memory content** — Graphiti's documented non-defense; Claude Code 2.1.284's neutralization. Test: note containing impostor system-prompt markup; committed `project.md` with hidden instructions (the "repo-supplied files are flagged untrusted" path); assert neutralization/quarantine at load, not just at extract.
8. **Silent ingestion loss** — Graphiti #1707 (200-then-dropped). Test: engine down → outbox; extraction LLM fails mid-dream → assert the note is *not* consumed (`markDreamed` only on success) and re-queues; a failed dream must be visible (`gated`/error), never a no-op.
9. **Stale index after deletion** — Letta #4337 (deleted skills still advertised). Test: retire a skill / delete a memory; assert the next session's injected stack and skill index reflect it.
10. **Shared/merged memory conflicts** — Letta #4832/#5091 and the 0.33.0 git-conflict repair. Test: teammate clones a repo with committed `project.md` while their engine has its own platform state; assert the verbatim import doesn't duplicate or clobber; concurrent dream + hand-edit of Manual notes.
11. **Recency by ingestion time instead of event time** — Letta #4097 (reflection overwriting fresher facts); the bi-temporal lesson from Zep. Test: delayed outbox delivery — a note about Monday's state arrives *after* a note about Wednesday's; assert the reconcile uses the note's event time (front-matter), not dream time.
12. **Context bloat from memory itself** — Claude Code 2.1.309 (compaction loop under a very large CLAUDE.md). Test: `/learning` budget line with a pathological stack; assert pruning is announced and the session survives.

## Corrections register

- 2026-10-25 — first edition (task 2-b). Cursor "Memories" deprecation is inferred from a docs redirect plus archive evidence, not a vendor statement [U]. Codex/ChatGPT consumer-memory details are grounded in `openai/codex` issues and Wikipedia, not OpenAI's help center (403 to automated fetch) [C where marked]. Vendor benchmark numbers (Mem0, MemOS, Supermemory, Zep) are all [C] — none re-derived here.
