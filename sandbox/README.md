# Unown Sandbox

A **disposable, keyless test rig** for everything Unown does. One command
exercises all five mechanisms against a throwaway clone of this repository —

```bash
python3 sandbox/run_sandbox.py            # full suite (~1–10s, zero API cost)
python3 sandbox/run_sandbox.py --list     # enumerate scenarios
python3 sandbox/run_sandbox.py --scenario s5   # a single scenario
python3 sandbox/run_sandbox.py --keep     # keep runtime artifacts for inspection
```

## Why a sandbox?

Unown's scripts mutate state: hooks write logs, dreamers consolidate notes,
the harness edits source files and promotes patches. You want to *prove* those
behaviors before pointing them at your real project. The sandbox gives each
run:

- a **fresh clone** of the repo under `sandbox/.runtime/<timestamp>/repo`
  (git-initialized with a `sandbox-baseline` commit so diffs are meaningful),
- a **synthetic `HOME`** populated from `fixtures/home` — giving you a real,
  controllable user-tier `CLAUDE.md` without touching yours,
- a stripped environment (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `OPENAI_API_KEY` removed) — scripts physically cannot spend money or call
  home; anything that tries fails loudly instead,
- an **isolation proof**: when the suite finishes, the runner verifies your
  live checkout is byte-identical and `git status`-clean, or the suite FAILS.

## The six scenarios

| ID | Mechanism | What is proven |
|----|-----------|----------------|
| S1 | Tiered memory | `user → project → local` resolution order via `memory/digest.py`; empty-HOME degradation |
| S2 | Hooks / gate | `PreToolUse` denies destructive FS ops & force-push & secret-writes, flags token echoes as `ask`, passes benign calls; audit trail redacts secrets |
| S3 | Hooks / hygiene | `PostToolUse` logs + runs the formatter plan on edits; `Stop` hook transcribes a fake transcript into `dreams/sessions/` with secret redaction |
| S4 | Auto dreaming | `dream.py --offline` folds session notes incrementally, merges exact-duplicate bullets `(x2)`, marks output UNREFINED, second run is a no-op |
| S5 | Self-improvement | Full `harness/seed_demo.sh` loop: baseline evals fail → weakness mined → bounded fix proposed → validation gate PASSES → v2 promoted (RUNBOOK stale fact corrected) |
| S6 | Routing | `dispatch.py --dry-run` wraps an (adversarial!) issue payload in `<untrusted_event>` fencing, keeps injection prose visible-as-data, strips token shapes, extracts context — no model call |

Plus the runner-level guarantee: **the live repo was untouched by all of it**.

## How isolation works

```
your live checkout                     sandbox runtime (disposable)
/home/z/my-project/Unown/              sandbox/.runtime/<stamp>/
├── CLAUDE.md        ── copy ──▶       ├── repo/       fresh git clone +
│   (never touched)                    │               baseline commit
└── ...                                ├── home/       synthetic HOME
                                       │   └── .claude/CLAUDE.md (user tier)
                                       └── empty-home/ proves tier absence
```

Runtime dirs that are gitignored upstream (`harness/runs|proposals|verdicts`,
`unown/logs`, `dreams/sessions`) are recreated empty inside the clone so the
real scripts can write like they would in production.

## Fixtures

- `fixtures/home/.claude/CLAUDE.md` — simulated user-global memory tier
  (includes an `@import` line to exercise digest parsing).
- `fixtures/local/CLAUDE.local.md.example` — simulated gitignored local
  override (the `.example` suffix keeps it committable; the repo's global
  `CLAUDE.local.md` ignore rule must stay intact for real users).
- Session notes and hostile payloads are generated programmatically inside
  each scenario (`S4`, `S3`, `S6`) so they stay co-located with their
  assertions. Synthetic tokens are **assembled at runtime from harmless
  pieces** — no literal token-shaped strings exist anywhere in this tree.

## Writing a new scenario

Drop `sandbox/scenarios/s07_your_thing.py` exposing:

```python
NAME = "your-thing"
DESCRIPTION = "one-liner for --list"
def run(ctx):                      # ctx: repo/home/empty_home Paths + sh()
    proc = ctx.sh([ctx.py, "some/script.py"], cwd=ctx.repo)
    assert proc.returncode == 0
    return "what just got proven"   # shown in the report row
```

The runner auto-discovers `sNN_*.py` modules; failures print a traceback plus
the last commands/stdout/stderr captured through `ctx.sh`.

## When something fails

Re-run with `--keep` and poke around the runtime tree directly — logs land in
`sandbox/.runtime/<stamp>/repo/unown/logs/`, harness verdicts under its own
directory, consolidated dreams under `dreams/consolidated/`. The runner keeps
the runtime automatically whenever any scenario fails.
