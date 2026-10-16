# Benchmark research for Unown

> Task 6-a research note (2026). Goal: figure out what "oh-my-pi", pi, and comparable coding
> agents actually run and publish, then pick credible, Docker-free benchmarks Unown can run in
> this sandbox (no Docker, no cloud sandboxes) and show on the landing page.
> All numbers below were captured from the cited pages on 2026-10-09. Leaderboards move —
> re-verify before publishing any comparison.

---

## (a) What comparable products run + published numbers

### A.1 — Aider (the closest analog: an open-source terminal agent with its own benchmark + public leaderboard)

- **What it runs**: its own **polyglot benchmark** — 225 hardest Exercism exercises across 6
  languages (C++ 26, Go 39, Java 47, JS 49, Python 34, Rust 30), selected as "the 225 problems
  solved by ≤3 of 7 reference models" out of 697. 2 attempts per exercise (`--tries 2`, default);
  after attempt 1 the harness feeds the test-failure output back for attempt 2. The leaderboard
  sorts by **pass@2** ("percent correct") and also reports pass@1, edit-format compliance, tokens,
  cost, seconds/case.
- **Methodology sources**:
  - Blog (design + why): https://aider.chat/2024/12/21/polyglot.html
  - Leaderboard (51 models, YAML-stat expandable rows): https://aider.chat/docs/leaderboards/
  - Benchmark harness docs: https://github.com/Aider-AI/aider/tree/main/benchmark (`benchmark/README.md`)
  - Exercise data: https://github.com/Aider-AI/polyglot-benchmark
    (layout: `<lang>/exercises/practice/<exercise>/` = stub source + `<name>_test.py|<name>.spec.js|...`
    + `.docs/instructions.md` + `.meta/example.*` reference solution)
  - Per-language test commands (from `benchmark/benchmark.py`, `run_unit_tests`):
    `.py → pytest` · `.rs → cargo test -- --include-ignored` · `.go → go test ./...` ·
    `.js → npm-test.sh (sed xtest→test; npm run test)` · `.cpp → cpp-test.sh (cmake -DEXERCISM_RUN_ALL_TESTS=1; make)` ·
    `.java → ./gradlew test`; 3-minute timeout; runs "should be inside docker" only for safety.
- **Published numbers (official leaderboard, pass@2 / cost per full 225-exercise run)**:

