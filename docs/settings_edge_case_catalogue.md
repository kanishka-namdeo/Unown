# Settings Edge Case Catalogue — Phase 5 of the Settings Evolution Round

**Date:** 2026-10-31 · **Method:** code-verified audit of every autonomous
subsystem (`pi-repo/packages/self-learning/src/`; citations are file:line in
that root). **Feeds:** the Settings trust matrix
(`docs/settings_trust_recovery_framework.md`) and the missing-settings
implementation (Phase 7).

Each edge case records what happens **today** (verified from code), the
user-facing control/visibility that exists, the recovery path, severity if
unaddressed, and the proposed Settings remedy. Honesty rule: mitigations
that exist in code but are invisible to users count as *invisible*.

---

## 1. MEMORY

Architecture: 4 tiers (policy→project→user→local, `memory.ts:51`). Engine
side: SQLite `memory_versions` is authoritative, `.md` files self-heal
(`memory.ts:14-25,160-176`). Project tier is Mem0-backed (`memory.ts:227-249`).
Terminal side: file-is-truth, dreams write atomically with provenance sidecar
(`term.ts:528-560`).

| Edge case | Today (code evidence) | Control / visibility | Recovery | Severity | Proposed Settings control |
|---|---|---|---|---|---|
| Memory poisoning | 4 deterministic layers: quarantined notes never reach the LLM (`dream.ts:131-135`, `guard.ts:239-265`); flagged extracted memories deleted (`dream.ts:151-162`); render gated ship/sanitize/gate (`dream.ts:281-321,785-824`); injection-time provenance demotion to "UNVERIFIED" (`term.ts:696-712`). Regex-only scanner — a benign paraphrase evading all patterns ships | Gated dreams in dashboard (status+reason); sanitize receipts; injection-time console.warn | Memory screen one-key rollback (writes NEW version, history kept — `memory.ts:493-500`); `POST /api/memory/:tier/rollback` | High | **Memory review inbox**: every shipped diff (vN→vN+1) with approve/revert; quarantine browser |
| Wrong memory learned (non-adversarial) | No factual verification — guard detects *adversarial shapes* only. Engine path has canary; **project path has none** (`dream.ts:774-781`) | Dream receipts; provenance footer; per-rule `[note N]` tags | Rollback; Manual-notes lane survives re-renders (`memzero.ts:1713-1718`) | Med-High | Learning-preview mode: dreams land pending, applied after approval |
| Duplicate memory | Extraction dedup + LLM reconcile MERGE (`memzero.ts:1198,1228-1290`); reconcile failure → fail-open additive-only + console.warn (`memzero.ts:1265-1271`) | Reconcile counts in dream note | Next dream re-reconciles; manual edit | Low-Med | Duplicate/conflict counters on memory screen |
| Stale memory | Recency-wins reconcile; no TTL anywhere — staleness only fixed when a new dream runs | Provenance dates in render | Reconcile; manual edit | Medium | Rule age indicator + "reconcile now" |
| Conflicting memories | Same reconcile; double LLM failure → contradictions persist silently | `mem0:reconcile-failed` bus event | Next dream | Medium | Conflict counter + persistent warning (not one console.warn) |
| Incorrect retrieval | topK 8, lexical fallback without ONNX (degraded, warned once); search is pull-only — nothing auto-injected | `/memory search` footer names backend | Delete by id | Low-Med | Recall-quality feedback flag |
| Project rename / migration | Identity = git remote (stable across clones/rename/worktrees, `project-identity.ts:20-31,162-176`); basename scopes auto-migrated (`dream.ts:666-683`). **Gap:** non-git projects key on `path:<realpath>` — moving the dir strands the scope | Dashboard project list | Old rows kept; no path→path migration | Medium | Project-identity panel + adopt/merge-scope tool |
| Tier cap hit | Writes throw above 48k (`memory.ts:186-191`); dream converts to `gated` (no loop, `dream.ts:696-740`); injection self-trims with visible footer. **Gap:** terminal user-tier append has no at-rest cap (`term.ts:438-450`) | Gated rows; `/learning` budget report | Rollback; raise env cap | Low | Cap slider + pruned-at-injection viewer |
| Injection budget | 80k total cap, oldest dropped first, guide/policy protected, honest overflow flag (`budget.ts:63-66,139-196`) | `/learning` + memory screen meter | Consolidation | Low | Budget meter in Settings |
| Crash mid-write | DB-first WAL; reads self-heal from newest version row; atomic writes everywhere | — | Self-healing | Low | — |
| Cross-project hoist | Opt-in env `PI_USER_TIER_HOIST`; ≥2 projects; ≤3 rules/dream; dedup vs both tiers (`hoist.ts:42-57,211-299`) | Hoist receipt | Hand-delete | Low | **Toggle in Settings (today env-only = invisible)** |

