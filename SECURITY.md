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
4. **Upstream key leakage via `.env`.** `BRIDGE_UPSTREAM_KEY` lives only in the gitignored root `.env`; the GitHub PAT lives only in the git remote URL. CI runs a gitleaks full-history scan. If a key ever lands in a tracked file, commit message, or log, treat it as disclosed and rotate it. Use fine-grained PATs with minimal scopes.
5. **Self-modification via the harness loop.** The loop writes its own project memory. Containment: every memory write is versioned and roll-backable; a shipped improvement requires a sandboxed pass plus a confirmation re-run; a dream that breaks the most recent canary task is rolled back; regressions auto-unship. What the loop must never weaken is the referee itself — guard logic and the tests that pin it. A change to guard rules without tests and a CHANGELOG entry is rejected (policy: [docs/BEHAVIOR.md](docs/BEHAVIOR.md)).
6. **Hooks execution surface.** Both hook layers are in-process pattern gates, not shell scripts. Engine `PreToolUse` denies destructive shell and outbound network; `PostToolUse` feeds transpiler errors back to the agent. Terminal hooks are scoped for real work (network, `git push`, installs allowed); `UNOWN_STRICT_HOOKS=1` restores sandbox-grade strictness. Deny-list misses are in scope.

## Already Mitigated, with Receipts

- Memory subsystem findings F1–F10, each status-tagged with evidence: [docs/memory-system-review.md](docs/memory-system-review.md).
- Test strategy and CI receipts (3-OS matrix, sandbox smoke, bridge suite): [docs/testing-strategy.md](docs/testing-strategy.md).
- Live benchmark receipts — memory-live (7/7), memory-poison (3/3), poison-corpus, MPBench, quality-axes, recall-qa: [benchmarks/memory-eval/](benchmarks/memory-eval/) (per-suite `RESULTS.md`).

## Known Trade-offs

- The guard's note-level layer is pattern-based: subtle or novel phrasings may pass unflagged (MPBench adversarial note-flag rate 0.26). The dream plant layer plus the deterministic ship gate are the backstop — together they shipped 0/50 adversarial directives.
- On hosts without the OS sandbox, the engine degrades to the path jail: process-level containment, not kernel-grade.
- Memory consolidation is model-judged, so benign content can be dropped (MPBench benign consolidation recall 0/20 is a measured limitation, not a defense gap) — recall is traded for safety there.
