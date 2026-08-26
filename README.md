# Unown — a self-improving Claude Code agent harness

Unown is an open blueprint + runnable scaffold for **using AI to improve AI**.
It packages five mechanisms — popularized by Anthropic's own practice of using
Claude Code to improve Claude Code — into one repository you can clone into any
project and run today:

| # | Mechanism | Where it lives | What it does |
|---|-----------|----------------|--------------|
| 1 | **Tiered Memory** | `CLAUDE.md`, `memory/`, `CLAUDE.local.md` | Enterprise policy → project → user → local override; persists context across sessions |
| 2 | **Self-Improving Harness** | `harness/` | Records runs → mines failures → proposes bounded fixes → validates on evals → promotes v2 only if the gate passes |
| 3 | **Routing** | `router/`, `.github/workflows/` | Connects Unown to GitHub events via headless (`claude -p`) cloud sessions — PR drafts, comment replies, Slack digests, even with your laptop closed |
| 4 | **Auto Dreaming** | `dreams/`, `.claude/agents/auto-dreamer.md` | A nightly subagent merges session notes: dedupes, resolves contradictions, prunes stale entries, consolidates into one clean `CLAUDE.md` proposal |
| 5 | **Hooks** | `.claude/settings.json`, `.claude/hooks/` | `PreToolUse` allow/deny gates, `PostToolUse` auto-format/lint/logging, plus `SessionStart`, `UserPromptSubmit`, `Stop`, `SubagentStop` |

For all five, the pattern is the same: **let the system discover its own weaknesses**.

---

## Quickstart

### Prerequisites

- [Claude Code](https://claude.com/claude-code) CLI (`npm install -g @anthropic-ai/claude-code`)
- Python 3.10+ (hooks and scripts are dependency-free standard library)
- An `ANTHROPIC_API_KEY` (or active Claude subscription login) for headless runs
- `gh` CLI (optional — needed for routed GitHub automation)

### 1. Drop Unown into your project

Copy this repo's contents into your project root (or vendor the directories you
want). The layout is intentionally boring:

```
.claude/settings.json     ← hooks wiring (deterministic control plane)
.claude/hooks/*.py        ← hook scripts (gatekeeper, formatter, scribe)
.claude/agents/           ← auto-dreamer + harness-analyst subagents
CLAUDE.md                 ← Tier-3 project memory Unown reads about itself
memory/digest.py          ← prints the effective memory stack for any dir
harness/                  ← the self-improvement loop (evals → mine → fix → gate)
dreams/                   ← session notes in, consolidated CLAUDE.md out
router/dispatch.py        ← GitHub event → headless session router
sandbox/                  ← keyless test rig: 6 scenarios, disposable clones
.github/workflows/        ← nightly-dream, self-improve, event-router
docs/                     ← research report, architecture, cost & security
```

### 2. Run it interactively

```bash
cd your-project
claude                      # SessionStart hook injects the memory digest
```

Watch the transcript: the `SessionStart` hook reports which memory tiers were
found; every prompt passes through `user_prompt_submit.py`; every Bash call
passes the `pre_tool_use.py` gate; every edited file is auto-formatted by
`post_tool_use.py`; when Claude stops, `stop.py` writes a session note to
`dreams/sessions/`.

### 3. Let it dream

After a few days of notes accumulate:

```bash
python3 dreams/dream.py --dry-run   # preview consolidation inputs
python3 dreams/dream.py             # write dreams/consolidated/<date>.md
```

Review the proposal, then merge what you like into `CLAUDE.md`.
Or let GitHub Actions do it nightly and open a PR for you.

### 4. Improve the harness itself

```bash
cd harness
./iterate.sh --max-iterations 3
```

This runs evals against the current harness version, mines failed transcripts
for weaknesses, asks Claude to propose a *bounded* fix, re-validates affected
evals (2-of-3 majority to absorb model noise), and either promotes the change
(`PASS`) or rolls it back and loops (`FAIL`).

### 5. Route tasks from GitHub

Enable the workflows under **Actions**, then add repository secrets:
`ANTHROPIC_API_KEY`. See [`docs/COST.md`](docs/COST.md) for budget knobs and
[`docs/SECURITY.md`](docs/SECURITY.md) before enabling event-driven routing.

### 6. Prove it works before touching anything: run the sandbox

No API keys, no network, no mutations of your checkout — every mechanism gets
driven end-to-end inside a disposable clone:

```bash
python3 sandbox/run_sandbox.py     # 6 scenarios; FAILS if your live repo changes
```

Expected tail: `Result: 6/6 scenarios PASSED`. See [`sandbox/README.md`](sandbox/README.md)
for what each scenario proves and how to add one.

---

## The five mechanisms in depth

Each mechanism has a working reference implementation plus a section in
[`docs/RESEARCH.md`](docs/RESEARCH.md) tracing it back to primary sources
(official Claude Code docs, Anthropic engineering writing, Self-Harness papers).

1. **Tiered memory** — four CLAUDE.md levels resolve per-session:
   managed policy (`/etc/claude-code/CLAUDE.md` on Linux), user
   (`~/.claude/CLAUDE.md`), project (`./CLAUDE.md`), local
   (`./CLAUDE.local.md`, gitignored). Tiers concatenate rather than hard-
   override; specificity breaks ties. `memory/digest.py` makes the stack
   visible and is injected by the SessionStart hook.
2. **Self-improving harness** — keep the model stable, make the harness
   editable, record every run, mine failures into weakness clusters, propose
   bounded changes, gate them behind evals. Promotion requires the validation
   gate, never a human's hope.
3. **Routing** — `claude -p` headless mode inside scheduled and event-driven
   GitHub Actions turns Unown into a background worker: draft PRs, reply to
   comments, triage issues, post Slack digests.
4. **Auto dreaming** — batch consolidation of session notes by a cheap,
   read-mostly subagent following ACE-style itemized merging (never rewrite
   the whole blob; merge structured bullets deterministically).
5. **Hooks** — deterministic shell-level control at every lifecycle edge:
   block dangerous commands *before* they run, format *after* edits, log at
   session boundaries.

## Repository hygiene

- No secrets ever live in this repo. Hooks redact obvious token patterns from
  logs; CI reads credentials from GitHub Actions secrets only.
- All hook scripts are standard-library Python, auditable in minutes.
- `docs/SECURITY.md` covers prompt-injection defenses for untrusted GitHub
  content, sandboxing, and PAT hygiene (rotate any token shared in chat!).

## License

MIT — see [LICENSE](LICENSE).
