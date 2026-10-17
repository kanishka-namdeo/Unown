# Memory & learning

How unown remembers: a four-tier memory stack injected into every session, a note pipeline that captures what actually happened, and AutoDream — the consolidation job that turns notes into memory and mints skills.

Related pages: [usage](usage.md) · [skills](skills.md) · [configuration](configuration.md) · [troubleshooting](troubleshooting.md) · [memory-classifier-evaluation](memory-classifier-evaluation.md) · [memory-system-review](memory-system-review.md)

- [The four-tier stack](#the-four-tier-stack)
- [What every session sees](#what-every-session-sees)
- [The note lifecycle](#the-note-lifecycle)
- [AutoDream consolidation](#autodream-consolidation)
- [Skills minting](#skills-minting)
- [Editing memory by hand](#editing-memory-by-hand)
- [What to commit](#what-to-commit)
- [Inspecting memory](#inspecting-memory)
- [Honesty: what the loop actually ships](#honesty-what-the-loop-actually-ships)

Scope note: this page is about the **terminal agent's** memory — what your sessions see and feed. The engine's internal learning loop (harness, ship gates, task minting) is described in the [README](../README.md#the-learning-loop).

The loop in one sentence: every session writes notes → the engine's AutoDream job consolidates them → the next version of your project's memory (and sometimes a new skill) lands in `<project>/.unown/` → your next session starts where the last one ended.

If you only remember one thing: **memory is files on disk, re-read for every session** — there is no hidden database on the terminal side. Anything you can edit, you can inspect with `cat`.

## The four-tier stack

Memory is four Markdown files, merged most-specific-wins and injected into every agent session — engine sandboxes and terminal sessions alike:

| Tier | File | Maintained by | Role |
|------|------|---------------|------|
| 0 · policy | `~/.unown/memory/policy.md` | you (ops / enterprise) | Non-negotiable guardrails. Optional — a built-in default policy applies when the file is absent. |
| 1 · project | `<project>/.unown/memory/project.md` | AutoDream and you | The learning surface: terminal session notes are consolidated here. Hand edits survive (see below). |
| 2 · user | `~/.unown/memory/user.md` | you | Global preferences across every project; seeded on first run. |
| 3 · local | `<project>/.unown/memory/local.md` | you | Per-project, per-machine overrides. Highest precedence. Gitignored. |

Precedence is most-specific-wins, with `local.md` at the top: on a conflict, the local tier has the final say; the policy tier is the floor every session keeps. The stack is ordered policy → project → user → local when presented to the agent, each file labeled with its authority:

| Virtual file (as the agent sees it) | Backed by |
|-------------------------------------|-----------|
| `memory/tier0-policy.md` (enterprise policy — highest authority) | `~/.unown/memory/policy.md` or the built-in default |
| `.unown/memory/project.md` (maintained by AutoDream & you) | `<project>/.unown/memory/project.md` |
| `memory/tier2-user.md` (global preferences) | `~/.unown/memory/user.md` |
| `.unown/memory/local.md` (local overrides — highest precedence) | `<project>/.unown/memory/local.md` |

The project scaffold appears automatically on your first session in a directory (or immediately with `unown init`): `.unown/memory/project.md`, `.unown/memory/local.md`, and a `.unown/.gitignore` that keeps `local.md` (and any `*.local.md`) out of git. `unown init` in an existing project is idempotent — it never overwrites files that are already there.

## What every session sees

Every terminal session — and every engine sandbox run — gets the resolved stack attached as context, **alongside** your own `AGENTS.md`/`CLAUDE.md` chain (supplemented, never replaced). Two more things ride along:

- **Skills** — the four starters in `~/.unown/agent/skills/` plus everything in `<project>/.unown/skills/`, including skills AutoDream minted. Progressive disclosure: only name + description ride the prompt; the body loads on demand.
- **Subagent definitions** — `.unown/agents/*.md` (project level) and `~/.unown/agent/agents/*.md` (user level).

The stack is re-resolved from disk on every `/new`, `/resume` and `/fork` — a memory write AutoDream lands while your session is open is visible to the very next session command, no restart needed. `/learning` re-prints the effective stack mid-session, fresh from disk.

The four files ride the session context as files (like your `AGENTS.md` chain), re-resolved only when a new session starts — and they are plain Markdown, so what the agent sees is literally what `unown memory` prints.

## The note lifecycle

Notes are the raw material AutoDream consolidates. They enter four ways:

| Entry point | How | When it fires |
|-------------|-----|---------------|
| Mid-session | the `note` tool (agent-invoked) or `/note <text>` (you) | the moment something worth remembering happens; delivered to the engine immediately |
| Session exit | automatic exit-note capture | on quit, provided the session did something (at least one prompt or tool call); carries duration, tool usage and the final outcome |
| Shell | `unown note "watch out: flaky test in auth.spec"` | any time, outside a session |
| Subagents | automatic, `[subagent]`-tagged | every `task` subagent writes its own note — subagents learn too |

Delivery is a `POST /api/notes` to the engine (`UNOWN_ENGINE_URL`, default `http://127.0.0.1:3030`) carrying the note text and the project path (the engine caps a note at 20,000 characters — far beyond anything a session note should be). When the engine is unreachable — down, or you are working offline — the note is written to `~/.unown/notes/outbox/` as `<timestamp>-<project-slug>.md` with the project path and time in a small front-matter block, and nothing is lost. The engine ingests the outbox on boot and on its `note-sync` job (every 5 minutes), then archives each file to `~/.unown/notes/done/`.

You can watch the pipeline move: notes appear on the dashboard's Dreams tab as pending, get consumed by the next dream, and the dream's output shows exactly what was merged, pruned and added.

From there AutoDream takes over: benchmark notes feed the engine's own project memory, terminal notes feed **your** project's memory. A note is only consumed once — `markDreamed` ties it to the dream that ingested it.

## AutoDream consolidation

The `auto-dream` job (every 10 minutes, plus a `dream-check` event that wakes it when notes pile up) runs a consolidation sub-agent over the pending notes. It merges duplicates, resolves contradictions in favor of the most recent evidence, prunes stale one-off observations, reorganizes into topic sections (`## Workflow`, `## Known pitfalls`, `## Task playbooks`, …) and writes the next version — keeping the file under 120 lines and never deleting hard-won rules, only tightening their wording.

Two consolidation paths:

- **Benchmark notes → the engine's own project memory**, gated by a canary: the freshly dreamed memory must re-pass the most recently passing task. A dream that breaks it is rolled back automatically and shows up with status `gated` on the dashboard. `PI_DREAM_GATE=0` disables the gate ([configuration](configuration.md)).
- **Terminal notes → your project's `.unown/memory/project.md`.** Pending notes are grouped by project and each group is consolidated into that project's own memory file — the one the next session there reads. The engine-side dream needs at least 3 undreamed benchmark notes before it fires; project dreams run whenever terminal notes are pending.

Every consolidation is versioned in the engine DB — engine tiers under their own names (attributable: `seed` / `harness` / `autodream` / `rollback`), your project's memory under a synthetic `project:<slug>` tier. For the engine's four tiers the dashboard Memory tab shows the full history with one-click rollback; for your project's file the versions are recorded (and the project dreams appear on the Dreams tab with their version numbers), but restoring means pasting a previous version back into the file — which is trivial, because the file is plain Markdown on your disk.

### Two different "project memories"

Do not confuse the two files that share a tier name:

| | The engine's project memory | Your project's memory |
|---|------------------------------|------------------------|
| File | inside `data/self-learning/` (repo runtime state) | `<project>/.unown/memory/project.md` |
| Fed by | benchmark run notes | your terminal session notes |
| Written by | harness improvements + benchmark dreams | project dreams (+ you, by hand) |
| Gated by | canary re-run of the last-passing task | nothing — your notes, your file |

The engine's own memory is what the five-mechanism loop improves; your project's memory is what your sessions accumulate. The dashboard Memory tab shows the engine's four tiers and the skills minted into your projects; your project's dreams show up on the Dreams tab.

## Skills minting

When consolidated notes reveal a recurring, multi-step procedure — how to run this test suite, how to deploy, how to debug the flaky part — AutoDream mints it as an Agent Skill into `<project>/.unown/skills/<name>/SKILL.md`, and the very next session can pick it up.

Guardrails on minting:

- max **2 skills per dream** (quality bar) and a **24-skill ceiling per project** (context budget for the skill index)
- every proposal is validated against the Agent Skills contract and deduplicated against everything already on disk
- every version is recorded in the engine DB; rollback restores a previous version's file
- **retiring** a skill (removing its directory from your project) is a deliberate dashboard action — the engine never deletes your files on its own

See [skills](skills.md) for the full skills story, including the seeded starters.

### A worked example

A terminal session in `~/code/api-gateway` hits a flaky integration test, you (or the agent) record it mid-session with `/note flaky: auth.spec retries on slow CI — run with --runInBand locally`, and at quit the exit note (duration, tools used, final outcome) is delivered too. The next `auto-dream` pass over that project's pending notes might consolidate both into:

```markdown
## Known pitfalls
- auth.spec is timing-flaky under parallel runners — use `--runInBand` for local runs.
```

and, if several notes kept describing the same multi-step procedure (clone → seed → `--runInBand`), mint a `run-tests` skill beside it. Next session in that project: the pitfall is already in the stack, the skill is one prompt away.

## Editing memory by hand

All four tiers are plain Markdown — edit them whenever:

- `project.md` — safe. AutoDream consolidates *on top of* the current file content, so your edits survive and the next dream records them in the version history.
- `user.md` / `policy.md` — yours entirely; unown only seeds them once.
- `local.md` — the right place for machine-specific truth ("the work laptop needs `--network=host`").

Do not bother formatting: bullets under topic headings is the shape AutoDream reads and writes best.

## What to commit

| Path | Commit? | Why |
|------|---------|-----|
| `.unown/memory/project.md` | yes | AutoDream maintains it; committing shares the project's accumulated learning across machines and teammates |
| `.unown/memory/local.md` | no | personal, per-machine overrides; the scaffold's `.gitignore` already excludes it |
| `.unown/skills/` | yes | minted skills are project assets — the point is that the next session (and the next teammate) picks them up |
| `.unown/agents/` | yes | your own subagent definitions |

What a teammate gets when they clone the repo: the shared project memory and the minted skills. What they do not get: your `local.md` (gitignored), your `~/.unown/memory/user.md` (global, per-human) and any queued notes still sitting in your outbox. Their sessions start from the shared tiers and start accumulating their own.

## Inspecting memory

- `unown memory` — prints the effective four-tier stack for the current directory, exactly as a session receives it.
- `/learning` — the same stack, in-session, re-read from disk.
- `unown doctor` — verifies the project and user memory files exist ([troubleshooting](troubleshooting.md)).
- Dashboard → **Memory** tab — the engine's four tiers with contents, full version history and one-click rollback, plus every skill AutoDream minted into your projects (skills rollback and retire write back to your project's files).

## Honesty: what the loop actually ships

The engine only earns improvements when the model struggles. A model that already passes every task leaves the mining-and-patching machinery nothing to ship — the honest outcome is "nothing shipped", not a fabricated improvement. With kimi-k2.5 all five seeded benchmark tasks pass unaided, so the engine's own memory grows slowly (mostly through dream consolidation), while your project memory grows from real session notes. Point the engine at a weaker model or harder tasks and the mining, patching and shipping fires on its own — see [configuration](configuration.md) for switching models.
