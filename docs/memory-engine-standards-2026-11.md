# Memory-engine standards floor — late 2026 (the round's grounding research)

The grounding base for the memory-engine combination round
(`docs/memory-engine-combo-round-session.md`): what a production-quality AI
agent memory engine must do in November 2026 to be considered current,
distilled from live-fetched sources (npm/PyPI registries, official docs
sites, GitHub raw files, arXiv — all opened 2026-11-10; no figure below is
invented, and the two fetch-blocked sources are flagged in place).

Scope: the **memory engine** — the four-tier stack, the Mem0 platform tier,
AutoDream consolidation, the note pipeline, search/rollback/health — not the
harness, plan mode or the TUI (those have their own standards docs:
`plan-mode-standards-2026-11.md`).

## 1. The reference systems (what they ship in late 2026)

**Mem0** (`mem0ai` on npm) — TS SDK **3.3.1** (2026-09-25; 3.0.0 landed
2026-04-16). API surface: `add/search/get/get_all/update/delete/delete_all`
scoped by `user_id/agent_id/app_id/run_id`; v3 async endpoints
(`/v3/memories/add` → `PENDING` + `event_id` polling); per-memory
**history endpoint** (`/v1/memories/{id}/history`); orgs/projects
multi-tenancy; Dream (consolidation) config/stats/activity/runs/sources/
preview; webhooks; feedback; export. The 2026-04 algorithm is **ADD-only
single-pass extraction** (nothing overwritten; six-stage pipeline; hash
dedup; `attributed_to` metadata), **multi-signal retrieval** (semantic +
BM25 + entity-graph + temporal fused), native always-on **graph memory**.
Reported: LoCoMo 92.5, LongMemEval 94.4, ~6,956 mean tokens per retrieval.
Dream: Supersede (badged, `latest_only=true`) and Merge (hidden,
`include_merged=true`) always on; Synthesis opt-in, additive, idempotent,
links patterns back to **source memories as evidence**; "nothing Dream does
is destructive — every change is recorded and reviewable". SDK memory
**expiration** (`expiration_date` hides, never deletes; `showExpired`
restores). Notably: Mem0's public docs contain **no MINJA-specific defense
page** — their practical posture is storage-layer scoping ("a query scoped
to one identity cannot see another identity's memories… enforced at the
storage layer, not by convention"). Mem0 even ships a first-party **Pi
agent plugin** (`@mem0/pi-agent-plugin` v0.3.0): auto-capture on
`agent_end`, recall before every turn, project/session/global scopes from
the git root, tool output truncated to 200 lines/50KB.
Sources: https://registry.npmjs.org/mem0ai ·
https://docs.mem0.ai/openapi.json · https://docs.mem0.ai/llms.txt ·
https://docs.mem0.ai/platform/features/dream.md ·
https://raw.githubusercontent.com/mem0ai/mem0/main/README.md ·
https://docs.mem0.ai/integrations/pi-agent.md ·
https://mem0.ai/blog/ai-agent-memory-governance-meaning-best-practices-for-secure-memory

**Letta** — the active source is now **`letta-ai/letta-code`**
(`npm install -g @letta-ai/letta-code`). The late-2026 architecture is
**MemFS**: memory is a per-agent **git repo**; every memory edit is a commit
(version history, conflict resolution, saved-vs-uncommitted boundary);
root files load into the system prompt every turn while indexed directories
stay out of context until needed (**progressive disclosure** via `MEMORY.md`
signposts); no vector index by default (grep/read tools; optional semantic
mod); memory subagents (dreaming, **memory doctor**) update memory
concurrently via **git worktrees**. `/init` bootstraps, `/remember` teaches,
`/doctor` **audits placement, duplication, and system-prompt token usage**,
`/sleeptime` configures consolidation with an optional "agent reviews
before applying" gate; reorganization **backs up the repo first**. The
famous filesystem finding (Aug 2025): **74.0% on LoCoMo** by simply storing
conversation histories in files — "memory is more about how agents manage
context than the exact retrieval mechanism". Sleep-time compute is their
consolidation paradigm; the **Context Constitution** (2026-04) treats
context as a scarce resource.
Sources: https://raw.githubusercontent.com/letta-ai/letta/main/README.md ·
https://docs.letta.com/concepts/memfs/index.md ·
https://docs.letta.com/configuration/memory/index.md ·
https://www.letta.com/blog/benchmarking-ai-agent-memory ·
https://www.letta.com/blog/sleep-time-compute ·
https://www.letta.com/blog/context-constitution

**Zep / Graphiti** — open-source **temporal context graphs**: entities with
evolving summaries, facts/edges with **temporal validity windows**,
**episodes** as raw-data provenance ("every derived fact traces back to its
source"), incremental construction, hybrid retrieval (semantic + keyword +
graph traversal); invalidated facts are **not deleted**. Zep paper: 94.8%
vs 93.4% over MemGPT on DMR; LongMemEval up to +18.5% accuracy with 90%
latency reduction.
Sources: https://raw.githubusercontent.com/getzep/graphiti/main/README.md ·
https://arxiv.org/abs/2501.13956

**LangMem / LangGraph** — the taxonomy is now standard: **semantic** (facts),
**episodic** (experiences), **procedural** (rules); updates either **in the
hot path** or **in the background**; recall should rank by similarity
**plus importance and strength (recency/frequency)** — not similarity alone.
Sources: https://docs.langchain.com/oss/python/langgraph/memory ·
https://raw.githubusercontent.com/langchain-ai/langmem/main/README.md

**Instruction-file conventions (the tier stack's peers)** — **AGENTS.md**
is the de-facto standard ("over 60k open-source projects", stewarded by the
Agentic AI Foundation under the Linux Foundation; adopted by Codex, Cursor,
Gemini CLI, GitHub Copilot coding agent, opencode, Zed, Warp, …), nested
with "the closest AGENTS.md to the edited file wins". **Claude Code** runs
a four-tier load: managed policy (`/etc/claude-code/CLAUDE.md`) → user
(`~/.claude/CLAUDE.md`) → project (`./CLAUDE.md`, or repo `AGENTS.md`) →
local (`./CLAUDE.local.md`, gitignored), plus auto memory capped at
**200 lines / 25KB**, `@file` imports with an **approval dialog for
imports committed by others**, and **`/doctor prompt-audit`** (reports
outdated/conflicting instructions without editing them). **Gemini CLI**
loads global → workspace → just-in-time context on file touch, with
`/memory show|reload`. **Cursor** organizes rules as Project
(`.cursor/rules/*.mdc`, glob/description-gated) / User / Team / AGENTS.md.
Sources: https://agents.md ·
https://docs.claude.com/en/docs/claude-code/memory.md ·
https://www.geminicli.com/docs/cli/gemini-md ·
https://cursor.com/docs/context/rules · https://opencode.ai/docs/rules/

**Memory security (the 2026 poisoning literature)** — canonical: **MINJA**
(memory injection via query-only interaction; arXiv 2503.03704) and
**AgentPoison** (backdoors via long-term memory poisoning; arXiv
2407.12784). The 2026 wave: **InjecMEM** (single-interaction injection,
retriever-agnostic anchor; arXiv 2608.23471), **MIND**
(intent-aware denoising of retrieved memory; arXiv 2607.28103), **MemAudit**
(post-hoc auditing of poisoned memory via causal attribution — memory
forensics; arXiv 2605.23723), **the Chronos vulnerability** (temporal-
persistence attacks, sleeper agents; arXiv 2607.19433). Production trust
boundaries observed: Mem0's editor plugins block direct writes to memory
files; Claude Code approval-gates external imports; Letta's git boundary
separates committed from uncommitted memory.

**The compaction cliff** (the sharpest 2026 placement evidence) — via
Mem0's replication of the CIKM result: Claude Code `/compact` preserves
only **53% of safety rules after one compaction and 10% after five**;
declarative rules evade regex rescue; rules stored in CLAUDE.md or a memory
layer held 63/63. Durable rules must live in the memory files, not the
compacted working context.
Source: https://mem0.ai/blog/testing-memory-placement-against-compaction-cliff

**Benchmarks that matter** — LongMemEval (knowledge updates + abstention;
arXiv 2410.10813) and LoCoMo (single/multi-hop, open-domain, temporal;
arXiv 2402.17753); production systems report accuracy **plus mean tokens
and latency** under a stated retrieval budget, and treat retrieval-only
benchmarks with skepticism (Letta's 74% filesystem result).

## 2. The floor — the late-2026 checklist

What a production memory engine must do, each item concrete enough to test.
(M) = already Unown's claimed contract; (G) = candidate gap this round must
check live.

1. **Scope-enforced isolation** — every read/write carries identity/tier;
   cross-scope access structurally impossible at the storage layer. [mem0] (M)
2. **Attributable writes** — every memory records its source; synthesized
   content links back to its evidence. [mem0][zep] (M)
3. **Versioned, rollback-able memory** — change history per memory/tier;
   rollback of any write or consolidation batch; backup before bulk
   reorganization; preview/dry-run for consolidation. [mem0][letta] (M)
4. **Non-destructive consolidation** — dedupe/supersede/merge mark and link
   rather than delete; superseded records retained and inspectable. [mem0][zep] (G)
5. **Idempotent background consolidation** off the user's latency path, with
   an optional review-before-apply gate. [letta][mem0][langmem] (M)
6. **ADD-only fact writes + separate reviewable reconcile pass.** [mem0] (M)
7. **Temporal validity/expiry** — hide-but-never-delete semantics; delete
   must cascade so superseded facts cannot resurface. [mem0][zep] (G)
8. **Trust boundary for model-authored content** — direct writes blocked
   through non-memory channels; staged-not-loaded promotion; poisoned notes
   quarantined before extraction AND before render. [security][mem0][claude] (M)
9. **Poisoning-aware retrieval** — retrieved memory treated as untrusted
   input (MINJA/InjecMEM operate query-only); scope-filter + anomaly flags. [security] (G)
10. **Scoped, read-only cross-project search** — across-scope search is an
    explicit global lane, never a widened project query; writes stay
    scoped. [mem0] (M)
11. **Tiered instruction loading, most-specific-wins** with documented load
    order; explicit user prompts override files. [claude][agents.md] (M)
12. **Progressive disclosure** — only roots load every session; deep
    material behind indexes pulled in when relevant. [letta][claude] (M)
13. **Hard injection budgets with visibility** — caps with a visible
    loaded-token count / budget line; truncation never silent. [claude][mem0] (M)
14. **Constraint survival across compaction** — safety rules live in durable
    memory files, not working context. [mem0-blog][security] (G)
15. **Multi-signal hybrid retrieval** — semantic + lexical (+ entity,
    temporal) fused, with a lexical fallback offline; ranking beyond raw
    similarity (recency/frequency/importance). [mem0][langmem] (M)
16. **Entity linking** for multi-hop recall without an external graph DB. [mem0][zep] (G)
17. **Memory health surface** — duplicates, conflicts, staleness, placement
    quality, token usage exposed via a command/API; audits report-before-
    mutate. [observability] (M)
18. **Extraction hygiene defaults** — inference on by default, raw mode
    fenced as a duplicate hazard; extraction async off the response path. [mem0] (M)
19. **Cross-lane sharing + gated hoisting** — explicit user/org scope with
    the same trust boundary; promotion project→user only after multi-project
    evidence. [mem0][claude][cursor] (M)
20. **Benchmark discipline with cost** — reproducible eval, accuracy +
    tokens + latency under a stated budget. [mem0][letta] (M)
21. **Audit trails and export** — async write events, per-memory history,
    exportable snapshots. [mem0] (G)
22. **Local/offline operation** — self-hosted with degradation paths (lexical
    fallback), quarantine/rollback intact offline. [mem0][letta] (M)
23. **AGENTS.md interop** — consume repo AGENTS.md alongside native tiers. [agents.md][claude] (M)
24. **Portability of memory state** — exportable, versioned artifact
    reproducible across machines. [letta] (G)

## 3. The testing-matrix recommendation (what "all combinations" means)

Cross **write lanes × consolidation × read lanes × tiers**, plus adversarial
rows. For Unown's surfaces specifically:

- **Write lanes (W)**: W1 in-session `/note`; W2 agent `note` tool;
  W3 automatic exit note; W4 shell `unown note`; W5 subagent auto-note;
  W6 `## Manual notes` hand-edit; W7 harness ship-gated patch.
- **Consolidation (C)**: C1 pending/undreamed; C2 project dream;
  C3 benchmark dream (canary-gated); C4 quarantine (poisoned note,
  zero-extraction); C5 hoist (project→user); C6 no-change dream;
  C7 gated/rolled-back dream.
- **Read lanes (R)**: R1 session-start injection; R2 `/learning` mid-session
  (staleness + budget lines); R3 `/new`/`/resume`/`/fork` re-resolution;
  R4 `unown memory` CLI print; R5 `/memory search` in-session; R6
  `GET /api/memories?q=` scoped; R7 `?across=1` cross-scope; R8 sandbox-run
  injection; R9 dashboard Memory screen (versions, rollback, diff).
- **Tier setups (T)**: T1 all four tiers; T2 missing tiers (policy absent →
  built-in default); T3 cross-tier conflicts (most-specific-wins); T4 budget
  overflow (visible truncation); T5 untrusted repo-supplied project.md
  (flagged until first dream).
- **Lifecycle (L)**: L1 version rollback then re-render; L2 auto-unship;
  L3 health card (duplicates/conflicts); L4 outbox (engine down → queue →
  sync → dead-letter); L5 concurrent sessions serialized; L6 stable project
  identity across clones/worktrees.

Adversarial rows worth pinning from the floor: poisoned note → quarantine →
**zero extraction AND zero render in every read lane** (item 8); same fact
via every write lane → one canonical record, variants retained and linked
(items 4/6); contradiction at a lower tier → supersede links + current
truth in latest reads (items 4/7); budget overflow → deterministic
truncation + visible count (item 13); hoist → user tier wins, attributable,
rollback-able (item 19); offline → lexical fallback still scoped (item 22).

## 4. Fetch-blocked / unverified (honesty ledger)

- Codex's own AGENTS.md guide page (curl-blocked; the repo doc exists and
  agents.md lists Codex as an adopter).
- snap-research/LoCoMo GitHub README (404 on raw fetch — the arXiv paper is
  cited instead).
- OpenCode V2 rules specifics (V1 page read).
- The literal "bi-temporal" vocabulary in Zep (described functionally from
  the fetched README/paper; the structure matches).
- Mem0's npm-reported benchmark figures (92.5 LoCoMo / 94.4 LongMemEval)
  are Mem0's own published numbers from their README/eval docs —
  reproducible via their open-sourced eval harness, not re-run here.