## 2. AUTODREAM

Trigger: router jobs (`auto-dream` 10 min, `dream-check` 30 min,
self-trigger loop guard `router.ts:40-50,140-142`); governor + breaker gated
(`governor.ts:238-249`). **Approval workflow: NONE** — fully automatic;
review is post-hoc only. Verdict flow: `ship` / `sanitize` (flagged lines
stripped, remainder ships — `guard.ts:550-566`) / `gate` (nothing ships; any
flag on first mint gates — `guard.ts:541-559,517-520`).

| Edge case | Today | Control / visibility | Recovery | Severity | Proposed control |
|---|---|---|---|---|---|
| Bad dream / hallucinated practice | Engine: canary re-runs K most-recent passing tasks under new memory, drift analysis (`canary.ts:176-209`). Project: regex guard only | Dreams screen; guard summary per receipt | Rollback | Med (project) / Low (engine) | Dream approval mode |
| Regression introduced | Canary K=3 stratified; verify-twice re-run; two failures or drift → **automatic rollback** (version rolled by canary itself, mem0 event stream reverted ADD→delete/UPDATE→restore/DELETE→re-add, `dream.ts:485-493`, `canary.ts:548-553`, `memzero.ts:1146-1184`). Crashed canary = failed. `PI_DREAM_GATE=0` disarms everything; no samples → gate **skips** and ships (`dream.ts:502,601-609`) | Gated rows with per-sample outcomes | Automatic (engine) / manual (project) | **High (project: zero regression detection)** | Per-project canary command |
| Conflicting dreams / bad consolidation | Reconcile per dream; hallucinated ids ignored; double failure → additive-only | Bus event + note | Next dream | Medium | Memory health card |
| Partial-apply / crash mid-dream | Unwind boundaries: pre-COMMIT → revert+consume; post-COMMIT → ship stands, error row (`dream.ts:1011-1047`) | error/gated rows | As coded | Low | — |
| Empty extraction stalls | Escalation ladder, ONE salvage call, never a loop (`memzero.ts:744-926`) | no-change rows | — | Low | — |
| Dream cost runaway | Governor ceilings + breaker | `/api/overview` + doctor | Auto-throttle | Low | Budget sliders in Settings (env-only today) |

## 3. SKILLS

Lifecycle: `shipped | retired` only (`skills.ts:74`). Minted → **staged**
(`staged: true`) in `.unown/skills-staged/` — never auto-loaded; promotion is
a human `mv` (SA-B2, `skills.ts:9-48,105-110,138-165`). **The strongest
review story of any subsystem** — memory and dreams have nothing like it.

