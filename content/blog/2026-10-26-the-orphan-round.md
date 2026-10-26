---
title: "The orphan round: the lane with no ledger of its own"
description: "Round four paid the ledger's last IOU: the sync lane's kill -9 orphans — alive, unrecorded, swept by nobody — now journal, heartbeat, and sweep."
date: 2026-10-26
lastmod: 2026-10-26
tags: [subagents, release]
type: release
media: [/landing/tui/subagent-explore/stills/02-task-subagent-running.png, /landing/tui/fleet/stills/05-resume-registry.png]
---

Every round's closing section is a promise the next round keeps. Round three's
ledger ended with one unpaid line: *the sync lane's own children of a
SIGKILLed parent — covered on the signal paths by the reaper registration but
carrying no journal or sweep of their own — are the round-four candidate,
written down where the next round will find them.* This is that round. The
discipline held: the orphan was reproduced live, against the same metered
production endpoint, before a line of the fix existed.

## The orphan with no ledger of its own

The probe gave a parent one synchronous `task` child — the default lane, no
`async: true` — whose bash was sleeping long enough to crash the parent
mid-run with a pid-only `kill -9`. Then it sampled the wreckage. The sync
child was alive. Its bash grandchild was alive. And the record of either
existing was **zero**: no `.unown/fleet/` directory at all, no journal, no
heartbeat, nothing for a second boot to notice — the probe verified that a
fresh real session booted in the repo stayed silent while the orphan kept
running. At the end the probe killed the child by hand, because no tool
would.

