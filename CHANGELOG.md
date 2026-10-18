# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Repo conventions: measured claims cite their receipts (`docs/testing-strategy.md`, `benchmarks/memory-eval/*/RESULTS.md`). Changes to agent behavior — prompts, default models, routing, guard rules, hooks, memory injection — are filed under **Agent Behavior**; the policy lives in [docs/BEHAVIOR.md](docs/BEHAVIOR.md).

## [Unreleased]

### Added

- **Self-update: `unown update`** — the update lifecycle for installed agents (design researched against Claude Code `claude update`, ohmyzsh `omz update`, Codex/Gemini update-notifier, rustup, brew). `unown update` fast-forwards the git-checkout install to the newest *ready* release tag (`git fetch --tags` + `git merge --ff-only`), re-runs the installer (deps, engine build, `.env`-preserving bootstrap, PATH shim), verifies the version actually moved (anti-shadowing), and **auto-rolls-back to the recorded pre-update commit when the rebuild fails**. Guards, each refusing with actionable guidance: dirty tree (opt in with `--allow-dirty` = git `merge --autostash`), pinned/detached installs without an explicit version, local commits ahead of the remote, non-descendant targets. A half-pushed tag (its `package.json` disagreeing with the tag name) is never offered. `unown update <version>` pins/rolls back explicitly; `unown update --rollback` restores the recorded state; `unown update --check` is non-mutating (exit `0` up to date, `2` available, `1` error) with a `--json` variant for scripts. State (`~/.unown/update-check.json`, `update-state.json`) lives outside the repo — the updater never dirties the user's tree.
- **`unown uninstall`** — the reverse of the install path (rustup `self uninstall` pattern): removes only the PATH shims that point into THIS checkout (foreign shims reported, never touched), keeps `~/.unown` memories by default (`--purge-data`) and the checkout (`--purge-checkout`, which refuses uncommitted work), `--dry-run` supported.
- **`unown doctor --json`** — machine-readable diagnostics (`{ok, version, checks[{id,status,detail}], summary}`) with unchanged exit semantics; scriptable and CI-able. Doctor also reports the version + short SHA + checkout path, the cached update-check state, and the user-state schema version.
- **`unown info`** — the bug-report support bundle: version, platform/toolchain, git state, provider names (baseUrls credential-redacted; `auth.json` existence + file mode only, contents never read), update-check state, active opt-outs. Human + `--json`; paste-safe by construction.
- **`unown completions bash|zsh|fish|powershell`** — static ASCII completion scripts; a drift test pins every script to mention every CLI command word.
- **User-state migrations** — forward-only `~/.unown` schema migration runner (`~/.unown/migrations.json`, capped history, non-fatal failures, downgrades never walk back). Zero migrations exist at v1; the mechanism ships so the first real one has somewhere to land. Runs after `unown update` applies; reported by doctor.
- **One-line installer** — `curl -fsSL https://unown-nine.vercel.app/install.sh | sh` (`public/install.sh`, served by the site deployment): refuses root, checks git, bootstraps bun via bun's own installer when missing, clones (main, or `--version vX.Y.Z` pinned), runs the repo installer; whole body in a `main(){…}; main "$@"` wrapper with `set -eu` (the standard curl-pipe-sh mitigations); review-first and checksum.sh documented. Release workflow now attaches `sha256sums.txt` to every GitHub Release. New doc: [docs/install.md](docs/install.md) (one-liner, manual, requirements, offline/air-gapped, uninstalling).
- **Update notifications** — interactive sessions show a one-line "update available" notice: TTY-gated, CI-suppressed, 24h-cached, refreshed by a detached background child running a read-only `git ls-remote` (no GitHub API, no rate limit, works with private/self-hosted remotes; never blocks startup). `unown doctor` now reports the version, short SHA, checkout path and last check state. Opt-outs: `NO_UPDATE_NOTIFIER` / `UNOWN_DISABLE_AUTOUPDATE` / `DO_NOT_TRACK` (background check only) and `UNOWN_DISABLE_UPDATES` (all update paths — the org/CI kill switch). Remote URLs are credential-redacted before any output or state write (a PAT embedded in the git remote never leaks — unit-pinned).
- **`unown changelog [n]`** — prints the latest `CHANGELOG.md` sections; a successful update prints the changelog slice for the crossed versions plus the release-notes URL.
- New user-facing doc: [docs/updating.md](docs/updating.md) — the full update contract (commands, exit codes, guards, pinned installs, rollback, offline/air-gapped use, privacy). Tests: `pi-repo/packages/self-learning/test/update.test.ts` (39 tests — semver, ls-remote parsing, notice gating, and the whole cmdUpdate flow against throwaway local git repos, including the PAT-redaction leak guard).
- **DOX (agent workflow)** — root `AGENTS.md` gains a **Git Preflight** section: every task opens, and the Closeout commit is preceded, by `git fetch` → measure `HEAD...@{u}` → `git pull --ff-only` (never a bare `git pull`, which is fetch + merge and can merge uninvited). A dirty tree is worked around, never cleared by `stash`/`restore`/`clean`/`reset --hard`; a diverged branch stops for the user's choice instead of an agent-side merge or rebase; and a moved tree refreshes what changed (`bun install`, `db:push`, service restart) and re-reads the AGENTS.md chain, because DOX is code. `CONTRIBUTING.md` points at it. This is a repo-workflow rule, not a runtime change — no prompt, model, routing, guard or hook moved, so [docs/BEHAVIOR.md](docs/BEHAVIOR.md) is unchanged.
- README: bespoke four-tier memory-stack diagram (`.github/assets/diagram-memory.png`, GBA brand palette, regenerable from `scripts/brand/diagram-memory.html`, layout-gated by `scripts/check_overflow.mjs`); README restructured 34 KB → 24.5 KB with every moved section landing in `docs/` (integrity gates + session walkthrough → `docs/memory.md`, production notes → `docs/configuration.md`, repository layout → `CONTRIBUTING.md`).