| Edge case | Today | Control / visibility | Recovery | Severity | Proposed control |
|---|---|---|---|---|---|
| Unsafe skill minted | Guard scans desc+body; ANY flag rejects outright (first-mint semantics, `skills.ts:289-317`); staged dir never loads | `skill:rejected` event | Never loaded; delete staged; `retireSkill` | Low | Staged-skills inbox with diff + promote/discard buttons (today: raw `mv`) |
| Duplicate skills | Name checked vs loaded ∪ staged ∪ DB (`skills.ts:225-259`); index ceiling 24 | — | — | Low | — |
| Obsolete skill | No auto-retirement by design (`skills.ts:45-48`); stale skills ride every prompt | Skills screen; retire API | `retireSkill` | Medium | Skill health: last-used + suggest-retire |
| Skill conflicts | Nothing detects content conflicts (name dedup only) | — | Retire + re-mint | Medium | Overlap detector |
| In-session writes to skill tree | Denied by instruction-set guard (`termhooks.ts:16-22`, `instruction-guard.ts:80-89`) | Deny reason in hook log | Propose-a-PR | Low | — |
| Skill rollback | `rollbackSkill` restores any version (`skills.ts:372-395`); versions table + API | Skills screen history | Rollback | Low | — |

## 4. HOOKS

| Edge case | Today | Control / visibility | Recovery | Severity | Proposed control |
|---|---|---|---|---|---|
| Failing hook | Default **fail-open** (error → allow); `failClosed: true` per-handler opt-in (`hooks-config.ts:471-505`) | Error output; engine writes `hook_log` | Fix config; disable | Medium | Per-hook last-error status + default-failClosed toggle |
| Recursive hook / infinite loop | **No loop detection exists.** A PreToolUse hook invoking `unown` recurses with no depth cap; only bound is 60s timeout; async errors swallowed (`hooks-config.ts:482-488`) | None | Kill process | **High** | **Hook loop breaker**: depth tag + auto-deny past N |
| Long-running hook | `timeoutMs` clamped [100ms,60s] default 10s; process-group kill; timeout → allow unless failClosed (`hooks-config.ts:479,526-531`) | Timeout reason | Raise timeout / async | Low | Timeout exposure |
| Hostile project hooks.json | Trust-gated refuse-first (`hooks-config.ts:34-37,222-237`); strict mode adds sandbox-grade deny (sudo/ssh/network/git push — `termhooks.ts:26-27`); mutated input re-gated (TOCTOU fix) | Doctor shows trust state | Trust flow; delete | Low-Med | Strict-mode toggle in Settings (env-only today) |
| Terminal hook decisions | Engine writes hook_log; **terminal sessions leave decisions only in the transcript** | Transcript only | — | Medium | Terminal hook audit feed shipped with session note |

## 5. MCP

| Edge case | Today | Control / visibility | Recovery | Severity | Proposed control |
|---|---|---|---|---|---|
| Server unavailable | Error-marked, stays out of the way; reconnect cooldown 30s blocks spawn storms; mid-session exit stamps `lastFailedAt` (`mcp.ts:1543-1560`) | `/mcp` status; stderr tail | `/mcp reconnect` | Low | Server health panel |
| Timeout | 120s request / 20s connect; named timeout errors; wedge detection | Error text names bound | Env tuning | Low | Timeout sliders |
| Auth failure (HTTP) | 429/503 retried with backoff; 401/403 → warning, fail-open | Error line | Fix config | Low | "Credentials expired" card |
| Duplicate tools / collisions | Sanitized `mcp__<srv>__<tool>` ≤64; collisions `_2` suffix + logged; per-server cap 100 (`mcp.ts:1930-1949`) | Log lines | Rename | Low | — |
| Elicitation escalation | Default `autoDecline: true`; `autoAccept` per-server opt-in returns schema-valid dummy `{confirmed:true}` (`elicitation.ts:10-28,110-120`) — autoAccept on a destructive server silently confirms deletes | `/mcp elicitation` subcommand | Policy edit | Medium | Elicitation policy matrix + autoAccept counter |
| Injection via tool output | One choke point → shield annotate (fail-open banner) + transcript entry (`mcp.ts:1961-1981`) | Banner + telemetry | — | Low-Med | Shield flag feed |
| Result size | 16k cap with visible truncation | Truncation marker | — | Low | — |

## 6. GOALS

