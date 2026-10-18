# local-llm — the local-model testbench

**Question:** can *fully-local, performance-optimized* LLMs (llama.cpp + small GGUF
quants, CPU-only) speed up or improve Unown's learning-layer subtasks — the pi
agent's memory pipeline (failure mining, AutoDream consolidation, skill/task
minting, note triage) — without degrading the self-improvement loop, and can
they do it on the **broad range of systems Unown supports** (Linux / macOS /
Windows, x64 / ARM, modest RAM)?

This directory is the hypothesis-driven testbench that answers it. It replays
**byte-faithful production prompts** (copied verbatim from
`pi-repo/packages/self-learning/src/{harness,dream,skills,mint}.ts`) with
**fixtures captured from the live engine** (real runs, real session notes, real
failed-run transcripts — see `fixtures/`), against:

- **remote baseline** — the production model (`kimi-k2.5`) via the llm-bridge,
- **local candidates** — `llama-server` (llama.cpp, MIT, prebuilt binaries)
  serving small quants: Qwen3-0.6B, Granite-4.0-1B, LFM2.5-2.6B (all Q4_K_M)
  and nomic-embed-text-v2-moe for the embedding lane.

## Layout

```
hypotheses.json   the registry: H1–H8, thresholds, guards, verdicts, evidence
runner.mjs        cross-platform driver (pure Node ≥18, no native deps)
lib/
  llama.mjs       llama-server lifecycle + cross-platform provisioning
  openai.mjs      minimal OpenAI-compatible client (timing, json_schema)
  prompts.mjs     EXACT production prompt assemblies + fixture loaders
  experiments.mjs E1–E5 implementations
  judge.mjs       blind A/B judge (position-swapped, consistency-gated)
  report.mjs      results persistence + markdown tables
fixtures/         authentic data exported from the engine SQLite (notes,
                  tasks, runs incl. FAILED transcripts, dreams, memory tiers)
results/          experiment outputs (JSON per experiment + summary)
bin/, models/     llama.cpp binary + GGUF weights (gitignored)
```

## The experiments

| # | Hypothesis | Replays | Key metrics |
|---|---|---|---|
| E0 | H6 cross-platform viability | llama-server cold start | startupMs, RSS, tok/s, prefill tok/s, json_schema sanity |
| E1 | H2 note triage (generative) | `TRIAGE` probe on real notes | kind/outcome agreement vs remote, JSON validity, p50 latency |
| E2 | H4 AutoDream consolidation | `dream.ts` SYSTEM + real notes + memory | JSON validity, length sanity, injection heuristics, blind judge |
| E3 | H3 failure mining | `harness.ts mineFailure` on REAL failed runs | JSON validity, harness validator pass, blind judge, latency, cost |
| E4 | H5 task minting | `mint.ts` curriculum authoring | validateDraft() static contract, blind judge |
| E5 | H1 note triage (embedding) | nomic-embed zero-shot classification | agreement vs remote labels, latency |
| E6 | H7+H8 integration (phase 2) | full harness cycles w/ local routing | pass-rate parity, cycle cost — **only if E1–E5 verify** |

## Running it

```bash
# 1. provision (idempotent; downloads llama.cpp prebuilt + GGUFs per platform)
node benchmarks/local-llm/runner.mjs provision

# 2. E0 capability probe (works with NO API key — the cross-platform lane)
node benchmarks/local-llm/runner.mjs probe

# 3. comparison experiments (need the Unown stack up: bridge+engine, or at
#    least the bridge reachable via TEST_BRIDGE_URL)
bun run agent:start
node benchmarks/local-llm/runner.mjs all            # full suite
node benchmarks/local-llm/runner.mjs e3-mine --model qwen3-0.6b   # single
```

Config: `TEST_BRIDGE_URL` (default `http://127.0.0.1:3031`),
`TEST_REMOTE_MODEL` (default `kimi-k2.5`), `TEST_JUDGE_MODEL`,
`LLAMA_BUILD` (default `b11718`). Remote cost estimates use public list
prices (`lib/experiments.mjs COSTS`).

## Method notes (why you can trust the numbers)

- **Real prompts, real inputs.** Prompt templates are copied verbatim from the
  production sources and a sync-comment marks each one; fixtures come from the
  engine's own SQLite via read-only export. The mining fixtures are genuine
  FAILED agent runs (the harness was driven against deliberately-hard tasks to
  produce them).
- **Unown's own parsers.** JSON extraction uses a port of `llm.ts extractJson`;
  validators reimplement the production post-validation constraints
  (`harness.ts` patch rules, `mint.ts validateDraft` essentials) — so
  "validatorPass" means "the engine would have accepted this output".
- **Blind judging.** Quality is compared by the remote production model as
  judge, with outputs anonymized as A/B, each pair judged twice with positions
  swapped, and only position-consistent verdicts counted (flips = ties). This
  is the "local-draft + big-verify" cascade pattern under test, reused as the
  measurement instrument.
- **Grammar-constrained JSON.** Local candidates are tested with
  `response_format: json_schema` (llama.cpp grammar decoding), which is also
  the recommended production setting for any local lane.
- **Cross-platform.** The runner is pure Node with no native deps; llama.cpp
  prebuilts (runtime CPU dispatch, no AVX requirement) cover linux-x64/arm64,
  macos-x64/arm64, win-x64/arm64. E0 runs in CI on all three OSes.

## Verdicts

Verdicts live in `hypotheses.json` (status + verdict + evidence links) and are
summarized in `results/REPORT.md` after each experiment campaign. **Changes to
Unown itself are gated on the registry** — see H8 for the minimal-risk
integration shape (bridge `local-*` route + per-subtask env overrides), which
only proceeds if H1–H5 verify.
