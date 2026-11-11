# TEARDOWN 2026-11-11 — five memory systems, reverse-engineered against the Recital benchtest findings

> The Memory Recital round's reverse-engineering deliverable: five products
> (Mem0 v3, Zep/Graphiti, Letta MemFS, Cognee, LangChain-LangMem +
> LlamaIndex) torn down from primary sources (GitHub READMEs, docs pages,
> papers — the URL appendix at the end), each scored against the two live
> bugs the round's real-user benchtest found in Unown's learning loop, plus
> the benchmark-methodology lessons the LoCoMo audit forces on any "as a
> real user" evaluation.

## The benchtest findings this teardown must answer (2026-11-11, live receipts in `benchmarks/memory-recital/`)

Driven as a real user through 3 complex sessions (debug a planted CSV
parser defect → knowledge update: strict ISO date validation + auto-sizing
→ REVERSAL: relax the date rule, state a comment-style preference, record
a dated switch), the loop scored:

| Probe | Warm (memory injected) | Cold (fresh clone, no `.unown/`) | Verdict |
|---|---|---|---|
| T1 temporal (when did auto-sizing land) | ✅ 2026-11-05 | ✅ honest abstention | memory lift works |
| T2 history (why the parser rewrite) | ✅ correct | ✅ honest abstention | works |
| T3 knowledge-update (current date rule) | ❌ "no information" | ❌ **hallucinated a confident answer** | **BUG 1** |
| T4 preference (comment style) | ❌ "not in memory" | ❌ abstains | **BUG 2** |
| T5 abstention (benchmark vs?) | ✅ honest abstention | ✅ honest abstention | works |

- **BUG 1 (reconcile deletes fresh evidence):** the extraction DID extract
  the relaxed date rule (`ce8b3d78…` in the mem0 event stream); the
  reconcile pass then deleted the OLD strict rule (correct) AND the NEW
  current-state carrier (wrong) — the final list states nothing about
  date validation, the single most consequential contract in the project.
- **BUG 2 (preferences dropped at extraction):** the comment-style
  requirement — stated, applied, and verified in-session — never became a
  memory; the extraction prompt's "engineering knowledge" framing has no
  lane for a user-stated convention.

Both are exactly the failure classes the industry has already engineered
answers for. Below: per product, what they do, and what Unown should take.

---

## 1. Mem0 v3 — ADD-only extraction + Dream consolidation (the direct competitor for AutoDream)

**Architecture (April 2026 "token-efficient memory" algorithm):** vector
DB + native entity graph + SQL append-log. Extraction runs asynchronously
after the agent responds: single-pass distillation producing **ADD-only
facts** — *nothing is ever overwritten or deleted during extraction*.
Conflicts are resolved at read time and by the background **Dream** pass:
Supersede (contradiction → old fact marked superseded, linked to its
replacer, retained), Merge (near-duplicates fold into one canonical),
Synthesis (≥20 memories distill into pattern memories, scheduled, slow).
Decay is a **0.3–1.5× ranking multiplier from access history — never a
filter**. Retrieval fuses four signals: semantic + BM25 + entity boost +
temporal (query's temporal intent classified without an LLM call, then an
additive boost toward the right dated instance). Injection target ~7K
tokens. Numbers: LoCoMo 92.5, LongMemEval 94.4 (self-reported, with an
open eval harness).

**Why they moved off in-line conflict resolution:** v2's ADD/UPDATE/DELETE
LLM decisions mid-write cost them +21 LoCoMo points when replaced by
ADD-only + background resolution — the exact same insight Cognee and Zep
built on.

**Against Unown's BUG 1:** Mem0's Dream Supersede marks the OLD fact
superseded and links the new one to it — the winner is protected by
construction because the new fact was never deletable at write time. The
lesson Unown needs: **fresh evidence must be un-deletable in the pass
that created it.** Unown's reconcile runs in the same dream that added
the fresh evidence, so a verdict that targets BOTH sides of a
contradiction kills the topic outright.

