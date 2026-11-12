# The Memory v2 round — closing the three gaps the field proved (2026-11-12, IN FLIGHT)

**Mission:** evaluate the detached memory system architecture by
reverse-engineering similar products/tools/projects (at least five — this
round swept eight memory-augmented-LLM products plus the adjacent
LangMem/MemOS/Supermemory tier) to understand what they are doing that is
proven better by user experience or research, then augment the workflows,
fix whatever breaks, improve the overall architecture, add visual
indicators for user delight, and cover the edge cases.

The Memory Encore round (v0.0.63, closed 2026-11-12) shipped the *visible*
layer: the freshness lane, the recall line, `/memory show`, the dashboard
health card. This round asks the question after that: **is the memory
*model* itself still frontier?** The teardown's answer — re-confirmed by an
independent eight-product sweep — is that the industry has moved past
Unown on three structural fronts, all three already named in
`docs/memory-competitor-research.md` as gaps #1-#3:

1. **Recency-delete is not supersede.** Graphiti's bi-temporal
   `valid_at`/`invalid_at` edge model, Mem0 Dream's Supersede badge, and
   Supermemory's `updates`/`isLatest` all retain the invalidated memory
   (linked to its replacement, queryable as "what was true then") instead
   of destroying it. Unown's reconcile DELETEs the loser — provenance is
   lost at the platform layer.
2. **One memory type is not enough.** Supermemory's typed auto-forgetting
   (facts persist, preferences strengthen, episodes decay), MemOS's
   L1→L2→L3→skills tiering, and LangMem's semantic/episodic/procedural
   taxonomy all give each memory type a different decay policy. Unown's
   flat 110-bullet cap drops oldest-first regardless of type.
3. **"Trust the dream" is not enough for inferred memories.** Supermemory's
   approve/decline/undo review queue for `derives` memories, Letta's
   "Agent reviews before applying" second pass, and Mem0 PR #4719's HITL
   overrides all gate model-inferred patterns behind a human. Unown's
   staged-skills lane (`skills-staged/`) is the precedent for skills but
   not yet for memories — cross-project hoists auto-ship today.

## Phase ledger

| Phase | Status | Artifact |
|---|---|---|
| CP0 research — eight products + the adjacent tier | ✅ done | `docs/detached-memory-comparative-research.md` + this file's code map |
| CP1 architecture — bi-temporal supersede with provenance | ✅ done | `memzero.ts` SUPERSEDE op + `isSuperseded`/`filterLatestOnly`/`memoryInvalidAt` + `memoryFreshnessStamp` supersede render + `memory-health.ts` `countSuperseded`/`supersededCount` + `dashboard-types.ts` `MemoryHealthCard.supersededCount` + `dream.ts` `DreamOutcome.superseded`/`supersededFragment` + `test/memzero-supersede.test.ts` (19 cases) |
| CP2 architecture — memory typing with per-type decay | ✅ done | `memzero.ts` `MemoryType`/`memoryType`/`mem0StaleDaysForType` + `memoryFreshnessStamp` per-type decay + `MEM0_CUSTOM_INSTRUCTIONS` type-teaching + `memory-health.ts` `countByType`/`typeBreakdown` + `dashboard-types.ts` `MemoryHealthCard.typeBreakdown` + `test/memzero-typing.test.ts` (13 cases) |
| CP3 architecture — the memory review queue | ✅ done | new `memory-review.ts` (park/list/approve/discard, modeled on `dream-review.ts` + `skills.ts` staged lane) + `test/memory-review.test.ts` (16 cases) |
| CP4 visual indicators — dashboard + recall line + health card | pending | `memory-screen.ts` + `engine-status.ts` + `memory-health.ts` extensions |
| CP5 edge cases + verification | pending | extended `memzero-unit.test.ts` + `memory-health.test.ts` + new `memory-review.test.ts` |
| CP6 docs/landing/blog/CHANGELOG/DOX + version + release | pending | v0.0.64; the rail regenerated; CI + release green |

## CP0 — the research and the code map (2026-11-12)

`docs/detached-memory-comparative-research.md` — eight products, every claim
sourced: **Mem0** (V3 ADD-only + platform Dream Supersede/Merge/Synthesis;
the TS SDK TOCTOU dedup race #6531, the dedup-window-miss #7123, the
cross-scope entity leak #5439 — all hit Unown since it runs the TS OSS
SDK), **Letta/MemGPT** (MemFS git-as-memory, worktree concurrency, dreaming
on compaction-event, `/doctor`; the memory-poisoning-across-sessions #3388,
the reflection-overwrites-fresh-facts #4097), **Zep/Graphiti** (the
bi-temporal edge model — `valid_at`/`invalid_at`, event time vs ingestion
time, episode→fact provenance; the silent-episode-loss #1707, the
cross-group filter bypass #2065), **Memary** (the breadth/depth split —
Memory Stream + Entity Knowledge Store, recursive subgraph retrieval),
**Cognee** (code-symbol graphs, session distillation two-stage acceptance,
COGX interchange format), **A-Mem** (Zettelkasten memory evolution —
existing memories re-tagged when new evidence arrives), **Memoripy**
(Ebbinghaus `R = e^(-t/S)` forgetting curves with reinforcement on recall),
plus the adjacent **LangMem** (semantic/episodic/procedural taxonomy),
**MemOS** (MemCube + MemScheduler + L1/L2/L3/skills tiering), and
**Supermemory** (`updates`/`extends`/`derives` relationship types, the
review queue for inferred memories, typed auto-forgetting, SMFS).

