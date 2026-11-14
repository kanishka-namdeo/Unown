# Teardown 2026-11-15 — eight memory systems, the evidence-chain round

> The fifth teardown in the memory lineage (Recital: five platforms; Encore:
> eleven products; the Divertimento new-wave: five platforms + the papers
> sweep). This round covered the systems none of those reached — and the one
> pattern every one of them validates that Unown lacked: **the provenance
> chain from a distilled rule back to the raw session note that produced
> it.** Every claim sourced; `[V]` = verified in fetched source/docs/repo,
> `[C]` = vendor-claimed, `[U]` = inference. Companion: the round's session
> log (`memory-nocturne-round-session.md`) · [memory.md](memory.md).

| # | System | What it is | The pattern this round takes from it |
|---|---|---|---|
| 1 | Mastra (`@mastra/memory`) | the TS agent framework's four-subsystem memory (1.65M weekly downloads) | summaries as durable pointers + recall tool back to raw history; merge-semantics write guardrails |
| 2 | Letta (letta-code, 2026) | git-backed MemFS + dreaming subagents (323k monthly downloads) | provenance lives in the commit record, never the rendered line; compaction-event trigger; one dream identity |
| 3 | MemoryMesh | schema-driven knowledge-graph MCP server | all-or-nothing write validation with actionable errors |
| 4 | mcp-memory-service | detached SQLite+vec memory service (2.1k★) | needs-review band + superseded-but-retrievable; the #1460 auto-supersede lesson |
| 5 | Basic Memory | markdown knowledge base (4.6k★, 60k monthly downloads) | markdown-as-source-of-truth at adoption scale; checksum-guarded writes |
| 6 | Mnemos | neuroscience-modeled continuity MCP (★164, Oct 2026) | the three-measure state model; gist-before-archive; **the ablation that motivated this round** |
| 7 | oh-my-pi (omp) | 39k★ coding agent with curated memory | explicit invalidate-by-id; lesson→skill promotion |
| 8 | LangGraph Store | cross-thread namespace store in the most-deployed agent framework | background memory formation as the documented first-class pattern |

Plus the papers sweep (post-2026-11-01): WikiTrace [2611.14320], MAPE
[2611.17068], FGSE [2611.14326], MemCredit [2611.15600], Task-Conditioned
Utility [2611.03930], SoMem [2611.11929], Anchor [2611.10382], Hidden Costs
of Forgetting [2610.35496], MemoryDojo [2611.09721], model-transition
[2611.10628].

## The finding that set the round's scope