| Edge case | Today | Control / visibility | Recovery | Severity | Proposed control |
|---|---|---|---|---|---|
| Impossible goal | Prompt-only mitigation ("say so plainly", `goal.ts:65`) | `/goal` status | `/goal clear`/`pause` | **High** (token burn, no ceiling) | Per-goal turn/token budget + auto-pause |
| Conflicting goals | Only ONE goal at a time; replacement has no warning (`goal.ts:35-41`) | Status line | Re-set | Low | Replace confirmation + history |
| Forgotten goal | Persists across `/new /resume /fork`; weeks-old goal keeps injecting | Footer status | clear/pause | Medium | Goal age + stale nudge |
| Infinite goal loops | **No max-turns in interactive sessions** — `--max-turns` is headless-only (`max-turns.ts:2-8`) | Turn count in UI | Esc; `/goal clear` | **High** | Apply turn guard to goal-driven TUI turns |
| Completion verification | Evidence gate: marker line + todos done + file-path AND command-output markers — "agent-honest, not cryptographic" (`goal.ts:22-24,128-162`) | Notify lists evidence | Stays active | Medium | Optional verify-command per goal |

## 7. AUTOMATIONS

Trust story: config in engine DB; default mode `read-only` (no bash/write/edit);
`UNOWN_AUTOMATION=1` hides mutation tools inside runs → no recursion
(`automations.ts:15-17`); nothing auto-merges.

| Edge case | Today | Control / visibility | Recovery | Severity | Proposed control |
|---|---|---|---|---|---|
| Runaway automation | Hard 30-min SIGKILL (`automations.ts:92,1222-1228`). **No user-facing cancel of a RUNNING run** — wait, or restart engine | Run history; live state | Pause stops FUTURE runs only (`server.ts:440-455`) | **High** | **"Stop now" kill switch** |
| Cost explosion | 20-automation cap, 2 concurrent, single-flight, flood guard. **Governor does NOT cover automation runs** — children are CLI processes whose tokens never hit the ledger (`governor.ts:36-44,231-237`, `automations.ts:40-42`) | Run output; overview budget silently excludes this spend | Pause; maxRuns cap | **High** | Automation token ceiling + spend meter |
| Retry storms | Dispatch retries 30s·2ⁿ cap 15 min ×5; occurrence retries opt-in; event flood guard 10/5min (`automations.ts:124-131`) | Retry chains in history | retryMax=0 | Low | Retry-policy editor |
| Recursive chains | `routine.finished` chains capped at depth 3, visible; event namespace reserved (`automations.ts:105-114`) | Chain depth errors | — | Low | — |
| Destructive chains | read-only default; standard mode = full toolset behind deny-list; reviewable via git | Run output; git diff | git / `/undo` | Medium | Per-automation allowed-tools editor |
| Misfires | Skip after 5-min grace; opt-in catch-up-once; per-routine override | Skipped rows | — | Low | Misfire dropdown |
| Engine-down zombies | Zombie reaper 10 min; orphans closed failed; slot re-arm avoids double-advance (`automations.ts:1256-1299`) | recovered events | — | Low | — |

## 8. SUBAGENTS

| Edge case | Today | Control / visibility | Recovery | Severity | Proposed control |
|---|---|---|---|---|---|
| Excessive spawning | Sync: wall-clock 5-min default (clamp 30s–30min); turn cap `UNOWN_SUBAGENT_MAX_TURNS` **default off**. Async fleet: concurrency 8 (0=unlimited escape), overflow = typed failure; 15-min hard timeout | Fleet widget; delegation ledger with turns/tokens | `task_control stop` (polite + tree-kill 12s) | Medium | Turn-cap + concurrency defaults in Settings |
| Context poisoning (child→parent) | Every delivery passes shield annotate (fail-open banner); persisted to transcript (`fleet-runtime.ts:1398-1424`) | Banner + flag | — | Medium | Shield-flag feed per subagent |
| Divergent plans | Child boundary instructions; BLOCKED as first-class status for re-planning (`subagent-catalog.ts:285-311`) | Per-child status | Steer | Low | — |
| Silent no-op completions | Git fingerprint completion guard; zero mutations → `COMPLETION_GUARD_FAILURE` (`subagent-catalog.ts:339-413`) | Guard text | Re-dispatch | Low | — |
| Merge failures (worktrees) | Nothing auto-merges; kept-tree note in result; merge preview | `[worktree kept]` | Manual git merge | Medium | Kept-tree helper (list/merge/discard) |
| Stalled execution | `stalled` after 120s no stdout; steering resets clock; ask-question parks 600s | Widget status | Steer/stop | Low | — |
| Orphaned children | Journal + heartbeats; boot sweep tree-kills live orphans, marks worktrees; identity-probe safety (`fleet-reaper.ts:24-65`) | Journal; audit fields | Sweep on boot | Low | Reap event feed |

