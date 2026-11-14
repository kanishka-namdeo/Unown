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

Two transparency surfaces sit on top of the stack (the 2026-11-12 Memory Encore round):

- **The session-start recall line** — one dim info line at boot, `◈ memory recalled: 14 rules · v17 · dreamed 12m ago — /memory show`, printed once per process when the project has learned rules (silent for a fresh project — nothing learned, nothing claimed). It is the affirmative "your memory was injected" signal: the quiet footer paints nothing when the engine is healthy, so without this line the default layout never says the injection happened. Works degraded — it reads the project's own files, never the engine.
- **`/memory show`** (optionally `/memory show full`) — prints the EXACT stack the model receives this session: every tier's content with its provenance line, the injected guide, per-tier char counts, and the injection-budget tail (pruned/head-truncated/OVERFLOW named — truncation is never silent). `/learning` shows the stack's metadata (tiers, staleness, budget); `/memory show` shows the payload. The default view trims each tier to 60 display lines with an honest `… (N more lines — /memory show full)` marker — the model always receives the full stack; only the display trims.

The four files ride the session context as files (like your `AGENTS.md` chain), re-resolved only when a new session starts — and they are plain Markdown, so what the agent sees is literally what `unown memory` prints.

## The note lifecycle

Notes are the raw material AutoDream consolidates. They enter four ways:

| Entry point | How | When it fires |
|-------------|-----|---------------|
| Mid-session | the `note` tool (agent-invoked) or `/note <text>` (you) | the moment something worth remembering happens; delivered to the engine immediately |
| Session exit | automatic exit-note capture | on quit, provided the session did something (at least one prompt or tool call); carries duration, tool usage and the final outcome — **unless the session made zero tool calls** (the 2026-11-11 evidence contract: an answer with no read/run/fix is unverified model output, so the outcome line is withheld and the note keeps only the audit trail; the withheld line is stripped at both guard layers, never reaching the extraction LLM) |
| Shell | `unown note "watch out: flaky test in auth.spec"` | any time, outside a session |
| Subagents | automatic, `[subagent]`-tagged | every `task` subagent writes its own note — subagents learn too |

Delivery is a `POST /api/notes` to the engine (`UNOWN_ENGINE_URL`, default `http://127.0.0.1:3030`) carrying the note text and the project path (the engine caps a note at 20,000 characters — far beyond anything a session note should be). When the engine is unreachable — down, or you are working offline — the note is written to `~/.unown/notes/outbox/` as `<timestamp>-<project-slug>.md` with the project path and time in a small front-matter block, and nothing is lost. The engine ingests the outbox on boot and on its `note-sync` job (every 5 minutes), then archives each file to `~/.unown/notes/done/`.

You can watch the pipeline move: notes appear on the TUI dashboard's Dreams screen (`unown dashboard`) as pending, get consumed by the next dream, and the dream's output shows exactly what was merged, pruned and added.

From there AutoDream takes over: benchmark notes feed the engine's own project memory, terminal notes feed **your** project's memory. A note is only consumed once — `markDreamed` ties it to the dream that ingested it.

### Freshness: every rule carries its last-confirmed date

Since the Memory Encore round every rendered rule ends with the date it was last confirmed — `- run tests with bun test · 2026-11-09` — and a rule that has gone `PI_MEM0_STALE_DAYS` days (default 28) without re-confirmation is marked `- … · 2026-09-13 · stale`. The date is the platform's `updatedAt`: a later dream that re-asserts the rule (an UPDATE verdict) refreshes it, so the stamp decays honestly — evidence that keeps arriving stays fresh, evidence that stopped arriving says so. Seeds (the repo's scaffolding) and legacy rows with no parseable timestamp stay bare rather than carrying a fake date. The [memory guide](#what-every-session-sees) teaches the semantics: a `stale` rule is weaker evidence — verify before asserting it. This is the visible, soft version of the decay the research field converged on (Claude Code ships per-memory modified timestamps for the same reason; Copilot expires un-refreshed memories at 28 days — ours marks instead of deleting, and `PI_MEM0_STALE_DAYS=0` turns the marker off while keeping the dates).

## AutoDream consolidation

The `auto-dream` job (every 10 minutes, plus a `dream-check` event that wakes it when notes pile up) runs a consolidation pass over the pending notes. Since the platform swap the pass is: notes are quarantined or admitted (structurally — flagged notes never reach the extraction LLM at all), admitted notes go through the platform's extraction pipeline as atomic, deduplicated, scoped memories (the extraction contract since 2026-11-11 names **stated conventions and style rules** first-class — comment style, naming, commit-message formats: an instruction every future session must follow — and bans **negative abstention** answers: "no record of X" describes the agent's own knowledge state, never the project; since 2026-11-14 it also tags each memory with an **SRO triple** — `[subject, relation, object]` naming what the claim is about, the property, and the exact value, the differentia that makes "X is 20" and "X is 22" different claims), a thin reconcile pass resolves contradictions **recency-first** (the shipped contract: the most recent evidence wins and the invalidated rule may not appear anywhere as current practice — only with an explicit historical marker; history markers cite only what the memories themselves say — invented history is an invented fact) and prunes stale one-off observations — **and since the Divertimento round a deterministic layer follows the LLM verdict: two LIVE memories carrying SRO triples with the same subject|relation and different objects are a contradiction resolved by recency alone** (no similarity guess — the research measured similarity-based conflict detection at AUROC 0.59, chance, arXiv 2606.26511; the deterministic rule takes stale-fact errors 15–40% → ~0%): the newest confirmed evidence wins, the losers are stamped supersededBy=<winner> + invalidAt (the same bi-temporal stamps), and **differing values are never merged or averaged** (the MIRIX numeric-merge class — both values are retained verbatim for audit). Rows without triples keep full LLM authority — adoption is gradual, by extraction. A same-batch timestamp tie leaves the group to the LLM (it sees both rows in one listing), and the fresh-evidence protection extends to the deterministic pass exactly as to the LLM's. The dream note renders the deterministic share (", N superseded (retained for audit; K deterministic)") and the health card carries `sroTaggedCount` (the adoption indicator) — and a deterministic render writes the next version of the tier file in the familiar topic sections (`## Workflow`, `## Known pitfalls`, `## Task playbooks`, `## Environment`, `## Preferences`, `## Verified fixes`, `## Facts`, `## Episodes`) — capped at `PI_MEM0_MAX_RENDERED` bullets **total, split per memory type by share** (fact 40% / procedure 25% / preference 20% / episode 15%, with a waterfall that returns unused share to the types that can use it — a single-type store gets the whole cap; hard-won rules have their own cap and are never dropped *to save space*; a rule invalidated by newer evidence is not protected). The render footer carries the per-type kept/pruned tally, never silently.

**Usage-conditioned decay (the Divertimento round, 2026-11-14)**: a LIVE memory the render budget repeatedly refuses to render goes **dormant** after `PI_MEM0_DORMANT_AFTER` (default 3) consecutive excluded renders — MIRIX's ignored-pushes law with the recurrence reset (CAMeR: time-driven decay collapses to ~zero; use-conditioned reinforcement is the driver; MemDream: soft, reversible decay). Dormant is a badge and a bookkeeping state, never a deletion: the memory stays current in the store — searchable (with a `dormant` badge; a hit REVIVES it for the next render's budget), and one inclusion resets the counter. The bookkeeping lives in a per-scope side record (`dormancy-<scope>.json` under the mem0 data dir), deliberately not on the platform rows: a counter bump is not a re-assertion, and `platform.update` would refresh `updatedAt` — falsely refreshing the freshness stamp and flipping the deterministic winner order. The health card carries the all-scope dormant count.

