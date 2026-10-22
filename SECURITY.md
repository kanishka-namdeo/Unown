# Security Policy

How to report vulnerabilities in Unown, what is in scope, and where the
agent-specific defenses stand. The v1 blueprint's security model is preserved
at [blueprint/docs/SECURITY.md](blueprint/docs/SECURITY.md) as frozen
reference material; this page supersedes it for the current stack.

## Scope

In scope:

- The `unown` terminal agent (`bin/unown`) — session tools, hooks, plan mode, setup.
- The self-learning engine (`mini-services/agent-service` → `pi-repo/packages/self-learning`) — the memory pipeline: notes, guard layers, AutoDream consolidation, canary gates, skill minting.
- `mini-services/llm-bridge` — the OpenAI-compatible gateway over the upstream endpoint.
- Sandbox profiles: bubblewrap (Linux), seatbelt (macOS), the in-process path jail (native Windows and fallback).
- Secrets handling: the root `.env`, `~/.unown/agent/auth.json`, the git remote URL.

Out of scope:

- The vendored pi-mono base under `pi-repo/` beyond Unown's own changes — pure upstream bugs go to [badlogic/pi-mono](https://github.com/badlogic/pi-mono).
- Vulnerabilities in your LLM provider (Dashscope, OpenAI, others) — report to the provider.

## Supported Versions

| Version | Supported |
|---------|-----------|
| `main` (HEAD) | yes |

No tagged releases exist yet. Fixes land on `main`; security-relevant fixes are recorded under **Security** in [CHANGELOG.md](CHANGELOG.md).

## Reporting a Vulnerability