**Against Unown's BUG 2:** Mem0's extraction taxonomy includes preference
as a first-class memory type (event/state/plan/preference/relationship/
absence). Unown's project-scope instructions frame extraction as
"engineering knowledge" with no preference lane — yet a repo-scoped style
convention IS durable project knowledge.

**Take:** (a) protect fresh-batch memories from DELETE in the same dream's
reconcile; (b) explicit preference/convention extraction lane; (c) the
temporal write-time metadata + read-time additive boost pattern (Unown's
lexical backend can carry the date-string boost deterministically);
(d) decay-as-multiplier if a ranking layer ever lands.

## 2. Zep / Graphiti — the bi-temporal model (the cleanest conflict contract)

**Architecture:** a context graph of Entities (summaries that evolve),
Facts (typed edges with **temporal validity windows**), Episodes (raw
ingested provenance), Custom Types. Two time axes per fact: event time
(`valid_at`/`invalid_at` — when it became true in the world) and system
time (`created_at`/`expired_at` — when the graph learned/expired it).
Contradiction = **automatic fact invalidation**: old facts expire, never
delete — "what was true at any point in time" stays queryable. Ingestion
incremental per episode; retrieval hybrid (semantic + BM25 + graph
traversal) + cross-encoder rerank. Paper: DMR 94.8%, LongMemEval +18.5%
with −90% latency.

**Against BUG 1:** Zep cannot delete the winner because invalidation is
the only contradiction move — the fresh fact invalidates the old one,
which stays as history. Unown's event stream (mem0 history table) already
has the raw material for a bi-temporal view: `createdAt`/`updatedAt`
exist per memory; what it lacks is the **supersede marker** so renders
can distinguish "current" from "history" instead of dropping the loser
outright.

**Take:** when the reconcile pass retires a superseded rule, prefer
Mem0-style Supersede (keep, marked, linked) over hard DELETE for
rule-kind memories; the temporal probe (T1) shows Unown already renders
dated markers correctly when the UPDATE text carries them — make that
reliable rather than lucky. (Hard DELETE stays right for
transient-status pruning and guard-sweep poison.)

## 3. Letta / MemFS — memory as a git repo + sleep-time compute (the architecture kin)

**Architecture:** agent memory is a **git repository** the agent owns:
root files (persona, project facts) compiled into the system prompt every
turn; each directory carries a `MEMORY.md` signpost index (root index
lists directories; names are the retrieval cues); no vector index by
default — the agent greps/reads its own memory. Consolidation is
**dreaming subagents** triggered by step-count or compaction events,
editing memory in **git worktrees** so memory edits never block the live
agent; every edit is a commit — revert is `git revert`. The sleep-time
compute paper (arXiv 2504.13171): ~5× test-time compute reduction at
equal accuracy, +13–18% from scaling sleep-time compute. RecoveryBench:
evaluate a fresh agent AND an agent with lived experience — agent changes
must clear both.

**Against BUG 1:** Letta's dreaming agent edits memory with the same
self-edit discipline as the primary agent — and git history means a bad
dream is recoverable by construction. Unown already versions every dream
(engine tiers + `project:<slug>` synthetic tiers, one-key rollback in the
dashboard) — the gap is that a bad dream is only *recoverable*, not
*prevented*: nothing gates a reconcile verdict that deletes fresh
evidence.

**Take:** (a) the worktree pattern maps to Unown's existing
`--worktree` machinery — a candidate lane for concurrent
dream-while-session editing later; (b) **RecoveryBench is the benchtest
shape this round formalizes** (fresh-vs-experienced is exactly the
warm/cold arm pair); (c) the signpost pattern — Unown's render sections
(`## Workflow`, `## Known pitfalls`) are the same bet, keep them.

## 4. Cognee — the 9-stage improve() pipeline (the consolidation discipline)