This is round three's headline finding, one lane over — and it is not an
exotic shape. The competitor sweep we ran while designing the fix reads like
a genre: Claude Code users file it as *"the orphan problem is architectural"*
(#33979 — subagents are separate processes, so an unexpected parent death
orphans them), and one of the most vivid tickets in that family (#18405)
describes a user finding an unknown process, killing it, and taking down
their own Claude session with it — the lived version of the rule this repo's
sweeper already follows: never kill a pid you cannot identify. The agent SDK
tracks auto-termination-when-parent-dies as a standing feature request
(#132/#142), and Codex ships both halves of the story — the orphaned
residual-process bug (#15379) and the durable-reconciliation feature request
(#54428) that the fleet lane already answered in round 3.

The fix refused to grow a second, drifting twin of the fleet reaper. One
journal, one heartbeat contract, one sweep — lane-tagged. Every
`runSubagentOnce` attempt now appends `{op:"spawned", lane:"sync", pid,
parentPid, promptFile, …}` to the same append-only
`.unown/fleet/journal.jsonl` the fleet writes — **one entry per attempt**,
because structured-output retries and fallback-model rotation each spawn a
fresh child, and each child deserves its own terminal record. The identity
token is the interesting part: a sync child runs `--no-session`, so there is
no session file to match a cmdline against. But every sync child carries one
unique string in its argv — the mkdtemp path of its `--append-system-prompt`
temp file. The journal records it; the sweep's `ps -o command=` probe matches
it. A `--no-session` child is identified by the one thing it cannot help
carrying.

The child itself now heartbeats `<id>.hb.json` `{pid, ts}` about once per
second from its own boot — the same fresh-and-self-reported identity signal
fleet children get from their control poller, just written from
`bootRuntime` instead, gated on a `UNOWN_SYNC_HEARTBEAT` env var the parent
hands it. That env var is internal plumbing, exactly like the fleet's channel
vars — including the rule that a bash-spawned grandchild must never inherit
it, or a grandchild could keep our heartbeat file fresh under its own pid
and lie to the sweep about which process is the orphan.

And the terminal records are honest by construction. A parent that
*observes* its child's exit journals `finished` with the status it watched
happen — `done`, `failed`, `timeout`, `aborted`, `spawn_error` — never a
guess. A parent killed mid-run writes nothing, and the next boot's sweep
owns the orphan from there: live and heartbeat-verified means tree-killed
and journaled `reaped`; gone means journaled `abandoned`; the heartbeat file
is cleaned with the kill. A worktree-isolated sync child journals its tree
amendment **per attempt**, so whichever attempt was running at the crash
correlates the tree for orphan-marking — kept on disk for review, the same
kept-tree rule as every other orphaned tree. The boot line itself went
lane-honest: `subagent crash sweep: 1 live orphan(s) reaped (0 fleet, 1
sync), 0 already dead (traced) (0 fleet, 0 sync), …`.

The live replay is the receipt that matters: crash the parent, boot any real
session in that repo, and the journal carries `reaped — parent dead; live
sync-lane orphan killed (heartbeat-verified)`, the heartbeat file is cleaned,
and the orphan is gone. The probe that ended round three's pre-fix run by
killing the child by hand now ends with nothing left to kill.

## The journal that lived one directory short

Designing the fix surfaced a seam the fleet had been shipping since round 3.
The journal's writer (the fleet manager's default) and its reader (the boot
sweep) both keyed on the session's **literal working directory** — so a
session booted from a subdirectory journaled its spawns into that
subdirectory's `.unown/fleet`, where a boot from the repository root would
never look. Invisibility by construction, one directory short, both lanes.

Both sides now resolve the git repo **toplevel** (a read-only
`git rev-parse` probe riding the repo's hardened GitSpawn-neutralized arg
set — a hostile repository config must not execute anything just because we
asked where the repo is). A subdirectory session and a root boot meet at one
file. The sweep still checks the literal cwd path first, so journals written
by 0.0.26-era sessions on real disks keep being found. And a
worktree-isolated child's journal is derived from the *session's* cwd, never
the disposable worktree's own `.unown` — the tree dies with the run; the
trace must outlive it.

The probe run also measured a small honesty gap in our own expectations:
`unown --version` is a fast path that never reaches the runtime boot, so it
never sweeps. The docs always said "every session boot" — now a receipt says
so too. The sweep rides sessions, not version prints.

## The receipts

- One live finding reproduced before any fix (the sync orphan with zero
  trace), one found *by* the design pass (the literal-cwd journal seam,
  affecting both lanes since round 3) — the round's argument for writing the
  ledger down in the first place.
- 19 new pins: 13 in `test/fleet-reaper.test.ts` (the sync decision table —
  live-parent skip, stale-heartbeat abandon, a real bash cmdline-verified
  reap keyed on the prompt-file token, the pre-heartbeat POSIX branch, the
  empty-token wildcard guard, finished-untouched idempotence, the lane-count
  boot line, per-attempt worktree dedupe; the journal-dir resolution with a
  real git repo, the non-git fallback, and 0.0.26-era literal-path
  compatibility; the heartbeat writer's beat/stop contract), the new
  `test/subagent-stress-round4.test.ts` (the shared 1 s / 5 s freshness
  contract, the env name, the vendored bash strip, the entry shape, and the
  fleet manager + sync sweep meeting at one toplevel journal), plus an
  end-to-end regression in `test/cli/task-structured.test.ts`: a real CLI
  parent SIGKILLed mid-sync-child-run, then a second real boot sweeps —
  journal `reaped`, heartbeat cleaned, worktree orphan-marked, orphan dead.
- All probes re-verified live in both directions against the same endpoint
  (pre-fix orphan with zero trace; post-fix sweep with the terminal record);
  the full self-learning suite at the release cut: **4,790 pass / 0 fail
  across 203 files**; root typecheck clean.
- The [CHANGELOG](https://github.com/kanishka-namdeo/Unown/blob/main/CHANGELOG.md)
  carries the round, and the limits table in
  [docs/subagents.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/subagents.md)
  now says what the boot line says: the heartbeat and the sweep belong to
  both lanes, and the journal lives at the repo toplevel.

## What this round did not cover

The failure-cascade shape remains as designed (bounded by the batch cap; not
re-measured this round). The recipe and automation lanes spawn their own
`unown` children outside `runSubagentOnce` — automations are engine-owned
(the service supervises them and restarts on crash, a daemon's job done by a
daemon), but the recipe lane's spawns carry neither journal nor heartbeat
and are the natural round-five candidate, written down here where the next
round will find them. A crash that lands *between* a job's sync attempts
(after one attempt finished, before the next spawned) leaves the job's
worktree `spawned` in the worktree registry without an open journal entry to
correlate — the window is seconds wide and the tree stays discoverable via
`unown worktrees list`, but nothing auto-marks it. A session booted *inside*
a managed worktree journals to that worktree's own `.unown/fleet` — the
worktree is that session's repo root, consistently, which also means a
root-boot never sweeps it. And the sweep remains a boot-time act by design:
a session that never reboots owns its children for its whole life, and no
background sweeper will take them from it while it runs.
