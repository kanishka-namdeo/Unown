# Unown project memory (Tier 3)

Unown is a self-improving Claude Code agent harness. When you (Claude) are
working inside this repository, these rules describe how the repo fits together
and how to change it safely.

## What lives where

- `.claude/settings.json` — hook wiring. Every lifecycle gate is declared here.
- `.claude/hooks/*.py` — standard-library Python hook scripts. No pip deps, ever.
- `.claude/agents/` — subagent definitions (`auto-dreamer`, `harness-analyst`).
- `memory/` — tiered-memory explainer and `digest.py` (effective memory stack).
- `harness/` — self-improvement loop: evals, failure miner, fix proposer,
  validation gate, `iterate.sh` orchestrator.
- `dreams/` — session notes (`sessions/`) and consolidated proposals
  (`consolidated/`). `dream.py` runs consolidation.
- `router/` — GitHub-event → headless-session dispatch.
- `docs/` — RESEARCH.md (sources), ARCHITECTURE.md (diagrams), COST.md,
  SECURITY.md.

## Non-negotiable rules

1. **Hook scripts stay dependency-free** (Python stdlib only). They must fail
   open: any unexpected exception exits 0 with a warning on stderr so the
   agent never bricks itself.
2. **Never log secrets.** Scripts must redact token-shaped strings
   (`github_pat_…`, `ghp_…`, `sk-ant-…`) before writing anywhere.
3. **Bounded changes only in the harness loop.** A proposal may edit at most
   one file listed in `harness/EDITABLE_SURFACES`; anything else is out of scope.
4. **Validation gate decides promotion.** Never ship a harness change that has
   not passed `validate_fix.py`.
5. Test scripts with `python3 -m py_compile` and validate YAML before commit.

## Conventions

- Python: stdlib only, type hints welcome, no framework.
- Shell: `set -euo pipefail`, POSIX-friendly.
- Docs: Markdown; diagrams as fenced mermaid blocks (GitHub renders them).
- Commits: conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).
