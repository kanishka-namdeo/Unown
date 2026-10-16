# Classifier models in Unown's memory system: an objective evaluation

> Purpose: decide whether non-generative models (classifiers, routers, verifiers,
> neural sequence memories) belong in Unown's tiered memory system, and record the
> evidence so the decision survives AutoDream.
>
> Research and decision note, 2026-10 (refined 2026-10-17). Topic: whether a
> classification or small extraction model — Jev (TypeSafe "System One"), the GLiNER
> family, or a related "head" model — should be introduced into Unown's tiered
> memory system, broadened to the full non-LLM model landscape (§11–§12).
>
> Verdict: **No as a primary component of today's memory system; a few narrow,
> conditional supporting roles.** AutoDream remains LLM-driven, with its existing
> empirical ship/canary/retention gates. Three cheap *deterministic* gates are
> worth doing now (§7a) — no model required. Revisit ML-based gating only if the
> trigger conditions in §7 are met.

- [1. Purpose and method](#1-purpose-and-method)
- [2. What Unown's memory system actually is](#2-what-unowns-memory-system-actually-is)
- [3. Candidate models](#3-candidate-models)
- [4. What agent-memory research implies](#4-what-agent-memory-research-implies)
- [5. Integration-point appraisal](#5-integration-point-appraisal)
- [6. Comparable architectures](#6-comparable-architectures)
- [7. Quantitative trigger conditions](#7-quantitative-trigger-conditions)
- [7a. Cheap deterministic gates worth doing now](#7a-cheap-deterministic-gates-worth-doing-now-no-model-required)
- [8. Risks and failure modes](#8-risks-and-failure-modes)
- [9. What to do instead (recommended investment order)](#9-what-to-do-instead-recommended-investment-order)
- [10. Candidate-specific verdicts](#10-candidate-specific-verdicts)
- [11. Other non-LLM model families and where they belong](#11-other-non-llm-model-families-and-where-they-belong)
- [12. A non-LLM model landscape beyond "smaller models"](#12-a-non-llm-model-landscape-beyond-smaller-models)
- [13. Sources](#13-sources)
- [14. Related pages](#14-related-pages)

---

## 1. Purpose and method

This document records an objective evaluation of a class of proposed memory-system
enhancements: inserting specialized classification small models into the Unown
pipeline. It is not a user tutorial and does not change any behavior.

Method:

1. Read the current implementation in `pi-repo/packages/self-learning/src/`,
   especially `memory.ts`, `dream.ts`, `notes.ts`, `skills.ts`, `llm.ts`.
2. Reconstruct the real data shapes, volumes, runtime constraints, and safety
   invariants from source.
3. Review online research, vendor documentation, and peer-reviewed preprints on:
   agent memory, classification models, embedding/novelty gating, and three
   comparable architectures (Letta, Neo4j agent-memory, Mem0).
4. Map each candidate model to concrete integration points and score it on
   capability fit, operational cost, safety, and reversibility.

Key conventions:

- "Memory" here means the Unown tiered rule/playbook store, not general LLM
  recall.
- "Classification model" is used loosely for non-generative decision heads: Jev,
  spaCy, GLiNER/GLiClass, DeBERTa-style zero-shot classifiers, and text
  embeddings.
- Monetary and speed claims attributed to vendors are treated as marketing
  claims until independently measured.

---

## 2. What Unown's memory system actually is

Relevant implementation:

- `pi-repo/packages/self-learning/src/memory.ts`
- `pi-repo/packages/self-learning/src/dream.ts`
- `pi-repo/packages/self-learning/src/notes.ts`
- `pi-repo/packages/self-learning/src/skills.ts`
- `pi-repo/packages/self-learning/src/llm.ts`

### 2.1 Representation and injection

Memory is represented as **markdown text**, across four tiers in ascending
specificity:

| Tier | File | Typical contents |
|---|---|---|
| policy | engine `memory/policy.md` | Non-negotiable guardrails |
| project | engine or project `.unown/memory/project.md` | Workflow, pitfalls, playbooks |
| user | `memory/user.md` | Working style preferences |
| local | `.unown/memory/local.md` | Session-local overrides |

`resolveMemory` in `memory.ts` loads every tier, wraps each in a
`<project_instructions>` block, and prepends it to the agent system prompt.
Memory is not queried or scored; the entire resolved block is always in context.
`totalChars` is the size metric. There is no vector index and no archival store.

### 2.2 Data sources

- `notes.ts` defines two note kinds:
  - Benchmark notes produced by engine runs.
  - Terminal notes produced by real project sessions.
- `buildTerminalNote` in `termhooks.ts` records run metadata: run id, kind,
  status, tool calls, final agent message.
- `noteFromRun` forms a short structured note from run outcomes, including
  verification evidence.
- Undreamed-note caps:
  - Benchmark: 24 notes per dream.
  - Terminal: up to 40 notes grouped per project slug.
- Project memory output is capped at roughly 120 lines / 8,000 chars in the
  skill/consolidation flow.

### 2.3 Consolidation and safety gates

AutoDream does not store notes directly. It asks an LLM (`chatJson`) to merge,
resolve contradictions, prune stale or one-off material, reorganize topics, and
write the next full project memory.

Safety mechanisms already present:

- Benchmark dream:
  - LLM produces next memory.
  - `writeTier` atomically versions it.
  - `canaryCheck` re-runs the most recent passing task under the new memory.
  - A failed canary rolls the consolidated memory back.
- Harness:
  - Candidate memory patch must pass a candidate run and a follow-up
    confirmation run.
  - Non-replicating passes are treated as noise and re-mined.
  - Retention check auto-unships improvements on a later failure.
- Skill minting:
  - Validation by name, description, body length, line cap.
  - Cap of 2 skills per dream.
  - Dedup against disk and database rows.
  - Ceiling of 24 skills per project.

These are versioned and attributable via SQLite (`memory_versions`,
`skill_versions`).

### 2.4 Compute and deployment constraints

- Runtime is bun/TypeScript, not Python/PyTorch.
- The self-learning engine is single-tenant (one cycle at a time) by contract.
- Sandboxes are fresh per run and OS-isolated through bubblewrap in production.
- `/home` is a private tmpfs inside the OS sandbox; model weights placed there
  would be invisible to sandboxed task code unless explicitly mounted.
- Network is shared only when `UNOWN_SANDBOX_NET=1`; default policy is strict.
- The upstream LLM is paid via a coding plan, but the user has explicitly
  specified that inference should not be rationed.

These constraints are relevant because common NER/classifier implementations
are Python/PyTorch-first, and some variants only have experimental ONNX ports.

### 2.5 Quantified economics (exact numbers from source)

All values below are exact unless marked estimate. Token estimates assume ~4
chars/token.

| Item | Value | Source |
|---|---|---|
| `auto-dream` interval | every 10 min | `router.ts:40-46` |
| `auto-dream` benchmark floor | needs ≥3 undreamed benchmark notes (out of last 50 checked) | `router.ts:200-202` |
| `auto-dream` terminal path | no floor — `runProjectDream()` every 10-min tick | `router.ts:204` |
| `dream-check` event on `run:finished` | fires when undreamed notes (any kind) ≥3 | `router.ts:114-118` |
| Benchmark dream input | max 24 notes (`undreamedNotes(24, "benchmark")`) | `dream.ts:57` |
| Project dreams input | up to 40 terminal notes grouped per project; all of a project's pending notes consumed at once | `dream.ts:235`, `notes.ts:51-60` |
| Consolidation calls | `maxTokens: 3000` each (benchmark, per-project, skill minter) | `dream.ts:96,271`, `skills.ts:197` |
| Harness `mineFailure` | `maxTokens: 1500` | `harness.ts:80` |
| Canary gate | exactly one full `runAgent` regression run when armed; zero LLM when skipped (no passing task, gate disabled, task missing) | `dream.ts:189-218` |
| Ship gate | candidate + confirmation runs must both pass (2 full agent runs per shipped patch) | `harness.ts:296-336` |
| Retention check | 0 LLM calls (SELECT + UPDATE + optional rollback) | `harness.ts:422-454` |
| Passed note size | ~300–500 chars | `notes.ts:96-114` (header + tools lines) |
| Failed note size | ≤ ~1.8 KB worst case (6 × 200-char failure lines + 300-char final words) | `notes.ts:105-112` |
| Terminal note size | ≤ ~750 chars (400-char final outcome cap) | `termhooks.ts:188-200` |
| Memory output guidance | < 120 lines (prompt rule, soft) | `dream.ts:49` |
| Skill caps | ≤2/dream, ceiling 24/project, body 80–8000 chars and ≤120 lines | `skills.ts:36,177,137-138` |
| Dream output floor | trimmed `projectMd` < 60 chars throws | `dream.ts:100,274` |

Estimates: a typical benchmark dream carries ~3–4k input tokens (3–6 short notes
+ ~120-line memory + system prompt); worst case ~13–14k input (24 max-size failed
notes). A typical project dream carries ~1–3k input tokens. The canary run
dominates whenever it fires — one full agentic loop dwarfs the ~3k-output
synthesis call.

Consequence for gating: per skipped benchmark dream you save exactly 1 synthesis
call plus 0-or-1 full agent runs (the canary is the dominant saving); per skipped
project dream you save exactly 2 calls (consolidation + minter), with no canary
attached. A gate is net-positive on tokens even if it is a trivial heuristic —
the question is never cost, it is correctness (see §8.1).

---

## 3. Candidate models

### 3.1 Jev / TypeSafe "System One"

Jev is a non-generative "System One" model. It accepts text or JSON "state" plus
named questions and returns typed values: choices, scores, or noul booleans, with
per-option probabilities and a confidence signal. It does not generate prose.

Strengths (from vendor and independent benchmark material):

- Fast response times (vendor-reported roughly 100-200 ms).
- Low per-request cost in absolute terms.
- Structured, parse-free outputs.
- Option to abstain (`noul`) and threshold on calibrated probability.
- Suited to routing, intent classification, triage, guardrails.

Limitations:

- No generation; cannot consolidate memory or write rules.
- Performance drops on large option sets.
- Out-of-distribution tasks are a known weakness.
- Calibration quality matters more than accuracy when used as a gate.
- Independent benchmark coverage reported Jev on 37 datasets, with mixed
  patterns and a steep gradient across languages.

### 3.2 GLiNER and related encoders

GLiNER is a small bidirectional-encoder model for zero-shot named entity
recognition: entities are matched to entity-type prompts in latent space rather
than generated. Related projects include:

- `GLiClass` — zero-shot text classification with a GLiNER-style architecture.
- `GLiREL` / `GLiNER-Relex` — relation and joint entity/relation extraction.
- `GLiNER2` — a unified multi-task model combining NER, classification, and
  structured data extraction.
- Domain variants, including biomedical and PII-focused versions.

Strengths:

- Zero-shot extraction for user-provided entity types.
- CPU-friendly in many configurations.
- Parallel extraction; favorable for latency.
- Confidence scores are available.
- Useful PII detection coverage.

Known constraints (important for gating use):

- Confidence may rank correctness but can be badly overconfident.
- Temperature scaling can reduce, but not eliminate, this.
- Performance depends heavily on entity spans and prompt quality.
- Some architectures scale better to many labels than others.
- ONNX support exists but is third-party relative to the Python implementation.

### 3.3 Joint Embedding Predictive Architectures (JEPA)

JEPA is a self-supervised representation objective: predict latent
representations of missing or future data instead of reconstructing inputs. Modern
variants extend it to video, RL, and language (e.g., LLM-JEPA). VJEPA and
Bayesian variants are probabilistic extensions.

Problem fit:

- JEPA is representation learning, not a retrieval primitive and not a
  generative consolidation mechanism.
- Unown does not train foundation models.
- Unown's memory is not a sensory/world-modeling or multimodal prediction
  problem.

Conclusion: **JEPA is the least applicable of the candidates.** It has no
realistic role in the current memory architecture.

---

## 4. What agent-memory research implies

### 4.1 Memory is not one decision

Parameters literatures separate memory into distinct decisions:

1. Consolidation: merge, resolve, derive durable rules.
2. Schema selection: facts, summaries, raw text, entities, or rules.
3. Retrieval: which stored items should reach the prompt.
4. Write gating: add, update, merge, or skip.
5. Scope / tenancy: global, per-user, per-agent, per-project.
6. Ordering / salience: which facts should dominate attention.
7. Forgetting: what should be dropped to fit a budget.

The right model class varies by decision. In nearly all literature reviewed,
**generation is LLM-driven, retrieval is embedding-driven, and write gating is
statistical/geometric or LLM-driven.** Small end-to-end classifiers are not the
dominant memory component.

### 4.2 Consolidation requires generation

AutoDream's consolidation is generative. It must:

- Preserve valuable rules.
- Reconcile contradictions with recency bias.
- Prune one-off noise.
- Discover recurring procedures.
- Produce a coherent short document.

A text classifier cannot perform those operations; at best, it can provide a
pre-filter or label. Since all evidence in a dream is already short and batched,
a pre-filter gains little.

### 4.3 Raw and generated representations both matter

Research summarized in "Storage Is Not Memory" argues that extraction at
ingestion can discard information that was not expected to matter when stored.
Unown's note design is closer to a structured run record than a compressed fact
set, which is relatively safe. Adopting extractive schemas (entity facts,
triplets) would increase this risk unless carefully governed.

### 4.4 Write gating can be cheap, but the savings are small

- SAGE models memory evolution as novelty detection and routes facts to ADD,
  merge, or NOOP using von Mises-Fisher density over embeddings. As a drop-in
  gate on A-Mem it skips 16-18% of write calls with ≤0.5% token-F1 change.
- True Memory uses novelty (gzip), salience, and prediction error (embeddings)
  for gating, deliberately disabled in reported benchmarks.
- RecMem triggers LLM consolidation only after semantic recurrence counts cross
  a threshold.

These support cheap gating at scale. However, per-dream LLM calls are few and the
gate adds correctness risk. Evidence removal occurs before the consolidator
sees it, and the literature also warns that extraction can discard useful
information.

### 4.5 Retrieval dominance depends on task type

The ICLR 2026 bottleneck study finds retrieval method drives 14-23 points
across write strategies, while write strategy only drives 3-8 points. This is
valid reason to prioritize retrieval and reranking in recall-focused systems. It
does **not** generalize to Unown's procedural-rule store, where memory is fully
injected, and task performance is measured through verification rather than
fact lookup.

### 4.6 Multi-factor memory value is promising but easy to overstate

"Learning What to Remember" proposes a multi-factor value function (emotional
salience, goal relevance, reliability, usage, task utility, value alignment,
self/user relevance) with learned weights over a non-differentiable
encode-forget-retrieve-answer pipeline. It highlights a serious methodological
issue: oracle scoring (peeking at the future question) saturates retrieval at
roughly 0.98 and measures retrieval, not forgetting. Unown's task-outcome gates
avoid this trap better than an embedding/value threshold.

### 4.7 Evaluation confounds

MemDelta demonstrates memory architecture claims often conflate changes in the
memory method with changes in embedding model, LLM, or retrieval pipeline. It
also shows some configurations cost hundreds or thousands of LLM calls. Any
future memory-model experiment must isolate variables and report per-decision
compute.

---

## 5. Integration-point appraisal

### 5.1 AutoDream consolidation

Candidate models cannot write the next memory. Labels or scores are not a
substitute for merging, contradiction resolution, or wording changes. A
classifier could drop notes before the LLM sees them, but evidence points against
this: redundancy filtering with moderate call reduction and concrete risk of
discarding learning material, especially with far fewer notes than benchmark
corpora.

### 5.2 Skill minting (`skills.ts`)

`validateProposal` already checks schema, size, and dedup. A Jev-style
decision could filter proposals, but it adds a hosted dependency and a threshold
to tune, while mentoring quality is gated by validation, cap, existing-skill
dedup, and ceiling. Because minting cannot directly hurt memory (minted skills
are additive and reviewable), a classifier here is low risk, but also low value.

### 5.3 Note routing

Unown currently has benchmark and terminal notes, with project grouping by
slug. It does not route notes by type, entity, or tier. Type-routing could be
useful for:

- policy vs project rule vs user preference vs local override;
- pitfall vs procedure vs configuration fact;
- entity-focused vs command-focused note.

However, today, routing is LLM-directed during consolidation and file-write
placement. It is not a proven bottleneck. Implementing typed decisions requires
label taxonomy creation, threshold calibration, and error handling on misroutes.
This is a genuine candidate for a gated trial once volume grows, but not now.

### 5.4 Ship, canary, and retention gates

These are safety invariants:

- Candidate changes ship only after passing a candidate and confirmation run.
- A dream is canaried against the most recent passing task.
- Regressions trigger auto-unship.

Replacing these with classification scores would weaken the system from empirical
task outcomes to point estimates. Both Jev and GLiNER have calibration concerns
and weaker behavior on ambiguous or out-of-distribution inputs. **Do not
replace empirical gates with scores.** Point scores may serve as advisory or
telemetry only.

### 5.5 PII and secret hygiene

This is the clearest legitimate use case. GLiNER includes PII-focused variants
and can run offline/on CPU in many deployments. If notes are ever shared
across users, processed in CI, or imported into shared stores, offline PII
scrubbing before consolidation is sensible. It does not improve memory quality,
but limits exposure.

### 5.6 Multi-tenant scope / shared memory

No candidate model adds value here. Scope is a data-modeling and permission
problem, not a classification problem. Comparable architectures show value in
sharing, not in classifying.

### 5.7 Entity enrichment / long-term archival memory

This is the biggest possible future use for GLiNER, but it requires an actual
architecture change. GLiNER fits extraction stages for entity-heavy systems; it
would not be appropriate for the existing `project.md` rule store.

If Unown ever adopts a long-term archival tier (read outcome memories, retrieve
by entity/relation, provenance), then GLiNER could be an extraction assistant
between raw session records and a graph or relational index. It should still
not be the consolidator.

### 5.8 Recall / semantic retrieval

Unown has no vector search. Introducing one would require:

- storage and versioning of embeddings or sparse indexes;
- query generation/injection logic;
- validation of fit with current small context budgets.

This is a product decision, not a classifier decision. Classification benefits
come only after retrieval architecture exists.

---

## 6. Comparable architectures

### 6.1 Letta / MemGPT

Strengths:
- Core, recall, and archival memory model.
- Always-in-context memory blocks plus retrieving external storage.
- Agent manages memory via tools.
- Shared blocks for cross-agent coordination.
- Strong persistence and block-centered compilation.

Lessons for Unown:
- Borrow: structured always-on memory with labels and caps.
- Avoid: runtime agent self-editing of durable memory.
- Avoid adopting its full framework: Unown's strength is a small layer over pi,
  with explicit evidence gates and files in the project.

### 6.2 Neo4j agent-memory

Strengths:
- Three memory layers: short-term, long-term, reasoning.
- Graph-native relationships, POLE+O entities, provenance.
- Multi-stage extraction (`spaCy → GLiNER → LLM`, plus GLiREL relationships).
- Entity resolution and dedup operations.

Lessons for Unown:
- Borrow: stronger provenance and reasoning traces in session notes.
- Avoid: graph database and entity-graph overhead unless retrieval pressure
  exists.
- GLiNER's role here is as an **extraction stage**, never the memory brain.
  This matches the user's "classification model like GLiNER" better than any
  current Unown touch point.

### 6.3 Mem0

Strengths:
- ADD/UPDATE/NOOP memory updates.
- Entity linking and hybrid retrieval.
- Multi-signal retrieval and multi-scope memory.
- Strong benchmark numbers, but with notable methodology questions.
- Graph memory provides only around ~2% gain over base Mem0 in that paper.

Lessons for Unown:
- Borrow: multi-signal retrieval if retrieval is added later.
- Avoid: treating atomic fact extraction as default truth. It can add loss,
  especially for procedural memory.
- Mem0 is useful as a reference for retrieval architecture, not as the basis of
  Unown's rule memory or its safety gates.

### Summary of architecture match

| Architecture | Optimizes for | Model class that fits | Unown match |
|---|---|---|---|
| Unown | Versioned procedural rules, task verification | LLM generation + empirical gates | Native |
| Letta | Unlimited context and agent self-management | Managed context + retrieval | Moderate, for scale |
| Neo4j | Entity relationships and provenance | NER + graph + LLM extraction | Only if archival entity memory added |
| Mem0 | Long-memory recall and token efficiency | LLM extraction + hybrid search | Moderate, for retrieval |

---

## 7. Quantitative trigger conditions

Adopt supporting classifier or retrieval work only if at least one of these
becomes true; otherwise keep the system LLM-gated and file-injected.

| # | Trigger | Metric / threshold | Action if triggered |
|---|---|---|---|
| 1 | Note volume growth | Median pending notes per dream > 100 or per-project > 100 | Add an embedding-geometry write gate following SAGE-style recurrence thresholds; keep LLM consolidation |
| 2 | Context budget pressure | Resolved memory block regularly > 4,000-6,000 tokens | Add selective injection/retrieval first, before extracting anything |
| 3 | Multi-agent coordination | Subagents need shared state beyond per-project rules | Borrow Letta-style shared memory blocks |
| 4 | Compliance/shared hosting | Notes cross a trust boundary or tenant boundary | Add offline GLiNER-PII scrubbing before consolidation |
| 5 | Archival recall requirement | Users need historical decisions/entities, not just current rules | Consider graph/entity-assisted memory; GLiNER only as extraction stage |
| 6 | Recall benchmark requirement | Unown needs to score against long-memory benchmarks | Add hybrid retrieval benchmarked with isolated variables |

## 7a. Cheap deterministic gates worth doing now (no model required)

Refinement 2026-10-17: the economics in §2.5 change the gating verdict. A gate
does not need ML to be net-positive — one skipped dream already pays for any
heuristic. Three fixes address measured waste with zero model dependency:

1. **Per-project floor for project dreams.** `runProjectDream` currently fires on
   a single pending terminal note (no floor; `router.ts:204`, `dream.ts:235`),
   buying 2 LLM calls (consolidation + minter, up to 6000 output tokens) for one
   ~750-char note. Gate: wait for ≥3 notes or 1 failure-bearing note per
   project. This kills the worst token-per-evidence ratio in the system.
2. **Kind-aware `dream-check`.** The `run:finished` trigger counts mixed kinds
   (`router.ts:116`) but consumes benchmark-only (`dream.ts:57`), so
   terminal-only accumulation can fire a benchmark dream that exits via the
   `no-notes` path — zero LLM but busy-mutex/job-slot noise. Gate: check the
   benchmark count before firing, not the mixed count.
3. **Status-aware canary skip.** All-`error`/all-already-passing note batches
   still cost a full canary agent run when the gate is armed. Gate: skip the
   canary when no note carries failure or new-pass evidence; keep the synthesis.

What gating must **not** touch: the harness ship gate (candidate + confirmation)
and the retention check. The former guards measured eval noise (≈ ±0.06,
`harness.ts:298-300`); skipping confirmation reintroduces exactly the flakiness
it exists to kill. The latter already costs zero LLM.

## 8. Risks and failure modes

### 8.1 Silent forgetting

A classifier gate removes evidence from the consolidator's input before it can
decide. In Unown, notes are the source of truth for project memory. Once a note is
dropped, its learning value is unrecoverable. This risk is especially high when:

- notes are low volume;
- notes include near-duplicate but semantically different lessons;
- the classifier uses few-shot, heuristic, or overconfident confidence scores.

Stronger risk controls:
- Treat gates as recommendation, not authority.
- Require empirical canary pass after any automated pruning.
- Never let classification override an explicit task failure.
- Version notes and record dropped notes in audit output.

### 8.2 Calibration drift

Jev's probability is documented as useful but not immune to
out-of-distribution failure. GLiNER's confidence can be badly overconfident
without temperature scaling, though ranking quality remains useful. In a
versioned memory system, a miscalibrated gate can prune valuable lessons for a
long time, causing silent memory loss.

Mitigations:
- Monitor gate hit rate, post-gate consolidation performance, and drift.
- Use abstention (`noul`) where possible rather than forcing a decision.
- Keep human review for deployment in production.
- Retain audit trails of all gate outcomes.

### 8.3 Evaluation confounds

Memory architecture changes can conflate results with unrelated changes (better
embedder, different LLM prompt, better retrieval). MemoDelta shows that
advertised gains sometimes come from components other than memory logic. Any
future model introduction must:
- Hold one variable at a time.
- Report compute, latency, tokens, and calibration.
- Score against task outcomes, not only text similarity.

### 8.4 Infra and supply-chain burden

Introducing Python/ONNX classifiers into a TypeScript/bun engine adds:
- model artifact management and pinning;
- version drift and integration testing;
- sandbox distribution and provenance;
- potential binary compatibility issues across host environments.

This is acceptable for offline compliance or high-scale gate use; not justified
for routine memory consolidation when LLM resources are not rationed.

---

## 9. What to do instead (recommended investment order)

If memory-system quality is the priority, invest in these first:

0. **Deterministic gates (§7a)** — per-project dream floor, kind-aware
   `dream-check`, status-aware canary skip. Zero model cost, fixes measured
   waste.
1. **Better notes**
   - Expand `buildTerminalNote` and `noteFromRun` to include failing tests,
     target files, command output summaries, and tool evidence.
   - Higher-quality notes improve consolidation more than any classifier.
2. **Better AutoDream prompt/contract**
   - Enforce stricter topic conventions.
   - Require explicit conflict resolution citations.
   - Add note-level provenance summaries.
3. **Better empirical gates**
   - Increase canary coverage beyond the last-passing task where computation
     allows.
   - Retention-test known pitfalls after memory changes.
4. **Only then: optional embedding/index work**
   - Use generic embeddings via the bridge, not a new classifier runtime.
   - Consider retrieval when context size grows.
5. **Only if needed: GLiNER PII scrub**
   - Offline and actor-limited.
6. **Only if archiving: entity-recall tier**
   - GLiNER as an extraction stage, plus a database and lifecycle management.

---

## 10. Candidate-specific verdicts

### Jev

- Fit: High-volume fixed-schema typed decisions, routing, safety guardrails.
- Unown memory fit: Weak.
- Why: Jev adds a network dependency and model lifecycle to low-volume
  decisions that are already handled via LLM generation or empirical
  outcomes. No natural Unown memory work item maps well to Jev's strongest
  capabilities.
- Future use: advisory classifiers for note triage or skill candidacy, but even
  that requires taxonomy, calibration, and load worthiness before adoption.

### GLiNER

- Fit: Entity extraction, PII scrubbing, domain-specific IE.
- Unown memory fit: Strongest where entity extraction and PII redaction are
  needed; poor fit for consolidation of procedural rules.
- Why: GLiNER's zero-shot NER is excellent for graph and archival memory, but
  Unown's current memory is compact and always injected.
- Future use: offline PII scrub or an extraction stage in an archival/long-term
  memory tier.

### JEPA

- Fit: latent representation learning and dynamics modeling.
- Unown memory fit: No use as a runtime memory primitive.
- Why: Unown does not train language/vision models and does not operate a
  world-model or frame prediction task in memory management.

---

## 11. Other non-LLM model families and where they belong

This section broadens the analysis beyond classifier models. It answers "models other than
traditional LLMs" in a memory-system setting, especially where LLM and retrieval/gating
become decoupled.

### 11.1 Small and specialized language models

SLMs are compressed or task-specialized generative models, usually in the 0.6-8B range.
They are useful when a memory system decomposes into an online fast path and an offline
slow path. LightMem uses a Controller SLM, a Selector SLM, and a Writer SLM in the
online path while reserving a larger model for offline consolidation. CLAG uses an SLM
as a clustering router and profile generator.

Unown fit: low today, because AutoDream is already offline and not contention-limited.
Medium future fit, if Unown gains an online memory-write surface or multi-turn memory
control. SLMs make more sense than adding a new runtime for a classifier; they use the
same OpenAI-compatible family and can be swapped per component.

Caveats:

- They require task-specific adaptation or data.
- They may suffer drift unless benchmarked against real note corpora.
- They are still text generators, so they inherit standard generation failures.

### 11.2 Embeddings and rerankers

Embeddings are the basic substrate for semantic retrieval, duplication detection, and
gating. Rerankers improve retrieval precision at additional latency.

Uses:

- vector or sparse retrieval indexes;
- recurrence detection for RecMem-style delayed consolidation;
- novelty and redundancy gating like SAGE;
- candidate filtering before expensive generation;
- hybrid BM25 + dense retrieval.

MemReranker demonstrates that compact 0.6-4B reranking models can rival larger
LLM-as-judge reranking on LOCOMO at roughly 200 ms, giving a clear latency and cost
path when retrieval is the bottleneck.

Unown fit: good only if retrieval becomes a product requirement. Embeddings can be used
immediately as a gate signal, but full retrieval requires schema, indexing, and query
injection changes.

Caveats:

- Retrieval gain is not the same as memory utility.
- Vector shards can fragment multi-step procedural memory.
- Embeddings are not auditable explanations.

### 11.3 Write-gating and clustering models

Write control is where specialized models have the strongest evidence — but the
newest router papers sharpen *when* that evidence transfers:

- SAGE models memory evolution as novelty detection over embeddings, skipping
  16-18% of write LLM calls on A-Mem with minimal observed quality loss.
- RecMem delays LLM consolidation until sustained recurrence in the subconscious
  layer.
- True Memory proposes an encoding gate with novelty, salience, and prediction-error
  signals.
- CLAG organizes memory into clusters to reduce cross-topic interference during
  localized evolution.
- **MemRouter** (arXiv 2605.00356) replaces a per-turn LLM memory manager with a
  frozen-backbone embedding classifier (~12M trainable params): LoCoMo F1 52.0 vs
  45.6 for the LLM manager, p50 write latency 970ms → 58ms. Transferable lesson:
  admission selectivity and per-category consolidation prompts dominate retrieval
  tweaks (factor attribution: admission +10.3, category prompts +5.2, retrieval
  +0.7). Non-transferable: the latency win optimizes a per-turn online manager
  Unown does not have — dreams batch ≤40 notes into one offline call.
- **MemAgent** (arXiv 2609.32521) routes across 13 heterogeneous memory providers
  with a Qwen3.5-4B LoRA policy (+10.0pp over no-memory, −12% task steps), but
  needs forced exploration over every provider × task and still trails a hindsight
  oracle by ~14pp. Negative result worth keeping: no single representation wins
  on more than one benchmark — keep `project.md` schema plural rather than routed.
- **Router-Mem** (arXiv 2608.01285) is the read-side mirror: a single-token
  sufficiency router early-exits ~30% of queries, cutting inference time ~25-27%
  on AMA/BEAM. Portable only if Unown's read path ever fans out — today it is a
  single `project.md` load with nothing to early-exit from.

Unown fit: possible as advisory/telemetry, but no direct replacement for AutoDream and
gate authority. With fewer than 40 terminal notes per project, ML-router savings are small and the
cost of a missed note is large. Do §7a's deterministic gates first; revisit an
SAGE-style embedding gate only past trigger #1 (>100 pending notes/dream).

### 11.4 Structured extraction and graph models

NER, relationship extraction, and GNNs are strong when memory is entity-centric or
graph-shaped:

- GLiNER/spaCy + LLM extraction for graph memory;
- relation models for traversal and causal lineage;
- GNN embeddings for node-, edge-, and multi-hop retrieval;
- graph-stored provenance chains like Neo4j-style memory.

Unown fit: not in the current markdown tier model. These become useful only if Unown
adds an archival/recall entity layer rather than its always-injected rule file.

### 11.5 Probabilistic, predictive, and world-model memory

Predictive systems store uncertainty and update beliefs through surprise.
Since the last revision, three systems clarify the boundary between portable
principle and non-portable machinery:

- Nous maintains categorical distributions over entity-attribute values and updates
  them on Bayesian surprise.
- MemoWM treats memory as a division of labor between a learned world model and
  episodic detail.
- **Nous (arXiv 2606.22030)** splits 2–2 with A-MEM on LoCoMo and is honest about
  the key result: Bayesian updating is *inert* without reliability signals
  (last-write-wins ties 36.27 vs 36.77); with them it wins, and holds poisoning at
  0% vs 100% naive under volumetric flood. Caveat: single backbone
  (gemini-2.5-flash), oracle-assigned provenance tiers, entropy decay never
  triggered in eval. Portable: per-rule confidence + surprise-scored deltas +
  append-only auditable history — implementable as reliability tags and delta logs
  over versioned markdown, no Bayes machinery required.
- **MemoWM (arXiv 2610.10778)** formalizes the retention rule worth stealing:
  retain a coordinate iff omission risk (error-probability × offline-measured
  task-impact) ≥ coding cost — 42.42% avg accuracy with −53.9% experience storage
  vs MIRIX. Caveat: headline rate excludes model weights and needs a
  quantizer + world model + retrieval head trained per domain. Portable as an
  AutoDream scoring rule (drop notes the base prompt already entails; keep
  high-surprise/high-utility ones), not as a subsystem.

Unown fit: the principle is worth borrowing (only uncertain or non-recoverable
information is stored), but a full predictive or latent world-model subsystem is
research-heavy and would conflict with Unown's text-only, auditable memory design.

### 11.6 State-space and long-sequence models

SSMs and related architectures focus on efficient long-sequence processing. They help
with token throughput and, in variants such as MemMamba, address sequence-memory
decay. New evidence sharpens the rejection:

- **Titans (arXiv 2501.00663)**: the memory module *is* an MLP whose weights are
  updated at test time by gradient descent on an associative loss, with
  surprise-as-gradient-magnitude and data-dependent forgetting. Scales past 2M
  context on needle-in-haystack. But the independent reproduction (Titans
  Revisited, arXiv 2510.09551) finds Titans does not always beat baselines
  (chunking is the damage source), and with a frozen backbone, memory-only
  test-time updates produce no learning — backbone/memory co-adaptation is
  required. Unown trains nothing and injects markdown into attention: incompatible
  on both counts, though the surprise-plus-decay gating algebra is cheap to borrow
  symbolically.
- **MemMamba (arXiv 2510.03279)**: threshold-triggered "note pool" (64-dim
  summaries, pool of 50) holds PG19 perplexity stable 17.3–18.3 at 30k→60k where
  Mamba-130M goes INF past 20k, and Passkey Retrieval 1.0 through 256k (0.9 @400k).
  Gains manifest only at 100k+ contexts and need GPU training — Unown's bottleneck
  is cross-session rule retrieval, where an explicit symbolic note pool costs zero
  training.
- **Mamba-3 (arXiv 2603.15569)**: discretization/complex-state/MIMO fixes give
  +1.8pp avg downstream at 1.5B and halve state for equal perplexity — all expressed
  in pretraining math and CUDA kernels, with zero applicability to a bun/TypeScript
  engine.
- Lineage note: NTM/DNC/Memory Networks lost to RAG-style text stores because joint
  controller–memory training is unstable and addressing traces are opaque, whereas
  plain-text stores stay decoupled, readable, and editable without retraining —
  exactly the auditability property Unown's markdown tiers rely on.

Unown fit: useful for validators or simulation replay at long turn counts, not as the
memory store itself. Engaging SSMs primarily for long-context summarization is
worthwhile only once usage is context-limited.

### 11.7 Verification, verifier, and reward models

Verifiers provide a decision model rather than generated text. Variants include ORMs,
PRMs, process verifiers, reward models, and judge models:

- AgentPRM combines immediate progress and long-term promise for agent decisions.
- Verifiable Process Reward Models (VPRMs) replace opaque neural judging with
  deterministic, rule-based verification where domain rules support it.
- VerMem uses local and global verifiers during training only, then removes them
  at inference.
- **VerMem (arXiv 2608.03137)**: one policy over LTM/active-context/episodic
  history via 7 atomic ops, SFT warmup + 3-stage RL curriculum; local verifier
  scores each memory transition, global verifier scores the finished trajectory
  (advantages normalized separately, constraint penalty added, both verifiers
  removed at inference). +6.05 avg over strongest baseline on 5 benchmarks × 2
  backbones; full verifier credit beats no-verifier RL by +6–10 pts. Authors admit:
  memory reset per episode (no cross-session retention tested), HotpotQA-only
  training, two Qwen backbones, and "learned verifier scores may inherit evaluator
  errors" with no adversarial testing. Adopt the hierarchical-credit *shape*, not
  the verifier-as-truth *substance*.
- **AgentPRM (arXiv 2511.08325)**: promise (Q-value) + progress (advantage)
  trained with TD/GAE instead of MC rollouts; >8× compute-efficiency vs ORM/PVM
  baselines claimed, WebShop beam-search 76.0 vs 54.5 PVM. Labels are bootstrapped
  from the policy's own rollouts — the correlated-error loop Unown's independent
  empirical gates exist to catch.
- **CMI (arXiv 2605.17641)**: `do(C=S)` intervention scoring — Utility =
  score(with memory) − score(no memory), Stability = score(with) −
  score(perturbed); keep iff Utility>0 and Stability≥0. Useful-F1 0.875 vs
  ~0.50 baselines, zero poison adoption — but at 3+ LLM generations per candidate
  plus a judge call, on n=87 with label-assisted risk filtering. Right *offline
  audit* for a versioned rule ("would outcomes have been worse without it?"),
  disqualified as an online gate.
- **CAMEL (arXiv 2605.09330)**: the cheapest causal hygiene available — write-time
  embedding residualization against the step mean plus novelty-gated writes, and
  perturbation-stability re-rank at retrieval, with no LLM calls (pure linear
  algebra). Suppresses association artifacts across three spurious types while
  clean accuracy rises — but it filters *association*, not *falsehood*, and
  cross-step distributed spurious evidence defeats it.
- **ActMem (arXiv 2603.00026)**: LLM-mined causal edges filtered by GPT-2 PMI
  into a memory KG plus counterfactual second-query retrieval; w/o-causal gives
  the lowest QA accuracy. Recall aid only — GPT-2-scale PMI (fluency ≈ causality
  risk) is too noisy to be load-bearing in a versioned rule store.
- **Memory Reward Inflation (arXiv 2608.00017)**: the formalism for why
  verifier-as-gate fails — stored self-grades inflate wrong episodes (Leniency
  31–54% across families), compounding through ranking *and* planner trust; only
  a retrieval-evidence verifier passes error-independence (+0.76/+0.05) while all
  parametric re-graders fail. This is the strongest intellectual support for
  Unown's design: without an error-decorrelated channel (real task outcomes),
  gating on model-generated scores compounds the bias it claims to check.

Unown fit: good as an evaluator, bad as a safety gate. The project's safety story is
empirical (candidate run plus confirmation run, canary task, retention check), and
replacing that with a learned verifier would create scoring correlation risk.
Verifiers can usefully serve training, offline evaluation, and search ranking.

### 11.8 Topic models and clustering models

Topic models, embedding clustering, and LLM-driven cluster-profile generation organize
memories into semantically coherent neighborhoods.

Unown fit: useful for future large stores; lower value for a four-tier markdown file
that is already human-curated and injected directly. If archival memory grows, topic
clustering is a good partitioning mechanism before vector retrieval.

### 11.9 Extended recommendation ladder

Update §9 to reflect non-classifier alternatives:

1. Better notes and generation inputs.
2. Better task-outcome gates.
3. Embeddings and hybrid retrieval (when volume justifies it).
4. SLM online decomposition of retrieval/write paths.
5. Clustering/topical organization for archival memory.
6. Entity extraction only for explicit relationship needs.
7. Verifiers as evaluation aides, not permission boundaries.
8. PII-only auxiliary extraction where compliance requires.
9. Predictive and world-model experiments only as long-term research, not as
   memory replacements.

## 12. A non-LLM model landscape beyond "smaller models"

The prior sections classify *families* by role. This section gives a more explicit
map of concrete non-LLM or non-frontier-LLM architectures that one sees in
agent-memory literature, and where (if anywhere) they map to Unown.

### 12.1 Architecture map

| Family | Core operation | Memory-system role | Replaces what |
|---|---|---|---|
| Retrieval engines: BM25, sparse search, vector ANN | lexical/semantic indexing | retrieval | pairwise or candidate lookup |
| Bi-encoder embeddings + cross-encoder rerankers | similarity scoring, top-k filtering | retrieval, gating, de-dupe | manual/LLM ranking |
| Selective/SLM agents | generated but cheap control agents | query planning, writing, compression | repeated LLM memory operations |
| NER/IE models | span labeling and text-structure extraction | entity memory and PII hygiene | noisy raw extraction by prompt |
| Graph neural networks | neighborhood aggregation, link scoring | memory graph retrieval, relation completion | manual graph query |
| Process/output verifiers | reward/semantic verification | offline quality, search, policy optimization | opaque LLM judgment |
| Topic models/clustering | distributional grouping | cluster organization and summarization | monolithic topic assignment |
| Router/gating heads | classification or embedding gating | ADD/UPDATE/NOOP routing, dispatch | per-turn LLM management |
| Recurrent/state-space models | sequential compression and state tracking | long-turn traces, compressed continuity | naive KV/scanning |
| World/predictive models | predictive coding, surprise minimization | latent reconstruction, gating, memory planning | brute-force storage |
| Causal inference layers | intervention and counterfactual scoring | safe selection and spurious-memory suppression | untested retrieval |
| Associative/external memory | keyed read/write matrices | differential memory storage, persistent facts | naive arrays of memory cells |

### 12.2 Mental model: retrieval first

In vast agent-memory literature, the most common error is assuming strong memory needs
deep model intelligence. In practice retrieval almost always dominates, so most of
the families above should be ranked in this order:

1. **Retrieval and reranking** (BM25, embeddings, rerankers; examples: LOCOMO
   and memory-specific rerankers).
2. **Gating / clustering** (geometric or router-based decisions; examples SAGE,
   RecMem).
3. **SLM-based lightweight workflows** (LightMem and CLAG; decouple fast online
   path from deep offline consolidation).
4. **Extraction/graph models** (GLiNER + GNN pipeline for relationship-heavy
   domain memory).
5. **Reasoning/verifier models**, primarily as evaluators or search support,
   not as permission boundaries.
6. **Sequential and predictive inference** (SSMs, Titans-era neural memory, world
   models) for highly long-horizon state continuity or compressive memory, but
   these require substantial engineering.

Traditional LLMs remain first choice for robust semantic synthesis; worth not
replacing except cost-scale or latency matters. But the boundary here is that
these non-LLM models are mostly useful as **supporting subsystems**, not replacements
for memory policy or memory generation.

### 12.3 "Do-not-do" list

Avoid these traps for Unown especially:

- **Mitigation via classification alone.** PRMs, SSMs, classifiers, and router heads
  do not provide task evidence themselves; they provide correlations or scores.
  Replace empirical gates with them means replacing behavioral outcome with a
  surrogate.
- **Memory inflation / spurious confounding.** Memory selection should be causally
  tested where possible; spurious associations in retrieved memory can mislead
  downstream reasoning, and poor gating can lead to confounded learned strategies.
- **Extraction without post-hoc reconstruction.** Knowledge graph extraction can
  discard context and context-sensitive nuance.
- **Vector store overflow / loss of provenance.** Dense memory erases structural
  provenance; always retain raw/structured evidence to recover critical context.
- **Trend chasing in wrapper stacks.** Routers and memory policies trained on a
  benchmark can overfit benchmark distributions rather than agent outcome.

### 12.4 Evaluation matrix for future model adoption

To decide whether a non-LLM model is warranted in Unown, require answers to all of
these:

1. Budget: measured end-to-end runtime and token consumption per memory event.
2. Benchmark invalidity / confounds: isolate variable, calculate compute and quality
   tradeoff.
3. Effect size: how many LLM calls / how much runtime does it remove, and by how
   much, under real note distribution rather than benchmark data.
4. Failure mode: what exactly happens when model misfires? silent pruning? dataset
   loss? incorrect entity linkage?
5. Reversibility: versioning / rollback handling.
6. Relevance: does it directly improve Unown task outcome or memory quality in a
   way empirical gates cannot? If not, delay.
7. Provenance: preserve the original notes and evidence after any non-LLM
   transformation.

### 12.5 Practical phased plan beyond this report

If product/user demand moves Unown toward memory-density research:

**Phase 0 – instrumentation first**
- Log every AutoDream and gate decision independently.
- Keep outcome storage and ordering stable for future analysis.

**Phase 1 – retrieval and reranking only, no consolidation bypass**
- Add sparse/dense retrieval over archived notes.
- Add reranker candidates only in low-risk regions.

**Phase 2 – gating + clustering**
- Add SAGE-like adaptive threshold.
- Add topics and constrained writer logic.
- Cluster-based evolution.

**Phase 3 – entity/graph subsystem**
- Entity constraints applied cleanly to historical scope.
- Selective and replaceable graph relations per type, not universally.

**Phase 4 – model architectures for extreme summaries/long context**
- Recurrence-aware summarization.
- Predict the expected claims before storing lasting facts.
- Keep evidence preservation and tier local injection intact.

**Phase 5 – advanced memory architectures**
- Titans/SSM/predictive memory experiments.
- Causal and counterfactual memory retrieval.
- High-risk/audit only, leaving primary UOWN rule memory untouched.

### 12.6 Concrete spike plan (if a trigger fires)

Do not build a model pipeline on speculation. If trigger #1 or #4 fires, run
this experiment on Unown's own notes before adopting anything:

1. **Dataset**: export the last N undreamed + recently dreamed notes with their
   dream outcomes (merged/pruned/added, canary pass/fail) from the engine DB.
   No benchmark data — the distribution that matters is Unown's notes.
2. **Baseline**: current behavior (consolidate all, canary as today). Record
   per-dream input/output tokens (from `runs.tokens_in/out`), wall time, and
   task outcomes on the canary + a held-out regression task.
3. **Candidate**: the proposed gate (deterministic floor first; embedding gate
   second; learned router last). Record skipped-call rate, token delta, and —
   critically — *recall of failure-bearing notes*: what fraction of skipped
   dreams contained a failure note that the baseline dream turned into a rule?
4. **Go/no-go**: ship only if (a) failure-note recall is 100% on the sample,
   (b) downstream task pass rate is unchanged within the harness noise floor
   (±0.06), and (c) token/time savings exceed 15% sustained over ≥2 weeks of
   real notes. Anything weaker is telemetry, not a gate.
4. **Isolation** (per MemDelta): change one variable at a time — gate logic,
   embedder, prompt, and retrieval must not change in the same experiment.

## 13. Sources

### Code inspected

- `pi-repo/packages/self-learning/src/memory.ts`
- `pi-repo/packages/self-learning/src/dream.ts`
- `pi-repo/packages/self-learning/src/notes.ts`
- `pi-repo/packages/self-learning/src/skills.ts`
- `pi-repo/packages/self-learning/src/llm.ts`
- `pi-repo/packages/self-learning/src/router.ts` (cadence, floors, triggers)
- `pi-repo/packages/self-learning/src/harness.ts` (ship gate, retention, budgets)
- `pi-repo/packages/self-learning/src/termhooks.ts` (terminal note sizes)

### Model and benchmark references

- GLiNER (arXiv:2311.08526), NAACL 2024 "Generalist Model for NER using
  Bidirectional Transformer."
- GLiNER2 (arXiv:2507.18546), "Efficient Multi-Task Information Extraction
  System with Schema-Driven Interface."
- GLiNER-BioMed (2026), "Suite of Biomedical NER Models."
- GLiNER-bi-Encoder (2026), "Breaking Scale Barriers."
- TypeSafe Jev official materials (system-one model).
- Independent Jev benchmark (arXiv:2609.37647).
- Jev blog posts, comparisons, and playground references from cited search
  results.
- JEPA (2023), I-JEPA; vision/body-mode, V-JEPA.
- LLM-JEPA (ICLR 2026) proof that the objective may benefit LLM training;
  not a runtime tool.
- VJEPA/BJEPA (arXiv 2026), probabilistic JEPA extensions.

### Agent-memory literature

- Rethinking Memory in LLM-based Agents (arXiv 2505.00675).
- Auto-Dreamer (arXiv 2605.20616), learned offline consolidation.
- AutoDreamer/Agent-Skills and related memory consolidation works.
- NeuSymMS (arXiv 2605.17596): LLM extraction, CLIPS-classified lifecycle,
  a concrete example of using a non-LLM decision layer for memory lifecycle.
- Mem0 (arXiv 2504.19413): dynamic extraction, consolidation, retrieval;
  graph memory only slightly improves accuracy.
- RecMem (ACL 2025): recurrence-gated LLM consolidation, embeddings for
  recall.
- True Memory (arXiv 2605.04897): verbatim storage, encoding gate, retrieval
  over stored events.
- SAGE (arXiv 2605.30711): novelty gate skips 16-18% write calls on A-Mem.
- Learning What to Remember (arXiv 2606.12945): learned multi-factor value,
  oracle limitations.
- Diagnosing Retrieval vs. Utilization Bottlenecks in LLM Agent Memory
  (ICLR 2026, arXiv 2603.02473).
- MemDelta (arXiv 2606.29914): controlled evaluation of memory architecture
  changes and confounds, plus benchmark baseline.
- Architecture docs for Letta, Neo4j agent memory, Mem0, and GLiNER.
- Routers: MemRouter (arXiv 2605.00356), MemAgent (arXiv 2609.32521), Router-Mem
  (arXiv 2608.01285).
- Verifiers/causal: VerMem (arXiv 2608.03137), AgentPRM (arXiv 2511.08325),
  CMI (arXiv 2605.17641), CAMEL (arXiv 2605.09330), ActMem (arXiv 2603.00026),
  Memory Reward Inflation (arXiv 2608.00017).
- Neural/predictive: Titans (arXiv 2501.00663) + Titans Revisited
  (arXiv 2510.09551), MemMamba (arXiv 2510.03279), Mamba-3 (arXiv 2603.15569),
  Nous (arXiv 2606.22030), MemoWM (arXiv 2610.10778).
- AGENTS.md tree summarized.

### Caveats

- Much of the 2026 source base consists of rapidly evolving preprints and
  vendor launches.
- Benchmark claims often contain confounds.
- No experimental implementation of any second model runtime was run in this
  repository. This is a literature-, source-, and architecture-grounded
  evaluation.

---

## 14. Related pages

- [memory.md](memory.md) — Unown memory stack, notes, AutoDream.
- [skills.md](skills.md) — skill minting and Agent Skills format.
- [testing-strategy.md](testing-strategy.md) — verification backlog.
- [configuration.md](configuration.md) — engine, ports, model, and runtime
  variables.
- `pi-repo/packages/self-learning/AGENTS.md` — engine and integrity gates.

Final takeaway: **Do not add classifier models as core memory components in
Unown today.** Keep consolidation, gating authority, and safety decisions
LLM-and-experiment-driven. Implement the three deterministic gates in §7a
(no model), keep classifier models restricted to narrow compliance and future
archival extraction tasks only if corresponding triggers occur, and require any
future ML gate to pass the spike plan in §12.6 on Unown's own notes.