**Architecture:** `remember`/`recall`/`improve`/`forget` operations; the
`improve()` pipeline runs 9 fixed stages
(feedback-weights → persist-session-qa → persist-agent-traces →
extract-agent-context → distill-sessions → update-user-preferences →
build-truth-subspace → review-conflicts → global-context-index) with:
**watermarks** (each entry consolidated exactly once), **curator/writer
gates** (a curator proposes lessons; a writer/rejecter validates against
existing lessons before acceptance; confidence + harmfulness gates),
**batch caps**, and **budget-exhaustion = skip-not-fail** (stages skip
with reasons; nothing is marked covered; the run resumes cleanly later).
Conflict review consults the documents and dates facts came from, and
emits `current`/`superseded`/`conflicting` marks that surface in search.
Feedback weights (default 0.5) ride nodes used during retrieval, move
with answer ratings, and **persist across re-ingestion**.

**Against BUG 1:** Cognee's conflict review is *evidence-consulting* — it
reads where each fact came from before deciding. Unown's reconcile sees
only the memory list with an `updated=` stamp; it cannot tell "this
memory was born 60 s ago from the note that supersedes the other one"
from "this memory is stale junk". The **watermark idea is the direct
fix**: fresh memories are this round's un-consolidated input — they
survive to the next pass by design.

**Against BUG 2:** Cognee has an explicit `update-user-preferences`
STAGE — a whole stage for exactly the memory kind Unown drops.

**Take:** (a) fresh-evidence protection = Cognee's watermark applied to
the reconcile pass (deterministic, not prompt-borne); (b) the
curator/writer two-step is the candidate upgrade for the reconcile LLM
(a proposing pass + a validating pass) — filed as a future lane, the
deterministic guard first; (c) per-stage honest skip-reporting is
already Unown's `no-change` discipline — extend it to rejected
fresh-deletes (the dream note should say what was protected).

## 5. LangChain/LangGraph + LangMem + LlamaIndex Memory — the abstraction layer (the taxonomy)

**LangGraph:** two-tier (short-term thread state + long-term Store:
namespace+key JSON docs with a vector index), memory taxonomy from CoALA
— **semantic (facts) / episodic (experiences → few-shot examples) /
procedural (instructions → self-rewriting system prompts)**; two write
timings — **hot path** (agent decides, adds latency, transparent like
ChatGPT's save-memories) vs **background** (memory-service on
scheduling/cron/manual triggers — Unown's exact shape). Two storage
shapes: **Profile** (one continuously-updated document; error-prone as it
grows) vs **Collection** (narrow scoped items; easier generation, higher
recall, complexity shifts to dedup/update) — Unown's atomic-memories
render is a Collection + a rendered Profile hybrid; the lesson is to
keep the atomic layer authoritative (it already is).

**LlamaIndex:** FIFO message memory with `token_limit` 30K and
`chat_history_token_ratio` 0.7 — when history crosses the ratio, the
oldest `token_flush_size` tokens **flush into long-term blocks**;
MemoryBlocks carry **priority** (0 = never truncated; higher = truncated
first); injection is XML-tagged into the system message.

**Take:** (a) the CoALA taxonomy is the vocabulary for the preference
fix — a user-stated convention is *procedural memory* (an instruction),
not a fact; Unown's render already has the section for it (convention
bullets) — the extraction prompt needs to name it; (b) hard token
budgets with priority-based truncation is what `budget.ts` already does
(48k/tier, 80k total) — the LlamaIndex refinement worth stealing is a
"never truncate" priority class for policy-tier and provenance
(Non-negotiables first); (c) hot-path vs background write timing is the
mid-session `note` tool's justification — it exists, it works (the T1
temporal fact proves it), keep it.

## The benchmark-methodology teardown (LoCoMo audit + LongMemEval — what "as a real user" must mean)

