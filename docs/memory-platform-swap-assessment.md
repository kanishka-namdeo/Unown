# Replacing the bespoke learning core with Mem0: assessment and decision

> Purpose: decide whether Unown's learning core — tier-memory storage, note
> consolidation (AutoDream), dedup, contradiction resolution and versioning —
> stays ~4,000 lines of bespoke engine code or moves onto a mature memory
> platform, and record the evidence so the decision survives the next dream.
>
> Research and decision note, 2026-10-22. Unlike the two harness-swap records
> ([oh-my-pi](oh-my-pi-swap-assessment.md), [opencode](opencode-swap-assessment.md)),
> which changed no code, this one is written **after the landing**: the swap is
> in the tree, every architectural claim below is verifiable at a cited
> `file:line`, and the guard wiring is pinned by tests.
>
> Verdict: **Yes — swap. The learning core runs on [Mem0](https://github.com/mem0ai/mem0)**
> (the `mem0ai` OSS TypeScript SDK, Apache-2.0, ~62.7k★, the ECAI-2025
> ADD→DEDUP→UPDATE extraction pipeline), **in-process inside the
> self-learning package, behind the same governed LLM bridge, in front of the
> same files-on-disk injection.** The engine keeps its shape and its contracts;
> what is replaced is the bespoke consolidation machinery underneath them. The
> committable artifact — `.unown/memory/project.md` — is preserved: it is now a
> deterministic *render* of platform memories, and pre-swap content imports
> verbatim at first run.

- [1. Method and evidence tiers](#1-method-and-evidence-tiers)
- [2. The structural cause: why the bespoke core had to go](#2-the-structural-cause-why-the-bespoke-core-had-to-go)
- [3. The options](#3-the-options)
- [4. Why Mem0 won](#4-why-mem0-won)
- [5. The architecture as implemented](#5-the-architecture-as-implemented)
- [6. Migration and import behavior](#6-migration-and-import-behavior)
- [7. Security posture](#7-security-posture)
- [8. What stays](#8-what-stays)
- [9. Rollback story](#9-rollback-story)
- [10. Open risks and revisit triggers](#10-open-risks-and-revisit-triggers)
- [11. Reproduction](#11-reproduction)
- [Related pages](#related-pages)

---

## 1. Method and evidence tiers

The candidate set was surveyed live (npm, GitHub, docs) on 2026-10-22; the
winner was then validated **end-to-end before any engine code moved** in a
scratch probe outside the tree (`scratch/mem0-probe/` in the workspace, not
committed: mem0ai@3.3.1 + Agnes AI `agnes-3.0-flash` + a local ONNX
`Xenova/bge-small-en-v1.5` embedder + SQLite stores; JSON mode and
tool-calling both exercised). The probe's artifacts — `vector_store.db`,
`history.db`, `vector_store_entities.db`, `hf-cache/Xenova/bge-small-en-v1.5`
— are on disk from that run.

Claim tiers follow the house convention:

- **[V]** — verified by direct read at a cited `file:line`, an npm registry
  field, or a command output re-run for this record. Where the check was run
  against our tree it says **[V-ours]**; against the candidate, **[V-cand]**.
- **[C]** — claimed by upstream (paper, README, registry metadata) or by the
  2026-10-22 research pass, not independently re-derived here. Actionable but
  unconfirmed.
- **[U]** — unknown; listed in §10.

One honesty note on the receipts: the live-probe numbers for Mem0 (stars,
LongMemEval) are upstream claims **[C]**, not our measurements — the same
discipline the memory-eval benchmarks apply to our *own* numbers does not
transfer to the vendor's. What *is* ours: the probe run, the shim validation,
and the guard-suite pinning below.

---

## 2. The structural cause: why the bespoke core had to go

The old core was a competent bespoke engine with a single-maintainer risk
profile. Specifics, not vibes:

| Problem | Evidence |
|---|---|
| The consolidation pipeline was one bespoke prompt + a single-shot file rewrite — every quality contract (recency-first, hard-won preservation, 120-line shape, quarantine) lived inside prompt text we alone maintained and re-hardened per model (F4 addendum 2: agnes-3.0-flash planted where kimi-k2.5 inoculated) | [`memory-system-review.md`](memory-system-review.md) F4; retired `dream.ts` SYSTEM prompt (pre-swap diff) |
| The dedup/quality machinery (local-ML dream lanes: MinHash dedup, activation ranking, hybrid curation — H11/H13/H14) shipped opt-in and OFF; the default path never benefited | [configuration](configuration.md) lane rows (now retired by this swap); H15 verdict in [benchmarks/nonllm](../benchmarks/nonllm/results/REPORT.md) |
| ~4k lines of learning-core code with no upstream: we were our own memory-pipeline vendor — every bug in extraction, dedup and contradiction resolution was ours to find and ours alone | module's own header count **[V-ours]** (`src/memzero.ts:6-7`); measured pre-swap at `HEAD`: 2,703 lines across the eight memory-facing modules (`memory 378 + dream 664 + localml 517 + guard 610 + budget 180 + memory-guide 28 + notes 117 + canary 209`), 3,481 counting the terminal-tier plumbing (`term.ts` 778) — the header's "~4,000" is the same set at its widest scope |
| The engine never had semantic recall: project memory was a flat injected file; "search the memory" was not a capability | pre-swap `server.ts` (no `/api/memories`); the platform adds one (`src/server.ts:523-537`) **[V-ours]** |

The honest counterweights — the parts the bespoke core did well — are exactly
the contracts this swap preserves by construction: recency-first
contradiction resolution, loser-never-current, hard-won-rule immunity,
versioned and attributable writes, gated dreams, quarantined notes. Those are
*product* decisions, and §5 shows where each one lives now.

The trigger to act now rather than later: the 2026-10-21 agnes campaign and
the memory-eval suites kept finding model-dependent layers in our own prompt
stack (the zero-extraction contract had to be enforced deterministically
*because* layer-2 prompt resistance broke across models). A memory pipeline
whose extraction quality is battle-tested across the field's model spread —
not just ours — removes a whole class of that maintenance.

---

## 3. The options

Short and factual. Stars are upstream counts from the 2026-10-22 survey
**[C]**; the fit column is ours.

| Candidate | Stars | License | Runtime | Memory model | Fit for an in-process embed |
|---|---|---|---|---|---|
| **Mem0** (`mem0ai` TS SDK) | ~62.7k★ | Apache-2.0 **[V-cand]** (npm `license`) | TypeScript SDK, in-process, pluggable LLM/embedder/store | LLM extraction → atomic, deduplicated, scoped memories (ADD→DEDUP→UPDATE) + history | **Yes** — TS-native, framework-agnostic, SQLite storage, custom embedder + custom-instructions seams |
| Letta / MemGPT | ~25.2k★ | Apache-2.0 **[C]** | Python-first; agents are long-lived OS *processes* | Agent-process model: memory blocks, core memory, archival recall | **No** — the agent-process model is too heavy for an in-process embed inside our Bun daemon; we need a library, not a runtime |
| Zep / Graphiti | — | license friction **[C]** (the survey's finding) | a Python service to run, plus clients | Temporal knowledge graph (bi-temporal edges) | **No** — a second daemon and a licensing model we would have to clear; the temporal-KG power is not what our bullet contracts need |
| Hindsight | — | OSS **[C]** | Python | LLM-curated memory | **No** — Python service model again; no TS embed |
| Mastra | — | — (not re-derived) | TypeScript framework | Framework with a memory *feature* | **No** — adopting it means framework lock-in for one surface; its memory surface is smaller than the problem |

(Mastra/Zep/Hindsight star counts omitted deliberately: the numbers were not
re-derived for this record and the rejections do not turn on them.)

The pattern the table encodes: the serious memory infrastructure in this
field is either Python or a whole framework. Mem0 is the one project that
ships the pipeline as a **library** with a TypeScript SDK — which is the only
shape that can live inside the self-learning package without becoming a
second daemon, a second language, or a framework migration.

---

## 4. Why Mem0 won

Maturity receipts (upstream claims **[C]** unless marked):

- **~62.7k★, the most-starred dedicated memory-layer project** — the default
  answer to "agent memory" in the field (GitHub count from the 2026-10-22
  survey; the GitHub API was rate-limited on re-check, so treat as **[C]**.
  The npm side re-verified: ~629k monthly downloads **[V-cand]**, registry
  search API 2026-10-22).
- **Apache-2.0** **[V-cand]** (`npm view mem0ai license`), repository
  `github.com/mem0ai/mem0` **[V-cand]** (`npm view mem0ai repository.url`),
  latest published `3.3.1` **[V-cand]** — we pin `^3.3.1`
  (`pi-repo/packages/self-learning/package.json`) **[V-ours]**.
- **A published method, not just a product**: ECAI 2025 paper *"Building
  Production-Ready AI Agents with Scalable Long-Term Memory"* — the
  ADD→DEDUP→UPDATE extraction pipeline we now run is the paper's pipeline
  **[C]**.
- **LongMemEval SCLA 93.4%** versus 87.1% for the full-context OpenAI memory
  baseline, per their paper **[C]** — i.e. the extraction pipeline beats
  "just inject everything" on long-horizon recall, which is the exact
  trade our render cap was guessing at.
- **Live-probe receipt (ours)**: mem0ai@3.3.1 + Agnes `agnes-3.0-flash`
  validated end-to-end in `scratch/mem0-probe` before the swap landed —
  JSON mode ✓, tool-calling ✓, scoped adds, contradiction-driven
  UPDATE/DELETE events, cross-project isolation (a `project:other` search
  returned 0 results), history retrieval, SQLite artifacts on disk
  **[V-ours]**.

And the architectural fit, which is what actually decided it:

1. **In-process library** — `new Memory({...})` inside the engine; no second
   service to supervise, no new failure domain in
   [resilience](resilience.md) terms.
2. **Pluggable everything** — the LLM, the embedder and the stores are
   constructor config, and the embedder/LLM instances are swappable
   post-construction (public fields). That is how the governed bridge and the
   local ONNX lane get in (§5).
3. **Atomic, scoped memories with history** — the granularity our guard
   always wanted: quarantine and revert operate on *memories*, not on
   re-parsed file text.

---

## 5. The architecture as implemented

The engine (Bun daemon, :3030) is unchanged in shape. Mem0 runs **in-process**
in the self-learning package; the platform's LLM traffic flows through the
existing llm-bridge exactly like every other learning call:

```
 notes ──▶ dream.ts consolidate()
             ├─ guard.ts scanUntrustedText ──▶ quarantined notes DROP OUT here (structural)
             ├─ mem0 add()          ──▶ LLM: GovernedLlm → llm-bridge (:3031) → upstream (Agnes)
             │                          extraction: ADD / UPDATE / DELETE events, scoped per agent
             ├─ guard sweep         ──▶ every extracted memory scanned; poison deleted pre-render
             ├─ reconcileMemories() ──▶ ONE governed chatJson call: recency-first verdicts applied
             │                          through mem0's own update/delete primitives
             └─ renderProjectMemoryMarkdown() ──▶ .unown/memory/project.md (the committable artifact)
 embedder: local-ml ONNX (Xenova/bge-small-en-v1.5, 384-dim) | lexical-hash fallback
 storage:  SQLite vector store + history in PI_MEM0_DIR (default DATA_DIR/mem0)
```

| Piece | Implementation | Receipt |
|---|---|---|
| Platform lifecycle | lazy in-process `Memory` singleton (`mem0ai/oss`), failed init retries on next call | `src/memzero.ts:361-439` **[V-ours]** |
| Governed LLM | `GovernedLlm` wraps mem0's LLM: every `generateResponse` lands in the governor ledger + feeds the upstream circuit breaker — the platform's calls obey the same auto-mode budget discipline as `llm.ts` calls; token accounting stays at the bridge (`/v1/usage`) | `src/memzero.ts:232-268` **[V-ours]** |
| LLM endpoint | the llm-bridge (`PI_BRIDGE_URL`, default `127.0.0.1:3031/v1`), model `modelFor("dream")` — i.e. `PI_DREAM_MODEL_ID` pins the platform's extraction/reconcile model too | `src/memzero.ts:92-103` **[V-ours]** |
| Embedder | `PI_MEM0_EMBEDDER=auto` (default): the local-ml ONNX lane (bge-small-en-v1.5, 384-dim — the H10/H11-verified lane, CI runs 39142263790 + 39156669131) when it loads, else a deterministic lexical-hash embedder (384-dim FNV-1a, tf-weighted, L2-normalized); `onnx` fails loudly; a backend switch re-embeds every stored memory through the public vector-store surface (idempotent, no mixed spaces) | `src/memzero.ts:118-220, 441-471` **[V-ours]**; [benchmarks/nonllm](../benchmarks/nonllm/results/REPORT.md) |
| Why local embeddings | Agnes serves **chat models only — no embeddings endpoint** (probed live 2026-10-22), so a local embedder is architecturally required; the lexical fallback keeps offline/stripped installs learning (keyword-class recall, deterministic) and names itself in every status surface (render footer, `/api/overview`) so degraded is never silent | research note + `src/memzero.ts:120-141` **[V-ours]** |
| Storage | SQLite vector store + SQLite history in `PI_MEM0_DIR` (default `DATA_DIR/mem0`), collection `unown`, dimension pinned to 384 at construction (the SDK's auto-dimension probe never runs) | `src/memzero.ts:67-89, 396-407` **[V-ours]** |
| Extraction guidance | `MEM0_CUSTOM_INSTRUCTIONS` — the surviving essence of the old AutoDream SYSTEM prompt: outcome-oriented rules, recency awareness, untrusted-input discipline, `linked_memory_ids` for supersession | `src/memzero.ts:105-116` **[V-ours]** |
| Reconcile pass | one `chatJson` call over a scope's memory list; verdicts (DELETE/UPDATE) applied through mem0's own primitives so every change lands in mem0's history; recency-first, loser-never-current, hard-won (kind `harness`/`seed`) preserved-but-not-protected-from-recency; hallucinated ids ignored | `src/memzero.ts:610-732` **[V-ours]** |
| Render | deterministic markdown: topic sections (`## Workflow`, `## Known pitfalls`, `## Task playbooks`, `## Environment`, `## Verified fixes`, `## Facts`), newest-first bullets, cap `PI_MEM0_MAX_RENDERED` (default 110 — the old "under 120 lines" shape) dropping **oldest** first with hard-won rules immune, provenance footer naming platform + backend + counts; an empty scope keeps the section skeleton so the next dream has shape to write into | `src/memzero.ts:815-894` **[V-ours]** |
| Revert | `revertMemoryEvents`: ADD→delete, UPDATE→restore previousText, DELETE→re-add verbatim — the exact event-stream rollback the canary and guard gates call | `src/memzero.ts:576-608` **[V-ours]** |
| Harness ships | `appendRules("project", …)` is now async: rules ship as verbatim atomic memories (`infer: false` — the ship gate already ran), the tier re-renders, and the version row records it; harness ships record their memory ids so retention's auto-unship deletes exactly what the ship added | `src/memory.ts:197-227`, `src/harness.ts:486-520, 600-655`, `src/memzero.ts:742-782` **[V-ours]** |
| Dream honesty | new `no-change` status: a dream where nothing substantive survived extraction, or the render is idempotent, consumes the notes without inflating versions; a project file is never overwritten with an empty skeleton | `src/dream.ts:54-63, 199-225, 499-521, 557-583` **[V-ours]** |

### Environment surface

All optional; registered in [configuration](configuration.md):

| Variable | Default | Meaning |
|---|---|---|
| `PI_MEM0_DIR` | `DATA_DIR/mem0` (`data/self-learning/mem0`) | data dir for `vector_store.db` + `history.db` |
| `PI_MEM0_EMBEDDER` | `auto` | `onnx` \| `lexical` \| `auto` (onnx when the local-ml lane imports, else lexical) |
| `PI_MEM0_MAX_RENDERED` | `110` | render bullet cap (oldest dropped first; hard-won rules immune) |
| `PI_MEM0_RECONCILE` | on | `0` disables the reconcile pass — the platform becomes mem0-additive-only |

### The Bun shim (the one real blocker, closed)

mem0's SQLite driver is `better-sqlite3`, whose native binding uses V8 APIs
directly and cannot load under Bun (the engine's runtime). Fix: a
`resolutions` override in `pi-repo/package.json` redirects the dependency to
`pi-repo/shims/better-sqlite3/` — a ~100-line drop-in that subclasses
`bun:sqlite`'s `Database` under Bun and `node:sqlite`'s `DatabaseSync` under
Node, covering exactly the API surface mem0ai@3.x uses (`exec` / `prepare` /
`transaction` / `close`, with better-sqlite3 semantics normalized).
Validated end-to-end in the scratch probe **and** by the in-tree suites; the
shim documents its own scope ("if mem0ai grows a new better-sqlite3 call, this
file grows a matching method"). **[V-ours]** `pi-repo/package.json`
(`overrides`), `pi-repo/shims/better-sqlite3/index.js`.

---

## 6. Migration and import behavior

Nothing is lost at the boundary; everything imports verbatim, once:

| Install state | What happens at first boot/dream |
|---|---|
| Fresh install | the project tier's starter rules seed into the platform as atomic memories with kind `seed` (render-immune to the cap), then render | `src/memory.ts:230-247` **[V-ours]** |
| Pre-swap engine (legacy tier content, empty platform scope) | `importLegacyMarkdown` stores every existing bullet **verbatim** (`infer: false` — no LLM rewrites them; the reconcile pass tidies later) with kind `legacy`, then re-renders and versions the import | `src/memory.ts:248-260`, `src/memzero.ts:793-813` **[V-ours]** |
| Pre-swap terminal project (established `.unown/memory/project.md`) | the first project dream imports the file's bullets verbatim into that project's scope before rendering — an established project's accumulated learning survives the swap | `src/dream.ts:483-489` **[V-ours]** |
| Dream-triggered path (engine DB has versions but platform still empty) | the same boundary guard runs inside `runDream` before the render replaces the tier | `src/dream.ts:185-193` **[V-ours]** |
| Teammate clones a repo with a committed `project.md` | their engine's platform scope is empty → first dream imports the committed bullets verbatim — the committable artifact still carries the learning across machines | same import path **[V-ours]** |
| Embedder backend switched later (e.g. lexical → ONNX after installing local-ml) | every stored memory is re-embedded through the public vector-store surface: same ids, same payloads, same history — only the embeddings change; interrupted reindexing re-runs at next boot | `src/memzero.ts:441-471` **[V-ours]** |

The render marks legacy/seed/harness provenance by section ("Verified fixes"
collects kind `harness`/`seed`) and the footer always names the active
backend, so a stale or degraded render is visible in the file itself.

One contract change, stated plainly: **hand edits to a project-tier
`project.md` no longer survive the next dream.** The file is a render of
platform state; the next dream re-renders from the platform, not from the
file. Hand-authored rules should enter as notes (`unown note …`, the `note`
tool) so extraction picks them up — or be made before the first import, which
does read the file. The other three tiers are untouched hand-editable files.
([memory](memory.md#editing-memory-by-hand) carries the user-facing version.)

---

## 7. Security posture

**Stronger than pre-swap, structurally.** The old defense leaned on prompt
resistance (model-dependent — the F4 addendum 2 lesson) with deterministic
backstops. The new primary layer needs no model cooperation:

1. **Structural zero-extraction (input side).** Every note passes
   `scanUntrustedText` *before* the platform: a flagged note is dropped from
   the batch — it never reaches the extraction LLM, so it cannot be
   paraphrased into memory. The quarantine contract stopped being a prompt
   rule and became control flow. Pinned: "a poisoned note never reaches the
   platform; the dream completes honestly" (`test/dream-guard.test.ts`,
   2026-10-22 run: 11/11 across the guard + canary-crash suites) **[V-ours]**.
2. **Extraction sweep (output side).** Every memory the platform *extracted*
   is scanned before it survives the dream — poison that arrives through the
   LLM's own output is deleted at atomic-memory granularity. Pinned by the
   same suite ("a poisoned EXTRACTION is deleted by the guard sweep before
   anything ships") **[V-ours]**.
3. **Ship gate on the render (unchanged semantics).** The rendered document
   still passes `decideGuardAction` with first-mint gating preserved on both
   dream paths — and a gated dream now also reverts the platform event stream,
   so the poison leaves the platform, not just the file **[V-ours]**
   (`src/dream.ts` guard blocks).
4. **Layer-2.5 echo backstop, actually wired this time.** The pre-swap dream
   passed the quarantined texts to the backstop under a wrong property name
   (`quarantinedNoteTexts` vs the expected `quarantinedNotes`), so the
   backstop never saw them; the swap fixes the key. With structural
   quarantine as the primary layer this is defense-in-depth restored, not the
   load-bearing wall **[V-ours]** (`src/dream.ts` both guard calls).
5. **Untrusted-input discipline travels with the extraction prompt.**
   `MEM0_CUSTOM_INSTRUCTIONS` forbids extracting runner/tool directives; the
   reconcile system prompt DELETEs injection payloads on sight **[V-ours]**
   (`src/memzero.ts:105-116, 612-625`).

What did not change: the guard rule set (`guard.ts`), the injection shield /
scanner split, the canary gate, the ship/mint gates, the sandbox model. The
platform's LLM calls are governed (§5) and its SQLite lives under `DATA_DIR`
with everything else engine-side.

---

## 8. What stays

The swap replaces the learning core, not the learning system:

- **Consumers unchanged in role**: harness, skills, hoist, router, dashboard,
  hooks, server routes, term injection. `harness.ts` ships rules through the
  platform for the project tier; the other tiers remain string-append file
  tiers (`src/memory.ts:197-227`) **[V-ours]**.
- **The files-on-disk principle**: sessions still inject tier files resolved
  from disk; pi's `agentsFilesOverride` seam is untouched. `.unown/memory/
  project.md` remains the committable artifact — now a rendered view.
- **The four-tier stack and precedence** (policy → project → user → local).
- **Guard/quarantine contracts** — preserved and strengthened (§7).
- **Gates**: dream canary, guard first-mint, ship gate, retention
  auto-unship (now deleting exact platform memory ids), skill mint gate,
  full version history (dream writes are attributable as `mem0`).
- **Budget discipline**: the governor ledger + circuit breaker cover platform
  traffic; the job watchdog and busy-mutex are unchanged.

---

## 9. Rollback story

Layered, with the strongest property last:

1. **Per-dream**: canary failure, canary crash, or a guard `gate` verdict →
   `revertMemoryEvents` rolls the exact event stream back **and** the memory
   version rolls back — both dream paths **[V-ours]**.
2. **Per-ship**: a harness improvement that regresses → auto-unship deletes
   exactly the memory ids that ship recorded (`improvements.memory_ids`) and
   re-renders **[V-ours]**.
3. **Per-version**: every render is a versioned row; the dashboard's
   one-key rollback restores a previous render's file content. Honest caveat:
   that restores the *file*, not the platform list — the next dream re-renders
   from platform state. Platform-level reverts are what 1–2 do.
4. **Whole platform**: `DATA_DIR/mem0/` is self-contained SQLite. Delete it
   and the next boot re-imports the on-disk tier content verbatim
   (`seedMemoryIfEmpty`'s legacy path) — the files remain the durable
   artifact even though the platform is the working set **[V-ours]**
   (`src/memory.ts:248-260`).
5. **Un-swap entirely**: the engine-facing seam is the `MemoryPlatform`
   interface (add/getAll/search/delete/update + events); every consumer
   talks to that, not to mem0. The exit ramp is one implementation swap, and
   the tier files on disk carry the full learning across it.

---

## 10. Open risks and revisit triggers

1. **TS SDK maturity vs the Python SDK** — the paper and LongMemEval numbers
   were earned on the Python pipeline; the TS SDK is the younger surface
   **[C]**. Mitigations: pinned `^3.3.1`, the narrow shim, the
   `MemoryPlatform` seam, and the live probe before landing. Watch: mem0ai
   release notes for changes to the post-construction injection points
   (§10.2 of this list).
2. **Post-construction injection is contract-by-public-field** — we set
   `memory.embedder` / `memory.llm` and call `_ensureInitialized()` on the
   SDK instance. An SDK refactor that moves or privatizes those breaks loudly
   at boot (init throws, engine reports the platform error on
   `/api/overview`, dreams record it) — degraded, not silent, but a break.
3. **Embedder dimension pinning (384)** — both backends are 384-dim by
   construction; the dimension is pinned so the SDK's probe never runs.
   Moving to another embedder family later means a deliberate re-embed pass
   (the reindex machinery already exists for backend switches).
4. **Version pinning + shim surface drift** — `mem0ai@^3.3.1` under a
   `resolutions` override to a local shim that implements exactly today's
   better-sqlite3 surface. Upgrade deliberately: run the probe, then the
   guard suites, then the engine. The 2026-10-27 security round added a
   second override on the same lever: `zod` is forced to 4.6.7 at the
   monorepo root because it reaches the tree only transitively (through
   `mem0ai` itself, `@anthropic-ai/sandbox-runtime` and the `openai` peer —
   GHSA-mrhx-c7xc-m3w5) — the same drill applies: the call sites were read
   for compatibility first, then the full engine suite re-ran green with the
   memory tier on the overridden zod.
5. **Test debt from the swap** — the deterministic suite currently reads
   3002 pass / 38 skip / **11 fail** (2026-10-22, this workspace): the
   failures are pre-swap expectations not yet updated for the async
   `appendRules`/`seedMemoryIfEmpty` signatures and the retired dream lanes,
   plus three legs this workspace trips because the local-ml subpackage's
   `@huggingface/transformers` install is absent. The *new* wiring is pinned
   (dream-guard + canary-crash: 11/11) but the stale expectations owe an
   update before the next release cut.
6. **Hand-edit contract change on the project tier** (§6) — user-visible,
   documented in [memory](memory.md#editing-memory-by-hand); watch for
   surprise in the wild.
7. **Per-dream cost shape** — extraction is one platform `add()` per batch
   plus one governed reconcile call (the old dream was one call total); the
   platform's internal LLM call count is observable per-dream in the
   governor ledger, which is the honest place to watch it. `PI_MEM0_RECONCILE=0`
   exists if the pass ever costs more than it earns.

**Revisit triggers**: mem0ai TS SDK goes unmaintained or ships breaking
changes we cannot absorb at the seam; the hosted Mem0 platform becomes the
only path to a capability we need (we are OSS-only by decision); extraction
quality regresses visibly in the dreams' merged/pruned stats; or the embedder
lane needs to change dimension families.

---

## 11. Reproduction

```bash
# The live probe that validated the architecture before the swap landed
# (workspace scratch dir, not committed; artifacts on disk: vector_store.db,
#  history.db, hf-cache/Xenova/bge-small-en-v1.5)
cd scratch/mem0-probe && bun install && bun probe-mem0-e2e.mjs

# The guard wiring of the mem0-backed dream (fake platform: no LLM, no network)
cd pi-repo/packages/self-learning && bun test test/dream-guard.test.ts test/dream-canary-crash.test.ts

# Candidate metadata (license / repository / latest version / downloads)
npm view mem0ai license repository.url version
curl -s "https://registry.npmjs.org/-/v1/search?text=mem0ai&size=1"   # monthly downloads

# The shim's driver under both runtimes
bun -e 'import Database from "./pi-repo/shims/better-sqlite3/index.js"; const db = new Database(":memory:"); console.log("bun ok")'
node -e 'import("./pi-repo/shims/better-sqlite3/index.js").then(m => { const db = new m.default(":memory:"); console.log("node ok") })'

# Docs links (this record)
bun run check:docs   # or: node scripts/check_docs.mjs docs/*.md
```

---

## Related pages

- [memory.md](memory.md) — the user-facing memory system this swap re-platformed (tier stack, note lifecycle, the platform-backed project tier)
- [memory-system-review.md](memory-system-review.md) — the critical review whose F-findings the swap's security posture answers (F4 addendum 3 records the change)
- [configuration.md](configuration.md) — the `PI_MEM0_*` env registry
- [oh-my-pi-swap-assessment.md](oh-my-pi-swap-assessment.md) — the first harness-swap record (verdict: no); a different question: the substrate, not the learning core
- [opencode-swap-assessment.md](opencode-swap-assessment.md) — the second harness-swap record (verdict: no); same invariant, different blocker
- [detached-engine-architecture.md](detached-engine-architecture.md) — the engine daemon this platform lives inside; budget governor + circuit breaker the GovernedLlm feeds
- [providers.md](providers.md) — the Agnes AI endpoint (`https://apihub.agnes-ai.com/v1`, `agnes-3.0-flash`) behind the bridge's failover lane
- [benchmarks/nonllm](../benchmarks/nonllm/results/REPORT.md) — H10/H11 receipts for the ONNX embedder lane the platform adopted
