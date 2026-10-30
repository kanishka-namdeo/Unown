# The delegation round — the validation ledger

The round's failure ledger, continuing the lineage (F1–F7 aria round · F8–F13
carving round · F14–F20 website-excellence · F21–F25 the encore). Every entry
follows the contract: failure → reproduction → root cause → fix (or fix plan)
→ pin/re-run evidence. No entry is resolved until its re-test passes; product
defects found in the baseline get their fix verified by the after-benchmark
(checkpoint 5).

## F26 — the runaway scout: 104 turns, 596k tokens, killed only by the clock

**Failure.** The baseline's t3 batch spawned three scouts for three
independent questions. Two came back fine (`ok; 7 turns, 19k in` / `ok; 3
turns, 15k in`). The third burned **104 turns, 596k input tokens and 111 tool
calls** before the default 300 s timeout killed it — `## scout (timeout;
killed at 300s budget; 104 turns, 596k in / 5k out, 111 tool calls)`
(`receipts/baseline-2026-10-30T07-43-53/task-t3-triptych.session.jsonl`). A
scout — the "come back SMALL" agent — spent 596k tokens on "which six
benchmark suites feed the landing figures".

**Reproduction.** The journal pair (`spawned` 07:44:17 → `finished
status:timeout` 07:49:17 — exactly the 300 s budget later) plus the result
header in the transcript. The upstream usage log corroborates the burn.

**Root cause.** A sync-lane child has exactly one bound: the wall-clock
timeout. No turn cap, no token budget, and the print-mode loop guard
(`--max-tool-repetitions`) is not inherited by children — the same shape
Claude Code issue #106025 measured in production (71% of subagent tokens
spent after each agent's 80th step) and MAST's task-verification failure
family. One wedged investigation loops until the clock stops it.

**Fix plan (checkpoint 2).** Lean read-only builtins (`scout`,
`background-explore`) ship a default `maxTurns` (the per-agent routing field
that already exists); the runaway shape becomes a typed early exit
(`max-turns` cap) instead of a 596k-token clock kill. Pin: a unit test on the
shipped default + the after-benchmark's t3 re-run.

## F27 — the async delivery never lands in the session transcript

**Failure.** In the baseline's t8 re-run, the fleet child finished at
07:56:47 and the parent answered from its delivery at 07:56:48 — but the
session file contains **no entry for the delivery itself**. The transcript
jumps from the status poll to the final answer; the child's report exists
only in the registry summary and the journal. A user replaying the session
(`unown sessions export`, resume) cannot see what the child actually said.

**Reproduction.** `task-t8-async.session.prior-1.jsonl` (the merged file,
kept): the 07:56:47–48 window has no delivery entry;
`.unown/fleet/registry.json` carries the 400-char summary;
`task-t8-async.receipt.json` records the journal `finished done`.

**Root cause.** The fleet delivers results through pi's steer path
(`sendMessage({customType: "unown-subagent-result"}, {deliverAs: "steer"})`);
a steer delivered mid-turn is consumed as input without being persisted as a
session entry — the transcript records turns, not steers.

**Fix plan (checkpoint 2).** The delivery path persists an explicit session
entry (the same `appendEntry` seam the mission pin uses) so the transcript is
complete. Pin: a fleet-runtime test asserting the entry exists after a
delivered result.

## F28 — the dream trigger 409ed and the harness gave up

**Failure.** The baseline's post-workload `POST /api/jobs/auto-dream/trigger`
answered **409 `engine-busy`** — the engine's own scheduled dream was already
running — and the runner recorded the failure as the learning-retention
measurement (scored 0 on a measurement that never happened).

**Reproduction.** `summary.json → dream.trigger.status: 409`; the re-drive
(`dream-retry.receipt.json`) took four attempts (three 409s, then 200:
dreams 3→6, memory v3→4, notes consolidated).

**Root cause.** The runner treated a transient scheduler conflict as
terminal. The engine's busy mutex is by design (one job at a time); a caller
that wants the dream must retry.

**Fix.** The runner now retries the trigger up to 5× with 30 s backoff
(`run-delegation-bench.mjs`); the baseline's completion is the re-drive
receipt, honestly labeled. **Resolved** — the re-run evidence is the
`dream-retry.receipt.json` (dreams Δ3, version bump 3→4).

