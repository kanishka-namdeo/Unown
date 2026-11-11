# Memory Encore round — competitor teardown & research (2026-11-12)

> The Memory Recital round (2026-11-11) tore down five memory platforms
> ([TEARDOWN_2026-11-11_five-memory-systems.md](TEARDOWN_2026-11-11_five-memory-systems.md):
> Mem0 v3, Zep, Letta MemFS, Cognee, LangChain/LangMem + LlamaIndex) against
> the four live learning-loop bugs it found. This round asks the complementary
> question: **what does the field do that our users can SEE and FEEL?** — the
> memory UX of the shipping coding agents, plus the second wave of memory
> platforms the first teardown did not cover. Eleven new products, every claim
> carrying its source; inferences are marked as such and were verified where
> the live page permitted.

Method: live fetches of official docs, changelogs, engineering blogs, paper
abstracts and repo READMEs (2026-11-12), plus the archived surfaces where a
vendor has since removed a feature. Products covered, grouped by what they
prove:

| # | Product | What it is | The pattern this round takes |
|---|---|---|---|
| 1 | Claude Code (Anthropic) | terminal coding agent | recall/save toasts, memory timestamps, `/context` + `/doctor prompt-audit` |
| 2 | Cursor | IDE agent | the Memories deprecation — invisible memory loses to file rules |
| 3 | Windsurf (Codeium/Cognition) | IDE agent | memory + rules panel, per-workspace isolation |
| 4 | Gemini CLI (Google) | terminal coding agent | `/memory show` exact-context, Auto Memory review inbox, checkpointing |
| 5 | Codex CLI / AGENTS.md (OpenAI + LF) | terminal agent + interchange format | nested nearest-file memory, 60k+ repo adoption |
| 6 | GitHub Copilot | IDE/PR agent | evidence citations + just-in-time verification, +3%/+4%/+7% A/B numbers |
| 7 | MemOS (MemTensor) | memory operating system | MemCube unification, LoCoMo 75.8 vs Mem0 64.57 |
| 8 | A-MEM (agentic memory) | research memory system | Zettelkasten atomic notes + auto-linking + evolution |
| 9 | HippoRAG 2 (OSU NLP) | research retrieval | KG + Personalized PageRank single-step multi-hop |
| 10 | Supermemory | commercial memory API | temporal truth, auto-forgetting, graph view |
| 11 | OpenMemory (mem0) | local memory server / plugin | detached extraction worker, gated recall injection |

---

## 1 — Claude Code: the memory UX bar the terminal field converges on

Sources: <https://code.claude.com/docs/en/memory> (live, updated 2026-11-10),
the public changelog
<https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md> (live),
<https://code.claude.com/docs/en/errors.md#memory-index-is-over-its-read-limit>,
the Anthropic app memory announcement
<https://www.anthropic.com/news/memory>, and the API memory-tool beta
<https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>.