Report privately via GitHub's Private Vulnerability Reporting: on
[github.com/kanishka-namdeo/Unown](https://github.com/kanishka-namdeo/Unown), open the **Security** tab and use **Report a vulnerability**. This opens a private advisory thread with the maintainers. Please do not open a public issue for anything you believe is exploitable.

Include, where you can:

- the commit you ran — `git rev-parse HEAD` in your clone (`unown --version` is landing this milestone),
- the component (agent / engine / bridge / sandbox / hooks),
- reproduction steps and the impact you assess,
- relevant lines from `.run/*.log`, with secrets removed.

What to expect:

- Best-effort acknowledgement within a few days — this is a maintainer-run project, not a security team.
- We confirm or reject the report, then coordinate a fix and a disclosure window with you before anything goes public.
- Guard-bypass reports are especially welcome: a payload class that slips the memory guard usually lands as a new guard rule plus pinned tests plus a corpus case (the worked example is in [docs/BEHAVIOR.md](docs/BEHAVIOR.md)).
- Credit in the CHANGELOG entry on request.

## Agent Threat Surface

Unown is autonomous-adjacent: it consolidates untrusted text into memory it later injects into its own sessions, executes commands in a sandbox, and runs a self-improvement loop. The classes we treat as live threats:

1. **Prompt injection via session notes / memory.** Anything the agent reads — files, fetched URLs, tool output — can carry instruction-shaped text that rides the note pipeline into AutoDream and from there into future session context. Mitigated in layers: a deterministic note-level flag layer, quarantine banners on flagged content in the dream, and a deterministic ship gate on the final candidate. Measured on the adversarial corpora: poison-corpus 10/10 strong-signal cases flagged, 0 planted, 0 shipped; MPBench 0/50 planted, 0/50 shipped, 0 benign false positives — receipts in [benchmarks/memory-eval/](benchmarks/memory-eval/). Model-level judgment remains probabilistic; the deterministic layers are the guarantee.
2. **Guard bypass classes.** The guard is pattern-based, so novel phrasings can evade layer 1. A real one was found live by MPBench (ADV_1590: a process-gate bypass framed as an *observation*, shipped as an "observed, not policy" pattern) and fixed by the `security-bypass` rule in `pi-repo/packages/self-learning/src/guard.ts`, pinned by `pi-repo/packages/self-learning/test/guard.test.ts`. New classes become rules + tests + corpus cases.
3. **Sandbox escape.** Engine runs execute under the OS sandbox — bubblewrap on Linux (read-only root filesystem, private `/home` `/tmp` `/run`, killed network namespace, dropped capabilities; a verified binary is vendored with sha256 provenance under `pi-repo/packages/self-learning/native/`), seatbelt on macOS with a bwrap-equivalent profile, and the in-process path jail on native Windows and as the universal fallback. The `sandbox-smoke` CI job covers this surface; escapes in profile generation or the fallback jail are in scope.
4. **Upstream key leakage via `.env`.** `BRIDGE_UPSTREAM_KEY` lives only in the gitignored root `.env`. CI runs a gitleaks full-history scan, a `.pre-commit-config.yaml` runs the same scan on maintainer machines before a commit is ever made, and GitHub secret scanning with **push protection** is enabled on the repository (a secret-shaped push is blocked before it lands). If a key ever lands in a tracked file, commit message, or log, treat it as disclosed and rotate it. Store the GitHub PAT in a credential helper (`git config credential.helper store`, `0600` on `~/.git-credentials`) — never in the remote URL, which many tools echo verbatim.
5. **Self-modification via the harness loop.** The loop writes its own project memory. Containment: every memory write is versioned and roll-backable; a shipped improvement requires a sandboxed pass plus a confirmation re-run; a dream that breaks the most recent canary task is rolled back; regressions auto-unship. What the loop must never weaken is the referee itself — guard logic and the tests that pin it. A change to guard rules without tests and a CHANGELOG entry is rejected (policy: [docs/BEHAVIOR.md](docs/BEHAVIOR.md)). The instruction-set write policy (October 2026, below) additionally keeps in-session writes away from AGENTS.md, skills, hooks and permission configs entirely.
6. **Hooks execution surface.** Both hook layers are in-process pattern gates, not shell scripts. Engine `PreToolUse` denies destructive shell and outbound network; `PostToolUse` feeds transpiler errors back to the agent. Terminal hooks are scoped for real work (network, `git push`, installs allowed); `UNOWN_STRICT_HOOKS=1` restores sandbox-grade strictness. A user-hook `mutate` decision re-runs the full built-in gate stack on the mutated input before it executes (TOCTOU closure, October 2026). Deny-list misses are in scope.
7. **Instruction-set persistence (rule-file backdoors — including the memory lane).** The instruction set — AGENTS.md/CLAUDE.md at any depth, `.unown/skills/*/SKILL.md`, `.unown/agents/*.md`, hooks and permissions configs, and (2026-10-22 v2) tier-1 project memory with its provenance sidecar — is code the model executes as behavior that *reads* like documentation. October 2026's in-the-wild campaigns made this a primary vector (AutoRedClaw arXiv:2610.27244; Agent Commander, embracethered.com/blog/posts/2026/agent-commander-your-agent-works-for-me-now/; the "Fable to Haiku" subagent-config downgrade chain; the Tensorlake npm worm's `.claude/settings.json` / `.vscode/tasks.json` droppers). Mitigations shipped 2026-10-22: in-session writes to those paths are hard-denied in every mode (write/edit tools and bash redirects alike, verdict final above the declarative layer — `pi-repo/packages/self-learning/src/instruction-guard.ts`); AutoDream-minted skills land in the never-auto-loaded `.unown/skills-staged/` and are promoted by a human; an invisible-Unicode lint (CI + pre-commit + `unown doctor-instructions`) rejects the hidden-instruction character classes (Unicode Tags behind emoji, bidi TrojanSource, zero-width and Sneaky-Bits carriers); CODEOWNERS + branch protection put every instruction-file change behind owner review. The 2026-10-22 v2 extension closes the memory lane the same day the Manual-notes preservation feature opened it: agent writes/appends to `.unown/memory/project.md` and a forged `.unown/memory/project.provenance.json` are denied (the lane makes agent-written memory durable — the persistence vector OWASP ranks as ASI06, Memory & Context Poisoning), and provenance v2 (per-section sha256 + a sticky `manualEdited` flag) means a preserved hand-edit is framed “hand-edited, unverified” forever instead of being laundered into “written by AutoDream” trust framing — the laundering class formalized in arXiv:2607.29167 (*Memory Provenance Laundering in LLM Agents*).
8. **Repo-local git config execution (GitSpawn class).** A cloned project's `.git/config` can carry execution sinks — `core.fsmonitor` (git spawns the configured helper on a plain `git status`/`git add`), `core.sshCommand`, `core.askPass`, `core.pager` — that fire the moment the harness runs git in the working tree, before any approval prompt (September 2026 disclosure, shattered.io/gitspawn-ai-coding-agent-vulnerability-2026/; seven coding agents affected). Mitigations shipped 2026-10-22: every read-only probe neutralizes hooks + fsmonitor + sshCommand + askPass + pager with `-c` overrides (`readOnlyGitArgs()` in `pi-repo/packages/self-learning/src/gittools.ts`); the mutation path neutralizes fsmonitor + sshCommand while deliberately keeping the user's own hooks live (husky/lint-staged must gate agent commits like any other); a regression test plants a hostile `core.fsmonitor` and pins that the marker file never appears.
9. **DNS-exfiltration commands.** Prompt injection + an allowlisted `ping`/`nslookup`/`dig`/`host` leaked `.env` contents via DNS subdomains without any user approval (Claude Code CVE-2025-55284). Unown's network deny rule was structurally blind to the same shape — resolution itself is the channel, with no HTTP/socket argv for the rule to match. Mitigations shipped 2026-10-22: the DNS-capable family (POSIX + PowerShell twins) is denied in the sandbox and strict-terminal lists with the loopback exemption preserved; these commands are never allowlisted in shipped defaults (`pi-repo/packages/self-learning/src/bash-policy.ts`).

