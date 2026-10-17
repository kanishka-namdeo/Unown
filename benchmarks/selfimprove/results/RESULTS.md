# Self-improvement lift — results

**Question:** does Unown's memory actually help on repeat tasks — the thing it
exists for?

Protocol (`../runner.mjs`): a 10-task Python Exercism set (disjoint from the
polyglot subset — no contamination) is solved **cold** (fresh project, fresh
memory) and then **warm**: each task re-runs in a brand-new workspace that
carries *only* the dreamed `.unown/` memory from its cold pass. No source
files leak between passes. Memory is injected into every session through the
AGENTS.md chain (`agentsFilesOverride` → `resolveTerminalMemory`), and
AutoDream's consolidation is triggered deterministically via
`POST /api/jobs/auto-dream/trigger` — the run verifies every task's memory
actually changed from the template before the warm pass starts. Scoring
mirrors the polyglot runner's anti-tamper rules (read-only tests during the
session, pristine restore before scoring). n=10, single run per phase, per
model.

## v1 — thin notes (negative control, kimi-k2.5)

`v1-thin-notes/` — with only the CLI's auto-generated session summaries as
notes, AutoDream consolidated but extracted **zero** entries; project memory
stayed the 11-line template. The warm pass still showed savings (kimi −25.6%
input tokens / −47% wall time), but with an *unchanged memory file* those
gains are attributable to upstream prompt caching on near-identical prompts,
**not** to Unown memory. We therefore do not publish v1 as a memory effect;
it is kept here as the control arm that isolates the prompt-caching
confound.

| Model | Cold pass | Warm pass | Input Δ | Output Δ | Avg duration Δ |
|---|---|---|---|---|---|
| kimi-k2.5 | 10/10 | 10/10 | −25.6% | +5.0% | 64s → 34s (−46.9%) |

## v2 — agent-authored notes (the publishable variant)

`v2-notes/` — identical protocol, but the task prompt asks the agent to file
1–3 concise lessons with the `note` tool before finishing (the product
behavior the memory system is designed around). Receipts include the dreamed
memory snapshot for every task (`memory-cold-tasks.*.md`), so the "memory
actually changed" precondition is auditable per task.

| Model | Cold pass | Warm pass | Input Δ | Output Δ | Avg duration Δ |
|---|---|---|---|---|---|
| qwen3.6-plus | 10/10 | 10/10 | −23.7% (401,445 → 306,218) | −0.1% | 25s → 23s (−8.0%) |
| qwen3.7-plus | 10/10 | 10/10 | +23.2% | −2.0% | 24s → 25s (+4.2%) |
| kimi-k2.5 | 10/10 | 10/10 | +21.8% (34,553 → 42,075) | −5.1% | 37s → 24s (−35.1%) |

Read honestly: the v1 control shows a −25.6% "saving" for kimi that was pure
prompt-caching artifact; once memory is actually in the loop (v2), kimi
*spends* ~22% more input tokens (the injected memory adds context) but
finishes 35% faster — memory trades a little prompt budget for fewer
iterations. qwen3.6-plus gets both wins (−23.7% input, −8% wall time);
qwen3.7-plus pays the context and does not convert it into speed on this
set. Pass rates were 10/10 on both passes for every model, so the pass-rate
lift is 0pp across the board: on tasks the model can already solve, memory
buys efficiency, not correctness. Numbers are single-run (n=10 tasks); we
do not claim significance. Per-task dreamed-memory receipts are committed
(`memory-cold-*.md`) so the "memory actually changed" precondition is
auditable.

## v3 — project continuity (the real-life arm, kimi-k2.5)

`v3-notes/` — v2 measured *repeat-task* efficiency (same task, same memory).
Real life is different: you keep working in the SAME repo on NEW tasks while
memory accumulates session over session. v3 simulates that trajectory with
three copies of the same evolving 6-task repo (`../v3-fixture/`):
**acc** (real product behavior — every session's notes consolidated by a
real AutoDream dream, memory snapshot per session, next session sees the
learned `.unown/memory/project.md`), **ctl** (identical sessions, notes
deleted + memory reset to the template after each session — a memoryless
agent), and **unrel** (memory pre-seeded with the v2 PYTHON Exercism dream —
a real, learned, wrong-domain memory — kept fixed; isolates "irrelevant
memory present" from "no memory").

| Arm | Pass | Billed input tokens | Avg duration | Notes |
|---|---|---|---|---|
| acc (real dreams) | 6/6 | 17,314 | 36s | 5/6 dreams consolidated; memory grew accurately |
| ctl (no memory) | 6/6 | 12,690 | 11s | control purity: notes deleted pre-dream |
| unrel (python memory) | 6/6 | 16,438 | 11s | negative control: wrong-domain memory, fixed |

Read honestly: on a trajectory the model can already solve, accumulated
real memory bought **0pp pass-rate, cost ~36% more billed input tokens and
~3× wall time on the average** (the duration skew is one 105s regression
session — n=1, single trajectory; the JSONL has per-session durations).
The unrelated-memory arm is the cleanest result: wrong-domain memory costs
~30% input tokens and buys nothing — the negative control confirms the
measurement is sensitive to *memory content*, not just prompt size. Dream
QUALITY, audited from the per-session snapshots, was genuinely good
(`memory-acc-after-session-*.md`: test command, import style, the
`add`-accumulation rule, JSON-newline requirement — all accurate). n=1
trajectory per arm, one model, single run: directional, not statistical.
Protocol receipts: `runner-v3.mjs`, `kimi-k2.5.jsonl`, `logs/` (full
session stdout/stderr), `unrel-memory-source.md`.
