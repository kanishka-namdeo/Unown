# Ralph — the worker→reviewer loop

`unown ralph "<task>"` runs Geoffrey Huntley's "Ralph Wiggum" loop — as [goose ships it](https://goose-docs.ai/docs/tutorials/ralph-loop) — as a first-class Unown harness surface: an alternating **worker → reviewer** cycle where every iteration is a *fresh* agent session and state is handed off **only through files**.

```
unown ralph "fix the flaky router test: it fails ~1 in 5 runs under load"
unown ralph "migrate the note outbox to the new schema" --reviewer-model qwen3.7-plus
```

## The loop

1. **Worker run** — a brand-new headless session (no chat history): do the task, honour the reviewer's feedback file when one exists, keep `.unown/ralph/<run>/summary.md` current ("what I did, how I verified it, what remains").
2. **Reviewer run** — a brand-new session, ideally **a different model** (`--reviewer-model`): reads the task, the worker's summary, and `git diff` against the loop-start baseline, then answers with exactly one of:
   - `VERDICT: SHIP` — the task is genuinely complete and verified; the loop ends.
   - `VERDICT: REVISE` + a `FEEDBACK:` section — the feedback is written to `feedback.md` and the *next* worker iteration starts fresh with it.
3. At most `--iterations N` pairs (default 5, hard cap 20). Exhaustion ends the loop honestly (`max-iterations`, exit code 1) — every file stays for inspection; nothing is silently shipped.

```
.unown/ralph/<run-id>/
  task.md        the task, frozen verbatim at loop start
  summary.md     the worker's running log (the worker owns this file)
  feedback.md    the last reviewer's feedback (the reviewer's handoff)
  verdict.md     the final verdict + rationale (or the honest not-shipped note)
```

## The design rules (and where they come from)

- **Fresh context every iteration** — the industry convergence (goose's Ralph, Cline `/newtask`, OpenHands condensation): long histories rot; *files* don't. Each spawn is the same headless `unown --mode json -p --no-session` CLI routines and watch use — there is no bespoke spawner.
- **Cross-model review is the point** — a reviewer that shares the worker's model shares its blind spots. `--reviewer-model` exists to be set to something else; single-model loops work but are weaker second opinions.
- **The reviewer never edits** — reviewer runs are read-only (the automations `read-only` toolset); a reviewer that modifies the work it judges defeats the pattern. Workers run standard mode — the task is to change the repo, the same trust level as any agent session.
- **Never silently ship** — a reviewer that exits non-zero or emits no parseable `VERDICT:` line defaults to **REVISE** (goose's semantics): the loop may continue, it may never sneak a ship past a crashed judge. The default is visible — `verdictExplicit: false` in the record, a harness note in `feedback.md`.
- **Bounded by construction** — per-run 30-minute timeout (the shared automations timeout), the iteration cap, and the reviewer's diff budget (30 000 chars, truncated with a note — a huge diff is summarized, never allowed to eat the prompt). In a non-git workspace the reviewer is told so and reviews the workspace directly.
- **The verdict grammar is contractual** — `VERDICT: SHIP` / `VERDICT: REVISE`, start-of-line, case-insensitive, first match wins. Prose ("the verdict: ship it") never matches.

## Observability

- Every worker/reviewer spawn lands as a `runs` row (`kind: ralph-worker` / `ralph-reviewer`, `task_id` = the loop id) — the dashboard Runs pane and `GET /api/runs?kind=ralph-worker` render them with no new surface.
- One `ralph_runs` row per loop (status, iterations run, token totals, models, baseline sha).
- Bus events `ralph:iteration-finished` / `ralph:done` (SSE when the loop runs inside an engine context).

## Composing

- `--json` emits the full machine-readable record (iterations, verdicts, exit codes, tokens) for scripting.
- The loop is user-initiated and runs in-process (like `unown watch run`): it spawns its children directly and records into the shared store — it does not need the engine up, and it is **not** callable from inside a routine run (the `UNOWN_AUTOMATION=1` no-recursion gate applies to its children).
- Checkpoints compose: `/undo` in a session rolls back any ralph changes like any other edit.

## Sources

- goose — [the Ralph loop tutorial](https://goose-docs.ai/docs/tutorials/ralph-loop) (worker + *different* reviewer model, fresh session per iteration, persistent summary/feedback files, ship verdict, iteration cap).
- Geoffrey Huntley — the original "Ralph Wiggum as a software engineer" pattern (repeat until the reviewer ships).
- Unown's own subagent fleet (worker/reviewer roles) and the automations spawn seam — the existing architecture this loop is built on.