The ranked patterns → what this round ships: bi-temporal supersede (CP1,
Graphiti's edge model + Mem0 Dream's badge + Supermemory's `isLatest`),
memory typing with per-type decay (CP2, Supermemory's typed forgetting +
LangMem's taxonomy + MemOS's tiering), the review queue for inferred
memories (CP3, Supermemory's approve/decline/undo + Letta's second pass +
the staged-skills precedent). The honest gaps NOT shipped, on the record:
graph retrieval over memory links (HippoRAG 2 PPR / A-MEM evolution — a
deep lane needing its own benchtested round), the COGX interchange format
adoption (a cross-engine interop change deserving its own scope), and a
full `/doctor` trim policy (the audit surface ships in CP4 but the
auto-trim of derivable-from-repo content defers).

### The code map — where the three upgrades land

The spine is `pi-repo/packages/self-learning/src/memzero.ts` (2,077 lines).
Every upgrade touches it. The full file-by-file map (twelve seams) is
preserved in the task's research record; the load-bearing sites per
upgrade:

| Upgrade | Primary edit sites |
|---|---|
| **(1) Bi-temporal supersede** | `memzero.ts`: extend `PlatformMemory` (L392) + `MemoryPlatformEvent` (L405) + `ReconcileOp` (L1368, add `SUPERSEDE` op); modify `reconcileMemories` application loop (L1496–1566) to stamp `superseded_by`/`invalid_at` instead of DELETE; extend `memoryConfirmedAt` (L153) + `memoryFreshnessStamp` (L165) to render bi-temporal state; extend `RECONCILE_SYSTEM` (L1350) rule 1; extend `memory-health.ts` `countConflicts` (L195) + `MemoryHealth` (L149); add fields to `MemoryHealthCard` in `dashboard-types.ts` (L253); extend render footer (L2014). |
| **(2) Memory typing + decay** | `memzero.ts`: add `type` to `PlatformMemory.metadata`; extend `MEM0_CUSTOM_INSTRUCTIONS` (L203) to extract types; extend `RENDER_SECTIONS` (L1769) for preference/episode; extend the render cap loop (L1945–1958) for per-type decay horizons; extend `mem0StaleDays` (L145) to read a per-type map (`PI_MEM0_STALE_DAYS_PREFERENCE=180`, etc.); update `memory-guide.ts` (L34). |
| **(3) Review queue** | new `memory-review.ts` modeled on `dream-review.ts` (L1–134) + `skills.ts` staged lane (L101–165); route `hoist.ts` `promoted[]` (L308) into the queue instead of auto-write; new `/api/memory/review` routes in `server.ts` (after L1000); new `/memory review` subcommand in `tools.ts` (after L4722); new dashboard drill-in (`memory-screen.ts` L199); new `test/memory-review.test.ts`. |

### The setup verified (2026-11-12)

- Repository cloned at v0.0.63 (HEAD `63c7782b`, the v0.0.63 release receipt).
- Bun upgraded 1.3.14 → 1.4.4 (the install script requires ≥1.4; the
  pi-repo lockfile needs it).
- `agent:install` run green: root + pi-repo `bun install`, model data
  hydrated (40 provider files), `build:offline` green (8.5 MiB bundle),
  `.env` bootstrapped from `.env.example` with the Agnes AI upstream key
  injected (`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`,
  `BRIDGE_UPSTREAM_KEY` set, `BRIDGE_MODEL=agnes-3.0-flash`); `.env` is
  gitignored (mode 0600), no credentials in the tree.
- The local-ml lane installed (`@huggingface/transformers@4.3.1`) and its
  two blocked postinstalls trusted (`onnxruntime-node`, `protobufjs`) — the
  ONNX embedder is now operational (was lexical-fallback before).
  `GET /api/memory/health` reports `backend: "onnx"`, 2 memories reindexed
  lexical→ONNX.
- The llm-bridge (:3031) proxies to Agnes AI — verified with a direct
  `agnes-3.0-flash` completion returning `AGNES_OK`; `/v1/models` serves 6
  Agnes models.
- The engine (:3030) boots with bearer-token auth, memory platform live,
  9 router jobs started, `GET /api/memory/health` returning
  `{duplicateCount:0, conflictCount:0, warnings:[], memoryCount:2}`.

## CP1 — bi-temporal supersede with provenance (in flight)

The reconcile pass today DELETEs the loser of a contradiction (recency
wins, rule 1 of `RECONCILE_SYSTEM`). The upgrade introduces a `SUPERSEDE`
op that stamps `superseded_by` + `invalid_at` on the loser instead,
retaining it for audit and rendering it with a visible "→ superseded by
mem-abc · 2026-12-01" suffix. Search gains a `latest_only` filter so
superseded memories are excluded from recall by default but remain in the
store and the version history. This closes gap #1 and makes the health
card's `conflictCount` actionable (it already counts
`linked_memory_ids`-linked memories whose OLD side is still alive — that
counter becomes the supersede audit lane).