- **The LoCoMo audit (dial481/locomo-audit):** 6.4% of gold answers
  wrong; the standard LLM judge accepts 62.81% of deliberately
  vague-but-topical WRONG answers; category sizes make most adjacent
  comparisons statistically indistinguishable; the 446 adversarial
  questions were never evaluated by anyone; one system scored above the
  dataset's mathematical ceiling. **Lesson: judge-free matching (Unown's
  existing choice) + honest-abstention scoring + per-question receipts
  is the defensible lane — do not adopt an LLM judge for the recital
  suite.**
- **LongMemEval's five abilities:** information extraction, multi-session
  reasoning, temporal reasoning, knowledge updates, **abstention**. The
  recital battery covers all five with real sessions (T1 temporal, T2
  multi-hop history, T3 knowledge-update, T4 preference, T5 abstention).
- **The contamination lesson (this round's own finding):** QA sessions
  write exit notes that re-enter the learning loop — a benchtest that
  re-queries the same memory bank after its own QA notes are dreamed
  measures recall of the QA ANSWERS, not of the original facts. The
  recital harness must keep QA arms note-free (dead-engine-URL → outbox
  lane), which is also the outbox-resilience test.
- **The cold-arm lesson:** the cold arm hallucinated a confident answer
  to T3 where the warm arm honestly abstained. A cold arm that invents
  facts makes warm-arm abstention look like a FAILURE on raw scores —
  score abstention questions on honesty, not exact-match.

## What this teardown changes (the picks)

1. **FIX BUG 1 (this round):** deterministic fresh-evidence protection in
   `reconcileMemories` — DELETE ops on memories born in the current
   dream's batch are rejected; merge-into-the-newest preferred. Mem0's
   ADD-only + Cognee's watermark + Zep's invalidation-only all converge
   on the same invariant; Unown gets it as a guard, not a prompt plea.
2. **FIX BUG 2 (this round):** the extraction instructions gain an
   explicit convention/preference lane (procedural memory in CoALA's
   vocabulary); render sections unchanged.
3. **Tighten the reconcile prompt's history discipline:** markers must
   cite only what the memories say (the round's T1 UPDATE invented
   "previously stated as a future switch" — rule-5 wording must ban
   invented history).
4. **The recital benchtest becomes a permanent suite**
   (`benchmarks/memory-recital/`): real-session corpus + warm/cold arms +
   judge-free matching + abstention scoring + receipts — LongMemEval's
   five abilities, driven through the real agent, with the QA arms kept
   note-free.
5. **Filed as future lanes (not this round):** two-step curator/writer
   reconcile; supersede-marked renders (bi-temporal view over the mem0
   history); a ranking layer with Mem0-style temporal boost + decay
   multiplier; feedback weights wired to harness outcomes.

## URL appendix (everything cited)

- Mem0: github.com/mem0ai/mem0 · docs.mem0.ai/core-concepts/how-it-works ·
  /platform/features/dream · /platform/features/memory-decay ·
  mem0.ai/research · github.com/mem0ai/memory-benchmarks ·
  arxiv.org/abs/2504.19413
- Zep/Graphiti: github.com/getzep/graphiti · getzep.com ·
  arxiv.org/abs/2501.13956
- Letta: github.com/letta-ai/letta · docs.letta.com/concepts/memfs ·
  github.com/letta-ai/context-constitution · letta.com/blog/sleep-time-compute ·
  github.com/letta-ai/letta-evals · arxiv.org/abs/2504.13171
- Cognee: github.com/topoteretes/cognee ·
  docs.cognee.ai/core-concepts/main-operations/improve · arxiv.org/abs/2505.24478
- LangChain/LangMem: docs.langchain.com/oss/python/langgraph/memory ·
  github.com/langchain-ai/langmem · LlamaIndex:
  developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory
- LoCoMo audit: github.com/dial481/locomo-audit · LongMemEval:
  github.com/xiaowu0162/LongMemEval · arxiv.org/abs/2410.10813 ·
  BEAM: github.com/mem0ai/memory-benchmarks
