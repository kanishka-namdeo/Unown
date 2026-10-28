# The validation round — competitor research

> **Verdict up front:** the field moved since the 2026-10-25 sweep. Codex CLI
> shipped **memory v2** as default — a real memory tool subsystem that
> independently converges on Unown's write-gated-notes → background
> consolidation shape, and adds recall-time citations Unown lacks. Claude
> Code now ships the industry's most complete **per-skill evaluation loop**
> (`plugin eval`, skill-creator A/B, `/skill-doctor`) — the single most
> validation-relevant gap this round records against Unown. Nothing found
> invalidates the five-mechanism architecture; the fresh evidence mostly
> *strengthens* it (append-only notes, quarantine-at-ingest, staged SKILL.md,
> structured markdown memory are all now field-standard). The round's
> validation programme adopts the strongest patterns as measurement
> discipline, and the gap ledger feeds the mission's improvement lane.

- [Method](#method)
- [The eight systems](#the-eight-systems)
- [The seven-dimension comparison](#the-seven-dimension-comparison)
- [What this round adopts](#what-this-round-adopts)
- [Remaining gaps (the honest ledger)](#remaining-gaps-the-honest-ledger)
- [Validations of Unown's existing design](#validations-of-unowns-existing-design)

Related: [the full evidence sweep](../benchmarks/research/2026-10-29/memory-validation-round.md)
(every claim, tiered and sourced) · [the session record](validation-round-session.md) ·
[the consolidated 24-system report](competitor-comparison-report.md) ·
[the prior sweep](../benchmarks/research/2026-10-25/README.md) ·
[the memory-competitor deep dive](memory-competitor-research.md)

## Method

Primary sources only — official docs sites serving `.md`, raw GitHub source,
release feeds, PR patches, arXiv — every claim tiered **[V]** verified in a
fetched source this round, **[C]** community/upstream-claimed, **[U]**
uncertain. The prior sweeps (2026-10-25, plus the SOTA/parley research docs)
were read first so this round adds rather than repeats; the full 46 KB sweep
with inline URLs lives at
`benchmarks/research/2026-10-29/memory-validation-round.md`. No
search-engine sentiment was consulted; anything community-reported is
tiered [C] or [U].

## The eight systems

(The mission's comparative set: OpenHands, Roo Code, Claude Code, Codex CLI,
Gemini CLI, Cline, Aider — OpenDevin is OpenHands' former name, folded into
its row.)

- **OpenHands** (formerly OpenDevin, now Agent Canvas + software-agent-sdk) —
  opt-in two-tier `MEMORY.md` index + daily logs under a ~6k-char budget,
  untrusted content wrapped and re-read each session; OTel → LLM-judge →
  dashboards → human-gated SKILL.md improvement proposals; Critic threshold
  auto-retry in the SDK, with a published rubric-supervised-critic method
  (arXiv:2603.03800); deterministic path-triggered rule injection. [V]
- **Roo Code** (official handoff to community, docs frozen 2026-05; Zoo Code
  fork continues) — rules dirs + mode YAML + AGENTS.md, no engine memory; the
  cleanest public statement of the context-poisoning doctrine ("treat the
  session as disposable; wake-up prompts don't work"); Intelligent Context
  Condensing with a before/after token-cost audit row; Agent Skills format
  with an 8-level override ladder. [V]
- **Claude Code** (v2.1.312) — the CLAUDE.md chain plus typed auto-memory
  with a capped index; **the skill-eval infrastructure**: `claude plugin
  eval` (grader-scored, CI-gating exit codes), the skill-creator plugin
  (benchmark.json pass-rate/time/token deltas, blind A/B, description
  trigger hit-rate tuning), `/skill-doctor` context-cost audits; the
  2.1.311/2.1.312 memory fixes extend a known failure class
  (stale-memory-after-compaction, mid-session overwrites). [V]
- **Codex CLI** (v0.165.0) — **memory v2, default**: `memories_v2/` store +
  `add_ad_hoc_note/list/read/search` tools, per-rollout summaries grounding
  on-demand evidence retrieval, consent-gated writes that only background
  consolidation applies, an anti-drift doctrine ("memory is not proof of
  current behavior"), recall-time citations with rollout UUIDs, and an
  external-agent memory import pipeline. The round's biggest architectural
  change in the field. [V]
- **Gemini CLI** (v0.66.0) — GEMINI.md tiers plus Auto Memory: multi-instance
  lock + processed-version state, patch parse → dry-run → target-allowlist →
  atomic apply, hard prohibition on touching active memory or credentials;
  drafts SKILL.md files into a human-gated inbox — the only shipped
  skill-from-transcript generator besides Unown's staged lane. [V]
- **Cline** — `.clinerules` with conditional `paths:` rules; the Memory Bank
  six-file structure formalized as first-party docs ("I MUST read ALL memory
  bank files at the start of EVERY TASK"); Auto Compact with
  checkpoint-restore to pre-summarization state. [V]
- **Aider** — the stateless pole: graph-ranked token-budgeted repo map,
  CONVENTIONS.md via `--read`, benchmark craft as the field's bar
  (pass@1/@2 + well-formedness + cost, Docker-pinned). [V]
- **Cross-cutting** — the **Agent Skills open standard** (agentskills.io) is
  now referenced by Claude Code, Gemini CLI, Cline and Roo Code: the skill
  *format* is commoditized; skill *evaluation* is the differentiator. [V]

## The seven-dimension comparison

(Condensed from the sweep's full table; see the evidence file for the
complete version with per-cell tiers.)

| Dimension | Where the field is | Where Unown stands |
|---|---|---|
| Memory architecture | Structured markdown tiers everywhere; Codex adds a memory *tool* subsystem; Claude Code caps + types entries | Four-tier policy→project→user→local, Mem0 platform, versioned + rollback — field-complete |
| Learning loop | Claude Code: postmortems + skill eval; Codex: background consolidation; OpenHands: human-gated dashboards | The five-mechanism loop with ship gates, canaries, retention sweeps — the deepest shipped loop |
| Benchmark generation | Claude Code plugin evals; Aider's harness craft; OpenHands matched-model gating | Task minting from real failures with solvability gates — unique in the CLI field |
| Regression prevention | Checkpoints, eval-gated CI, anti-drift doctrines everywhere | Canaries + retention checks + auto-unship on regression — strongest in class |
| Skill generation | Gemini drafts SKILL.md; Claude Code A/B-tests them; the format is standardized | Dream-driven staged minting with guard scans — matches the field's human-gate posture |
| Context retention | Condensers with measured cost claims (Roo's audit row, OpenHands condenser) | Memory injection + budget pins; condenser economics not yet a benchmarked dimension |
| Long-term continuity | Committed markdown memory is the mainstream answer (Cline's bank, Codex namespaces) | Tracked `.unown/memory/project.md` + provenance sidecar — same family, plus dream upkeep |

## What this round adopts

1. **Recall-time evidence discipline** (from Codex v2's citation contract):
   the validation round's UX ledger records, for every recall probe, whether
   the answer's memory source is verifiable — the anti-drift measurement the
   mission's "retrieval relevance" metric asks for.
2. **With/without baselines** (from Claude Code's skill eval): every
   improvement claim this round is measured against a cold/control session,
   not only against the previous warm run — the same A/B discipline, applied
   to memory.
3. **Cost columns on every figure** (from Roo's condensing audit row): every
   session row in the UX ledger carries turns/tokens/wall-time, and every
   snapshot carries token totals.
4. **The stale-memory failure class as regression pins** (from Claude Code
   2.1.311): the round's validation log treats any memory answer that
   contradicts current source as a defect candidate, not a curiosity.

## Remaining gaps (the honest ledger)

Ranked by validation relevance (full detail in the sweep, §5):

1. No **per-skill evaluation harness** (with/without baselines, trigger
   accuracy, per-skill cost) — Claude Code ships one; Unown's gates are
   suite-level.
2. No **skill usage/cost audit** (`/skill-doctor` equivalent) — the
   every-listed-skill-taxes-every-turn cost is unmeasured.
3. No **recall-time memory citations** in the rendered memory's own
   instructions (Codex v2 cites rollout UUIDs).
4. **Memory interchange**: Codex imports external-agent memories; Unown's
   import is verbatim-bullet without event history.
5. No **deterministic path-triggered injection** — the full rendered memory
   rides every session (OpenHands/Cline/Claude Code scope by path).
6. No **critic-driven iterative refinement** with a learned quality scorer
   (OpenHands' Critic).
7. **Condenser economics** are not a benchmarked dimension (the longrun
   receipts test thrash survival, not retention quality).
8. Team distribution of learned memory/skills beyond committed markdown
   (recorded as deliberate local-first non-adoption, not an oversight).

## Validations of Unown's existing design

The sweep's strongest finding is convergent evolution: Codex v2's
append-only-notes-consumed-only-by-consolidation [V] is Unown's write-gate +
notes pipeline; Roo's "sessions are disposable, wake-up prompts don't work"
doctrine [V] is the argument for Unown's quarantine-at-ingest; Claude
Code's over-cap rewrite errors [V] match Unown's loud-truncation pins;
Cline's formalized memory bank [V] and the field's SKILL.md standard [V]
are the shapes Unown already ships. Where the field is moving — skill eval,
memory citations, path scoping — is exactly where this round points the
programme's improvement lane next.
