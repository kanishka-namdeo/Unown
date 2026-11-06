# TEARDOWN 2026-11-06 — the Letta filesystem-memory result vs A2's Mem0 bet

> The Rondo round's first §7 competition-cycle teardown (opened at the 5th-ticket
> mark per the standing cadence). Sweep: 5 source-reads (2 primary changelogs,
> 2 memory-benchmark sources, 1 eval-landscape source). Pick: **Letta's
> "Benchmarking AI Agent Memory: Is a Filesystem All You Need?"** — the one
> that interrogates A2's foundational architecture bet rather than a feature
> lane.

## The sweep table (5 reads, 2026-11-06)

| # | Source | What moved | Unown-relevant? |
|---|---|---|---|
| 1 | Claude Code changelog v2.1.308–318 (Oct 22–Nov 3, 2026; 582 entries across 9 versions) | `onFailure: "block"` for Agent SDK hook callbacks (fail-CLOSED hooks); `permissions.blockWritesOutsideWorkingDirectories`; `CLAUDE_CODE_SUBAGENT_EFFORT` + pooled budgets + layered policy; `claude -p` exit-1 hardening on transcript-write failure; `/schedule` connector warnings; skills-sync durability fixes | High — hooks, permissions, print-mode contract, schedules are all A2 surface lanes |
| 2 | OpenCode changelog v2.2.4–2.2.5 (Oct 30, 2026) | Persistent desktop terminals (survive server restarts with scrollback); interactive artifacts (`artifact_create/read/update/delete` + built-in local provider); percentage compaction buffer (`"buffer": "20%"`); `opencode attach` (remote backend attach); `agent create` with per-tool permission allowlists | Medium-high — artifacts + compaction + attach map to A2's dashboard/artifact/serve lanes |
| 3 | **Letta — "Benchmarking AI Agent Memory" (the PICK)** | A plain FILESYSTEM agent (grep/search_files/open/close over stored conversation files, gpt-4o-mini) scored **74.0% on LoCoMo** vs Mem0's reported **68.5%** (top graph variant); Mem0's numbers "controversial and unverifiable" by the Letta team; implication: memory effectiveness lives in the AGENT'S context management, not the retrieval substrate; simple tools are in-distribution for LLMs, knowledge graphs are not | **Highest — direct challenge to A2's core bet** |
| 4 | Mem0 — "State of AI Agent Memory 2026" (Apr 2026) + the 600-turn comparison | Mem0 +14pp over OpenAI Memory at sub-2s latency; the incumbent case for specialized memory pipelines | High — A2's AutoDream runs the Mem0 lexical backend today |
| 5 | Presenc coding-agent benchmarks 2026 + Terminal-Bench 2.0/4.0 | SWE-Bench Verified ~78% (approaching saturation); Terminal-Bench 2.0 top 82%; real-world PR acceptance 35–50% (materially below benchmarks); open-weight trails 25–40% | Context — the eval landscape A2's benchmark programme orbits |

## The pick, torn down: what Letta actually showed

1. **The claim**: an agent with four filesystem tools (grep, search_files, open, close) over raw conversation files beat every specialized memory system Letta could verify — Mem0's best graph variant included (74.0 vs 68.5 on LoCoMo, gpt-4o-mini).
2. **The mechanism they claim**: LLMs are heavily trained on filesystem tools, so agents USE them well; the bottleneck is context management policy (what to load, when), not retrieval machinery; knowledge-graph substrates push work out-of-distribution.
3. **The caveats they concede**: framework-vs-framework comparisons are "apples to oranges"; memory-tool evaluation in isolation is nearly impossible; their own Memory Benchmark is the proposed fix.

## Against A2's architecture (the honest reckoning)

A2's memory stack: 4-tier injected memory (policy → project → user → local) + AutoDream consolidation on the **Mem0 lexical backend** + staged skill minting + the engine's note pipeline. The Letta result cuts at this in three places:

- **The substrate bet.** A2 bets on a specialized pipeline (Mem0) over plain files. Letta's evidence says the file lane is at least as good and more agent-legible. A2's own receipts this round are ambivalent: the B-18 arc (reasoning-noise leaking through the Mem0 consolidation render — FIXED in v0.0.57 at the dream's write boundary) is precisely the "specialized pipeline adds leak surface" risk class Letta names; but the fix landed ENGINE-side in one ticket with 14 pins, and the memory-effectiveness/classifier evals in `docs/` show measured retrieval-rank and ops-accuracy wins on A2's own benchmarks.
- **The context-management claim.** This is where A2 is ALREADY on the right side: the 4-tier most-specific-wins injection, the render caps, the H-8 env-filter law — that IS context-management policy as the first-class citizen. The Letta finding strengthens A2's existing direction: keep investing in WHAT gets injected (placement, dedup, caps — the memory-quality backlog items), not in fancier retrieval.
- **The verification gap.** Letta could not verify Mem0's numbers. A2's answer is the round's own law: every memory claim carries a rerunnable receipt (`benchmarks/memory-eval/` — retrieval-rank + ops-accuracy corpora, per-case JSON). That is the defensible position; keep it.

## What this teardown changes (the picks that matter)

1. **No substrate swap.** The Letta result does NOT justify ripping out Mem0 (their own caveats forbid that reading; A2's own evals show wins; the swap assessments in `docs/memory-platform-swap-assessment.md` already ruled once). It DOES justify a **cheaper A/B**: a file-lane memory variant behind the existing port seam, evaluated on A2's own frozen retrieval-rank corpus — the §6 CANARY shape, not a rewrite. Filed as a candidate hypothesis (H-13 lane in the registry), NOT dispatched this round.
2. **Fail-closed hooks (Claude Code's `onFailure: "block"`).** A2's user hooks are fail-OPEN by design (documented). Claude Code just shipped fail-CLOSED as an opt-in for SDK callbacks. The teardown pick: add an opt-in fail-closed mode for A2's user hooks (per-event or global) — small, buildable on the extension surface, and the security round's lane. Candidate for the registry's next PROPOSE row.
3. **The eval-saturation context.** SWE-Bench ~78% and Terminal-Bench 82% top scores vs 35–50% real-world PR acceptance: the gap is the measurement story A2's benchmark programme already tells (probe-don't-assume, K≥3, failure-class taxonomy). No action — corroboration.

## Verdict

The round's DRIVE vehicle (Chaconne) is unaffected. The AUGMENT track gains two candidate hypotheses (the file-lane memory A/B; fail-closed hooks) — both queued as PROPOSE rows for the next registry pass, neither dispatched mid-round (the §6 lifecycle law: evidence-gated, human-promoted).