## Repository hardening posture (2026-10-22)

GitHub-side controls, verified via the REST API on the date above:

- **Secret scanning: enabled**, with **push protection enabled** — a secret-shaped push is blocked before it lands (docs.github.com/en/code-security/secret-scanning/push-protection-for-repositories-and-organizations).
- **Branch protection on `main`**: pull requests required, one approving CODEOWNERS review required, stale reviews dismissed, seven required CI status checks (3-OS build+test, typecheck, unit, secret/advisory scan, production build), linear history, force-push and deletion blocked. Owner-action extras not yet enabled (the current fine-grained PAT lacks those toggles): `secret_scanning_non_provider_patterns`, `secret_scanning_validity_checks` — both recommended.
- **Administrators are exempted from branch protection on purpose**: this is a solo-maintainer project and verified milestone landings push directly to `main` (every such push still runs the full CI matrix afterward; the exemption is the documented trade-off between gate rigor and the maintainer workflow). Non-admin collaborators — and any stolen non-admin credential — go through the full PR + review + CI gate. A compromised *admin* credential bypasses this gate; rotation guidance is below.
- **`.github/CODEOWNERS`**: instruction files (AGENTS.md/CLAUDE.md/SKILL.md at any depth), the guard/gate sources (instruction-guard, bash-policy, guard, shield, permissions, hooks, termhooks, injection-scanner, config-trust), the sandbox and hardened-git sources (bwrap, sandbox, gittools, worktree), the CI workflows, the gitleaks config and the unicode lint all require owner review on every PR.
- **Actions are SHA-pinned** with least-privilege `permissions:` per job; Dependabot covers actions + bun; CodeQL runs weekly; OpenSSF Scorecard is tracked; releases carry SBOM + build-provenance attestations.
- **PAT hygiene**: the repository is pushed through a git credential helper (`0600`), never a PAT-in-remote-URL. Fine-grained PATs with minimal scopes and short expiry are the standing recommendation for anyone cloning with write access; the October 2026 GhostAction campaign (1,900 accounts, 30k+ repos) started with exactly one shared token. If a token is suspected stolen: revoke **from a different machine** and snapshot first — the Shai-Hulud/Tensorlake worms wipe the home directory when they detect revocation.

## OWASP Top 10 for LLM Applications — control mapping

Self-assessment against the OWASP 2025 list (genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/); the 2026 edition's changes (Excessive Agency rising to #3, Hidden Context Exposure replacing System Prompt Leakage) are noted where they change the answer.