| Model | % | Cost | Note |
|---|---|---|---|
| gpt-5 (high) | 88.0% | $29.08 | top row; pass@1 52.0 |
| gpt-5 (medium) | 86.7% | $17.69 | |
| o3-pro (high) | 84.9% | $146.32 | |
| gemini-2.5-pro (32k think) | 83.1% | $49.88 | |
| grok-4 (high) | 79.6% | $59.62 | |
| DeepSeek-V3.2-Exp (Reasoner) | 74.2% | $1.30 | best $/score |
| claude-opus-4 (32k thinking) | 72.0% | $65.75 | |
| **Kimi K2** | **59.1%** | **$1.24** | our model family |
| DeepSeek R1 (0528) | 71.4% | $4.80 | |
| **Qwen3 32B** | **40.0%** | **$0.76** | our model family |
| Qwen2.5-Coder-32B | 8.0% | — | (2024 blog table) |

  Aggregated/self-reported rows (llm-stats.com, sourced from vendor blogs):
  Qwen3-Coder-480B 61.8% (https://qwenlm.github.io/blog/qwen3-coder/),
  Kimi K2-Instruct-0905 60% (https://moonshotai.github.io/Kimi-K2/) —
  see https://llm-stats.com/benchmarks/aider-polyglot and https://epoch.ai/benchmarks/aider-polyglot.
  No kimi-k2.5 / qwen3.7-plus polyglot rows exist anywhere yet → Unown can be first.

### A.2 — SWE-bench Verified (500 human-validated instances; the default "agent skill" benchmark)

- **Official leaderboard**: https://www.swebench.com/verified.html (180 Verified entries; JS data
  blob `#leaderboard-data` on https://www.swebench.com/). Docker is **required** by the official
  evaluation harness (`python -m swebench.harness.run_evaluation`, per-instance Docker images).
- **Bash-only model comparison**: the SWE-bench team runs every model through
  **mini-SWE-agent** (no tools, ReAct loop; temp 0.0 for ≤1.x, unset for ≥2.x) —
  that is the "fair model" row to compare against, e.g. Kimi K2.5 (high) **70.8% @ $0.15/task**.
- **Published numbers** (official leaderboard, resolved %, date):

| Agent + model | % | Date |
|---|---|---|
| Claude 4.5 Opus + Sonar Foundation Agent | 79.2% | 2025-12-05 |
| Claude 4.5 Opus + live-SWE-agent | 79.2% | 2025-12-15 |
| Gemini 3 Pro + live-SWE-agent | 77.4% | 2025-11-20 |
| Claude 4.5 Opus + mini-SWE-agent | 76.8% | 2026-02-17 |
| MiniMax M2.5 + mini-SWE-agent | 75.8% | 2026-02-17 |
| **Warp** ("Multiple") | **75.6%** | 2025-09-01 |
| Claude 4.6 Opus + mini-SWE-agent | 75.6% | 2026-02-17 |
| **Kimi K2 + Lingxi v1.5** | **71.2%** | 2025-10-14 |
| GPT-5 + OpenHands | 71.8% | 2025-08-07 |
| **Kimi K2.5 + mini-SWE-agent** | **70.8%** | 2026-02-17 |
| Qwen3-Coder-480B + OpenHands | 69.6% | 2025-08-05 |
| Kimi K2 Thinking + mini-SWE-agent | 63.4% | 2025-12-10 |
| Qwen3-Coder-480B + mini-SWE-agent | 55.4% | 2025-08-02 |

- **First-party numbers for our exact model families** (self-reported, in-house harness):
  - **Kimi K2.5** (https://github.com/MoonshotAI/Kimi-K2.5, tech report table; thinking mode,
    temp 1.0 top-p 0.95, 256k ctx, **coding scores averaged over 5 runs**; SWE-bench series via
    in-house SWE-agent-adapted framework; TB 2.0 via default Terminus-2 agent, non-thinking):
    SWE-bench **Verified 76.8** (GPT-5.2-xhigh 80.0 · Opus 4.5 80.9 · Gemini 3 Pro 76.2 ·
    DeepSeek-V3.2 73.1) · SWE-bench **Pro 50.7** · SWE-bench **Multilingual 73.0** ·
    **Terminal-Bench 2.0 50.8** (GPT-5.2 54.0 · Opus 4.5 59.3 · Gemini 3 Pro 54.2 · DeepSeek 46.4) ·
    PaperBench 63.5.
  - **Qwen3.7-Plus** (self-reported from https://qwen.ai/blog?id=qwen3.7-plus, aggregated at
    https://llm-stats.com/models/qwen3.7-plus): SWE-bench **Verified 77.7** · **Pro 57.6** ·
    **Multilingual 75.8** · **Terminal-Bench 2.0 70.3** · LiveCodeBench v6 89.6 · GPQA 90.3.
    (Qwen3.7-Max: SWE-bench Pro 60.6% — highest proprietary at its launch.)

### A.3 — Terminal-Bench (Stanford / Harbor / Laude Institute; the "terminal agent" benchmark family)

- **Methodology**: each task = instruction + Docker image + tests + example solution + time limit;
  agent adapter harness runs inside the container; verifier re-runs in the same mutated container.
  **Docker is required** (or a cloud sandbox via Harbor). Versions: 1.0 (May 2025, 5 issues
  observed …), 2.0 (Nov 2025, **89 tasks**), 2.1 (May 2026), 3.0 (Jul 2026), **4.0 (Aug 2026,
  66 tasks)**, TB-Science 0.1. Leaderboard: https://www.tbench.ai/ (table/pareto/waffle views;
  resolution rate with **95% CI whiskers**, release date, tokens, total cost).
- **Published numbers — Terminal-Bench 4.0 (current default, 66 tasks)**:

| Rank | Model (effort) | Agent | Res. rate | Tokens | Cost |
|---|---|---|---|---|---|
| 1 | Opus 5.5 (max) | Claude Code | 64.8% ± 3.1% | 8.0B | $4.7k |
| 2 | Sonnet 5.5 (max) | Claude Code | 61.8% ± 2.9% | 19.4B | $7.3k |
| 3 | GPT-6 Astra (max) | Codex | 58.2% ± 2.8% | 1.5B | $3.3k |
| 5 | Fable 5.1 (max) | Claude Code | 57.9% ± 3.8% | 2.7B | $6.2k |
| 13 | Qwen3.8-Max-0902 (max) | Claude Code | 27.0% ± 3.8% | 3.0B | $4.6k |

- **Published numbers — Terminal-Bench 2.0 (89 tasks; our model families)**:

| Agent + model | % ± CI | Date |
|---|---|---|
| GPT-5.5 + NexAU-AHE | 84.7% ± 2.1 | 2026-04-23 |
| Claude Opus 4.6 + Meta-Harness | 76.4% ± 2.4 | 2026-02-05 |
| **Warp** (multiple models) | **61.2% ± 3.0** | 2025-12-12 |
| Claude Opus 4.6 + Claude Code | 58.0% ± 2.9 | 2026-02-05 |
| Claude Opus 4.5 + OpenHands | 51.9% ± 2.9 | 2025-11-24 |
| **Kimi K2.5 + Terminus 2** | **43.2% ± 2.9** | 2026-01-27 |
| Kimi K2 Thinking + Terminus 2 | 35.7% ± 2.8 | 2025-11-06 |
| Kimi K2 Instruct + Terminus 2 | 27.8% ± 2.5 | 2025-07-11 |
| Qwen 3 Coder 480B + OpenHands | 25.4% ± 2.6 | 2025-07-22 |
| Qwen3.6-35B-A3B + little-coder | 24.6% ± 3.2 | 2026-04-16 |

### A.4 — Other agents' published eval work

- **Devin / Cognition**: original SWE-bench run 13.86% on 570 issues (Mar 2024,
  https://cognition.com/blog/swe-bench-technical-report). Current model line (SWE-2, Sep 2026,
  https://cognition.com/blog/swe-2): FrontierCode 1.1 Main **50.0%**, DeepSWE 1.1 **73.0%**,
  **TB 2.1 92.8%**, **TB 4 27.3%** (vs GPT-6 Astra 57.9% / Fable 5.1 55.8% on TB4). They present a
  benchmark × model-comparator table plus a Pareto cost/capability argument — a good pattern.
- **Cline** (Aug 2026, https://cline.bot/blog/open-sourcing-evals-for-open-weight-agents): runs
  **Harbor** on **Terminal-Bench (89 tasks)** with **Modal** cloud sandboxes; multi-objective
  optimization (score vs cost vs time vs token weight); publishes raw scores **and traces**
  ("over a thousand dollars worth of hill-climbing scores and traces"); "Hill Climber's Checklist"
  (North-Star metric, quantify the noise, break down failure modes…). Their variance table is the
  best public example of statistical honesty: same-build reruns spread e.g. minimax-m3 43.8→56.2%,
  glm-5.2 56.2→74.2%. Also https://cline.bot/blog/deepseek-wins-imo-gold-on-12-cents (cost angle).
- **Warp**: publishes on third-party boards instead of a self-run one — SWE-bench Verified 75.6%
  (official board, 2025-09-01) and Terminal-Bench 2.0 61.2% (official tbench.ai, 2025-12-12).
- **OpenHands**: appears on both official boards (e.g. GPT-5 + OpenHands 71.8% SWE-bench Verified;
  Opus 4.5 + OpenHands 51.9% TB 2.0). Explainer: https://www.openhands.dev/blog/ai-coding-benchmarks-explained.
- **Artificial Analysis Coding Agent Index** (https://artificialanalysis.ai/agents/coding-agents):
  composite of **DeepSWE v1.1 (113 tasks, Datacurve) + Terminal-Bench 4.0 (66 tasks, Laude) +
  SWE-Atlas-QnA (124 tasks, Scale AI)**; each benchmark = **average pass@1 across 3 attempts**;
  equal weights; UI shows Index, **time/task**, **cost/task**, token usage, safety refusals,
  reward-hacking, harness comparison. Methodology gold standard for a neutral composite.
- **Databricks** built a private multi-million-LOC benchmark because "public benchmarks like
  SWE-Bench and TerminalBench … can't answer the questions we had"
  (https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase) —
  same rationale Unown can cite for a self-run suite.
- **SWE-bench ecosystem forks (context)**: SWE-bench-Live
  (https://github.com/SWE-bench-Live/SWE-bench-Live, post-cutoff GitHub issues, **Docker images on
  DockerHub → still Docker-bound**); OpenAI stopped using SWE-bench Verified in Feb 2026 for
  contamination (https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified).

---

## (b) oh-my-pi and pi findings

### B.1 — pi (badlogic / earendil-works; the base of Unown's pi-repo/)

- Repo: https://github.com/badlogic/pi-mono (site https://pi.dev; this is exactly what
  `Unown/pi-repo/` contains, packages `@earendil-works/pi-*`).
- **pi's own eval infrastructure = `packages/evals`** (in our tree): a **vitest-evals** framework
  (`describeEval`, judges, `evalHarnessTable` for A/B harness comparison with repetitions,
  pass-rate lift in points, token/latency/cost deltas). Runner:
  `npm run eval -- --provider openai --model gpt-5.6-sol` (or `PI_PROVIDER=… PI_MODEL=… npm run eval`).
  Harness: `createPiCodingAgentHarness({ name, model, noTools, transformSystemPrompt, output })`;
  artifacts land in `.eval/` (`runs.jsonl` + full session JSONL). Guidance follows
  https://github.com/getsentry/vitest-evals and
  https://github.com/adewale/skill-eval-harness (repetitions, trustworthy judges, telemetry).
  Current suites in-tree: `smoke.eval.ts`, `extensions.eval.ts` — behavioral, not leaderboards.
- **pi's public benchmark result**: Mario Zechner ran **Terminal-Bench** via a Harbor adapter
  (https://github.com/badlogic/pi-terminal-bench — `harbor run -d terminal-bench@2.0
  --agent-import-path pi_terminal_bench:PiAgent -m anthropic/claude-sonnet-4-5 -n 4`):
  **"pi with Opus 4.5 gets 8th place in terminal-bench. pi only has read/write/edit/bash, no web
  search, no compaction, minimal system prompt and tool descriptions (1–2 sentences). Caveats:
  only a single full run; submission requires 5 full runs, so…"**
  (https://x.com/badlogicgames/status/1995295577907593690). The repo README documents the required
  Harbor `upload_dir` patch, `--env daytona` cloud option, and leaderboard submission process.
- **pi's stance**: the README explicitly says public session data matters "instead of toy
  benchmarks" and ships **pi-share-hf** (https://github.com/badlogic/pi-share-hf) +
  https://huggingface.co/datasets/badlogicgames/pi-mono for publishing real sessions. pi does not
  maintain a public leaderboard of its own.

### B.2 — oh-my-pi (the product the user asked about)

- Repo: https://github.com/can1357/oh-my-pi · npm `@oh-my-pi/pi-coding-agent` (v18.8.7, updated
  daily) · site https://omp.sh · install `curl -fsSL https://omp.sh/install | sh`.
  It is a **fork of badlogic/pi-mono** by can1357 / Stencil Labs ("The Pi you love, with
  batteries included"): 60+ providers, 31 built-in tools, 14 LSP ops, 28 DAP ops, ~80k lines of
  Rust core, `omp` CLI. Long-horizon **memory the agent curates** (`retain`/`learn`/`recall`
  facts between sessions) — conceptually the same differentiator Unown has.
- **What oh-my-pi runs for tests/benchmarks** (this is the direct answer to the user's question):
  1. **`@oh-my-pi/pi-metaharness`** — "One manager for repository benchmarks": Harbor, TypeScript
     edit, and SnapCompact runs share one experiment→run→trace model, SQLite store, REST/SSE API,
     and a dashboard on :4700 (`bun run serve --port 4700`; `POST /api/runs {benchmark: harbor|edit|snapcompact,
     model, tasks, concurrency, attempts, …}`). Harbor runner options: `-m model -l tasks -n
     concurrency -k attempts (pass@k) -d dataset (terminal-bench@2.0 …) --timeout-multiplier
     --environment docker|apple-container`. **Notably it includes a "Native Terminal-Bench 2.1
     runner" (`bun run bench:tb`) that bypasses Harbor and Docker entirely** — it boots each
     task's published OCI image as an **x86_64 KVM microVM** on a "Vibemon" host, streams omp's
     `--mode rpc` through `vmon exec --pipe`, and runs the verifier in the same mutated VM
     (needs a KVM host; not possible in our container sandbox).
     Their benchmark model pools are cheap-model mixes (Ling 3.0 Flash, DeepSeek V4 Flash,
     Nemotron 3.5, Laguna S 2.1, Tencent Hy3, Step 3.7 Flash via OpenRouter `:floor`, with
     `openrouter/qwen/qwen3.7-flash` as vision role) — i.e. oh-my-pi benchmark-runs **Qwen
     flash-tier models** routinely.
  2. **`@oh-my-pi/typescript-edit-benchmark`** — "Edit benchmark suite built on TypeScript source
     mutations" (an aider-style edit benchmark using the pi-mono TS codebase itself).
  3. **`@oh-my-pi/snapcompact`** — context-compression package **with a SQuAD eval suite**.
  4. Trace reports: `scripts/trace-report.ts` turns a run trace into a narrative markdown report
     via two cheap models (~$0.001/report) — a nice "show your work" artifact pattern.
- No public leaderboard or published scores found for oh-my-pi itself; its value to us is the
  **architecture** (unified benchmark manager + dashboard + native no-Docker runner) and its
  honest-infrastructure choices (auth never enters task containers, resumable runs, spend
  tracking per trial).

### B.3 — pi ecosystem extras (context for "tamagotchi")

- https://awesome-pi.site catalogs 1,587 pi-related projects; the "Misc" list includes
  **"Tamagotchi like pet for your pi coding agent" (TypeScript)** and "Elyntic self-improvement
  lab" — i.e. "tamagotchi" in this space is a **keep-your-agent-alive self-improvement loop
  product**, not a formal benchmark (https://awesome-pi.site/misc). The academic analog is
  "A Self-Improving Coding Agent" (SICA, https://arxiv.org/abs/2504.15228) which reports 17–53%
  gains by letting the agent rewrite its own codebase. This is exactly Unown's pitch — a
  self-run "learning-loop" eval is on-brand and defensible.

---

## (c) Ranked Docker-free benchmark plan for Unown (this sandbox: no Docker, no KVM, no cloud sandbox)

Sandbox inventory: Python 3.12.15 + pytest 9 (venv), Node 24.21 + bun 1.3.14, g++ 14.2,
JRE only (no javac), no go/rust/cmake (user-space tarballs/pip can add them), ~7GB disk,
outbound net OK. LLM endpoint: local bridge `http://127.0.0.1:3031/v1` (OpenAI-compatible, no
key needed locally; see `Unown/.env` — `BRIDGE_API_KEY` is empty) serving **kimi-k2.5,
qwen3.7-plus, qwen3.6-plus**; upstream spacing 400ms, 180s timeout. Agent: `unown -p "prompt"`
in a working dir; model via `PI_MODEL_ID`.

### Plan A (highest credibility): Aider polyglot subset, run by Unown — "Aider polyglot, Unown harness, N-exercise subset"

Externally recognized benchmark, directly comparable to public rows (Kimi K2 59.1%, Qwen3 32B
40.0% on the official board), and it tests exactly what a terminal coding agent does
(read stub → edit files → run tests → fix from failures).

1. **Data**: `git clone --depth 1 https://github.com/Aider-AI/polyglot-benchmark` (≈2,600 exercise
   files; layout `<lang>/exercises/practice/<name>/`: stub + tests + `.docs/instructions.md` +
   `.meta/example.*` reference solution).
2. **Pick a stratified subset** (label it!): e.g. **50 exercises** proportional to the 225-mix
   (Python 8, JS 11, C++ 6, Go 9, Java 10, Rust 6) — or start **Python+JS+C++ only (25 exercises)**
   if avoiding extra toolchains; fix the subset list by commit hash and publish it in the results
   JSON so the run is reproducible. Choose exercises deterministically (e.g. alphabetical per
   language) to avoid cherry-picking.
3. **Toolchains** (all user-space, no root):
   - Python: `pytest` (already in /home/z/.venv) — command `pytest -q` in the exercise dir.
   - JS: `npm install` once per exercise (or a shared `node_modules` cache), then
     `sed -i 's/\bxtest(/test(/g' *.spec.js && npm run test` (aider's npm-test.sh).
   - C++: `pip install cmake` (wheel) → `cmake -DEXERCISM_RUN_ALL_TESTS=1 -G "Unix Makefiles" .. && make` in `build/` (aider's cpp-test.sh).
   - Go (optional): `curl -LO https://go.dev/dl/go1.25.x.linux-amd64.tar.gz && tar -C $HOME -xzf` → `$HOME/go/bin/go test ./...` (~450MB).
   - Java (optional): Temurin 21 JDK tarball (~190MB) + exercises ship `./gradlew test` (gradle
     downloads itself on first run; ~10min/exercise first time).
   - Rust (optional): `curl https://sh.rustup.rs | sh -s -- -y --profile minimal` (~1GB) →
     `cargo test -- --include-ignored`.
4. **Runner** (mirroring aider's harness, but with Unown as the agent):
   - For each exercise, copy the exercise dir to a fresh scratch dir
     (Unown's own bubblewrap sandbox can wrap this: `unown` already sandboxes bash via bwrap).
   - Prompt (adapted from aider's): attach `.docs/instructions.md` + the failing test file
     contents + the file list; ask Unown to make the tests pass; **1 attempt, then feed back the
     test output for attempt 2** (aider default `--tries 2`); report **pass@1 and pass@2**.
   - `PI_MODEL_ID=kimi-k2.5 unown -p "$(cat instructions.md)"` (headless print mode;
     `--mode json` if we want structured events) with cwd = scratch dir.
   - Score: exercise passes iff test command exits 0 (timeout 180s, aider uses 180s).
5. **Cost/runtime** (rough): ~5–25k tokens/exercise-attempt for these small files; 50 exercises ×
   2 attempts ≈ 1–3M tokens → **$0.5–$3 per model** at plus-tier pricing; wall-clock
   **1–3.5h** with 2–4 parallel workers (bridge enforces 400ms spacing upstream).
6. **Report as**: "Aider polyglot benchmark (Exercism), 50-exercise subset, Unown 0.x harness,
   2 attempts, models kimi-k2.5 / qwen3.7-plus / qwen3.6-plus — pass@1 / pass@2 / tokens / $".
   Context rows from the official leaderboard (Kimi K2 59.1% @225, Qwen3 32B 40.0% @225, gpt-5
   88.0% @225) clearly marked as full-225, different-harness (aider) results.

### Plan B (medium credibility, cheap): pi's own vitest-evals behavioral suite — what pi/Unown run on themselves

This is literally "the tests pi runs", it needs no Docker, and it exercises the agent loop
(tools, extensions, skills) rather than just the model:

1. Suite lives in-tree: `Unown/pi-repo/packages/evals` (see `README.md` there).
   Run: `cd Unown/pi-repo && npm run eval -- --provider zai-bridge --model kimi-k2.5`
   (env equivalent `PI_PROVIDER=zai-bridge PI_MODEL=kimi-k2.5 npm run eval`); forward extra
   vitest args after `--`. Artifacts: `.eval/runs.jsonl` + `sessions/` JSONL per run.
2. Write Unown-specific evals with `createPiCodingAgentHarness` (name, model, noTools,
   transformSystemPrompt, output) — e.g. a **self-improvement eval**: run task → capture session
   note → new session same task → measure pass-rate lift + token delta (the "tamagotchi/SICA"
   experiment: 17–53% gains reported academically). Use `evalHarnessTable` + repetitions ≥5 with
   `judgeThreshold: null` so scores are observations, and report pass-rate lift in points.
3. Add an **edit benchmark** in the style of oh-my-pi's typescript-edit-benchmark: apply scripted
   mutations to pi-repo TS sources and ask Unown to restore/patch them; score with `tsc`/vitest.
   (We already have the whole pi-mono codebase in-tree — same trick oh-my-pi uses.)
4. Cost/runtime: pennies per suite (a few dozen short runs); minutes per suite, hours for a
   6-repetition A/B matrix. This is the "self-improving" story's proof engine for the landing
   page (pass-rate curve across memory versions — data Unown's engine already records).

### Plan C (supporting metrics): model-level sanity checks — evalplus (HumanEval+/MBPP+) and LiveCodeBench

These are **model** benchmarks (single-shot, non-agentic) — good as a "model quality" column and
to sanity-check the bridge, not as agent proof. Label them as such.

1. **evalplus** (`pip install "evalplus[vllm]"` or plain `pip install evalplus`):
   - HumanEval+ (164 problems, 80× more tests than HumanEval) / MBPP+ (378 tasks, 35× tests).
   - Point at our OpenAI-compatible bridge:
     `evalplus.evaluate --model kimi-k2.5 --dataset humaneval --backend openai --greedy \
        --base-url http://127.0.0.1:3031/v1` (env `OPENAI_API_KEY=x` if the client insists on one;
     our bridge needs none). `--greedy` = temperature 0, pass@1. Local execution is the default —
     Docker only optional for isolation (https://github.com/evalplus/evalplus).
   - Runtime: ~30–60 min/model on HumanEval+ (164 prompts × greedy), tokens ≈ 0.3–1M; MBPP+
     similar. Cost ≈ $0.1–$1/model.
   - Published context numbers: https://evalplus.github.io/leaderboard.html (frontier models
     90%+; use as "model tier" reference, not the headline).
2. **LiveCodeBench** (contamination-free, contest problems from LeetCode/AtCoder/Codeforces;
   https://github.com/LiveCodeBench/LiveCodeBench, data
   https://huggingface.co/datasets/livecodebench/code_generation_lite):
   `git clone … && uv venv --python 3.11 && uv pip install -e .`, then their CLI
   (`run_lcb …`) supports OpenAI-compatible endpoints; v6 split recommended
   (qwen3.7-plus self-reports 89.6% on v6 — a citable row for our model family).
3. **tau2-bench** (optional; agent reliability in tool-agent-user interaction — airline/retail/
   telecom/banking domains; https://github.com/sierra-research/tau2-bench, Python ≥3.12 ✓,
   no Docker; live board https://taubench.com). Not a coding benchmark; use only if we want a
   "policy-following" angle. Runtime ~1h/domain/model.
4. **Not runnable here** (documented for honesty): Terminal-Bench (Docker per task; oh-my-pi's
   no-Docker path needs a KVM host, pi's other path needs Daytona/Modal cloud keys),
   SWE-bench Verified / SWE-bench-Live (per-instance Docker images on DockerHub),
   Commit0 (57 libraries, Docker-isolated test envs,
   https://commit-0.github.io/). **Show their published numbers for our model families
   (Section a) instead, clearly attributed** — that's what Warp does.

### Recommended sequencing

1. Week 1: Plan C evalplus (quick model sanity + bridge shakedown) → Plan A Python+JS subset
   (25 exercises, 3 models, pass@1/pass@2, tokens, $) → publish table + methodology footnote.
2. Week 2: Plan A full 50-exercise subset incl. Go/C++ (Java/Rust if disk allows); add
   qwen3.6-plus as an ablation (thinking off) — cheap interesting row.
3. Ongoing: Plan B self-improvement evals (the differentiator) — pass-rate lift across memory
   versions, surfaced on the landing page as a chart (see (e)).

---

## (d) Fairness rules for agent benchmarking (collect the industry's actual practice)

1. **Attempts**: state pass@k explicitly. Aider: 2 attempts with test-failure feedback between
   them; leaderboard sorted by pass@2. Artificial Analysis: average pass@1 across 3 attempts.
   Kimi K2.5 tech report: coding scores averaged over 5 runs. Terminal-Bench leaderboard
   submission requires 5 full runs (pi's X post caveat). **Never mix pass@1 and pass@2 in one
   column.**
2. **Temperature/sampling**: SWE-bench mini-SWE-agent ≤1.x used temp 0.0; ≥2.x leaves it unset
   (provider default). EvalPlus uses `--greedy` (temp 0). Kimi used temp 1.0/top-p 0.95 for
   agentic runs. **Rule: fix and disclose one setting per table; for agent runs prefer the
   provider default + deterministic tools, and report the variance instead of hiding it.**
3. **Variance/statistical honesty**: report CI or spread (tbench prints "64.8% ± 3.1%" = 95% CI;
   Cline publishes same-build rerun spreads of ±6–18 points on 89 tasks). With n=30–50
   exercises, one exercise = 2–3.3 points — say so ("±5pp at n=50"). Never claim ranking
   deltas smaller than the spread. A/B claims need repetitions (pi's evals README: ≥5–6
   repetitions, judgeThreshold null, report lift in points).
4. **Cost/token accounting**: report tokens (prompt/cached/completion) and $ per run and per
   task (aider shows $/run; tbench shows $ and tokens per submission; AA shows cost/task;
   swebench mini-SWE-agent rows show $/instance). Unown's bridge already meters per-request
   spend — surface it per exercise in the results JSON.
5. **Sandboxing/test pollution**: aider runs the benchmark "inside docker" only to contain
   generated code; we have Unown's bwrap sandbox instead — run each attempt in a fresh scratch
   dir inside bwrap, copy tests in from the pristine clone, never let the agent see
   `.meta/example.*` (aider's harness only shows the stub + docs + tests; the reference solution
   must be excluded from the prompt and from the workspace).
6. **No test-set tampering**: don't let the agent edit the test file to pass (aider doesn't
   forbid it but scores on exit code; safest: make test files read-only in the scratch dir).
   Remove `@Disabled` annotations for Java (aider does) and `xtest`→`test` for JS — disclose it.
7. **Label subsets honestly**: "Aider polyglot (Exercism), 50-exercise subset, Unown harness,
   2 attempts, kimi-k2.5 via Dashscope, 2026-10-xx, commit <hash>" — never "polyglot 78%".
   Pin the exercise list (file+commit hash), the harness version, and the model snapshot date.
8. **Contamination**: prefer post-cutoff/live datasets for headline claims (LiveCodeBench v6,
   SWE-bench-Live) or disclose cut dates; OpenAI dropped SWE-bench Verified over contamination
   (Feb 2026) — cite that when someone asks why we don't show SWE-bench.
9. **Same model, same harness** when comparing harnesses; same harness, same everything when
   comparing models (Cline: "Most models perform best in their own harness"; Databricks found
   pi ≈ native harnesses at lower cost — a good expectation-setter for Unown rows).
10. **Publish artifacts**: aider publishes per-run YAML; Cline publishes traces; oh-my-pi
    normalizes traces into a store. Unown should publish the results JSONL + session JSONL
    (pi evals already snapshot these) + the exact prompt template. Cheap trust, big payoff.

---

## (e) How competitors present benchmark results (patterns to copy)

1. **Aider** (https://aider.chat/docs/leaderboards/): plain dense **table** — Model | Percent
   correct | Cost | Command | Correct edit format | Edit format — each row expandable into a
   full YAML stat block (dirname, pass rates 1/2, tokens, timeouts, seconds/case, total cost,
   date, version). Takeaway: **table + expandable receipts + the exact command to reproduce**.
2. **Terminal-Bench** (https://www.tbench.ai/): ranked table with **95% CI whiskers**, model
   release date, tokens, cost; alternate **Pareto (score vs cost)** and **waffle** (per-task
   pass/fail grid) views; version selector (1.0…4.0). Takeaway: **show the distribution, not
   just the mean; a per-task waffle grid is very landing-page friendly.**
3. **SWE-bench** (https://www.swebench.com/): separated tabs "all agents" vs "bash-only
   mini-SWE-agent" (model-vs-model fairness), links to logs/trajectories per row.
4. **Cognition/Devin** (https://cognition.com/blog/swe-2): one compact benchmark × model-comparator
   table + explicit Pareto cost argument ("within one point of X while 64% cheaper").
5. **Cline**: blog post with methodology first (Hill Climber's Checklist, variance tables),
   downloadable traces; benchmark framed as multi-objective (cost vs score), not a single boast.
6. **Artificial Analysis** (https://artificialanalysis.ai/agents/coding-agents): composite index
   card + separate **Time per Task / Cost per Task** charts, harness comparison toggle, safety
   columns. Takeaway: **pair every accuracy number with a cost/latency number.**
7. **Warp**: no self-run leaderboard; points at official third-party boards. Takeaway: if we
   can't run SWE-bench/TB here, **quote their official boards with links and dates** — it reads
   as more honest than a self-run subset anyway.

**Recommended Unown landing-page pattern**: an "Benchmarks" section with (1) a small table:
"Aider polyglot subset (N=50, 2 attempts) — pass@1 / pass@2 / tokens / $" per model, with an
expandable "methodology" footnote (subset list pinned by commit, prompt template, bridge
config); (2) a line chart "pass-rate vs memory version" from the self-improvement evals
(the differentiator nobody else shows); (3) a context box: published first-party numbers for
the same models on SWE-bench Verified / Terminal-Bench 2.0 with links and dates, clearly
marked "vendor-reported, full benchmark, different harness".

---

## Appendix — quick source index

| What | URL |
|---|---|
| Aider polyglot design blog | https://aider.chat/2024/12/21/polyglot.html |
| Aider leaderboard | https://aider.chat/docs/leaderboards/ |
| Polyglot exercise data | https://github.com/Aider-AI/polyglot-benchmark |
| Aider benchmark harness | https://github.com/Aider-AI/aider/tree/main/benchmark |
| Terminal-Bench leaderboard | https://www.tbench.ai/ |
| Terminal-Bench versions | https://www.tbench.ai/benchmarks |
| pi Terminal-Bench adapter | https://github.com/badlogic/pi-terminal-bench |
| pi X post (8th place) | https://x.com/badlogicgames/status/1995295577907593690 |
| pi evals package | `Unown/pi-repo/packages/evals` (README) |
| oh-my-pi repo | https://github.com/can1357/oh-my-pi |
| oh-my-pi metaharness | `packages/metaharness` in the oh-my-pi repo |
| SWE-bench Verified | https://www.swebench.com/verified.html |
| SWE-bench-Live | https://github.com/SWE-bench-Live/SWE-bench-Live |
| Kimi K2.5 tech report | https://github.com/MoonshotAI/Kimi-K2.5 |
| Qwen3.7-Plus blog | https://qwen.ai/blog?id=qwen3.7-plus (aggregated: https://llm-stats.com/models/qwen3.7-plus) |
| Devin SWE-2 | https://cognition.com/blog/swe-2 |
| Cline evals methodology | https://cline.bot/blog/open-sourcing-evals-for-open-weight-agents |
| Artificial Analysis agents | https://artificialanalysis.ai/agents/coding-agents |
| evalplus | https://github.com/evalplus/evalplus |
| LiveCodeBench | https://github.com/LiveCodeBench/LiveCodeBench |
| tau2-bench | https://github.com/sierra-research/tau2-bench |
| Commit0 | https://commit-0.github.io/ / https://github.com/commit-0/Commit0 |
| llm-stats polyglot aggregate | https://llm-stats.com/benchmarks/aider-polyglot |
| Epoch polyglot page | https://epoch.ai/benchmarks/aider-polyglot |
| OpenAI on SWE-bench contamination | https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified |
