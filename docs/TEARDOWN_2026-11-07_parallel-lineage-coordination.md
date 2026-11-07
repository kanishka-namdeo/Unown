# TEARDOWN 2026-11-07 — parallel-lineage coordination

> The Serenade round's mid-round competition cycle (the cadence law:
> every 5 tickets or by evidence density — TODAY'S trigger is the
> evidence: **three V-42-class races in one session** — the L-1
> bring-up push race, the DUAL L-2 landing, the L-3 claim-vs-close
> overlap). The question this teardown answers: how does the industry
> coordinate multiple concurrent coding agents on one codebase, and
> what has Unown already mechanized vs. left to operator discipline?
>
> Depths marked per the house law: **FULL** = the source was fetched
> and read whole · **SNIPPET** = the search result's quoted material ·
> **TITLE** = the title/abstract only (honest depth, no pretending).

## THE PICK

**The parallel-work-coordination class** — the mechanics of multiple
agent incarnations working the same repository concurrently: isolation
primitives (worktrees), claim/lease protocols, coordinator patterns,
and where the conflict actually gets detected (write time vs. merge
time vs. never).

## The ten source-reads

| # | Source | Depth | The finding that matters here |
|---|---|---|---|
| 1 | [Claude Code — Run agents in parallel](https://code.claude.com/docs/en/agents) | **FULL** | Four coordination styles by WHO coordinates: subagents (Claude), agent view (you), **agent teams ("multiple coordinated sessions with a shared task list and inter-agent messaging, managed by a lead")**, workflows (scripts). Worktrees are the isolation default: "Worktrees give each session a separate git checkout… parallel sessions each edit their own copy." **"Agent teams don't isolate teammates in worktrees, so partition the work so each teammate owns a different set of files."** Cross-session messaging lets separate sessions pass findings. `/batch` splits one large change into "5 to 30 worktree-isolated subagents." |
| 2 | [AugmentCode — Git worktrees for parallel AI agent execution](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution) | **FULL** | The failure modes named exactly: **"simultaneous writes to the same file, where one agent's changes silently overwrite another's"**; git's `index.lock` contention making concurrent git ops fatal. What worktrees DON'T solve: "The conflict problem moves to the PR merge stage"; **"Worktree isolation stops one task from trampling another's files, but does not stop one task's runtime from trampling another's ports, databases, caches, secrets, or test state."** Recommendations: worktree-per-task as the default, `git rerere` for recurring conflicts, "assign agents to strictly non-overlapping file domains before work begins." |
| 3 | [LiteLLM — How we built our own internal Devin in 2 days](https://docs.litellm.ai/blog/internal-devin-two-days) | **FULL** | Durable-execution coordination via **Temporal**: the coordinator "splits the work into assignments, gives each worker an isolated copy of the workspace, saves its own state and releases its sandbox while waiting, resumes… and collects results." The dedup law: **"We record agent launches so a retry won't start a second copy."** Recovery is three-layer (Temporal retries unfinished steps; the DB holds the chat/queue; Modal holds the sandbox + history). |
| 4 | [OpenHands — File-based agents + delegation](https://docs.openhands.dev/sdk/guides/agent-file-based) | **SNIPPET** | Sub-agent delegation via DelegationTool/TaskToolSet; agents declared as markdown with `when_to_use` examples feeding the ROUTER — the orchestrator picks the delegate by description match. |
| 5 | [Devin — Advanced capabilities](https://docs.devin.ai/work-with-devin/advanced-capabilities) + [Manage Devins](https://www.google.com/goto?url=CAEScwHEIkXXZzOFQkts3x8wfya9FK_tBGx6AAsbvTX6C4_wgBnCLUpsdRoDJCdfiqpqhCUeeq31v7jWCIYz3t8U6db5ZOXCOqDztlX4wXcc7gS2LINW_T_E_wQJUldvNZ6YR_Sn180CkM) | **SNIPPET** | The coordinator pattern: "The main Devin session acts as a coordinator: it scopes the work, assigns each piece to a managed Devin, monitors progress, resolves any [conflicts]." Parallelism is a first-class product surface. |
| 6 | [Git worktree isolation patterns for parallel AI agents](https://www.google.com/goto?url=CAEShwEBxCJF1-7anNUm2-vQWaE0Bhduqf6j4G--uPT4co-kKH5XjQjbw91VNqXUvdaSQrOYTnyQqagr0CBe-wuOUGEKY-iuOB4qYW3-_TJ_teiYbW0sOHgQxxkC3foNNjteNstXQBMRCDhECwmAJSFCVKmp07JAX_F0V8r5h-20ZNHmPAoKX8) | **SNIPPET** | The claim: "Git worktrees have emerged as **the dominant isolation primitive** for running multiple AI coding agents in parallel on the same codebase" (Feb 2026). |
| 7 | [git-stint — worktree/branch lifecycle automation](https://www.reddit.com/r/git/comments/1rj1wev/gitstint_automates_worktree_and_branch_lifecycle) | **TITLE** | "Each agent gets its own branch and worktree automatically. No setup per task" — the lifecycle-automation tier. |
| 8 | [Devin golden snapshots](https://docs.devin.ai/product-guides/snapshots) | **SNIPPET** | Enterprise-wide machine templates so every session "starts with the same pre-configured environment" — the bring-up-parity tier (Unown's bring-up receipts are the artisanal version). |
| 9 | [The OpenHands Software Agent SDK (arXiv 2511.03690)](https://arxiv.org/html/2511.03690v2) | **TITLE** | Composable agents over shared state/event streams — the academic formalization of source 4's mechanics. |
| 10 | [How to run coding agents in parallel with git worktrees (Claude Code + Codex)](https://www.google.com/goto?url=CAESigEBxCJF1wOpkHFrft0AJmiqUorwzWG7RplokWVNITffY3XlIKPbeXx7guVS2ctz4_fH_-t-H_-I-RL6pi5qi24u0jZg5v5TKPuISISMjibrsjCDAovqiX1tvh5gGdkfXZlg55SZlm6YHlaekTrCiy4_ZoOBK4QTxzwVIxEsEBD34cU8) | **TITLE** | The practitioner how-to tier: worktree per engine, both agents on one repo. |

## THE CONVERGENCE

The industry's answer has three layers, and Unown already lives one
of them NATIVELY:

1. **Isolation by default** (worktrees per task/agent — sources 1, 2,
   6, 7, 10). The conflict does not disappear; it MOVES to the merge
   stage where it is visible and mechanical (source 2's sharpest
   point: "The conflict problem moves to the PR merge stage").
2. **Claims and leases at the coordinator** (source 3's Temporal
   dedup — "we record agent launches so a retry won't start a second
   copy"; source 5's coordinator assigns and monitors; source 1's
   shared task list).
3. **Partition-by-ownership as the human/coordinator law** (source 1:
   "partition the work so each teammate owns a different set of
   files"; source 2: "assign agents to strictly non-overlapping file
   domains before work begins").

**Unown's position is unusual and worth naming precisely**: the
lineages are NOT one orchestrator's children (the pattern every
source assumes — a spawner exists). They are **parallel operator
resumes of the same standing directive**, spawned by sandbox
recycles, with no shared bus but git itself. Unown has therefore
evolved — organically, over 33+ lineages — a coordination stack the
industry sources describe in pieces:

- **The ledger-arbiter law** = source 3's Temporal dedup, implemented
  IN GIT: the fast-forward push is the atomic claim operation (the
  loser's push is rejected — git's own lock), and first-landing-governs
  is the resolution protocol. Today's three races were each DETECTED
  by exactly this mechanism (no silent overwrite ever landed: the L-1
  race was a push rejection, the dual L-2 was reconciled by
  first-landing + reflog preservation, the L-3 overlap by the
  claim-then-stand-down protocol).
- **The claim push** (L-4/L-5 "CLAIMED (ACTIVE)" commits) = source
  1's shared task list, materialized as commits — visible to every
  lineage at fetch time.
- **The split-lane discipline** (today: the L-queue vs the
  engine-contract augment lane, per the V-42 non-overlap contract) =
  source 1/2's file-domain partitioning, applied to whole surfaces.

## THE CAVEATS — what Unown has NOT mechanized

1. **The duplicate-dispatch waste is real even when detection
   works.** Both L-2 lineages burned a full ticket of engine turns
   (~57 turns each) before the arbitration; the loser's work survives
   only as reflog evidence. The industry's isolation tier (worktrees)
   would not have prevented the DOUBLE DISPATCH either — only the
   CLAIM tier does (check-before-dispatch as a hard gate, not an
   operator habit). Unown's claim protocol is advisory + honor-based;
   Temporal's dedup is mechanical.
2. **The claim check happens at ticket boundaries only.** The V-26
   mitigation ("checked at dispatch AND chunk-2") is operator memory,
   not tooling. A mid-ticket claim landing (today's L-3 shape: the
   34th claimed while the 33rd's close was landing) is only caught at
   the next fetch.
3. **The runtime-trampling class** (source 2: ports, databases,
   caches, test state) is unpinned across lineages. Today's near-miss:
   both lineages' stacks on port 3031/3030 would collide IF they
   shared a host — they don't only because the sandboxes are
   separate. The moment two lineages share a machine (or the engine
   upstream's metering — which they DO share), the class fires: the
   Agnes upstream is the shared runtime resource today.
4. **No cross-session messaging.** Source 1's sessions pass findings
   directly; Unown's lineages communicate only through commit
   messages and round logs (slow, batchy — but also durable and
   auditable, which the sources' buses are not).

## THE FILINGS (new registry rows, PROPOSE stage)

- **H-26 — the pre-dispatch claim gate** (operator tooling): a1-
  dispatch.py gains a mandatory pre-flight: `git fetch` + parse the
  round log's ACTIVE claims + REFUSE the dispatch (exit ≠ 0 with the
  named conflict) when the target ticket has an ACTIVE claim younger
  than the expiry window. SHOULD fire on every dispatch; SHOULD-NOT
  when no ACTIVE claim exists. Metric: duplicate-dispatch events per
  round (today: 2) → 0. Gate: the L-4/L-5 receipts replayed (the gate
  would have refused the 34th's L-3 dispatch had it existed).
- **H-27 — worktree-per-lineage** (operator environment): the
  bring-up lane spawns each lineage in `git worktree add` + the
  offline-cache install strategy (source 2's recommendation), making
  the landing a PR-style rebase. Anti-scope: the shared-engine-port
  class needs the detached-engine lane's host separation kept
  explicit. Filed for the next bring-up's decision, not a retrofit.

Upstream kin named for the record: Claude Code agent teams + /batch;
Temporal's durable dedup; Devin's managed coordinator; git rerere for
the recurring-conflict tier.

---

*The round continues: L-5 (the UI shell) ACTIVE in the parallel
lineage; the augment lane holds H-21 at CANARY (awaiting a genuine
capped-chunk fire) and the H-26/H-27 seeds above.*