Architecture: two complementary systems. (a) The **CLAUDE.md hierarchy** —
managed policy → user (`~/.claude/CLAUDE.md`) → project (`./CLAUDE.md` /
`AGENTS.md`) → local (`CLAUDE.local.md`), plus path-scoped `.claude/rules/`
and `@path` imports. (b) **Auto memory** (agent-written, v2.1.32: "Claude now
automatically records and recalls memories as it works") — a `MEMORY.md`
index plus one topic file per memory under
`~/.claude/projects/<project>/memory/`, with typed frontmatter categories
(`user`, `feedback`, `project`, `reference`), skipping anything derivable
from the codebase or already stated in CLAUDE.md. Injection is bounded: only
the first **200 lines / 25 KB of the index** enter the session; topic files
are read on demand.

What users see — the evidence that matters for this round:

- Literal session lines **"Saved 2 memories"** and **"Recalled 2 memories"**,
  iterated at least four times in the changelog (the notice, then clickable
  filenames in v2.1.86, then a verbose file list in v2.1.181). This is the
  single most-iterated memory-UX element in any shipping agent.
- **`/memory`** — a picker over every memory file across scopes (including
  not-yet-created ones), an auto-memory on/off toggle, and "open memory
  folder".
- **`/context`** — proves what actually loaded ("Memory files" section): the
  debugging answer to "is my memory even being seen?".
- **`/doctor prompt-audit`** (v2.1.283+) — audits CLAUDE.md/rules/skills for
  stale, contradictory or dead-reference instructions; proposes edits,
  changes nothing until approved.
- Per-memory **`modified` frontmatter timestamps** (v2.1.75) "helping Claude
  reason about which memories are fresh vs. stale".
- An over-index write fails loudly with a **rewrite instruction** (v2.1.210+:
  silent truncation → explicit error naming the cut and how to fix it).

Edge cases they handle: stale-index-after-compaction (v2.1.311), prompt
injection neutralized in recalled notes (v2.1.284 — invisible characters and
markup imitating Claude Code's own UI), auto-memory default-off in
background/nested sessions (can be turned off but never on there),
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, external-import approval dialogs,
plaintext-at-rest as the known security complaint
(<https://news.ycombinator.com/item?id=47708277>).

## 2 — Cursor: the deprecation is the data point

Sources: <https://cursor.com/docs/rules> and
<https://cursor.com/docs/llms.txt> (live), the archived Memories page
<http://web.archive.org/web/20250703061613/https://docs.cursor.com/context/memories>
(verified to exist via the Wayback availability API; content re-read from the
snapshot).

Cursor shipped auto-extracted **Memories** (2024–2025): facts pulled from
chat history, managed under Settings → Features → Memories, injected when
deemed relevant. The live docs index now contains **no Memories page** — the
feature was deprecated in favor of **Rules**: Project Rules
(`.cursor/rules/*.mdc`, version-controlled, frontmatter `description` /
`globs` / `alwaysApply` yielding Always / Auto-attach / **Agent-selected** /
Manual `@mention` modes), User Rules, Team Rules, and AGENTS.md support.
Community reaction to the removal was negative (r/cursor threads missing
auto-learning), and the forum now carries third-party memory products for
Cursor — Mnemolith "flags stale rules"
(<https://forum.cursor.com/t/mnemolith-shared-project-memory-for-cursor-that-flags-stale-rules/177294>),
MemKernel, Recall — direct evidence of unmet demand for durable,
freshness-tracked memory.

The lesson: **invisible, un-auditable auto-memory lost to explicit,
file-based, git-diffable rules.** Users could not see what was remembered,
could not diff it, could not bulk-export it — so the auto-lane died. Whatever
we automate must stay inspectable or it will read as creep, not help.

## 3 — Windsurf: memories as a first-class panel

Source: <https://docs.devin.ai/windsurf/plugins/cascade/memories> (live,
post-acquisition location).

Cascade auto-generates **memories** ("if it encounters context that it
believes is useful to remember"), workspace-scoped — never leaking across
workspaces — with an explicit natural-language trigger ("ask Cascade to
create a memory of …") and **credit-free** memory use. **Rules** are the
manual lane: `global_rules.md` plus `.windsurf/rules/` (glob- or
description-triggered, auto-discovered up to the git root, deduplicated
across multi-root workspaces, **12,000-char cap per file**), and undeletable
admin-owned System rules for enterprises. Users see the **Customizations →
Memories & Rules panel** with per-memory Edit buttons.

Evidence: "Windsurf kept memories a little better than Claude"
(<https://news.ycombinator.com/item?id=47457057>) and the standard-practice
quote "I set memories for it to run the tests too"
(<https://news.ycombinator.com/item?id=43833831>) against "I haven't seen it
make much difference" (<https://news.ycombinator.com/item?id=43598710>) —
again: relevance-based retrieval with no visibility reads as a no-op.

## 4 — Gemini CLI: exact-context debuggability + the review inbox

Sources: <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md>,
<https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/memory.md>,
<https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/auto-memory.md>,
<https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/checkpointing.md>,
<https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/tutorials/memory-management.md>.

Architecture: hierarchical `GEMINI.md` (global → workspace → parents,
configurable filename — it also reads `AGENTS.md`), **just-in-time
discovery** (touching a file loads that directory's context file), a Memory
**tool** that routes new facts to the right tier and refuses duplication
across tiers, and — the direct analog of our pipeline — **Auto Memory**
(experimental): a background service mines **idle** past-session transcripts
(idle ≥ 3 h, ≥ 10 user messages, active/trivial/sub-agent sessions excluded,
cross-instance lock files), drafts memory updates as **unified-diff `.patch`
files** plus `SKILL.md` skills into a **project-local review inbox**, and
can never directly edit active memory files, settings, credentials or the
project GEMINI.md; patches are parsed, target-allowlisted, dry-run and
applied atomically only on approval. Extraction defaults to creating
nothing unless evidence is strong, and redacts secrets.

What users see: the CLI **footer shows the count of loaded context files**;
**`/memory show` prints the exact concatenated context the model receives**;
`/memory reload`; `/memory inbox` (grouped promote/apply/discard dialog);
`/restore` — a **checkpoint picker** over a shadow git repo
(`~/.gemini/history/<project_hash>`, never the user's repo) that restores
files AND conversation AND re-proposes the pending tool call.

## 5 — Codex CLI / AGENTS.md: the interchange format won

Sources: <https://agents.md/> (live), the OpenAI repo's own
`docs/agents_md.md` (the developers.openai.com guide is JS-rendered;
precedence behavior cited from the agents.md spec).

AGENTS.md is "a README for agents": setup commands, code style, test/PR
instructions at the repo root, **nested for monorepos — the nearest file in
the directory tree wins** (OpenAI's own repo carries 88 of them). The
evidence that this beats per-vendor formats (`.cursorrules`, `CLAUDE.md`):
**60k+ open-source projects** use it, and it is supported by Codex, Google
Jules, Gemini CLI, Cursor, Amp, Devin, Factory, Aider, Zed, Warp, VS Code,
Windsurf, JetBrains Junie, RooCode — stewarded by the Agentic AI Foundation
under the Linux Foundation. One file every agent reads beats N files none
agree on. (Unown already reads and imports AGENTS.md — `unown import
--from codex` and the AGENTS.md detection lanes; nothing to take here
beyond confirmation of the convention's gravity.)

## 6 — GitHub Copilot: citations + just-in-time verification, with numbers

Source: the engineering blog
<https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/>
(Jan 2026), the changelogs
<https://github.blog/changelog/2026-01-15-agentic-memory-for-github-copilot-is-in-public-preview>
and <https://github.blog/changelog/2026-05-26-copilot-memory-has-more-controls-for-deletion-scope-and-the-copilot-cli>,
and <https://code.visualstudio.com/updates/v1_109>.

Architecture: cross-agent memory shared by Copilot coding agent, code review
and CLI. Memory creation is a **tool call** (`store_memory`) the agent makes
when it discovers something actionable; each memory is stored **with
citations — references to the specific code locations that support it**.
GitHub explicitly rejected offline curation in favor of **just-in-time
verification**: before using a memory the agent verifies its citations
against the current branch; contradicting code makes the agent store a
corrected memory, and a validated memory is **re-stored to refresh its
timestamp**. Memories **expire after 28 days** unless refreshed.

Proven better (A/B): **+3% precision and +4% recall** for code review,
**+7% pull-request merge rate** for the coding agent; adversarially seeded
contradictory/malicious memories with bogus citations were consistently
detected, contradicted and the pool **self-healed**. UX surfaces: opt-in →
default-on rollout, a settings page ranking memories by usefulness with
delete + voting, `store_memory` permission prompts stating user-level vs
repository-level scope, `/memory on|off|show` in Copilot CLI, repo-admin
kill switch. (The "memories as chat pills" detail could not be re-verified
in current public docs — treated as unconfirmed.)

## 7 — MemOS (MemTensor): memory as a managed resource

Sources: <https://arxiv.org/abs/2507.03724>, <https://github.com/MemTensor/MemOS>.

The MemCube unifies plaintext, **activation (KV-cache)** and **parameter
(LoRA)** memory behind one add/retrieve/edit/delete API over an inspectable,
editable memory graph, with an async MemScheduler (millisecond ingestion
under concurrency), provenance/versioned cubes, hybrid FTS5+vector retrieval
and tiered L1 traces / L2 policies / L3 world models. Paper numbers
(GPT-4o-mini backbone): LoCoMo overall J **75.80 vs Mem0 64.57 / Zep 59.22**;
PersonaMem **77.2 vs Mem0 65.9 / Zep 40.7** with fewer context tokens; repo
claims (2026) LoCoMo 88.83 and LongMemEval 89.20. Ships a local **Memory
Viewer dashboard** — the visual surface our round's dashboard lane takes
inspiration from. Deep-change lane: noted as future direction, not this
round.

## 8 — A-MEM: Zettelkasten notes that evolve

Sources: <https://arxiv.org/abs/2502.12110>, <https://github.com/agiresearch/A-mem>.

Every memory is an **atomic note** with contextual attributes and keywords;
on insertion the system analyzes historical notes, **auto-establishes
links**, and performs **memory evolution** — new notes update the contextual
representations of existing linked notes, so the network self-refines.
NeurIPS 2025; DialSim F1 **3.45 vs LoCoMo-system 2.55 (+35%) and MemGPT
1.18 (+192%)** across six foundation models; multi-hop ROUGE-L 27.23 vs
4.68; 5.4 s/note on GPT-4o-mini, 1.1 s on a local Llama-3.2-1B. Our
platform's reconcile UPDATE lane is a first-order version of evolution;
explicit note-linking is a future lane (the `linked_memory_ids` supersede
graph already exists as its substrate).

## 9 — HippoRAG 2: single-step multi-hop retrieval

Sources: <https://arxiv.org/abs/2502.14802>, <https://github.com/OSU-NLP-Group/HippoRAG>.

Offline OpenIE builds a knowledge graph with merged concept nodes; online,
query entities select seeds and **Personalized PageRank** spreads activation
so multi-hop retrieval completes in one step. ICML 2025: **+7% associative
memory over the SOTA embedding model**; vs NV-Embed-v2 **+9.5% F1 on
2Wiki**, Recall@5 **+5.0% MuSiQue / +13.9% 2Wiki**; query-to-triple linking
+12.5% Recall@5 over NER-to-node. Deep-change lane for a future round
(building a link graph over memories and spreading activation over it — the
natural extension of A-MEM's links).

## 10 — Supermemory: temporal truth + forgetting as products

Sources: <https://docs.supermemory.ai/>, <https://supermemory.ai/docs/concepts/how-it-works.md>,
<https://supermemory.ai/docs/concepts/graph-memory.md>,
<https://supermemory.ai/docs/agents-and-mcp.md>.

A commercial memory API separating **documents** (raw input, RAG layer) from
**memories** (extracted facts on a temporal vector-graph with **temporal
truth and automatic forgetting** — "how facts connect, update and stay
true"), multi-tenant namespaces, a `dreaming: "instant"` async mode, a graph
view UI, an `npx supermemory` CLI, and MCP servers for Claude/Cursor.
Quality claims are commercial (benchmarked in MemOS's OmniMemEval); the
architectural lesson that survives: supersession and forgetting are
first-class, visible operations, not silent deletions.

## 11 — OpenMemory (mem0): the detached-worker + gated recall pattern

Sources: <https://docs.mem0.ai/integrations/claude-code>,
<https://docs.mem0.ai/open-source/setup>, <https://github.com/mem0ai/openmemory>.

The mem0 Claude Code plugin captures evidence **locally** through lifecycle
hooks (user messages, answers, changed files, test/build results);
**extraction runs in a detached background worker**; **recall happens before
the first response** — an opening prompt ≥ 20 chars triggers a search that
injects **up to five** memories; `/mem0:search` takes `--top-k`,
`--category`, `--scope repo|dir|mine`. (The `mem0ai/openmemory` repo itself
has since pivoted to a cross-harness session-sync tool.) The pattern set —
detached consolidation, prompt-gated bounded recall — is what our pipeline
already does; the concrete gates (≥20-char prompt, ≤5 memories) are useful
calibration points.

---

## The ranked patterns → what this round ships

Ranked by (evidence strength × fit to a terminal-first agent with a detached
memory engine × cost). CP references are the round's checkpoints.

| # | Pattern | Who proves it | This round |
|---|---|---|---|
| 1 | **Session-start recall line** — "Recalled N memories" as a one-time info line, because healthy-state footers are silent | Claude Code (4 changelog iterations) | CP3 |
| 2 | **Freshness timestamps on every memory** (modified dates the agent reasons with) + visible staleness | Claude Code v2.1.75; Copilot 28-day TTL | CP2 |
| 3 | **Exact-context command** — `/memory show` prints what the model actually receives | Gemini CLI `/memory show`; Claude Code `/context` | CP3 |
| 4 | **Visible memory audit** — the health card (dupes, conflicts, reconcile recency) surfaced, not just API-deep | Claude Code `/doctor prompt-audit`; MemOS Memory Viewer | CP4 |
| 5 | **Timestamp refresh on re-assertion** — a memory re-confirmed by new evidence gets a new date (decay without deletion) | Copilot re-store-on-verify | CP2 (falls out of the reconcile UPDATE lane) |
| 6 | Inspectable memory files + versioned diff/rollback (already shipped: dashboard M11, `b` rollback) | Cursor deprecation lesson; Gemini checkpointing | done prior |
| 7 | Review-inbox for auto-memory (already shipped: pending-dream park/approve/discard lane) | Gemini Auto Memory inbox | done prior |
| 8 | Typed categories + anti-duplication vs derivable facts (already shipped: kind lanes, conventions/abstention bans) | Claude Code categories | done prior |
| 9 | **Evidence citations per memory + JIT verification loop** (agent verifies cited code before asserting; disagreement becomes a repair note) | Copilot +3%/+4%/+7% | CP2 partial: the guide already mandates verify-before-assert; per-fact citation metadata is a future lane (needs an extraction-contract change) |
| 10 | A-MEM note linking + evolution; HippoRAG PPR retrieval; MemOS MemCube unification | research numbers above | future rounds (deep) |

The honest gaps we are NOT shipping this round, and why: per-fact citation
metadata (an LLM extraction-contract change that deserves its own
benchtested round — the Recital round's method), PPR/graph retrieval (deep),
and activation/parameter memory (out of scope for a markdown-tier agent).
