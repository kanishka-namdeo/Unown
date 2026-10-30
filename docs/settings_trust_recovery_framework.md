# Trust & Recovery Framework — Phase 6 of the Settings Evolution Round

**Date:** 2026-10-31 · **Inputs:** `settings_edge_case_catalogue.md` (verified
subsystem audit), `settings_competitor_review.md` (trust patterns).
**Consumed by:** the Settings hub implementation (Phase 8) and the
self-improvement integration (Phase 10).

**The contract:** for every autonomous action in Unown, the user must always
be able to answer: *What happened? Why did it happen? What changed? What
learned from it? How confident is Unown? How do I undo it?* Every autonomous
subsystem must support **Explain · Review · Approve · Undo · Audit**. Where
one is missing, this round creates the surface for it.

---

## 1. The trust matrix (as-found → as-designed)

Status legend: ✅ exists and visible · 🔧 exists but invisible/awkward (this
round surfaces it) · 🆕 created by this round · ❌ out of scope (recorded
follow-up).

| Subsystem (autonomous action) | Explain | Review | Approve | Undo | Audit |
|---|---|---|---|---|---|
| **Memory — dream ships rules** | 🔧 dream receipts (why: notes list) | 🔧 dashboard Dreams screen | 🆕 review-mode inbox (pending diffs, approve/revert; default off, first-mint on) | ✅ version rollback (never destroys history) | 🔧→🆕 change ledger records dream-applied versions |
| **Memory — mem0 reconcile** | 🔧 dream note (merged/pruned) | ❌ per-rule view | ❌ (fail-open additive) | 🔧 rollback | 🆕 memory health card (last-reconcile status, counters) |
| **Memory — hoist to user tier** | 🔧 hoist receipt | 🔧 user.md edit | 🔧 opt-in env → 🆕 Settings toggle | ✅ hand-delete (additive bullets) | 🆕 ledger |
| **AutoDream — canary rollback** | ✅ per-sample outcomes + reasons | 🔧 dreams screen | automatic (correct default) | n/a (it IS undo) | ✅ gated rows |
| **Skills — mint** | 🔧 mint log lines in dream note | 🆕 staged inbox with diff | ✅ staging + human `mv` → 🆕 promote/discard buttons | ✅ `rollbackSkill` | 🔧 skills DB → 🆕 inbox history |
| **Hooks — decision made** | 🔧 result reason | ❌ | ✅ trust gate (project) / user-scope trusted | n/a (decisions are per-call) | 🔧 engine hook_log → 🆕 terminal feed + Settings viewer |
| **MCP — tool call** | ✅ typed errors, stderr tails | 🆕 server cards (tools list) | 🔧 elicitation policy → 🆕 matrix + autoAccept counter | n/a | 🔧 transcript entries |
| **Goals — completion claim** | ✅ evidence lines listed | 🔧 evidence markers | 🆕 optional verify-command gate | `/goal clear` | session entries |
| **Automations — scheduled run** | 🔧 run rows (output, triggers) | 🆕 run history in Settings | ✅ explicit creation (DB config) | 🆕 **stop-now kill switch** | ✅ automation_runs + 🆕 spend meter |
| **Subagents — spawn & result** | ✅ delegation ledger (why/task/cost) | 🔧 `/delegation` audit | 🔧 delegation level → 🆕 defaults panel | ✅ `task_control stop` + kept worktrees | ✅ journal |
| **Checkpoints — capture/restore** | ✅ receipt ledger | ✅ manifests | n/a (always-on, safe) | ✅ undo/redo/restore + 🆕 coverage badge | ✅ receipts |
| **Updates — self-update** | ✅ manifest + SHA-256 verify | 🔧 changelog | 🔧 explicit `unown update` (never silent) | ✅ `--rollback` | 🔧→🆕 ledger |
| **Governor — throttle** | ✅ budgetStatus on overview | 🔧 doctor | automatic (correct default) | n/a | ✅ breaker events |
| **Settings changes (this round)** | 🆕 contextual help per row | 🆕 diff vs defaults | 🆕 typed confirm for high-risk | 🆕 revert-to-previous + scoped reset w/ backup | 🆕 **change ledger** (who/what/when/where) |

---

## 2. The six questions, guaranteed by surface

1. **What happened?** — Observability: status card, learning feed, run
   history, change ledger, hook audit feed.
2. **Why did it happen?** — Explain column above: every artifact carries
   its trigger (notes→dream, schedule→run, event→chain, request→tool).
3. **What changed?** — receipts, dream diffs (inbox), settings ledger
   (before/after values), checkpoint manifests.
4. **What learned from it?** — Learning feed (dreams, versions, notes) +
   provenance footers on every memory rule.
5. **How confident is Unown?** — guard verdicts (ship/sanitize/gate),
   canary outcomes, completion-guard results, spec-verification status
   (verified / estimate / unverified labels in Models & Cost).
6. **How do I undo it?** — Recovery section: undo/redo/restore, dream +
   memory rollback, update rollback, settings revert/reset, dead-letter
   retry lane.

## 3. Risk communication rules (binding for the hub UI)

1. Every row renders a risk badge: low `●` (green) / med `◐` (yellow) /
   high `○` (red outline). Never in docs only (Roo anti-pattern).
2. High-risk actions require **typed confirmation** naming the consequence
   (bypassPermissions, dream-gate off, trust bypass, retention changes,
   reset).
3. Danger lives in the name (Codex pattern): no friendly aliases for
   dangerous options.
4. Persisted-rule preview: every write shows the exact value + destination
   file before commit (Claude pattern).
5. Defense-disabling toggles warn inline and cross-link the edge-case
   catalogue entry (e.g., dream gate → "regressions ship unverified").
6. Destructive ≠ hidden: irreversible actions stay reachable but carry the
   badge + confirmation + backup when possible.

## 4. Recovery guarantees (binding)

1. **No reset without backup:** every scoped reset writes a timestamped
   bundle to `~/.unown/agent/settings-backups/` first (last 5 kept —
   Claude pattern).
2. **History is never destroyed:** memory rollbacks write new versions;
   dream gates consume notes into rows; the ledger is append-only.
3. **Session-scoped by default:** permission-mode and add-dir changes are
   session-scoped unless explicitly persisted (already true — keep).
4. **Coverage honesty:** when recovery is impossible (bash changes,
   oversized files, retention deletes), the badge says so at the point of
   action, not after the fact.
5. **One keystroke to safety:** `/settings` → Recovery is the single
   surface listing every recovery path with its coverage state.

## 5. What this round implements vs. records

**Implemented now (Phase 7/8):** settings change ledger + recently-changed
with revert; risk badges + typed confirmations; health checks; trust
manifest (unified view of the five gates); memory/dream/skill review
surfaces wired to existing rollback mechanics; automation stop-now + spend
meter (engine API + Settings card); goal budget; hook loop breaker; undo
coverage badge; export/import/reset with backups.

**Recorded as follow-ups (out of scope this round):** managed-settings
enterprise tier with org-locked denies; OTel export of the ledger; per-rule
memory approve-before-apply as the DEFAULT (ships as opt-in review mode
first — measured, then decided); bash-change checkpointing (cost-bounded
snapshot design needed); non-git project identity migration tool.

## 6. Success criteria for this framework

- Every cell in §1 that was 🔧 is either surfaced or has an explicit 🆕
  surface in the hub.
- A first-time user can answer all six questions from `/settings` alone
  (benchmark BM-6).
- Every high-risk setting carries a badge + confirmation (benchmark BM-7
  audit script).
- The change ledger records: timestamp, actor (user/session/dream/automation),
  setting id, before, after, source surface (audit sample passes).