One structural guard sits between the reconcile pass and the platform (2026-11-11, the Recital round — [the teardown](TEARDOWN_2026-11-11_five-memory-systems.md) has the cross-product receipts): **fresh evidence is protected**. The reconcile pass may not DELETE a memory that was born in the current dream's batch — unless an exact-text twin of it survives the verdict (mem0's own same-batch twin-dedup stays legal). The invariant: the just-learned carrier of current state survives to the next pass, where it is established evidence and may be merged or superseded with the full listing in view; Mem0 v3 keeps this by making extraction ADD-only, Cognee by watermarking entries consolidated-exactly-once, and the guard shows up as the emerald **⛨ N protected** indicator on the dashboard's Dreams screen (the row, the drill-in, and the live feed — `dreams.entries_protected`).

The quarantine/consolidation contracts and the layer stack are measured in [`benchmarks/memory-eval/*/RESULTS.md`](../benchmarks/memory-eval/); the guard wiring of the new pipeline is pinned by `test/dream-guard.test.ts`; and the WHOLE loop — real sessions, real notes, real dreams, fresh-session recall, warm vs cold — is measured by [`benchmarks/memory-recital/`](../benchmarks/memory-recital/) (live run: warm 5/5, cold 0/5, lift +5).

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
- **The render**: `project.md` is a deterministic Markdown view of the platform's memories for your project — topic sections, newest-first, [freshness stamps](#freshness-every-rule-carries-its-last-confirmed-date) on every bullet, bullet cap, provenance footer (`<!-- unown: rendered N/M memories via Mem0 (backend: …) -->`). It stays the committable artifact; a teammate's fresh engine imports its bullets verbatim at their first dream.
- **Import at first run**: a pre-swap install's existing `project.md` (engine tier or terminal project) imports verbatim into the platform at the first dream — no LLM rewrites, nothing lost at the swap boundary.
- **Semantic recall (new)**: the engine can now *search* memory — `GET /api/memories?q=…` (scoped, with the platform status on `/api/overview`) — a capability the flat-file pipeline never had. The scoped lane accepts `agent_id` for a platform scope: a terminal project's slug resolves to that project's memories (the raw spelling and the explicit `project:<slug>` form both work; unknown ids pass through as given), and `across=1` fans the query over every scope that has dreamed (see [shared memory](#shared-memory-across-sessions-and-projects)). The dashboard's **dream now** key (`POST /api/dreams/run`) honors explicit intent: any pending note feeds at least one lane — benchmark notes run the engine dream at ANY count (the ≥3 threshold is the automatic lanes' cost policy, not the button's), terminal notes run their projects' dreams; a project with a dream **parked for review** skips (a `pending` event on the feed says so — never a silent no-op). A legacy basename slug (pre-2026-10-22 spelling, its scope superseded by the composite key) passes through as given — name the composite slug the engine's surfaces print, or the explicit `project:<slug>` form.

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
- `/memory search <query>` (in-session) and `GET /api/memories?across=1&q=…` run one semantic search over the engine scope AND every project scope that has dreamed — a session in project B can recall what was learned in project A, results tagged by source scope. Read-only: writes stay scoped, always. **Superseded memories never answer a recall as if current** (the Memory Divertimento seal, 2026-11-14): search excludes them by default; `--all` on `/memory search` (or `latest_only=0` on the API) opts into the audit view, where they render with an explicit `· superseded <date>` badge, never bare.
- The cross-project hoist (`PI_USER_TIER_HOIST=1`) promotes a rule from project memory only after **`PI_HOIST_MIN_PROJECTS` distinct projects** (default 2) have abstracted the same rule — one project's dream is project-suspicious, the same rule from two projects is a user-level habit. Since the Divertimento round a promotion **parks in the memory review queue** (`~/.unown/memory/review-queue/`, one user-level inbox across projects) instead of auto-writing: **the human approves or discards** (`/memory review`, `unown memory review`, or the dashboard Memory screen). Approve ships to BOTH user tiers (the terminal `~/.unown/memory/user.md` every real session injects, and the engine's versioned user tier), additively, with the observing projects AND the review decision named in the provenance comment — re-deduped and re-guarded at decision time (a rule that already landed by another path is skipped, never duplicated; the guard re-check can drop or refuse flagged lines). Discard keeps the candidate for audit; a later re-observation with more projects parks as a new candidate ("more evidence, re-ask"). Rules observed once park in the engine's candidate ledger awaiting their second project.

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
  **Quoted by the landing page? It belongs in Manual notes ([#46](https://github.com/kanishka-namdeo/Unown/issues/46)).** The landing page's memory preview (`src/components/landing/loop.tsx`) quotes this repository's own `project.md` verbatim, and `check:claims` gates every quoted line **exactly** — verbatim containment, no leniency — with a failure message whose remedy is this lane. A quoted line living only in a dream-rendered section is a line a render can prune (it happened twice in one day); its durable home is `## Manual notes`, and the renderer is pinned to preserve that lane through cap-pruning renders (`test/manual-notes.test.ts`).
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
- `unown memory doctor [--json]` — the audit pass (the deferred gap #4, closed): tier budgets + the injection budget (the same stack sessions inject), the stale count, a LIVE recall-seal probe (no superseded row may answer a default recall bare — the memU doctor law: prove the loop, not just that files exist), the store's health (dupes/conflicts/superseded/dormant/sro-tagged), the review-queue depth, placement findings (user-tier bullets carrying file paths; project-tier pure-workflow bullets as hoist candidates — report-only, never auto-shipped), and derivable-from-repo findings (bullets restating a package.json script). Engine-down: the tier/injection/placement audits still run (disk-derived); the store/queue/seal rows degrade honestly. `unown doctor`'s memory row gains a one-line store summary.
- `unown memory doctor [--json]` — the audit pass (the deferred gap #4, closed): tier budgets + the injection budget (the same stack sessions inject), the stale count, a LIVE recall-seal probe (no superseded row may answer a default recall bare — the memU doctor law: prove the loop, not just that files exist), the store's health (dupes/conflicts/superseded/dormant/sro-tagged), the review-queue depth, placement findings (user-tier bullets carrying file paths; project-tier pure-workflow bullets as hoist candidates — report-only, never auto-shipped), and derivable-from-repo findings (bullets restating a package.json script). Engine-down: the tier/injection/placement audits still run (disk-derived); the store/queue/seal rows degrade honestly. `unown doctor`'s memory row gains a one-line store summary.
- `unown memory review` — the memory review queue: list pending hoist candidates (id, evidence, rule, age), `approve <id>` (ships to both user tiers — re-deduped and re-guarded at decision time), `discard <id> [--reason s]` (kept for audit, never deleted). One user-level inbox across projects; the queue lives at `~/.unown/memory/review-queue/`.
- `/learning` — the same stack, in-session, re-read from disk, plus the injection budget line (whether the whole stack fit the cap or what was pruned/truncated — truncation is never silent). The stack renders first and the engine-state + budget lines ride the tail of the notice, so they stay visible in a terminal of any height.
- `unown doctor` — verifies the project and user memory files exist ([troubleshooting](troubleshooting.md)).
- `unown dashboard` → **Memory** screen — the engine's four tiers with contents, full version history and one-key rollback, plus every skill AutoDream minted into your projects (skills rollback and retire write back to your project's files). The engine's platform state (backend, model, dir, cap) rides `/api/overview`'s `memoryPlatform` block, and `GET /api/memories?q=…` searches the platform's memories per scope. Since the Divertimento round the screen also renders the **review-queue card** (pending candidates with evidence) under the health card, refetching live on every park/approve/discard.
- `/memory search <query> [--all]` — cross-project semantic search over every scope that has dreamed (see [shared memory](#shared-memory-across-sessions-and-projects)); `GET /api/memories?across=1&q=…` is the HTTP form. Superseded memories are excluded from results by default — they never answer a recall as if current; `--all` / `latest_only=0` opts into the audit view (they render with a `· superseded <date>` badge, never bare).

## The delight surfaces (Divertimento CP4, 2026-11-14)

The UX research's law — visible provenance builds trust, invisible influence
destroys it (Gemini's Statement+Rationale; Memory Sandbox's scrutability;
the ChatGPT anti-patterns quantified at 96% unilateral creation):

- **`/memory search` provenance badges** (the repo's own open item #8): every
  result carries its scope, score, and now its TYPE (non-fact only), its
  hard-won kind (`seeded` / `verified fix`), its freshness stamp (`· 2026-11-11 · stale` —
  the per-type horizon), and its dormancy state (`· dormant (revived by this
  search)` — the hit that just revived the row says so).
- **The recall line's honest count**: `◈ memory recalled: 12 rules (2 stale) · v7 ·
  dreamed 3h ago — /memory show` — the stale count renders ONLY when non-zero
  (a healthy stack stays quiet; a decayed one says so at the exact moment the
  model starts using it).
- **The dream digest toast** (the post-consolidation diff — the cheapest delight
  surface there is; the data already exists): `✦ AutoDream learned 3 new rules
  for this project (v41 → v42) · 4 superseded (kept for audit) · 2 went dormant`
  — each fragment only when its count is non-zero. The dream rows carry the
  digest columns (`entries_superseded`, `entries_dormant`) threaded from the
  outcome.
- **`/memory show`** appends `not injected · N dormant (…a /memory search hit
  revives)` when the engine reports any — what the budget LEFT OUT, honest
  about the stack's boundary (degrades to absent engine-down).
- **The dashboard health card** fact line gains `· N dormant · N sro-tagged`
  (quiet when zero), riding the superseded count.

## The memory health card (S2-4)

The memory platform's maintenance pass — the reconcile step that dedupes, retires stale rules and resolves contradictions — is **fail-open**: when its LLM call fails, the dream continues additive-only and the failure used to be ephemeral (a bus event + a console line, nothing queryable after the fact). The health card makes the accumulated state of a memory scope observable, deterministically and without an LLM call:

- **Last reconcile** — when the last *successful* reconcile pass ran. A failed pass is not a timestamp: the card's **reconcile-failing** warning carries the since-time and the error's own words, and it is **persistent** — a small record beside the mem0 data dir (`DATA_DIR/mem0`), cleared only when a pass succeeds. A failure you ignore shows up here forever, not just in a log you never opened.
- **Duplicates** — memories sharing the same *normalized* text (case, whitespace and punctuation folded). Exact-hash dedup misses near-duplicates; this counter is the v1 near-dupe class — a group of three counts three.
- **Conflicts** — supersede links (a newer memory `linked_memory_ids`-pointing at an older one) whose OLD memory is still alive: the contradiction the reconciler exists to retire, counted while it is unresolved.
- **Warnings** — `reconcile-failing` (additive-only backlog is growing), `tier-at-cap` (the project tier has reached its write cap and dreams stop shipping), `reconcile-stale` (no successful reconcile in >7 days *and* notes are still undreamed — the backlog will keep piling), `review-pending` (the amber, human-paced class: N memory review candidate(s) awaiting your decision — a feature waiting for a human, visible until decided, never silent). The card carries `reviewQueueDepth` (the Divertimento round) alongside `supersededCount` and the per-type `typeBreakdown` (the v2 round).

Surfaces: `GET /api/memory/health` (the engine scope's card, same gate as the memory lanes) and the settings hub's **Memory health card** item (`memory.health`). Remedies: edit/rollback from the dashboard's Memory screen, and let a dream run the reconcile (the engine settings' dream lane). Nothing in the card auto-deletes — it observes; the reconcile pass is the only thing that changes memory.

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
