# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Repo conventions: measured claims cite their receipts (`docs/testing-strategy.md`, `benchmarks/memory-eval/*/RESULTS.md`). Changes to agent behavior — prompts, default models, routing, guard rules, hooks, memory injection — are filed under **Agent Behavior**; the policy lives in [docs/BEHAVIOR.md](docs/BEHAVIOR.md).

## [Unreleased]

### Added

- Community-health surface: `SECURITY.md` (coordinated disclosure + the agent threat model), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, the bug/feature issue forms and PR template under `.github/`, and `docs/BEHAVIOR.md` — the agent behavior card.

Pending for the next release: user-preference consolidation (the weakest recall-qa axis — single-session-preference warm 0.33 — needs a user-tier dream path) and release/productization standards.

## [2.0.0] - 2026-10-18

No git tag has been cut yet; 2.0.0 is the version in `package.json` at HEAD. This entry seeds the changelog from the v2 history — the pi-based engine that superseded the v1 Claude Code harness blueprint (preserved under `blueprint/`).

### Added

- Cross-platform stack: bun TypeScript lifecycle scripts (`agent:install` / `agent:start` / `agent:stop` / `agent:link`), Windows launchers (`bin/unown.cmd`, `bin/unown.ps1`), auto-hydration of pi model data in the installer — identical flow on Linux, macOS and Windows.
- macOS seatbelt (`sandbox-exec`) OS-sandbox backend with a bwrap-equivalent profile, plus the darwin doctor.
- CI: 3-OS build-test matrix (ubuntu / macOS / Windows) driving the real `scripts/install.ts` path, a `sandbox-smoke` job, and the llm-bridge suite (95 hermetic tests) as a dedicated job.
- Benchmarks (receipts in `benchmarks/memory-eval/*/RESULTS.md`):
  - MPBench-adapted adversarial corpus (50 adversarial + 20 benign, public-corpus provenance): 0/50 planted, 0/50 shipped, 0 benign guard false positives.
  - Memory quality axes (contradiction / staleness / forgetting / interference, deterministic): 4/4 pass, 0 guard false positives.
  - LongMemEval-adapted recall QA (40 questions, warm/cold controlled arms): warm 0.650 vs cold 0.025 — lift +0.625.
  - Poison corpus (strong-signal obfuscation ladder): 10/10 flagged, 0 planted, 0 shipped.
- Landing page (`src/components/landing/`) with the GBA palette contract and the `scripts/gba_palette_check.mjs` gate; mission-control dashboard (7 tabs, live SSE feed).
- Decision records: `docs/memory-system-review.md`, `docs/testing-strategy.md`, and the two harness-swap assessments (`docs/oh-my-pi-swap-assessment.md`, `docs/opencode-swap-assessment.md`).

### Changed

- Memory injection is budget-capped: hard-sum cap on the injected memory block with oldest-first degradation.
- Dream canary gate upgraded to K stratified samples with tool-drift and claim-vs-ground-truth gating.

### Fixed

- Engine test-suite 3-OS import-order residue closed at the source (`test/_env.ts` preload via the package `bunfig.toml`): deterministic 736/0/37 across clean-tmp runs — receipts in `docs/testing-strategy.md` §7.2.
- `chatJson` / `extractJson` robustness (live dream-cycle minting failure on kimi-k2.5): string/escape-aware balanced-brace scan, `reasoning_content` fallback for `chatText`, and one corrective retry observable as the `llm:json-retry` bus event. Engine suite 753/0/37 after (17 new tests).
- `RAW_DEVICE_WIN` deny-pattern never matched — one backslash too many.
- Sandbox hardening rounds: runtime-bind + realpath resolution, Windows deny-patterns and tmpdir jail (hooks), macOS `/private` system-tree fix.
- CI Windows fixture-ordering flake (fixed at source).

### Security

- **Agent Behavior** — `security-bypass` guard rule: a bypass/circumvent/skip/disable verb near a process-gate object, both orders, directive or observation framing, note-level and line-level. Found live by MPBench (ADV_1590 — attacker rule shipped as an "observed, not policy" pattern), fixed in `pi-repo/packages/self-learning/src/guard.ts`, pinned by `pi-repo/packages/self-learning/test/guard.test.ts`. Live re-run of the exact case: flagged → not planted → nothing shipped; corpus re-run 0/50 planted, 0/50 shipped, 0 benign false positives (`benchmarks/memory-eval/mpbench/RESULTS.md`).
- Deterministic adversarial-content gate on both dream paths (memory-system review finding F4B).
- CI security gates: gitleaks full-history secret scan and `bun audit --prod`.

% No tags exist yet, so both entries point at the main commit stream. Re-point
% [2.0.0] at the tag URL when the release is cut.
[Unreleased]: https://github.com/kanishka-namdeo/Unown/commits/main
[2.0.0]: https://github.com/kanishka-namdeo/Unown/commits/main
