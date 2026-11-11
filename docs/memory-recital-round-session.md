# The Memory Recital round — benchtest the memory system as a real user (2026-11-11)

**Mission:** drive the agent LIKE A REAL USER on complex tasks and complex
scenarios, benchtest the memory loop (sessions → notes → AutoDream → memory
injection → recall) end-to-end live, reverse-engineer five other memory
products to extract their engineering lessons, fix whatever breaks, improve
the learning system, add delight-grade visual indicators, and close the
round with docs/landing/blog/version/dependabot hygiene.

The distinguishing feature of this benchtest: the previous memory benchmarks
(`benchmarks/memory-eval/*`) feed **synthetic notes** into the dream. This
round drives **real agent sessions** (real `unown -p` runs doing real work in
a scratch project), lets the note pipeline capture what it captures, and
scores the loop as the user actually experiences it — including the
exit-note capture quality, the mid-session `note` tool, the dream trigger
latency, and the next-session injection.

## Phase ledger

| Phase | Status | Artifact |
|---|---|---|
| CP0 setup + run | ✅ done | this file (below) |
| CP1 real-user benchtest design + run | ✅ done (baseline + verification) | `benchmarks/memory-recital/manual-logs/` (transcripts), the tables below |
| CP2 reverse-engineer 5 products | ✅ done | `docs/TEARDOWN_2026-11-11_five-memory-systems.md` |
| CP3 fix bugs found + learning-system improvements | ✅ done (4 bugs + 1 follow-up) | code + 11 unit tests, receipts below |
| CP4 visual indicators (user delight) | ✅ done | the ⛨ chain: DB → API → dashboard row/detail → feed |
| CP5 edge cases + verification + formal benchtest suite | pending | `benchmarks/memory-recital/` |
| CP6 docs/README/blog/landing + version bump + dependabot | pending | — |

## CP1 — the real-user benchtest (2026-11-11, live)

**Scenario battery** (the scratch project `recital-shop` — a real TypeScript
CSV-library with a planted parser defect; every session is a REAL
`unown -p` run through the live stack: bridge :3031 → Agnes
`agnes-3.0-flash`):

1. **S1 — complex debugging:** fix the quoted-CSV parsing defect properly
   (+ three new edge-case tests). Exit note delivered → dream → 3 memories
   (the defect, the fix, the location). T2-class knowledge.
2. **S2 — knowledge update:** strict ISO date validation + render
   auto-sizing. Dream → the new rules extracted (old facts retained).
3. **S3 — reversal + preference + temporal:** drop the strict date rule
   (contradiction), require comment style (preference), record the dated
   switch (temporal, via the mid-session `note` tool — which works).

**The QA battery** (fresh sessions, memory-only answers, warm = memory
injected vs cold = fresh clone without `.unown/`):

| Probe | Warm | Cold | Verdict (baseline) |
|---|---|---|---|
| T1 temporal | ✅ 2026-11-05 | ✅ abstains | works |
| T2 history | ✅ correct | ✅ abstains | works |
| T3 knowledge-update | ❌ "no information" | ❌ hallucinated a confident "contract" | **BUG 1** |
| T4 preference | ❌ "not in memory" | ❌ abstains | **BUG 2** |
| T5 abstention | ✅ honest abstention | ✅ abstains | works |

**BUG 1 — reconcile deletes fresh evidence.** The extraction DID mint the
relaxed date rule (mem0 history rows `ce8b3d78`/`37e7d039`); the reconcile
verdict then deleted BOTH the old strict rule (correct) AND the fresh
replacement — the final list states nothing about date validation.
**BUG 2 — extraction drops stated conventions.** The comment-style
requirement (stated AND applied) never extracted — the project-memory
extraction prompt had no lane for it (matches recall-qa's weakest axis).
**BUG 3 — answer-only sessions pollute memory (found in the follow-up).**
After the QA battery, the auto-dream consolidated the QA sessions' own exit
notes: the warm arm's honest abstention ("No comment style is specified")
became permanent project convention ("no comment style is mandated" — the
NEGATION of a real requirement), and the cold arm's hallucinated
date-validation "contract" became that project's FIRST memory. The
QA-feedback loop is a real-user contamination lane.
**BUG 4 — the reconciler invents history.** A merged temporal marker
carried a fabricated "previously stated as a future switch" clause.
Also verified GREEN in the same battery: the mid-session `note` tool, the
manual dream trigger, the auto-dream 10-min cycle, the structural
injection quarantine (a poison note never reached the extraction LLM),
the engine-busy mutex on double triggers, and the engine's own canary
gating (a `gated` dream was rolled back live).

## CP3 — the fixes (2026-11-11)

1. **Fresh-evidence protection** (`memzero.ts` `reconcileMemories` +
   `dream.ts` `consolidate()`): DELETE ops on memories born in the current
   batch are rejected unless an exact-text twin survives the verdict (the
   platform's same-batch twin-dedup lane stays legal — the `localml`
   dream-wiring contract re-passes). Counts surface in
   `ReconcileResult.protectedDeletes`.
2. **The conventions lane + abstention ban**
   (`MEM0_CUSTOM_INSTRUCTIONS`): CONVENTIONS AND STYLE RULES are
   first-class procedural knowledge; NEGATIVE ABSTENTION answers are
   never facts.
3. **Answer-only outcome withholding** (`termhooks.ts`
   `buildTerminalNote`): zero-tool-call sessions ship "Final outcome
   withheld" (never the answer text); the withheld line itself is
   stripped at both guard layers (`guard.ts` layer-0 +
   `stripSessionMetadataLine`) — the live re-verification caught the
   extraction LLM minting the line's own meta-sentence into memory.
4. **No invented history** (`RECONCILE_SYSTEM` rule 5) + winner
   protection and merge-into-the-newest named in rule 1 (the deterministic
   guard enforces what the prompt asks).

**Verification (the same battery, fresh project `recital2-shop`, engine on
the fixed code): warm 5/5** — T3: "validateRows now accepts empty dates and
any parseable date… before it required strict ISO" (correct, from memory);
T4: "comment style in recital2-shop: sentence case, no trailing periods"
(extracted, recalled); T1/T2/T5 unchanged-correct. The QA exit notes now
carry the withheld line; a dream over them lands nothing (pre-fix: the
abstention/hallucination pollution). 11 new unit tests; engine suite
5535/0/105 (5521/0/105 at the full-suite mark + the withheld-line strip
re-run).

## CP0 — setup + run (2026-11-11)

- Fresh clone of `kanishka-namdeo/Unown` @ `c7280cec` (main, v0.0.61) via PAT
  credential helper (PAT never printed, never committed).
- bun upgraded 1.3.14 → **1.4.3** (floor 1.4, lockfileVersion 3).
- `bun run agent:install` 7/7 green (engine systemd unit skipped in
  container — no user bus; agent-side auto-start carries it, per
  docs/routines.md).
- `.env` from `.env.example`; `BRIDGE_UPSTREAM_KEY` set (Agnes AI);
  upstream `https://apihub.agnes-ai.com/v1` — upstream verified live:
  `GET /v1/models` lists 6 agnes models; `agnes-3.0-flash` chat
  round-trip verified (`AGNES-OK`).
- `bun run agent:start` — bridge :3031 (upstream ok 200), engine :3030
  (phase ready, token auth, v0.0.61, 6 tasks).
- `unown doctor` — green (2 expected warnings: unverified model spec
  until first session, no LSP servers).
- LLM lane: `zai-bridge/agnes-3.0-flash`.

## Grounding research (2026-11-11, online)

Reverse-engineering targets selected and researched (full notes in the
teardown docs, CP2):

1. **Mem0 v3** — ADD-only extraction, Dream consolidation
   (Supersede/Merge/Synthesis), 4-signal fused retrieval (semantic + BM25 +
   entity boost + temporal), decay as ranking bias (0.3–1.5×, never filter),
   ~7K-token injection budget target, LoCoMo 92.5.
2. **Zep/Graphiti** — bi-temporal knowledge graph (valid_at/invalid_at +
   created_at/expired_at), contradiction = fact invalidation not deletion,
   episode provenance, hybrid retrieval + cross-encoder rerank.
3. **Letta (MemFS)** — memory as a **git repo of Markdown**, root files in
   every system prompt + `MEMORY.md` signpost indexes per directory,
   sleep-time compute "dreaming" subagents (step-count/compaction
   triggers), git worktrees for concurrent memory edits, RecoveryBench
   fresh-vs-experienced evals.
4. **Cognee** — 9-stage `improve()` pipeline, curator/writer-rejecter gated
   distillation, watermarks (each entry consolidated exactly once), budget
   exhaustion = skip-not-fail, feedback weights persisted across re-ingestion.
5. **LangChain/LangMem + LlamaIndex Memory** — profile vs collection
   tradeoff, hot-path vs background write timing, priority-ranked blocks
   with hard token budgets, XML-tagged injection.
6. Benchmark methodology: the **LoCoMo audit** (6.4% wrong gold answers,
   62.81% judge leniency on vague-but-topical wrong answers, category CI
   problems) + **LongMemEval** (5 abilities incl. abstention) + BEAM —
   lessons: fixed judges, mandatory no-memory/full-context baselines,
   per-category reporting, cost triad, CI gates.

Key engineering deltas identified for Unown (evaluated in CP3):
temporal metadata at write time + read-time temporal intent boost,
supersede-instead-of-prune in the reconcile pass, memory-doctor self
diagnostics, decay as soft ranking, feedback weights wired to harness
outcomes, watermarks on note consolidation.

## CP4 — visual indicators, the ⛨ chain (2026-11-11)

The assessment: the learning loop's safety work was INVISIBLE — the
fresh-evidence guard (CP3) rejects reconcile DELETE verdicts silently,
and "the system protected your just-learned rule" is exactly the moment
worth showing. The indicator chain (one source, four surfaces):

1. **Store**: `dreams.entries_protected` (schema + idempotent
   `ALTER TABLE` migration; 0 = guard did not fire, NULL = pre-round rows).
2. **Dream rows**: every done/gated dream records the count; the row's
   note carries the `N fresh-delete verdict(s) protected` fragment; the
   version-row note and the pending-dream review summary carry it too.
3. **Dashboard Dreams screen**: the list row gains `⛨ N protected` (the
   emerald success tone — the guard protecting the user's current state);
   the drill-in detail adds a "fresh evidence protected" field with the
   one-line explanation. Opt-in by event — a standing "0 protected" would
   be noise.
4. **The live feed**: `dream:finished` events carry
   `stats.protected`, and the feed line renders `· ⛨ N protected`.

**Live receipts (2026-11-11, post-fix engine):** the engine's own dream
(`in: 4, added: 5, protected: 1`) and recital2-shop's v4 project dream
(`in: 2, added: 3, protected: 1` — the reconcile tried to delete the
fresh Title-Case comment-style carrier; the guard held, and the
CONTRADICTION still resolved correctly: the old sentence-case preference
is gone, the new one stands). Pinned by the mock-fixture render test
(`dreams: [..., "protected"]`), the feed tests, and the end-to-end
wiring test in `test/manual-notes.test.ts`.