## 9. CHECKPOINTS / RECOVERY

| Edge case | Today | Control / visibility | Recovery | Severity | Proposed control |
|---|---|---|---|---|---|
| Bash-caused changes | **Not checkpointed** — ledger records commands, no per-file diffing; `/undo` cannot revert (`checkpoints.ts:66-68`) | `/receipts` command list | git | **High** (main undo blind spot) | Undo-coverage badge per turn + optional pre-bash snapshot |
| Files > 64 MiB | Never blobbed; honest `oversized` marker; never writes wrong content | Restore outcome | Manual | Low | Oversize report |
| Crash safety | Atomic everywhere; sha256 verify vs manifest → `corrupt-blob` reported; undo journaled before file touch | Restore outcomes | Re-run | Low | — |
| Redo limits | n cap 20; retention floor 20/owner; global 200 manifests evict oldest | Receipts totals | — | Low | — |
| Restore jail | realpath check; symlink escape refused; tombstones for new files | `outside` action | — | Low | — |

---

## TOP 15 GAPS (ranked by severity × likelihood × blast radius)

1. **No cancel for a RUNNING automation** → kill-switch button (SIGKILL child + close row).
2. **Automation spend outside the governor** → per-routine + global token ceilings, auto-pause, spend meter.
3. **Hook recursion has no loop breaker** → depth-tagged env + auto-deny past N + async-failure counters.
4. **Project-path dreams have zero regression detection** → per-project canary command gating the version.
5. **No dream/memory approval workflow** → memory approval inbox (staged diffs, approve/revert, default-on for first mints).
6. **Interactive goals have no turn/token ceiling** → goal budget with auto-pause notification.
7. **Bash changes not checkpointed** → undo-coverage badge + optional pre-bash snapshot.
8. **Terminal hook decisions unlogged** → hook audit feed to engine + Settings viewer.
9. **Fleet unlimited escape + turn cap off by default** → subagent defaults panel, remove 0-escape from UI.
10. **Elicitation autoAccept silently confirms destructive MCP actions** → policy matrix + counter + warning.
11. **Reconcile failures fail-open invisibly** → memory health card (status, counters, reconcile-now).
12. **Non-git project rename strands memory** → project-identity panel + adopt/merge tool.
13. **Stale skills never age out** → skill health (last-used, suggest-retire) + staged inbox.
14. **Goal evidence gate is regex-honest only** → optional verify-command per goal.
15. **Autonomy health is scattered** → one control-room surface: shield flags, MCP states, governor budget, breaker, automation spend, reconcile status.

## Cross-cutting design constraints for the Settings round

- Unown's env-knob surface is large (`PI_MEMORY_*`, `PI_DREAM_*`, `PI_MEM0_*`,
  `PI_ENGINE_*`, `UNOWN_MCP_*`, `UNOWN_FLEET_*`, `UNOWN_SUBAGENT_*`,
  `UNOWN_STRICT_HOOKS`, `PI_USER_TIER_HOIST`, `UNOWN_INJECTION_SHIELD`…) but
  **entirely env/CLI-based** — no first-class Settings surface for any of it.
- Two structural asymmetries to design around: **skills got a
  staging/approval lane (SA-B2) while memory and dreams did not**, and **the
  engine got a governor while automations and terminal sessions did not**.
- Mitigations that exist but are env-gated are invisible to a GUI user — the
  Settings redesign must surface them without duplicating their mechanics.