## F29 — the harness's comma-blind marker failed a correct answer

**Failure.** t8's marker `/\d{4,}/` failed on the answer "**82,204 lines**"
— the comma breaks the digit run, so a correct, verified answer scored red.

**Reproduction.** `task-t8-async.receipt.run1.json`: markers all false while
the result text contains the correct count.

**Root cause.** A US-formatted number defeated a naive contiguous-digit
regex.

**Fix.** Marker is now `/\d{1,3}(,\d{3})+|\d{4,}/` (comma groups or 4+
contiguous digits); the lane re-ran green
(`task-t8-async.receipt.json`, 9 s, correct count). **Resolved** — the re-run
receipt is the record; run1 is kept as the audit trail.

## F30 — a re-run lane continued the prior session file

**Failure.** The t8 re-run passed `--session <same path>` — and `--session`
CONTINUES an existing file, so the re-run transcript contained run1's entries
plus its own (two prompts, two async spawns, interleaved polls), corrupting
spawn attribution.

**Reproduction.** The merged file (now kept as
`task-t8-async.session.prior-1.jsonl`) holds both the 07:55 and 07:56 blocks.

**Root cause.** The harness assumed `--session` truncates; it resumes (the
flag's own help: "continue that exact session file").

**Fix.** The runner rotates a pre-existing session file aside
(`.prior-N.jsonl`) before any re-run; the baseline's t8 transcript was
re-derived from the re-run window (9 entries) with the merged original kept.
**Resolved** — rotation is in the runner; no future re-run can merge.

## F31 — the resume path dropped resumed lanes' spawn counts from the tally

**Failure.** After `--resume`, `summary.json → tally.totalSpawns` read 1 (the
re-run lane only) instead of 8 — resumed green lanes contributed zero spawns.

**Reproduction.** The post-resume summary (recomputed from receipts to 8; the
defect visible in the pre-fix file's `lanes[].spawns` gaps).

**Root cause.** The resume branch pushed `{resumed: true}` without the prior
receipt's journal-delta count.

**Fix.** The resume branch now carries the prior spawn count; this baseline's
summary was recomputed from the receipts. **Resolved.**

## F32 — the parent polls a push channel: seven status calls in fifteen seconds

**Failure.** The baseline's t8 run1 shows the parent calling
`task_control {action:"status"}` **seven times between 07:55:04 and
07:55:15** while the async child ran — although the spawn ack explicitly says
"the result will arrive as its own message". Each poll is a model turn;
seven wasted turns per background child is the headless twin of Claude Code
issue #95730's "waits silently" complaint, inverted: not invisibility but
distrust.

**Reproduction.** `task-t8-async.session.prior-1.jsonl` (the run1 block):
seven consecutive `status` tool calls; the t8 re-run block shows one (the
behavior is model-discretionary, not deterministic).

**Root cause.** The ack's contract line is not emphatic enough for the model
to bank on; there is no observable "you will be woken" affordance and no
penalty signal for polling.

**Fix plan (checkpoint 3).** The async ack and the `task_control status`
reply both state the push contract plainly ("stop polling — the result
arrives as its own message and wakes you"), and the fleet's completion
batching (which already coalesces wake-ups) is surfaced in the ack. Measured
again by the after-benchmark's t8 lane (poll count is a scorer raw).

## F33 — the capture lane's stale UNOWN_ROOT spawned a ghost binary path

**Failure.** `pty_fleet_lane.py`'s first run spawned
`bun /home/z/my-project/Unown/bin/unown` — capital-U path, nonexistent — and
polled an error pane for 240 s before reporting the widget "not visible"
(a false measurement).

**Reproduction.** The first run's `fleet-widget.pane.txt` (`widget visible:
False`) against `scripts/tui-capture/pty_common.py`'s module default
`UNOWN_ROOT = "/home/z/my-project/Unown"`.

**Root cause.** `pty_common.py`'s default root drifted from the actual
checkout path; the lane script passed `cwd` but not the env var the module
reads for the binary.

**Fix.** The lane is driven with `UNOWN_ROOT=/home/z/my-project/unown` in
the environment (and the README documents it); the re-run captured the widget
live (`fleet-widget.pane.txt`, `visible: True`, still rendered). **Resolved**
— the false-negative receipt is superseded by the live one, kept for the
trail.