**WikiTrace** ([arXiv 2611.14320](https://arxiv.org/abs/2611.14320)) [V]:
linking each learned lesson → its trajectory summary → the raw trajectory,
and letting the agent descend those links to self-correct before acting,
**reduces memory-induced degradation across five benchmarks**. **MAPE**
([2611.17068](https://arxiv.org/abs/2611.17068)) [V]: program-evolved memory
designs with up to +12% accuracy at 35% cost share two patterns — retaining
raw conversations as retrievable evidence, and query-time composition.
**Task-Conditioned Utility** ([2611.03930](https://arxiv.org/abs/2611.03930))
[V]: raw memories beat task-blind summaries on answer-bearing pairs (+0.33
paired reward). **Zep/Graphiti** (covered in the Recital teardown) built
episodes as raw-data provenance — "every derived fact traces back to its
source" [V]. **Mnemos**'s own blind ablation [V]: the same memories saved as
plain searchable files scored 43% vs the product's 42% — the value is in
*keeping, waking, and linking*, not the storage engine.

**Unown had the raw material all along** — notes are archived in the engine
DB, `markDreamed` ties them to their dream — but nothing let a user or the
agent descend from a RULE to the note that produced it. That gap is this
round's evidence lane.

## 1 — Mastra: the four-subsystem memory, read from source

Sparse-cloned at `ca59cc1` (2026-11-14); `@mastra/memory` **1,646,580
downloads last week** [V npm API]. Four subsystems: message history (token
budget with a monotonic boundary cursor), semantic recall (topK 4,
messageRange {1,1} — LongMemEval-tuned [V changelog #9046]), working memory
(per-resource LLM-editable scratchpad), and **Observational Memory** — the
flagship: an Observer agent distills raw messages into dated, priority-tagged
observations once past 30k tokens; a Reflector rewrites the log past 40k with
an escalating compression ladder (levels 0–4, `validateCompression` rejects
non-shrinking output, `detectDegenerateRepetition` catches loops) [V].

**What they do better (validated by their own issue record):**
- **Summaries as durable pointers + a recall tool that pages raw history**
  (`om-tools.ts`): every observation group keeps `_range: startId:endId`;
  the `recall` tool pages raw messages (low → high detail → char offsets),
  and the prompt teaches "Reflections are lossy… a missing search hit is not
  evidence that an event did not happen" [V]. Their own BEAM audit found
  **620 stranded chunks** where reflections lost details that appear nowhere
  else [V ARCHITECTURE.md] — the exact failure the pointer chain prevents.
- **Merge-semantics write guardrails** (PR #10659, fixing user-reported data
  loss #7775): deep-merge updates, `null` = delete, arrays replace whole,
  provider-padded nulls stripped, and an **empty-template overwrite is
  refused** ("Update skipped to prevent data loss") [V].
- **In-flight-turn protection** (#25372, open): a consolidation pass must
  never consume the active session's own request — users watched their
  request vanish mid-run [V].

**What Unown does better:** deterministic SRO supersession vs Mastra's
prompt-only contradiction handling (their audit's 620 stranded chunks and
#25372 are the receipts); freshness stamps and dormancy have **no Mastra
equivalent** [V absence]; the detached engine keeps consolidation off the
session path (Mastra's in-process OM measured **2–4s per agent step** in
#15677 and ~2.94s per model call in #27319) [V].

## 2 — Letta 2026: MemFS, dreaming, and the provenance discipline

The V1 sleep-time-agent architecture (two agents sharing memory blocks,
`rethink_memory` tools, arXiv 2504.13171) was retired to an `archive` branch
in Aug 2026 [V]; today Letta = **letta-code** (npm 323,044 downloads/month,
417 releases [V]) with a git-backed memory filesystem: root files compile
into the system prompt every turn; directories with their own `MEMORY.md`
are deferred until opened; no vector index by default (grep/read) [V docs].

**What they do better:**
- **Provenance lives in the commit record, never the rendered line** [V
  `maintaining-core-memory/SKILL.md`]: memory files state only the rule;
  the git commit carries the evidence — subject `memory(<origin>): <learning>`,
  body tells the story, `Sources:` lists conversation ids; "Git dates the
  commit, not the event — so write the event date."
- **Compaction-event trigger**: dreaming fires on `step-count` (default 25),
  manual, or **`compaction-event`** — dream exactly when the conversation is
  about to be summarized and information lost [V docs].
- **Two-phase proposal→review→merge** (`reflectionMerge: "explicit"`): the
  proposer works in a git worktree; a second pass reviews for accuracy and
  placement, merges, never touches unrelated uncommitted state [V].

**What Unown does better:** deterministic enforcement (Letta's "resolve
contradictions in favor of the latest evidence" is a prompt instruction; no
freshness concept at all; no dormancy); the canary gate and fresh-evidence
protection have no Letta counterpart [V].

## 3 — MemoryMesh: schema-constrained writes at niche scale

`CheMiguel23/MemoryMesh`, 355★, 10 issues total (all closed) [V]. Typed
nodes/edges validated against user-provided JSON schemas; every mutating
call is **all-or-nothing** (v0.4.0 fixed #35: partial saves on failed
validation); enum violations list allowed values; corrupt JSONL lines are a
hard error with the line number [V]. **The verdict for Unown:** strict
schemas are a differentiator, not a foundation — the two high-adoption
systems in this teardown (Basic Memory, mcp-memory-service) both chose free
text + light conventions + optional schema layers later [V]. MemoryMesh's
*validation discipline* (all-or-nothing, actionable errors) is the take.

## 4 — mcp-memory-service: the needs-review band and the #1460 lesson

`doobidoo/mcp-memory-service`, 2,127★, 348 releases/year [V]. A detached
HTTP service with FTS5-trigram + sqlite-vec hybrid search (RRF fusion,
consensus boost), usage-based decay (access counts feed a 0.6/0.2/0.1/0.1
semantic/recency/access/quality rank), and a non-destructive forgetting
engine (archive with reasons; deletion only for duplicates and expired
temporaries) [V].

**The #1460 saga (16 comments, open)** [V]: keyword-regex contradiction
detection + auto-supersede **defaulted on** wrongly retired ~⅓ of neutral
pairs on a real 150-pair store — tried similarity bands (0.40–0.75), a
3-class NLI veto, a bidirectional 4-way rule, a fine-tuned 4-way head
(0.975 val accuracy): **every approach wrongly retired 33–50% of neutrals**.
An LLM asked the right question ("now that B exists, should A disappear
from search?") wrongly retired only 2–4/144. Their conclusions, now shipped:
`MCP_CONSOLIDATION_AUTO_SUPERSEDE` defaults **false**; genuine contradictions
become `contradicts` + `needs_review` edges; **recency is computed in code,
never by the model** [V]. Unown's deterministic SRO pass already embodies
the strong form (the research-grade rule from MemStrata); the adoptable
nuance is the *needs-review band* — retained, badged, searchable — as the
destination for anything the deterministic pass should not decide alone.

## 5 — Basic Memory: markdown-as-source-of-truth at adoption scale

`basicmachines-co/basic-memory`, 4,573★, ~59,910 downloads/month, AGPL-3.0
[V]. Notes are markdown entities; SQLite is a **derived index** ("Files are
the source of truth" [V NOTE-FORMAT.md]). Picoschema: schemas are just notes
with `type: schema` — infer/validate/diff, never a write gate [V].
**Authored valid-time** (SPEC-82): observations carry temporal range
literals (`[2026-06-10,2026-07-27)`), fixed-width lexical, "yesterday"
refused [V]. Optimistic concurrency via `expected_checksum` → typed
`REVISION_CONFLICT`; v1.0 removed format-on-save because post-write
reformatting manufactured phantom sync conflicts [V]. The cost center:
**54 issues with "sync" in the title** [V] — the bidirectional-sync tax.

## 6 — Mnemos: the ablation that motivated this round

`Riley-Coyote/mnemos-mcp`, ★164, created 2026-10-27 [V]. Engrams with three
separate measures — `strength` (storage), `stability` (resistance to
fading), `accessibility` (reachability now) — decay every 4h, slower when
settled+linked; **fading never deletes** (quiet → archive; recall revives);
reconsolidation strengthens on recall; when an experience fades below
threshold the agent is asked **what it taught** — the lesson outlives the
details [V]. Blind-judged vs Claude Code's CLAUDE.md+memory folder over
3 months: 65% vs 35%; the stacked config reached 58% [V README]. **The
ablation**: the same memories as plain searchable files scored 43% vs 42% —
their own conclusion is that the product's value is keeping/waking/linking
[V]. The memory card with correct/let-go buttons is the most expressive
memory-state UI in the field [V].

## 7 — oh-my-pi (omp): 39k stars, memory the agent curates

`can1357/oh-my-pi`, ★39,032 [V]. Tools `retain` (facts), `learn` (reusable
lessons, promotable into managed skills), `recall`, `reflect`, and
`memory_edit` — **update, forget, or invalidate stored memories by id**
[V README §13]. Session summaries compress into a "mental model" that loads
on the next session's first turn; memory tools are **setting-gated, off by
default** [V]. The take: explicit invalidation semantics (Unown's
`supersededBy` is the same law) and the lesson→skill promotion path.

## 8 — LangGraph Store: background memory as documented orthodoxy

`langchain-ai/langgraph`, ★44,967 [V]. Long-term memory = JSON documents in
a Store addressed by namespace + key; cross-thread recall; the docs name the
**hot-path vs background** write tradeoff explicitly and cite ChatGPT's
`save_memories` as the hot-path example [V docs]. Validation for Unown's
detached-engine bet: the most-deployed agent framework documents the
background lane as the first-class pattern.

## The papers (post-2026-11-01, measured results only)

| Paper | Result this round used |
|---|---|
| WikiTrace [2611.14320] | lesson→summary→raw links cut memory-induced degradation across 5 benchmarks |
| MAPE [2611.17068] | retain raw conversations as retrievable evidence: +12% @ 35% cost |
| Task-Conditioned Utility [2611.03930] | raw memories beat task-blind summaries (+0.33 paired reward) |
| FGSE [2611.14326] | lessons as hypotheses, trial-then-commit: harmful updates 3.6% |
| MemCredit [2611.15600] | utility-ranked selection beats BM25 86.6 vs 65.7 SR@50 under budget |
| Hidden Costs of Forgetting [2610.35496] | delayed deletion preserves effectiveness; 0/42 deletion configs cut cost |
| MemoryDojo [2611.09721] | all 5 tested memory systems susceptible to poisoning — quarantine stays load-bearing |
| Model transition [2611.10628] | memory export/import across model swaps needs action-level testing, verbal checks miss drift |

## What this round shipped (the ranked patterns, adopted)

1. **The evidence lane** (from 1–8 + WikiTrace/MAPE/Zep): every memory a
   dream extracts links back to its note batch — dream id + note ids +
   first-line excerpts — in a per-scope side record (`memory-evidence.ts`).
   Batch-level attribution (extraction is ONE call per batch — the honest
   unit); pointers never enter the rendered tier (Letta's placement law);
   bounded (1000 entries/scope, 12 notes/entry, 96-char excerpts); grows by
   extraction, never retroactively.
2. **The evidence surfaces**: the health card's `evidenceLinkedCount`
   (dashboard memory screen + `unown doctor`'s store line), the doctor's
   evidence-coverage finding, the dream note's ", N evidence-linked"
   fragment, and per-record evidence in `unown memory export` — sanitized
   on import (provenance-only, never auto-written).
3. **The #48 cure** (repo-intelligence lane): `specSourceLabel` is total by
   construction; sidecar records with foreign `source` values coerce to
   `unknown` + `unknownSource` and render honestly.

Sources (all fetched 2026-11-14/15): mastra-ai/mastra @ `ca59cc1` (sparse
clone: `packages/memory/src/**`, `packages/core/src/processors/memory/**`,
`docs/src/content/en/docs/memory/**`; npm downloads API; issues #7775,
#15677, #25372, #26129, #27319, PRs #9046, #10659) · letta-ai/letta-code @
main + letta-ai/letta @ `archive` (cloned; docs.letta.com configuration/
concepts/agent-sdk pages; letta.com blog posts; arXiv 2504.13171) ·
CheMiguel23/MemoryMesh (source tarball + issues #35, #41) ·
doobidoo/mcp-memory-service (source tarball; issue #1460 full thread;
PyPI/pypistats) · basicmachines-co/basic-memory (source tarball;
NOTE-FORMAT.md; issue search) · Riley-Coyote/mnemos-mcp (README + docs) ·
can1357/oh-my-pi (README) · docs.langchain.com/oss/python/langgraph/memory ·
arXiv 2611.14320, 2611.17068, 2611.03930, 2611.14326, 2611.15600,
2610.35496, 2611.09721, 2611.10628.
