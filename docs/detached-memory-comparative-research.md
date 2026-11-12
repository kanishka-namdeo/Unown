# Detached Memory Systems — Comparative Architecture Research

> **Purpose**: a 2026-11-12 reverse-engineering sweep of eight detached-memory /
> memory-augmented-LLM products — Mem0, Letta (MemGPT), Zep/Graphiti, Memary,
> Cognee, A-Mem, Memoripy, plus the adjacent LangMem/MemOS/Supermemory tier — to
> ground the next round of Unown's detached-memory architecture work in what the
> field has actually shipped and proven. This complements
> [memory-competitor-research.md](memory-competitor-research.md) (the 2026-10-25
> eleven-product teardown) with an architecture-lens read of the same landscape.
> Every claim is sourced; `[V]` = verified in fetched source/docs/issue,
> `[C]` = vendor-claimed, `[U]` = inference.

Related pages: [memory.md](memory.md) · [memory-competitor-research.md](memory-competitor-research.md) · [detached-engine-architecture.md](detached-engine-architecture.md) · [memory-platform-swap-assessment.md](memory-platform-swap-assessment.md) · [memory-system-review.md](memory-system-review.md)

- [Framing: detached vs attached memory](#framing-detached-vs-attached-memory)
- [The Unown baseline](#the-unown-baseline)
- [Project-by-project](#project-by-project)
- [Academic concepts & benchmarks](#academic-concepts--benchmarks)
- [Consolidation best-practice synthesis](#consolidation-best-practice-synthesis)
- [Cross-platform keyboard UX](#cross-platform-keyboard-ux)
- [Where Unown stands — gap matrix](#where-unown-stands--gap-matrix)
- [Recommendations](#recommendations)
- [Sources](#sources)

## Framing: detached vs attached memory

The field draws a clean line between **attached (contextual) memory** — everything
riding inside the model's context window on every turn (system prompt, persona,
the last N turns, injected docs) — and **detached (external) memory** — facts,
episodes, and procedures that live *outside* the context window and are pulled in
only when the model or an orchestrator decides they are needed. The MemGPT paper
([arXiv:2310.08560](https://arxiv.org/abs/2310.08560)) formalized the OS metaphor:
context window = RAM, external store = disk, the agent manages its own context via
"memory editing" tools instead of naively stuffing everything into the prompt.

The practical reason the field converged on detached memory is token economics
plus four failure modes of naive RAG: (1) retrieved chunks lack temporal validity
(an old and a new fact both get returned), (2) there is no contradiction
resolution, (3) there is no consolidation or forgetting so the store grows
unbounded and recall noise rises, (4) there is no provenance so the model cannot
tell which sources to trust. Every system below is an attempt to fix one or more
of these four gaps. The recurring architectural claim: **memory should be a
managed substrate with typed entries, validity windows, and a lifecycle, not a
vector pile.**

## The Unown baseline

Unown is a self-learning coding agent built on the open-source `pi` coding-agent
TUI. It runs as two halves sharing nothing but files and HTTP — a short-lived
terminal agent and a detached "self-learning engine" daemon. The terminal agent
never opens the engine's database (measured: 0 fds) — it reads Markdown off disk;
the engine is the single writer.

- **Storage**: a four-tier Markdown stack injected into every session — `policy.md`
  (ops), `project.md` (AutoDream-rendered from Mem0), `user.md` (global),
  `local.md` (per-machine, gitignored). The engine side runs in-process Mem0
  (`mem0ai` OSS TS SDK) over SQLite vector store + ONNX `bge-small-en-v1.5`
  embeddings (384-dim) with a deterministic lexical fallback.
- **Retrieval**: full-stack injection every session (most-specific-wins merge,
  ordered policy→project→user→local) PLUS `/memory search` (scoped and
  `?across=1` cross-project, read-only).
- **Lifecycle**: notes → outbox queue (durable fallback when engine down) →
  AutoDream consolidation (every 10 min + event-triggered): quarantine →
  ADD-extract via Mem0 → recency-first reconcile → deterministic render into
  `project.md` (110-bullet cap, oldest dropped). Every rule carries a
  last-confirmed date; rules >28 days unconfirmed get a `stale` marker
  (`PI_MEM0_STALE_DAYS`).
- **Gates**: ship gate (candidate run must pass twice), dream canary gate (new
  memory must re-pass last-passing task, else rolled back), retention auto-unship,
  skill mint gate (max 2/dream, 24 ceiling, staged in `.unown/skills-staged/`).
- **UX surfaces**: `◈ memory recalled: N rules · vN · dreamed Xm ago — /memory show`
  boot line; `/memory show [full]` (the exact budget-pruned stack the model
  receives, provenance included, truncation never silent); TUI dashboard
  (`unown dashboard`) with Dreams screen + Memory screen + memory health card;
  `unown doctor`; `unown memory`.
- **Edge cases handled**: PII/untrusted content via structural quarantine + output
  scan + deterministic guard gate; contradictions via recency-first reconcile;
  stale facts via 28-day `stale` marker; multi-user/multi-project via
  git-remote-keyed scopes (origin URL hashed → 6-hex key); cross-project recall
  is read-only; hoist to user tier requires `PI_HOIST_MIN_PROJECTS=2` distinct
  projects corroborating; context overflow via injection-budget tail.
- **Tech stack**: Bun 1.4.4 + TypeScript; SQLite (WAL) via `better-sqlite3`; Mem0
  OSS TS SDK; ONNX `bge-small-en-v1.5`; OpenAI-compatible LLM bridge (:3031,
  Agnes AI upstream); engine REST+SSE on :3030. OS-level sandbox: Linux bubblewrap
  + macOS seatbelt; native Windows in-process path jail.

## Project-by-project

### Mem0 — https://github.com/mem0ai/mem0

The platform Unown's engine already embeds. Two generations ship side by side
[V]: the classic v2 pipeline (`FACT_RETRIEVAL_PROMPT` → vector search → second
LLM call classifying ADD/UPDATE/DELETE/NONE, contradiction = DELETE old) and the
V3 "phased batch pipeline" (April 2026, what the TS SDK Unown uses now runs):
single ADD-only LLM extraction call with `linked_memory_ids` entity linking and
a hard "Observation Date" temporal anchor — nothing is ever overwritten in the
add path. Storage is three-part: SQL (facts + metadata), vector store
(embeddings), entity store (entities + `linked_memory_ids`); plus a SQLite
history DB recording every ADD/UPDATE/DELETE with old and new text. Search fuses
semantic + BM25 keyword + entity-boost.

Platform-only **Dream** is the managed consolidation layer: **Supersede**
(contradicting fact badges the older as superseded, linked to replacement,
retained, excluded via `latest_only=true`), **Merge** (near-duplicates fold into
one canonical), **Synthesis** (≥20 user-scoped memories → additive idempotent
"pattern memories" linking back to sources). Paper: [arXiv:2504.19413](https://arxiv.org/abs/2504.19413).

**Known bugs that hit Unown directly** (all `[V]` from the public tracker): TS
SDK TOCTOU dedup race — two concurrent `add()` of the same fact both pass
hash-dedup and both insert silently ([#6531](https://github.com/mem0ai/mem0/issues/6531));
dedup window too small — hardcoded top-10, no cosine-similarity floor, "8
near-identical memories in ~1 hour" on large corpora ([#7123](https://github.com/mem0ai/mem0/issues/7123));
cross-scope entity linking — entities merge across `user_id`/`agent_id`
boundaries ([#5439](https://github.com/mem0ai/mem0/issues/5439)).

### Letta (formerly MemGPT) — https://github.com/letta-ai/letta

Letta has *replaced* the MemGPT memory-block model with **MemFS**: agent memory
is a **git repository owned by the agent**, projected onto whatever machine the
agent runs on [V — [docs: MemFS](https://docs.letta.com/concepts/memfs)]. Root
files (`persona.md`, `human.md`) load into the system prompt every turn;
directories with their own `MEMORY.md` index stay out of context until needed
("progressive disclosure," patterned after Agent Skills frontmatter). Every
edit is a git commit; cloud agents push so any machine picks it up. **Memory
subagents (dreaming, memory-doctor) run in git worktrees** so they update memory
concurrently without blocking the main agent. **Dreaming** is the productized
descendant of sleep-time compute — trigger is `step-count` or `compaction-event`,
behavior is `reminder` or `auto-launch`, with an "Agent reviews before applying"
second-pass option. `/doctor` audits "placement, duplication, and system-prompt
token usage." The legacy core-memory-block machinery was removed in 0.27.10.

**Known bugs** `[V]`: memory poisoning across sessions — agents can use internal
tools to maliciously alter persona, poisoned context permanently leaks into
subsequent independent evaluation runs ([#3388](https://github.com/letta-ai/letta/issues/3388));
reflection overwrites fresh facts — open fix "require explicit staleness before
overwriting memory facts" (#4097); stale index — deleted skills remain
advertised (#4337).

### Zep / Graphiti — https://github.com/getzep/graphiti

Graphiti is the open-source framework; Zep is the managed service. The data model
is a **temporal knowledge graph** ("context graph") [V]: **entities** (nodes with
summaries that evolve), **facts/relationships** (edges carrying **bi-temporal
validity** — `valid_at`/`invalid_at`, event time vs ingestion time), **episodes**
(raw ingested data as ground-truth provenance — "every derived fact traces back
here"), plus **communities** and developer-defined ontology (Pydantic
entity/edge types). Contradiction handling is *structural*: "When information
changes, old facts are invalidated — not deleted. Query what's true now, or what
was true at any point in time." Incremental construction: new episodes integrate
without graph recomputation; retrieval is hybrid (semantic + BM25 + graph
traversal), "without reliance on LLM summarization." Paper:
[arXiv:2501.13956](https://arxiv.org/abs/2501.13956). Backends: Neo4j 5.26,
FalkorDB 1.1.2, Amazon Neptune.

**The bi-temporal edge model is the industry's most principled contradiction
answer**: "current truth" is a query (`invalid_at IS NULL`), history is preserved
for audit, and *event time* (when it became true) is distinguished from
*ingestion time* (when we learned it) — which matters exactly when notes arrive
out of order.

### Memary — https://github.com/kingjulio8238/Memary

Emulates human memory via a Memory Stream (breadth — entities + timestamps) and
an Entity Knowledge Store (depth — frequency + recency per entity), influenced by
Microsoft Research's K-LaMP ([arXiv:2311.06318](https://arxiv.org/pdf/2311.06318.pdf)).
Graph DB (FalkorDB or Neo4j) backend; LlamaIndex ReAct agent. Retrieval is
**recursive** — determine key entities in the query, build a subgraph of max
depth 2, use the subgraph as context; **multi-hop** reasoning joins multiple
subgraphs when multiple key entities. The breadth/depth split (Memory Stream =
breadth of exposure, Entity Knowledge Store = depth of familiarity) is a
principled human-memory analog that naive chunk retrieval lacks.

### Cognee — https://github.com/topoteretes/cognee

Free open-source AI memory platform turning documents, code, and conversations
into a self-hosted knowledge graph + vector store + **code-symbol graph** that
agents can search and reuse. Runs fully locally without an LLM key (bundled
GLiNER extractor + local embeddings). Since 1.0 the entire memory layer
(relational metadata + PGVector + graph state) can run on a **single Postgres
instance**. Four operations: `remember` (store content/code/sessions), `recall`
(retrieve with auto-routing across graph/vector/code), `improve` (enrich, apply
feedback, bridge session knowledge into graph), `forget` (remove item/dataset).
**Session distillation** "curates accepted lessons into permanent memory" — a
two-stage acceptance model where sessions hold candidate lessons until accepted.
**COGX exchange format** — the only competitor shipping a memory interop format,
importing from Mem0/Letta/Zep/Graphiti. Paper: [arXiv:2505.24478](https://arxiv.org/abs/2505.24478).

### A-Mem (Agentic Memory) — https://github.com/agiresearch/A-mem

Academic agentic memory built on **Zettelkasten** principles — every memory
becomes a note with structured attributes (contextual description, keywords,
tags), and the system autonomously links and evolves memories. Paper:
[arXiv:2502.12110](https://arxiv.org/pdf/2502.12110). Storage: ChromaDB vector
store holding atomic notes with metadata. The distinctive idea is **memory
evolution**: when a new memory is added, the system (1) generates comprehensive
notes with structured attributes, (2) analyzes historical memories for relevant
connections, (3) establishes meaningful links based on similarities, (4) **triggers
updates to the contextual representations and attributes of *existing historical*
memories** — the store is a living network that re-organizes itself, unlike
naive RAG's immutable chunks.

### Memoripy — https://github.com/SamurAIGPT/Memoripy

Lightweight Python memory library implementing short-term and long-term memory
with **Ebbinghaus-inspired forgetting curves** `R = e^(-t/S)` where `t` is time
since last recall and `S` is memory strength (bumped on each recall — the
reinforcement mechanism), similarity-based retrieval, and reinforcement of
recalled memories. (Repo returned 404 during this research sweep — verify
availability before depending on it.) The forgetting curve is the principled
answer to "my memory store is full of stale one-off observations" — naive RAG
retrieves purely on similarity so a 2-year-old fact and a 2-minute-old fact tie
if their embeddings match; Memoripy explicitly models that memories fade unless
rehearsed.

### Adjacent tier — LangMem, MemOS, Supermemory

- **LangMem** ([github.com/langchain-ai/langmem](https://github.com/langchain-ai/langmem)):
  cleanest published taxonomy — *semantic* (collections vs profiles), *episodic*
  (few-shot examples), *procedural* (`create_prompt_optimizer` rewrites system
  prompts from trajectories). Two formation lanes: hot-path (agent calls memory
  tools mid-convo) vs background (manager consolidates between interactions).
- **MemOS** ([github.com/MemTensor/MemOS](https://github.com/MemTensor/MemOS)):
  "Memory Operating System" with **MemCubes** (composable knowledge bases with
  isolation/controlled sharing), **MemScheduler** (millisecond async ingestion),
  L1 traces→L2 policies→L3 world models→skills tiering, natural-language
  feedback correction.
- **Supermemory** ([supermemory.ai/docs](https://supermemory.ai/docs)): graph
  memory with three relationship types — `updates` (new replaces old for search,
  `isLatest`, history kept), `extends` (both valid), `derives` (inferred,
  `isInference: true` until confirmed). **Review queue for inferred memories**
  (approve/decline/undo). **SMFS** mounts memory as a real filesystem with
  semantic grep by default. Typed auto-forgetting: facts persist until updated,
  preferences strengthen with repetition, episodes decay unless significant.

## Academic concepts & benchmarks

**Forgetting curves (Ebbinghaus)** — the 1885 forgetting curve `R = e^(-t/S)`
(retention decays exponentially with time since learning, modulated by memory
strength `S` which increases with rehearsal) is instantiated by Memoripy
explicitly, by Supermemory's typed decay (facts persist, preferences strengthen,
episodes decay), by MemOS's L1→L2→L3→skills tiering, and by Unown's soft decay
(`PI_MEM0_STALE_DAYS=28`, the marker not deletion). Claude Code ships per-memory
`modified` timestamps for the same reason; Copilot expires un-refreshed memories
at 28 days (harder policy).

**Retrieval evaluation** — LoCoMo ([arXiv:2402.10790](https://arxiv.org/abs/2402.10790),
Snap's long-context multi-modal session benchmark, the standard) and LongMemEval
([arXiv:2410.10813](https://arxiv.org/abs/2410.10813), five abilities —
information extraction, reasoning, summarization, multi-session, temporal) are
the field's benchmarks. Mem0 reports 92.5 / 94.4; MemOS 88.83 / 89.20; Cognee
ships its own BEAM variant. Vendor benchmark numbers are uniformly `[C]`
(vendor-reported, not re-derived) — the systems that publish methodology +
reproduction (Mem0, Cognee, Unown) are more trustworthy than bare claims.

## Consolidation best-practice synthesis

Seven practices recur across the frontier systems:

1. **Structural quarantine before extraction** — a flagged/untrusted note is
   dropped from the batch *before* the extraction LLM call (Unown's
   zero-extraction contract; Claude Code 2.1.284's load-time neutralization).
   Prompt-based "don't extract bad things" is insufficient.
2. **ADD-only extraction + downstream consolidation** — Mem0 V3, Cognee, Unown
   all converged here. The extraction pass only adds; contradiction resolution is
   a separate reconcile pass with the full memory listing in view.
3. **Bi-temporal supersede, not recency-delete** — Graphiti's
   `valid_at`/`invalid_at` edge model is the gold standard: old facts are
   invalidated (not deleted), linked to their replacement, queryable as "what was
   true then." Mem0 Dream Supersede and Supermemory `updates`/`isLatest` follow
   the same shape. Unown's recency-first reconcile is the weaker version — its
   own competitor research flags this as **gap #1**.
4. **Fresh-evidence protection** — the reconcile pass may not DELETE a memory
   born in the current consolidation batch (Unown's ⛨ N protected indicator;
   Cognee's "consolidated-exactly-once" watermark; Mem0 V3's ADD-only).
5. **Review lane for inferred memories** — Supermemory's approve/decline/undo
   queue for `derives`; Letta's "Agent reviews before applying"; Mem0 PR #4719
   (HITL overrides, pending). Unown's staged-skills lane (`skills-staged/`
   awaiting human `mv`) is the precedent for skills but **not yet for memories** —
   **gap #3**.
6. **Typed retention** — Supermemory (facts persist, preferences strengthen,
   episodes decay), MemOS (L1→L2→L3→skills), LangMem (semantic/episodic/procedural
   with different storage). Replaces flat bullet caps with principled per-type
   budgets. Unown's flat 110-bullet cap is **gap #2**.
7. **Provenance on every memory** — Letta's git-per-memory, Claude Code's
   `modified` timestamps, Graphiti's episode→fact lineage, Unown's last-confirmed
   date stamps. The model and the user both need to know *when* a fact was last
   verified.

## Cross-platform keyboard UX

Synthesizing from the TUI/coding-agent ecosystem (Claude Code, Codex CLI, Cursor,
Letta, Unown's pi TUI) and web chat conventions:

| Pattern | Convention | Notes |
|---|---|---|
| Send message | `Enter` sends; `Shift+Enter` newline (web/TUI standard) | `Cmd/Ctrl+Enter` is the "compose then commit" pattern (email, Slack draft), not chat |
| Command palette | `Cmd+K` (macOS) / `Ctrl+K` (Win/Linux) | Raycast, Linear, Notion; `Ctrl+K` conflicts with readline "delete to end of line" on Win/Linux — slash commands are the TUI convention |
| Vim modes | `i`/`Esc`; `:` command-line; `hjkl` navigation | Cursor and some terminal agents support vim mode in the editor pane |
| Arrow-up edit last | Arrow-up in empty prompt recalls last input | Shell history convention; Discord, Slack, REPLs |
| Abort | `Esc` or `Ctrl+C` | Unown's unified abort matrix behind `Esc` / `/abort` |
| Resume | `Ctrl+R` or `--resume <id>` | Session lifecycle is first-class in coding agents |
| Help | `?` shortcut sheet | Unown's Ostinato ships an in-app `?` shortcut sheet |

**Cross-platform key conflicts**: `Cmd+Enter` on macOS is "send" in Mail but
"commit" in some editors; `Ctrl+K` on Windows/Linux is "delete to end of line"
in readline (conflicts with command palette). The safe cross-platform pattern is:
slash commands for TUIs, `Cmd/Ctrl+K` for web palettes (with Mac `⌘` detection),
and `Enter`-sends/`Shift+Enter`-newline for chat compose. **Accessibility**:
WCAG 4.1.3 "Status Messages" — Unown's TUI dashboard memory indicators (`◈ memory
recalled`, `⛨ N protected`, dream status lines) are status messages that should
be screen-reader-announced.

## Where Unown stands — gap matrix

| Capability | Frontier practice | Unown today | Status |
|---|---|---|---|
| Contradiction handling | Bi-temporal supersede with provenance (Graphiti, Mem0 Dream, Supermemory) | Recency-first reconcile | **Gap #1** |
| Memory typing | Facts/episodes/procedures with per-type decay (Supermemory, MemOS, LangMem) | Flat 110-bullet cap | **Gap #2** |
| Review for inferred memories | Approve/decline/undo queue (Supermemory, Letta) | Staged-skills for skills only | **Gap #3** |
| Cross-scope isolation | Hardened with tests (Mem0 #5439, Graphiti #2065 are the failure modes) | Git-remote-keyed scopes + read-only cross-project + 2-project hoist gate | **Unown ahead** |
| Memory poisoning defense | Quarantine + write gates + load-time neutralization | Structural quarantine + write gate + zero-extraction | **Unown at frontier** |
| Detached architecture | Letta MemFS git worktrees; MemOS MemScheduler; Supermemory SMFS | Detached engine daemon, 0 fds, file+HTTP only, budget governor, circuit breaker | **Unown at frontier** |
| Forgetting/decay | Ebbinghaus curves (Memoripy), typed decay (Supermemory), stale markers | 28-day `stale` marker, soft not deleting | **Unown at frontier** |
| Provenance | Git-per-memory (Letta), episode→fact lineage (Graphiti), `modified` (Claude Code) | Last-confirmed date + provenance footer + Manual-notes sticky flag | **Unown at frontier** |
| Truncation transparency | Claude Code explicit errors; Codex silent (negative) | `/learning` budget line, pruned/head-truncated/OVERFLOW named, never silent | **Unown at frontier** |
| Memory interop | Cognee COGX format | Committable `project.md` (verbatim import at first dream, no event history) | **Gap #10** |
| Memory doctor/audit | Letta `/doctor`, Claude Code `/doctor` | `unown doctor` (file existence) + memory health card (duplicates/conflicts/warnings) | **Partial** |

## Recommendations

The three gaps Unown's own competitor research ranks #1-#3, re-confirmed by this
sweep, are the next round's scope:

1. **Bi-temporal supersede with provenance** — add `valid_at`/`invalid_at`/
   `superseded_by` to the Mem0 store (or layer it in the render), retain
   invalidated memories, add `latest_only` to search. Closes gap #1.
2. **Memory typing with per-type retention** — tag each extracted memory as
   `fact` / `episode` / `procedure` / `preference` at extraction time; give each
   type a decay policy (episodes expire, facts persist until superseded,
   preferences strengthen). Replaces the flat 110-bullet cap with a principled
   budget. Closes gap #2.
3. **Memory review queue** — extend the `.unown/skills-staged/` precedent to
   memories: inferred patterns and cross-project hoists land in a review lane in
   the TUI dashboard with approve/decline/undo and evidence attached. Closes
   gap #3.

Secondary: (4) `unown memory doctor` audit pass (duplication, derivable-from-repo
content, placement, token budget); (5) a memory interchange format (adopt COGX
or define a Unown export carrying memories + events + metadata + supersede
links). Keep the keyboard-first TUI (slash commands + `?` sheet + `Enter`-sends +
`Esc` abort + `--resume`). Benchmark against LoCoMo / LongMemEval / BEAM with
published methodology.

## Sources

- Unown: [README](../README.md) · [memory.md](memory.md) · [BEHAVIOR.md](BEHAVIOR.md) · [memory-competitor-research.md](memory-competitor-research.md) · [detached-engine-architecture.md](detached-engine-architecture.md)
- Mem0: [github.com/mem0ai/mem0](https://github.com/mem0ai/mem0) · [docs.mem0.ai](https://docs.mem0.ai) · [arXiv:2504.19413](https://arxiv.org/abs/2504.19413)
- Letta: [github.com/letta-ai/letta](https://github.com/letta-ai/letta) · [docs.letta.com](https://docs.letta.com) · [MemGPT paper arXiv:2310.08560](https://arxiv.org/abs/2310.08560) · [MemFS docs](https://docs.letta.com/concepts/memfs)
- Zep/Graphiti: [github.com/getzep/graphiti](https://github.com/getzep/graphiti) · [arXiv:2501.13956](https://arxiv.org/abs/2501.13956)
- Memary: [github.com/kingjulio8238/Memary](https://github.com/kingjulio8238/Memary) · [K-LaMP arXiv:2311.06318](https://arxiv.org/pdf/2311.06318.pdf)
- Cognee: [github.com/topoteretes/cognee](https://github.com/topoteretes/cognee) · [arXiv:2505.24478](https://arxiv.org/abs/2505.24478)
- A-Mem: [github.com/agiresearch/A-mem](https://github.com/agiresearch/A-mem) · [arXiv:2502.12110](https://arxiv.org/pdf/2502.12110)
- Memoripy: [github.com/SamurAIGPT/Memoripy](https://github.com/SamurAIGPT/Memoripy) (verify availability)
- LangMem: [github.com/langchain-ai/langmem](https://github.com/langchain-ai/langmem)
- MemOS: [github.com/MemTensor/MemOS](https://github.com/MemTensor/MemOS)
- Supermemory: [supermemory.ai/docs](https://supermemory.ai/docs)
- LoCoMo: [arXiv:2402.10790](https://arxiv.org/abs/2402.10790) · LongMemEval: [arXiv:2410.10813](https://arxiv.org/abs/2410.10813)