### Fixed

- `AGENTS.md`: the v2.0.0 verification claim overstated the Release workflow — caught by the first run of the new Git Preflight, which pulled `b30996a`, `e0b7520` and `1b6fc53` mid-task and watched 39107793393 go red. Corrected to measured state: CI run 39106033167 is 17/17 green and `v2.0.0` is tagged, but there is no green Release run and no published Release (`gh release view v2.0.0` → release not found) — three attempts, three distinct defects: the windows version-consistency step (the pwsh/POSIX bug's twin inside `release.yml`, fixed at `b30996a`), the unresolvable `anchore/sbom-action@v17` (upstream publishes only `v0.x`; re-pinned at `e0b7520`), and `subject-digest: sha256:${{ github.sha }}` feeding a 40-char SHA-1 commit id where a 64-hex sha256 is required (fixed at `1b6fc53`, re-tag runs in flight).

Pending for the next release: user-preference consolidation (the weakest recall-qa axis — single-session-preference warm 0.33 — needs a user-tier dream path) and release/productization standards.

## [2.0.0] - 2026-10-18

Tagged as v2.0.0. This entry seeds the changelog from the v2 history — the pi-based engine that superseded the v1 Claude Code harness blueprint (preserved under `blueprint/`).

### Added (folded from Unreleased)

- Community-health surface: `SECURITY.md` (coordinated disclosure + the agent threat model), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, the bug/feature issue forms and PR template under `.github/`, and `docs/BEHAVIOR.md` — the agent behavior card.
- CI: the mermaid byte-identity gate (README-extracted diagram sources, vendored sha-pinned mermaid 11.16.1 — the version github.com renders — dual fresh-context render with sha256 identity; found and pinned mermaid's `Math.random` shape-generator wobble) and the E2E + a11y gate (`e2e/mock-engine.mjs` zero-dep mock of the engine's REST + SSE contract, 11 Playwright tests: dashboard flows + axe-core WCAG 2.0/2.1 A/AA scans of the landing page and all seven dashboard tabs).

### Fixed (folded from Unreleased)

- Dashboard accessibility: 80+ real WCAG 2.1 AA contrast defects (zinc-500/zinc-600 small text on the dark theme, `opacity-70` stat-chip labels, zinc-700 mono captions) and one aria violation (`aria-label` on a role-less span in the difficulty stars) — found by the new axe gate's first run and fixed across `src/components/dashboard/`.
- CI: the Windows `build-test` leg failed at the version-consistency step since 6f134c7 (POSIX `if [ ... ]` under the runner's default pwsh); the step now runs under `shell: bash`. The "all 15 green" receipt that shipped at 8163db3 referenced a typo'd run id and a run that was actually red — corrected in `AGENTS.md` with the observed green run.

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
