# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated here by AutoDream. Edit freely — your edits are preserved as a new version.
- Unown sessions have access to: todo, note, task, fetch_url, web_search, webfetch, lsp, read, ls, grep.
- Benchmark latency probes are ephemeral; prune them during consolidation to prevent memory bloat [note 2026-10-20T14:50:20.263Z].

## Engine restart procedure
- Find bun --hot PID with cwd mini-services/agent-service via /proc/<pid>/cwd.
- Kill it, then re-run .zscripts/dev.sh.
- bun --hot does NOT reload changes outside mini-services/.

## Pre-commit checklist (engine changes)
- Run: bunx biome check --write on changed files in pi-repo/.
- Verify engine restart: GET /api/overview returns ok:true.
- Confirm dashboard: :3000 returns 200.

## Known pitfalls
- LLM bridge calls timeout at 240s with 3 retries; agent watchdog at 600s.
- Failed cycles auto-recover — do NOT restart engine to fix them.
- Web search may fallback to alternative providers (You.com, DuckDuckGo, Tavily) due to connection/rate-limit issues [note 1].

## Environment
- Current Bun version: 1.4.3 (released October 2026) [note 1]

## Module inventory (consolidated)
- pi-repo: Pi agent harness monorepo with cross-platform shell entry points.
- pi-repo/packages/agent: Core Agent class with stateful wrapper, tool execution, event streaming.
- pi-repo/packages/agent/src: Agent loop functions (agentLoop, agentLoopContinue, runAgentLoop).
- pi-repo/packages/agent/test: E2E integration tests with faux providers, proxy streaming tests.
- pi-repo/packages/agent/scripts: Telemetry schema documentation generator.
- pi-repo/packages/ai: Unified LLM API with automatic model discovery, provider abstraction.
- pi-repo/packages/ai/scripts: Build-time model catalog fetchers (models.dev, OpenRouter, Vercel, NVIDIA NIM).
- pi-repo/packages/ai/test: Provider-specific OAuth, streaming, tool calling tests.
- pi-repo/packages/pi-client: Transport-neutral client over framed CBOR bytes with lease modes.
- pi-repo/packages/pi-protocol: Protocol types and encoding.
- llm-bridge: OpenAI-compatible gateway proxying to Dashscope with model allow-list [note 1].
- zai-upstream: Local HTTP shim exposing sandbox's z-ai-web-dev-sdk for bridge routing [note 1].
- agent-service: Mini-service wrapper (port 3030) booting self-learning layer with REST+SSE API [note 1].
- e2e: Playwright-based dashboard and landing page tests with axe-core accessibility [note 1].
- blueprint/router: GitHub event dispatcher with headless Claude sessions, tightly controlled tool allowlist [note 1].
- blueprint/sandbox: Disposable keyless test rig with synthetic HOME, offline operation [note 1].
- blueprint/sandbox/scenarios: Integration tests for tiered memory, hooks, AutoDream, self-improvement loop [note 1].
- blueprint/harness: Self-improving evaluation harness with golden tasks and weakness clustering [note 1].
- blueprint/memory: Tiered memory stack observability mirroring CLAUDE.md hierarchy [note 1].
- blueprint/dreams: Auto-dreaming driver consolidating session notes via headless Claude [note 1].
- bin: Cross-platform CLI launcher (Unix shebang, Windows cmd/ps1) [note 1].
- benchmarks/selfimprove: Repeat-task efficiency experiments measuring memory impact [note 1].
- benchmarks/polyglot: Aider polyglot benchmark with 50-exercise Exercism subset [note 1].
- benchmarks/nonllm: Local ONNX models (bge-small/MiniLM, ms-marco) and symbolic lanes [note 1].
- benchmarks/nonllm/lib: LexRank, MinHash-LSH, BM25+RRF, memory activation scoring [note 1].
- benchmarks/memory-eval/recall-qa: LongMemEval-adapted multi-session QA-recall benchmark [note 1].
- benchmarks/quality-axes: Deterministic suite measuring contradiction, staleness, forgetting, interference [note 1].
- benchmarks/poison-corpus: Adversarial memory poisoning defense evaluation [note 1].
- benchmarks/mpbench: MPBench dataset adapter for poisoning defense measurement [note 1].
- benchmarks/longhorizon: Multi-file refactoring task benchmark using clippad fixture [note 1].
- benchmarks/longhorizon/task/tests: clippad test suite for store, CLI, author, notebook [note 1].
- benchmarks/longhorizon/reference/tests: Reference implementation tests for clippad [note 1].
- benchmarks/local-llm: llama.cpp + GGUF experiments against production remote model [note 1].
- benchmarks/local-llm/lib: Cross-platform llama-server lifecycle, OpenAI-compatible clients [note 1].
- v3-fixture/tests: membench benchmark fixture tests for calc, stats, format, persist, search [note 1].
- clippad: Note-taking domain module with Notebook, UserDirectory, search, formatting [note 1].
