# Teardown 2026-11-14 — five new-wave memory platforms

> The third teardown in the memory lineage (Recital: five platforms,
> Encore: eleven products, the comparative sweep: eight). This round covers
> the **new wave** none of those reached — platforms that shipped after, or
> beside, the first teardowns, and are now the field's fastest-moving lane.
> Five platforms, every claim sourced; `[V]` = verified in fetched
> source/docs/repo, `[C]` = vendor-claimed, `[U]` = inference. Companion
> pages: [memory-divertimento-round-research.md](memory-divertimento-round-research.md)
> (the papers sweep + consumer-UX patterns) ·
> [detached-memory-comparative-research.md](detached-memory-comparative-research.md)
> · [memory.md](memory.md).

| # | Platform | What it is | The pattern this round takes from it |
|---|---|---|---|
| 1 | memU (NevaMind-AI) | memory sidecar for coding agents, "personal memory stored as Wiki" | agent-distills / store-verifies; the self-mining exclusion (ADR-0015); 22 published ADRs |
| 2 | MIRIX (+ MIRIX-2.0) | six-typed multi-agent memory system (Letta foundation) | usage-conditioned decay with recurrence reset; AutoDream dry-run; the soft-delete leak class |
| 3 | Nemori (Tanka.ai) | episodic segmentation + predict-calibrate distillation | prediction-error as the retention signal; temporal anchors baked into episodes |
| 4 | Memobase (memodb-io) | user-profile-centric memory server | the temporal benchmark delta (+29.5 pts over Mem0); profile as a materialized artifact |
| 5 | Hindsight (vectorize-io) | four-bank memory system with disposition traits | refine-don't-overwrite observations; purpose-built small models; the 61k-star traction signal |

---

## 1 — memU: the store-verifies/agent-distills split

Repo <https://github.com/NevaMind-AI/memU> (the old `nemocrab/memU` path is
404 — the repo moved [V]); sites memu.pro / memu.so; Apache-2.0. ⭐14,623,
v0.11.0-beta.3, latest commit 2026-11-14, 235 issues/69 open [V].

Two eras. v1.x was "24/7 Always-On Proactive Memory" with
memory-as-a-file-system (Categories=folders, Items=files, cross-refs=
symlinks, Resources=mount points) [V]. **v2.0-beta (2026-07-23)** pivoted to
"Personal memory, stored as Wiki. Across Sessions. Across Agents. Across
Devices." — a sidecar to desktop coding agents, pitched as a **~500-line
core** [V].

Architecture (v2, from code) — two seams per host [V]:

- **record**: a scheduled bridging task slices new session logs into
  self-contained job files; *the host agent itself* distills them into
  memory/skill Markdown; `commit` submits what the agent left on disk.
- **inject**: a standing instruction patched into the host's instruction
  files (`~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`, per-project `AGENTS.md`
  for Cursor, `~/.pi/agent/AGENTS.md` — adapters for Codex, Claude Code,
  Cursor, OpenClaw, Hermes, WorkBuddy, Cola, pi, plus `memu-agent detect`
  for anything else) telling the agent to run `<binary> retrieve` before
  answering [V].

Storage: tracked **Markdown files** (ADR-0007 renamed MemoryItem→RecallEntry,
MemoryCategory→RecallFile); three independent memory lines (chat→`MEMORY.md`,
workspace→`INDEX.md`, skill→`SKILL.md`), each L0→L1→L2 (raw→doc→item slices);
**the graph was explicitly dropped** — "retrieval is hybrid embedding+BM25,
no graph" [V]. Backends: sqlite (brute-force cosine) / postgres (pgvector),
SQLite-first [V]. The load-bearing design law: **"`MemoryService` makes no
LLM or chat calls; it stores, embeds, and retrieves the skill Markdown the
agent prepared"** [V] — judgment stays in the agent, the memory layer is a
dumb verifiable store.

Edge-case gold, both measured in production [V]:

- **Self-mining contamination (ADR-0015):** the bridging task runs as a host
  session, so memU mines its own bookkeeping — measured **19 of 95 tracked
  Claude Code sessions (2,111 of 25,833 records) were its own runs; on
  Hermes 4 of 5**. Fix: identity from the host session-ID env, never from
  transcript content; a skip-list into `prepare`.
- **Provenance invalidation (ADR-0006):** skills had "no provenance link, so
  they never invalidate on source change/delete" — fixed by making skills
  first-class `RecallFile(track="skill")` rows so a source change can
  invalidate the derived memory [V].
- Atomic local commits under concurrency (#805, 2026-11-14) [V]; offline
  telemetry spool with idempotent `event_id` that "counts, never content"
  [V]; Windows UTF-8/HERMES_HOME/scheduler-PATH quirks pinned by tests [V].

Evidence of quality: LoCoMo 92.09% is vendor-claimed for v1 [C]; v2
publishes no benchmark — the pitch is inspectability + cross-agent
portability [U]. Real evidence is traction: 15k stars, daily commits [V].
`memu.so` renders memory as a **wiki of Markdown files** with per-agent/
per-device session feeds ("Codex · MacBook Pro yesterday 09:12") [V]; CLI
`doctor` "proves the whole loop resolves: config, selected mode, and a live
retrieval" [V]; `uninstall` keeps the memory store (memory erased only on
explicit request) [V].

What Unown takes: (a) the **self-audit question** — does our dream lane ever
feed on its own bookkeeping? (checked in CP1; the answer is no by taxonomy —
dream rows are not notes — but the check is now pinned by a test); (b)
**provenance-linked invalidation** (our supersede stamps carry the successor
link — the same law, already half-shipped, finished by CP2); (c) the
**doctor that proves the loop** (CP5's `unown memory doctor` runs a live
retrieval, not just file-existence checks — the exact `memu doctor` shape).

## 2 — MIRIX: typed stores, AutoDream, and the experience-pool decay

Repo <https://github.com/Mirix-AI/MIRIX>; docs.mirix.io; paper
<https://arxiv.org/abs/2507.07957>; MIRIX-2.0 paper
<https://arxiv.org/abs/2611.12068> (Nov 2026) [V]. ⭐3,464, last push
2026-11-11 [V]. **Pivot**: from 0.1.6 main is "a pure memory system… the
desktop personal assistant has been deprecated" [V].

Six typed memories, each with its own ORM/manager/agent [V]: **Core**
(persona+human blocks, always visible), **Episodic**
(occurred_at/event_type/actor/summary), **Semantic** (entities+source),
**Procedural** (skills: instructions/triggers/examples/version/provenance/
citations/usage records), **Resource** (files/links), **Knowledge Vault**
(sensitive facts, delete-only API) [V].

**AutoDream**: `POST /memory/auto_dream` with `dry_run: true`,
`last_n_sessions`, `graph_only`; conservative-by-construction prompts —
"Prefer merging over deletion… **if two events conflict and the correct
answer is unclear, keep the uncertainty in the merged details**" [V]. Dream
merges duplicate anchors instead of rewriting memories; MIRIX-2.0's
semantic merges are restricted to a **newly-written frontier** (NN anchors,
cos≥0.86, LLM-verified, **lossless structural merge** — union row IDs, keep
aliases, rewire frames, **never rewrite/delete records**) [V].

**The experience-pool decay (the crown jewel)** [V]:
`score = sim × 0.5^ignored_pushes`; **recurrence (cosine ≥ threshold) resets
ignored_pushes** and increments recurrence_count; uncited shows +1 ignored;
"not worth" +2 (new rejects enter pre-decayed); **retire at 3 ignored
pushes**; scan limit 2000, min-sim 0.60 — all env-tunable. Docs advertise
global retention `fade_after_days: 30` (excluded from retrieval) /
`expire_after_days: 90` (permanent delete) [V] — not found in the OSS tree
(docs run ahead) [U].

Results: ScreenshotVQA **+35% relative over RAG at 99.9% storage
reduction** [V]; LoCoMo 85.38% (gpt-4.1-mini) vs Zep 79.09, LangMem 78.05,
Memobase 70.91, Mem0 62.47 [V]; MIRIX-2.0: **91.4% LoCoMo, 72.6%
LongMemEval-S (+14.3 over the best baseline)**; AutoDream worth **+31.0/
+22.0 pts** on single/multi-hop doc QA; 49.2% MetaClaw-Bench vs 44.0%
skill-library [V].

The honest-ops dividend [V]: an in-repo security-integrity review
(2026-11-09, 3,229 passing tests) fixed 11 defect classes, including:
**deleted memories still searchable** (soft-delete missing in the SQL/
Redis/graph paths — the exact recall-integrity class), snapshot restore
false success, **different numeric values merged by Dream** (fix preserves
sign/decimals/dates/percent/currency/units — the "numeric merge" guard),
API auth bypass, password-hash leakage. Every one of those is a test class
Unown's CP1 pins as a regression battery.

What Unown takes: (a) **usage-conditioned decay with recurrence reset**
(CP3 — our per-type horizons are TTL-only today; the ignored-pushes/
recurrence pattern upgrades them to use-it-or-lose-it); (b) the
**soft-delete-leak regression class** (CP1's search-path integrity tests);
(c) the **numeric-merge guard** as a reconcile test case (CP2).

## 3 — Nemori: prediction error as the retention signal

Repo <https://github.com/nemori-ai/nemori> (the Tanka.ai team); paper
<https://arxiv.org/abs/2508.03341> v4 "What Deserves Memory: Adaptive
Memory Distillation for LLM Agents" (2026-04-16) [V]. ⭐221, quiet ~7 months
since [V].

Two memory types only — **Episode** (title, content, source_messages,
temporal anchors, provenance) and **SemanticMemory** (content, type,
`source_episode_id`) — deliberately minimal [V]. Pipeline [V]: per-user
buffer → **LLM boundary detection** (Event Segmentation Theory) → episode
generation with **precise temporal anchors and provenance** → merger →
**semantic distillation via predict-calibrate**: the LLM *predicts* the
episode from existing semantic knowledge, and **only the deltas (prediction
errors) become new knowledge**; direct extraction when no priors exist
(cold start) [V].

Self-run LoCoMo (in-repo artifacts): overall **0.8305** (temporal 0.7882,
multi-hop 0.7943) [V]; the honest FAQ admits the token cost of episode
granularity and that temporal expressions ("the previous Friday (June 23,
2023)") are baked into episode text [V].

What Unown takes: the **predict-calibrate question** for our reconcile —
"would this 'new' memory have been predicted from what we already know?"
is exactly the duplicate/derivation test our audit pass (CP5) needs; and
the **temporal-anchor discipline** (CP4's provenance lines carry the date
the way Nemori bakes it into the episode).

## 4 — Memobase: the profile artifact and the temporal delta

Repo <https://github.com/memodb-io/memobase>; ⭐2,957, last push 2026-01-11
— **stalled ~10 months** [V]; team now fronts Acontext [V]. Positioning:
"**Memory for User, not Agent**" [V].

All data = per-user **blobs** → **buffer** (flush at ~1024 tokens or ~1h
idle) → extraction into **structured profiles** (`topic/sub_topic/content`)
+ **event timeline with fine-grained event gists** [V]. Cost engineering:
"LLM calls from ~3–10 to a **fixed 3**" [C]; profile reads are "a few SQL
operations, **<100ms**" — the ChatGPT-memory no-preprocess read shape [C].

The standout result of this round, from committed artifacts [V]:
LoCoMo v0.0.37 overall **75.78 — temporal 85.05** vs Mem0 66.88 (temporal
55.51), Mem0-Graph 68.44, LangMem 58.10, Zep 65.99, OpenAI 52.90; Zep's
own re-run (issue #101) 75.14, temporal 79.79. **The +29.5-pt temporal delta
over Mem0 — on the store Unown itself runs — is the single clearest
"proven better" signal in this teardown.** The mechanism: a small
always-materialized, timestamped artifact read directly, no
retrieval-time synthesis.

What Unown takes: the **materialized-artifact law** (our four tiers are
already materialized files — the lesson is that per-memory *timestamps in
the artifact* are what win temporal questions; our freshness stamps exist,
CP4 makes them count on every surface, and CP2's SRO keys make
supersession deterministic rather than similarity-guessed).

## 5 — Hindsight: refine-don't-overwrite, at 61k stars

Repo <https://github.com/vectorize-io/hindsight>; arXiv
<https://arxiv.org/abs/2512.12818> (with Virginia Tech's Naren
Ramakrishnan); MIT; **61,000★** — the fastest-growing memory system on
GitHub as of 2026-11-14 [V].

Four logical networks — **world facts, experiences, observations, mental
models** — in isolated banks with **disposition traits** (skepticism,
literalism, empathy) [V]. Operations **retain/recall/reflect**; recall = 4
parallel strategies (semantic, BM25, graph entity/temporal/causal,
temporal) fused by RRF + cross-encoder rerank [V].

**Observations = refine-don't-overwrite** [V]: each keeps exact-quote
evidence + **proof_count** + JSONB history; new evidence "strengthens,
weakens or extends" rather than replaces. **Mental models/pages**: standing
answers to fixed questions, background-rewritten, readable as a plain DB
read; **pages project onto disk as ordinary markdown** [V]. Purpose-built
open models (Nov 2026): `hs-decide-1-flash` (0.8B), `hs-rerank-1` (114M),
`hs-embed-1` (112M) [V]. **Memory Defense**: 45 PII/secret patterns,
redact-or-block at retain time [V]. Live benchmarks [C]: LongMemEval-S
94.6%, LoCoMo 92%, PersonaMem 86.6%, BEAM-1M 73.9%, with independent
reproduction claimed by VT's Sanghani Center + the Washington Post [C].

What Unown takes: the **evidence ledger** idea (CP2's supersede stamps +
CP4's provenance lines are the first half; the proof-count concept informs
CP3's dormancy — an excluded memory is "unproven recently", not "wrong");
and the **recall-time fusion discipline** (CP1's search-path integrity is
its recall hygiene prerequisite).

---

## The honest verdict, mapped to this round's checkpoints

1. **Integrity before features** (MIRIX's security review, memU's ADRs):
   Unown's own v2 round left the review queue **unwired** (an orphan module
   — verified in code), the search path **returns superseded memories as
   current** (verified: `filterLatestOnly` runs only in the render), and
   the per-type budget never replaced the flat cap. → **CP1**.
2. **Deterministic supersession** (the field's bi-temporal ledger + this
   round's MemStrata finding, see the research doc): similarity-based
   conflict detection is measured at AUROC 0.59 — chance — on contradicted
   vs duplicated facts; a deterministic (subject, relation, object) rule in
   a bi-temporal ledger takes stale-fact errors 15–40% → ~0%. → **CP2**.
3. **Usage-conditioned decay** (MIRIX's experience pool): per-type TTL
   alone is the weak variant; use-it-or-lose-it with recurrence reset is
   the proven upgrade. → **CP3**.
4. **Visible provenance and delight** (memU's wiki + session feeds, Gemini's
   Statement+Rationale, the post-consolidation digest): every recalled item
   carries its source and date; every consolidation shows the user what it
   did. → **CP4**.
5. **The doctor that proves the loop** (memU `doctor`, MIRIX's eval
   integrity): an audit pass that runs a live retrieval and reports
   duplication/budget/placement. → **CP5**.
6. **Interchange** (memU's cross-agent portability as its whole pitch):
   a Unown memory export/import, trust-gated. → **CP6**.

Sources: every `[V]` above was fetched and read on 2026-11-14 from the
linked repos/docs/papers; star counts from the GitHub API. The companion
papers sweep and consumer-UX research live in
[memory-divertimento-round-research.md](memory-divertimento-round-research.md).