| OWASP risk | Unown's control |
|---|---|
| LLM01 Prompt Injection | Deterministic injection shield over tool-result channels; memory guard (note flags + quarantine + ship gate) with adversarial-corpus receipts; untrusted-content banners; (2026 addition) instruction-set integrity controls — write denial, unicode lint, staged minting |
| LLM02 Sensitive Information Disclosure | `.env`/auth.json isolation; gitleaks CI + pre-commit + GitHub push protection; redaction-first `unown info`; engine bearer-token auth on the loopback API |
| LLM03 Supply Chain | SHA-pinned actions; single lockfile (bun.lock — root package-lock.json removed 2026-10-22); `bun audit --prod` in CI; Dependabot; CodeQL; SBOM + provenance attestations; SHA-256-verified vendored bwrap; GitSpawn-neutralized git invocation |
| LLM04 Data and Model Poisoning | The memory pipeline is the poisoning surface: canary runs, double-verification ship gate, retention auto-unship, quarantine + rollback — poison-corpus receipts (0/50 planted shipped) |
| LLM05 Improper Output Handling | Syntax gate feeds errors back; shield annotates suspect tool output; bash redirect target re-validation (symlink + instruction-set aware); deny-list blocks generated destructive payloads |
| LLM06 Excessive Agency | Hard-coded catastrophic deny-list above the declarative permission layer (rules can only add restrictions); write jail; sandbox deny-list; (2026) instruction-set write denial + TOCTOU re-check close the self-modification lane; `UNOWN_SANDBOX_REQUIRED=1` fail-closed knob |
| LLM07 System Prompt Leakage | (2026 note: replaced by Hidden Context Exposure) not treated as a boundary — the design assumes hidden context is discoverable; no secrets ride in system prompts, skill descriptions or memory tiers |
| LLM08 Vector/Embedding Weaknesses | Local deterministic lexical fallback embedder by default; ONNX lane optional; no third-party embedding upload of user data |
| LLM09 Misinformation | Verify-first defaults (the project's own checks run inside the agent loop); task-minted capability evals gate what the loop believes it learned |
| LLM10 Unbounded Consumption | Job watchdog; hourly/daily LLM budget; busy-mutex; (2026 addition) DNS-exfil denial closes a zero-cost exfil channel; token ceilings on the bridge spacing throttle |

## Already Mitigated, with Receipts

- Memory subsystem findings F1–F10, each status-tagged with evidence: [docs/memory-system-review.md](docs/memory-system-review.md).
- Test strategy and CI receipts (3-OS matrix, sandbox smoke, bridge suite): [docs/testing-strategy.md](docs/testing-strategy.md).
- Live benchmark receipts — memory-live (7/7), memory-poison (3/3), poison-corpus, MPBench, quality-axes, recall-qa: [benchmarks/memory-eval/](benchmarks/memory-eval/) (per-suite `RESULTS.md`).

## Known Trade-offs

- The guard's note-level layer is pattern-based: subtle or novel phrasings may pass unflagged (MPBench adversarial note-flag rate 0.26). The dream plant layer plus the deterministic ship gate are the backstop — together they shipped 0/50 adversarial directives.
- On hosts without the OS sandbox, the engine degrades to the path jail: process-level containment, not kernel-grade. Operators who need fail-closed behavior can set `UNOWN_SANDBOX_REQUIRED=1` (2026-10-22) — agent runs then refuse to start rather than degrade; on native Windows (no OS sandbox exists) that knob means "use WSL2 or unset it".
- Memory consolidation is model-judged, so benign content can be dropped (MPBench benign consolidation recall 0/20 is a measured limitation, not a defense gap) — recall is traded for safety there.
- The binary updater's `release.json` manifest is **not signed** (decision 2026-10-22: the release-key custody burden was judged to outweigh the threat it closes). Integrity is HTTPS to the release host or to a mirror the user configures, plus exact size and SHA-256 verification of every archive against the manifest and `sha256sums.txt` before activation, and `unown --version` before it is made live. A release account, host or configured mirror that is compromised can therefore serve a different manifest with matching archives. Independent verification stays available: the release's build-provenance attestations (`gh attestation verify <asset> --repo kanishka-namdeo/Unown`) and `sha256sums.txt`. Shipped binaries are code-unsigned for the same reason — see [docs/install.md](docs/install.md#standalone-per-os-binaries).
