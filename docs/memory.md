# Memory & learning

How unown remembers: a four-tier memory stack injected into every session, a note pipeline that captures what actually happened, and AutoDream — the consolidation job that turns notes into memory and mints skills. Since 2026-10-22 the consolidation engine underneath AutoDream is a memory platform — [Mem0](https://github.com/mem0ai/mem0) (the `mem0ai` OSS TypeScript SDK) running in-process in the engine; the decision, the options table and the receipts live in [memory-platform-swap-assessment](memory-platform-swap-assessment.md).

Related pages: [usage](usage.md) · [skills](skills.md) · [configuration](configuration.md) · [troubleshooting](troubleshooting.md) · [memory-classifier-evaluation](memory-classifier-evaluation.md) · [memory-system-review](memory-system-review.md) · [memory-competitor-research](memory-competitor-research.md) · [memory-platform-swap-assessment](memory-platform-swap-assessment.md)

- [The four-tier stack](#the-four-tier-stack)
- [What every session sees](#what-every-session-sees)
- [The note lifecycle](#the-note-lifecycle)
- [AutoDream consolidation](#autodream-consolidation)
- [The memory platform (Mem0)](#the-memory-platform-mem0)
- [Shared memory across sessions and projects](#shared-memory-across-sessions-and-projects)
- [Skills minting](#skills-minting)
- [Editing memory by hand](#editing-memory-by-hand)
- [What to commit](#what-to-commit)
- [Inspecting memory](#inspecting-memory)
- [Honesty: what the loop actually ships](#honesty-what-the-loop-actually-ships)

Scope note: this page is about the **terminal agent's** memory — what your sessions see and feed. The engine's internal learning loop (harness, ship gates, task minting) is described in the [README](../README.md#the-learning-loop).

The loop in one sentence: every session writes notes → the engine's AutoDream job runs them through the memory platform's extraction pipeline → the next version of your project's memory (and sometimes a new skill) lands in `<project>/.unown/` → your next session starts where the last one ended.

If you only remember one thing: **memory is files on disk, re-read for every session** — the terminal agent never opens a database, and anything you can inspect you can `cat`. The one nuance since the platform swap: the project tier's file is a deterministic *render* of engine-side platform memories (below), so there is now exactly one database in the loop — it lives in the unown repo's `data/self-learning/mem0`, never inside your project.

## The four-tier stack

Memory is four Markdown files, merged most-specific-wins and injected into every agent session — engine sandboxes and terminal sessions alike:

| Tier | File | Maintained by | Role |
|------|------|---------------|------|
| 0 · policy | `~/.unown/memory/policy.md` | you (ops / enterprise) | Non-negotiable guardrails. Optional — a built-in default policy applies when the file is absent. |
| 1 · project | `<project>/.unown/memory/project.md` | AutoDream (rendered from the memory platform) and you | The learning surface: terminal session notes are extracted into the platform and rendered here. Hand edits have a new contract — see [Editing memory by hand](#editing-memory-by-hand). |
| 2 · user | `~/.unown/memory/user.md` | you | Global preferences across every project; seeded on first run. |
| 3 · local | `<project>/.unown/memory/local.md` | you | Per-project, per-machine overrides. Highest precedence. Gitignored. |

Precedence is most-specific-wins, with `local.md` at the top: on a conflict, the local tier has the final say; the policy tier is the floor every session keeps. The stack is ordered policy → project → user → local when presented to the agent, each file labeled with its authority:

| Virtual file (as the agent sees it) | Backed by |
|-------------------------------------|-----------|
| `memory/tier0-policy.md` (enterprise policy — highest authority) | `~/.unown/memory/policy.md` or the built-in default |
| `.unown/memory/project.md` (AutoDream-maintained once dreamed; repo-supplied files are flagged untrusted until then) | `<project>/.unown/memory/project.md` |
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

You can watch the pipeline move: notes appear on the TUI dashboard's Dreams screen (`unown dashboard`) as pending, get consumed by the next dream, and the dream's output shows exactly what was merged, pruned and added.

From there AutoDream takes over: benchmark notes feed the engine's own project memory, terminal notes feed **your** project's memory. A note is only consumed once — `markDreamed` ties it to the dream that ingested it.

## AutoDream consolidation

The `auto-dream` job (every 10 minutes, plus a `dream-check` event that wakes it when notes pile up) runs a consolidation pass over the pending notes. Since the platform swap the pass is: notes are quarantined or admitted (structurally — flagged notes never reach the extraction LLM at all), admitted notes go through the platform's extraction pipeline as atomic, deduplicated, scoped memories, a thin reconcile pass resolves contradictions **recency-first** (the shipped contract: the most recent evidence wins and the invalidated rule may not appear anywhere as current practice — only with an explicit historical marker) and prunes stale one-off observations, and a deterministic render writes the next version of the tier file in the familiar topic sections (`## Workflow`, `## Known pitfalls`, `## Task playbooks`, …) — capped at `PI_MEM0_MAX_RENDERED` bullets (default 110, oldest dropped first), never deleting hard-won rules *to save space* (a rule invalidated by newer evidence is not protected). The quarantine/consolidation contracts and the layer stack are measured in [`benchmarks/memory-eval/*/RESULTS.md`](../benchmarks/memory-eval/); the guard wiring of the new pipeline is pinned by `test/dream-guard.test.ts`.

Notes flagged by the untrusted-content scanner are **quarantined under the zero-extraction contract** — and since the swap the contract is structural, not prompt-borne: a flagged note is dropped from the batch before the extraction call, so it cannot be paraphrased into memory even by a model with no prompt resistance. Defense in depth on the output side: every extracted memory is scanned before it survives the dream, and the rendered document still passes the deterministic guard gate (first mints gate on any flag).

Two consolidation paths:

- **Benchmark notes → the engine's own project memory**, gated by a canary: the freshly dreamed memory must re-pass the most recently passing task. A dream that breaks it is rolled back automatically — the memory version *and* the platform's event stream — and shows up with status `gated` in the TUI dashboard's Dreams screen. `PI_DREAM_GATE=0` disables the gate ([configuration](configuration.md)).
- **Terminal notes → your project's `.unown/memory/project.md`.** Pending notes are grouped by project and each group is consolidated into that project's own memory file — the one the next session there reads. The engine-side dream needs at least 3 undreamed benchmark notes before it fires; project dreams run whenever terminal notes are pending. A dream that extracts nothing substantive records an honest `no-change` (the file is untouched — never an empty skeleton over your memory).

Every consolidation is versioned in the engine DB — engine tiers under their own names (attributable: `seed` / `harness` / `mem0` / `rollback`), your project's memory under a synthetic `project:<slug>` tier. For the engine's four tiers the TUI dashboard's Memory screen shows the full history with one-key rollback and a per-version **diff against its predecessor** (`enter` on a version row — the engine stores every version's full text, so "what did that dream change?" is a lookup, not a by-eye comparison of two dumps); for your project's file the versions are recorded (and the project dreams appear on the Dreams screen with their version numbers), but restoring means pasting a previous version back into the file — which is trivial, because the file is plain Markdown on your disk (the platform-level revert — what the gates do — is exact event-stream rollback; a pasted file is re-rendered from platform state at the next dream).

## The memory platform (Mem0)

The engine behind the project tier (the "learning surface") since 2026-10-22 — full decision record and receipts in [memory-platform-swap-assessment](memory-platform-swap-assessment.md). What it is:

- **In-process Mem0** (`mem0ai` OSS TS SDK, Apache-2.0) inside the self-learning engine: notes go in through the platform's ADD→DEDUP→UPDATE extraction pipeline (LLM calls through the same llm-bridge, same governor budget and circuit breaker as every other learning call), and come out as atomic, scoped memories — one fact or rule each, deduplicated, per project.
- **Storage**: SQLite vector store + history under `DATA_DIR/mem0` (`PI_MEM0_DIR`) — engine-side runtime state, gitignored like the rest of `data/`.
- **Embeddings**: the local ONNX lane (bge-small-en-v1.5, 384-dim) when installed, else a deterministic lexical fallback that keeps offline installs learning; the active backend is named in the render footer so a degraded mode is never silent (`PI_MEM0_EMBEDDER`).
- **The render**: `project.md` is a deterministic Markdown view of the platform's memories for your project — topic sections, newest-first, bullet cap, provenance footer (`<!-- unown: rendered N/M memories via Mem0 (backend: …) -->`). It stays the committable artifact; a teammate's fresh engine imports its bullets verbatim at their first dream.
- **Import at first run**: a pre-swap install's existing `project.md` (engine tier or terminal project) imports verbatim into the platform at the first dream — no LLM rewrites, nothing lost at the swap boundary.
- **Semantic recall (new)**: the engine can now *search* memory — `GET /api/memories?q=…` (scoped, with the platform status on `/api/overview`) — a capability the flat-file pipeline never had.

What it is not: a cloud service. The platform runs locally on your data; the only network traffic is the extraction LLM through your own bridge.

### Two different "project memories"

Do not confuse the two files that share a tier name:

| | The engine's project memory | Your project's memory |
|---|------------------------------|------------------------|
| File | inside `data/self-learning/` (repo runtime state) | `<project>/.unown/memory/project.md` |
| Fed by | benchmark run notes | your terminal session notes |
| Written by | harness improvements + benchmark dreams (both through the memory platform) | project dreams — renders of the platform's memories for your project (+ the one-time verbatim import) |
| Gated by | canary re-run of the last-passing task | nothing — your notes, your file |

The engine's own memory is what the five-mechanism loop improves; your project's memory is what your sessions accumulate. The TUI dashboard's Memory screen shows the engine's four tiers and the skills minted into your projects; your project's dreams show up on the Dreams screen.

## Shared memory across sessions and projects

Real setups run several agents at once — parallel sessions in one repo, the same repo cloned twice, worktrees for review branches, several projects that should share user-level habits. Three mechanisms keep that consistent (all 2026-10-22):

**Stable project identity.** The memory scope is keyed by the repository, not the directory name: the git remote (origin, worktree-aware) normalized and hashed into a 6-hex key appended to the repo name (`project:api-3f9c21`). One repository → one memory everywhere it is cloned (clones, renames, worktrees, machines); two unrelated directories that happen to share a name → two scopes, each with its own memory (the old basename key let them leak into each other — a same-named `~/work/api` and `~/personal/api` shared ONE memory bank). Non-git directories fall back to the resolved path hash. Installs that dreamed under the old basename key migrate automatically: the first dream under the composite key copies the old scope's memories verbatim (per-kind metadata intact); the old scope stays as an audit surface and stops receiving writes.

**Concurrent sessions, same project.** Sessions never write memory directly — they deliver notes (unique outbox filenames, 20k cap, engine-down queueing) and the engine serializes everything behind a single-instance lock, a one-job busy mutex and `BEGIN IMMEDIATE` version allocation in SQLite (WAL). Two sessions that exit simultaneously both land; the next dream consolidates both notes together. An open session injects the memory snapshot it booted with; `/new`, `/resume` and `/fork` re-read from disk.

**Cross-project recall + gated hoist.**
- `/memory search <query>` (in-session) and `GET /api/memories?across=1&q=…` run one semantic search over the engine scope AND every project scope that has dreamed — a session in project B can recall what was learned in project A, results tagged by source scope. Read-only: writes stay scoped, always.
- The cross-project hoist (`PI_USER_TIER_HOIST=1`) promotes a rule from project memory into the user tier only after **`PI_HOIST_MIN_PROJECTS` distinct projects** (default 2) have abstracted the same rule — one project's dream is project-suspicious, the same rule from two projects is a user-level habit. Promotion writes BOTH user tiers (the terminal `~/.unown/memory/user.md` every real session injects, and the engine's versioned user tier), additively, with the observing projects named in the provenance comment. Rules observed once park in the engine's candidate ledger awaiting their second project.

## Skills minting

When consolidated notes reveal a recurring, multi-step procedure — how to run this test suite, how to deploy, how to debug the flaky part — AutoDream mints it as an Agent Skill into `<project>/.unown/skills-staged/<name>/SKILL.md` (2026-10-22 hardening: minted skills are model-authored instruction content, so they are staged where no session loads them — skill discovery reads `.unown/skills/` only, and promotion into it is a human `mv`, recorded by the `staged: true` frontmatter and the README written into `skills-staged/` on the first mint). A **promoted** skill is picked up by the very next session; user-authored skills in `.unown/skills/` load as they always did.

Guardrails on minting:

- max **2 skills per dream** (quality bar) and a **24-skill ceiling per project** (context budget for the skill index)
- every proposal is validated against the Agent Skills contract and deduplicated against everything already on disk — the staged tree included, so a re-dream cannot overwrite a skill awaiting review
- every version is recorded in the engine DB; rollback restores a previous version's file
- **retiring** a skill (removing its directory from your project) is a deliberate TUI-dashboard action — the engine never deletes your files on its own

See [skills](skills.md) for the full skills story, including the seeded starters and the promotion step.

### A worked example

A terminal session in `~/code/api-gateway` hits a flaky integration test, you (or the agent) record it mid-session with `/note flaky: auth.spec retries on slow CI — run with --runInBand locally`, and at quit the exit note (duration, tools used, final outcome) is delivered too. The next `auto-dream` pass over that project's pending notes might consolidate both into:

```markdown
## Known pitfalls
- auth.spec is timing-flaky under parallel runners — use `--runInBand` for local runs.
```

and, if several notes kept describing the same multi-step procedure (clone → seed → `--runInBand`), mint a `run-tests` skill beside it. Next session in that project: the pitfall is already in the stack, the skill is one prompt away.

## Editing memory by hand

All four tiers are plain Markdown — but they are not all equal anymore:

- `project.md` — sections outside **`## Manual notes`** are re-rendered by the next dream from platform state. The `## Manual notes` section is yours: AutoDream preserves it **verbatim** across every re-render — one bullet per durable hand-written rule, capped at 4k chars (a visible `<!-- unown: manual notes over cap -->` marker says when the tail was dropped). (Before 2026-10-22 there was no preserved section and the seed's "edit freely" copy was misleading; the honest contract is now a real hand-edit lane.) **Edit it outside sessions, in an editor** — the in-session write gate denies agent writes and appends to `project.md` and its provenance sidecar (2026-10-22 v2: the lane's durability is exactly what made agent-written content a persistent injection channel; see [permissions](permissions.md#instruction-set-write-policy-2026-10-22-hardening)). Honesty about origin ships with the lane: once your file has carried a hand-edited Manual-notes section, the dream's sidecar records it (`manualEdited`, sticky) and every future session's injection frames the section as **`Manual notes section hand-edited, unverified`** — never as "written by AutoDream". To feed the learned sections, record a note (`unown note "…"` or the in-session `note` tool) and let extraction pick it up. Every version is still in the engine DB, so a render that overstepped is recoverable.
- `user.md` / `policy.md` — yours entirely; unown only seeds them once.
- `local.md` — the right place for machine-specific truth ("the work laptop needs `--network=host`"). Tiers 0/2/3 are untouched by the platform swap: plain hand-editable files, exactly as before.

Do not bother formatting: bullets under topic headings is the shape the render writes and the platform extracts best.

## What to commit

| Path | Commit? | Why |
|------|---------|-----|
| `.unown/memory/project.md` | yes | the rendered view of the platform's memories for this project; committing shares the accumulated learning across machines and teammates — a fresh engine imports the committed bullets verbatim at its first dream |
| `.unown/memory/local.md` | no | personal, per-machine overrides; the scaffold's `.gitignore` already excludes it |
| `.unown/skills/` | yes | promoted skills are project assets — the point is that the next session (and the next teammate) picks them up; the agent itself cannot write here (in-session writes are denied by the instruction-set guard) |
| `.unown/skills-staged/` | yes | where AutoDream mints — awaiting human promotion (`mv` into `.unown/skills/`); never auto-loaded, so committing it is committing a review queue, not a behavior change |
| `.unown/agents/` | yes | your own subagent definitions |

What a teammate gets when they clone the repo: the shared project memory and the promoted skills (plus the staged queue awaiting review). What they do not get: your `local.md` (gitignored), your `~/.unown/memory/user.md` (global, per-human) and any queued notes still sitting in your outbox. Their sessions start from the shared tiers and start accumulating their own.

## Inspecting memory

- `unown memory` — prints the effective four-tier stack for the current directory, exactly as a session receives it.
- `/learning` — the same stack, in-session, re-read from disk, plus the injection budget line (whether the whole stack fit the cap or what was pruned/truncated — truncation is never silent).
- `unown doctor` — verifies the project and user memory files exist ([troubleshooting](troubleshooting.md)).
- `unown dashboard` → **Memory** screen — the engine's four tiers with contents, full version history and one-key rollback, plus every skill AutoDream minted into your projects (skills rollback and retire write back to your project's files). The engine's platform state (backend, model, dir, cap) rides `/api/overview`'s `memoryPlatform` block, and `GET /api/memories?q=…` searches the platform's memories per scope.
- `/memory search <query>` — cross-project semantic search over every scope that has dreamed (see [shared memory](#shared-memory-across-sessions-and-projects)); `GET /api/memories?across=1&q=…` is the HTTP form.

## Learning integrity (how the system polices itself)

Self-modification without gates degenerates fast, so every memory write is controlled:

- **Ship gate** — a mined patch only enters memory after its candidate run passes verification in a fresh sandbox — **and the pass replicates** in a second confirmation run (a built-in noise gate: a lucky pass does not ship).
- **Mint gate** — a minted task only becomes an active capability eval if the agent genuinely FAILS it in a fresh sandbox; tasks the agent already solves are discarded (honest outcome), and minted tasks graduate into the regression suite only by passing a later harness cycle. Since the 2026-10-25 round the gate also proves SOLVABILITY: the mint draft carries a `reference` solution (the solved form of the non-test source files), and a task whose reference cannot pass its own verify is discarded as unsolvable (`task:mint-unsolvable` on the event bus) — "the agent fails it" alone no longer distinguishes *hard* from *impossible*, and an impossible task was measured burning one full agent run on every cycle (task selection picks failing tasks first). A draft without a reference gets one bounded authored-reference call before the same sandbox check.
- **Capability quarantine** — the defense in depth behind the mint gate: a minted capability eval with `UNOWN_CAPABILITY_QUARANTINE_AFTER` consecutive failed baselines (default 6, 0 disables; infra `error` runs break the streak) and zero passes is deactivated (`status='quarantined'`, `task:quarantined` on the bus) instead of starving every other learning target forever. Operator lanes: `POST /api/tasks/:id/quarantine`, `POST /api/tasks/:id/activate` (a quarantined minted task returns to `capability`), and `GET /api/tasks?all=1` lists inactive rows.
- **Dream canary gate** — an AutoDream consolidation of the engine's project memory must re-pass the most recently passing task; a dream that breaks it is rolled back automatically (status `gated`) — the memory version *and* the platform's event stream (exact ADD/UPDATE/DELETE reversal).
- **Retention check** — if a task later fails after its improvement shipped, the improvement is marked `regressed` and the memory is rolled back to the pre-ship version (auto-unship).
- **Skill mint gate** — skills are minted only from recurring multi-step procedures in consolidated notes, max 2 per dream, validated against the Agent Skills contract, deduplicated against everything already on disk; every version is recorded and rollback-able, retirement is a deliberate TUI-dashboard action (the engine never deletes your files on its own). Since the 2026-10-22 hardening the gate is also structural: mints land in `.unown/skills-staged/` — never auto-loaded — and promotion into `.unown/skills/` is a human `mv`, so no model-authored skill rides the system prompt unreviewed.
- **Full version history** — every write to every engine tier is versioned and attributable; engine tiers and minted skills roll back from the TUI dashboard. Project memory (`.unown/memory/project.md`) is a plain versioned Markdown file — the engine records every version it writes, and restoring means pasting a prior version back (skills additionally have one-key rollback/retire with file writeback).

## What a learning session looks like

From the original development session (a weaker model driving the engine): `impl-debounce` **failed its baseline** (placeholder implementation, `setTimeout` against a mocked clock) → the harness mined the transcript, proposed rules ("drive time manually via an injectable `now()`", "flush the boundary lazily") → the **candidate run passed** → the rules were **shipped to project memory** → AutoDream later consolidated them into a reusable *Task playbook* section. Router jobs self-healed across service restarts and kept retrying the honestly-still-failing CSV task; memory reached project-tier v6 with every version attributable and rollback-able.

In this checkout — running kimi-k2.5 through the bridge — the engine has autonomously accumulated 60+ verified runs, 30+ AutoDream sessions consolidating 60+ session notes, 500+ hook decisions and a 20-version project-memory history. kimi-k2.5 solves all five seeded benchmark tasks unaided, so the improvement machinery finds nothing to ship — the honest outcome: **the loop only earns its keep when the model struggles**. That is exactly what task minting addresses: when the suite saturates, the `task-mint` job keeps authoring harder curriculum variants (each one validated by a real agent run — variants the model already solves are discarded just as honestly). Point it at a weaker model (or harder tasks) and the mining, patching and shipping above starts firing on its own.

## Honesty: what the loop actually ships

The engine only earns improvements when the model struggles. A model that already passes every task leaves the mining-and-patching machinery nothing to ship — the honest outcome is "nothing shipped", not a fabricated improvement. With kimi-k2.5 all five seeded benchmark tasks pass unaided, so the engine's own memory grows slowly (mostly through dream consolidation), while your project memory grows from real session notes. Point the engine at a weaker model or harder tasks and the mining, patching and shipping fires on its own — see [configuration](configuration.md) for switching models.
