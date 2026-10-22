# Watch — AI comments in code, resolved by the always-on engine

Drop instructions into code comments; the engine collects them, runs a batched
agent pass, and the comments disappear when the work is done.

- [What it is](#what-it-is)
- [The markers](#the-markers)
- [Opting a project in](#opting-a-project-in)
- [The dedup state machine](#the-dedup-state-machine)
- [Report vs standard mode](#report-vs-standard-mode)
- [The router job and the budget](#the-router-job-and-the-budget)
- [CLI reference](#cli-reference)
- [Security and trust](#security-and-trust)
- [Sources (the decision record)](#sources-the-decision-record)

Related pages: [routines](routines.md) · [the engine](detached-engine-architecture.md) · [usage](usage.md)

## What it is

Aider's `--watch-files` semantics, moved onto the always-on engine: while you
work, you leave instructions where the work happens — in the code, as comments
(`# AI: fix the off-by-one in this loop`). A background engine job (the
`watch-scan` router job, every 2 minutes) scans opted-in projects for those
markers, and for each root with NEW comments dispatches one batched headless
agent run (`unown --mode json`, the same spawn seam routines use) whose prompt
carries every new comment with its `file:line`. The run resolves the tasks
(and removes the comment lines it completed) or — in the default report mode —
answers and reports without touching anything.

The always-on placement is the design difference from aider: there, watching
needs a live aider session in that terminal. Here the detached engine owns the
loop, so comments left at 18:00 are resolved at 18:02 whether or not any agent
session was ever opened — the same "no agent in use" posture as
[routines](routines.md), and it composes with the [OS service
layer](routines.md#always-on-the-engine-service) (`unown engine install`) that
keeps the engine up across reboots.

## The markers

Line comments, start-of-line, case-insensitive, in the four language families
(v1 covers line comments only — block comments `/* AI: … */` and `<!-- AI: … -->`
are out of scope):

| Family | Prefix | Languages (default allowlist) |
|---|---|---|
| hash | `#` | python, shell, yaml, ruby, toml, r, perl, … |
| slash | `//` | typescript, javascript, go, rust, java, c, cpp, swift, kotlin, … |
| dash | `--` | sql, lua, haskell, ada |
| semicolon | `;` | ini, cfg |

The three kinds (aider's semantics):

| Marker | Kind | Meaning |
|---|---|---|
| `# AI: text` | task | do this work |
| `# AI! text` | urgent | do this work — prioritized in the batch |
| `# AI? text` | question | answer this in the report; no code change expected |

Matching is tolerant: leading whitespace before the marker, any case (`# ai:`),
and any non-empty instruction after it. A bare marker with no text is ignored
(as is a marker inside a string or mid-line — the marker must start the line,
modulo whitespace). Instruction text clips at 500 characters (the comment is
flagged truncated; the hash covers the clipped text).

## Opting a project in

A project becomes a watch root by a marker file — `.unown/watch.json`:

```json
{
  "enabled": true,
  "mode": "report",
  "include": ["*.py", "src/**/*.ts"]
}
```

- `enabled` (default `true` when the file exists) — set `false` to opt out.
- `mode` — `"report"` (default, read-only) or `"standard"` (edits allowed); see
  [below](#report-vs-standard-mode).
- `include` (optional) — glob patterns that REPLACE the default source-file
  allowlist: a pattern with no `/` matches the basename at any depth (`*.py`);
  with `/` it matches the root-relative path, `**` crossing directory
  boundaries and `*` within one segment. No `!` negation in v1.

Root discovery (the engine scans all three, deduplicates):

1. the engine checkout itself (the repo root);
2. every distinct routine `workspace` (a read-only `SELECT DISTINCT` — the
   projects you already entrusted with unattended runs);
3. `PI_WATCH_ROOTS` — colon-separated extra paths (POSIX; `;` on Windows).

A root with no marker file is simply not a root (the common case — silent). A
malformed marker JSON disables that root with a warning surfaced in
`unown watch roots`/`watch list` output.

The walk never follows symlinks, skips `.git`, `node_modules` and `.unown` at
any depth, skips binaries (NUL-byte sniff) and files over 512 KB, and caps at
5,000 files per root.

## The dedup state machine

A comment's identity is `sha1(file:line-kind-text)` — case and path separators
normalized. The engine stores seen hashes (`watch_seen`); a scan dispatches a
run **only for comments whose hash is not yet seen** — a quiet scan costs zero
LLM. After a run, the root is re-scanned:

- a comment still present (the run declined or could not finish it) is marked
  seen — it will **not** re-trigger until its text or line changes (an edited
  comment is a new hash, and dispatches again);
- a comment gone (resolved — the run removed the line, or you deleted it
  yourself) has its hash row deleted: forgotten, so re-adding the same comment
  later triggers a fresh run.

A comment that appears mid-run (after the scan snapshot, before the re-scan)
is not marked seen by that pass — the next scan picks it up.

## Report vs standard mode

The default mode is `report` (read-only): the batched run has NO write access —
it answers every `AI?` question and reports what it would do for each `AI:`
task. Write access (`standard`) is per-project, explicit, in the marker file —
the same trust posture as [routines](routines.md): unattended edits are a
deliberate choice, and a standard-mode run's file changes land in the working
tree, reviewable through git. A standard run removes exactly the comment lines
it resolved — never adjacent code.

## The router job and the budget

`watch-scan` is an interval router job (120 s), visible in the dashboard Router
screen and `unown engine status`. It is a *learning job*: like AutoDream and
the harness, its LLM spend goes through the governor (hourly/daily call+token
ceilings, the breaker), and one batched run per root per scan keeps the worst
case bounded. The 2-concurrent cap and the 30-minute run timeout are the
routine machinery's — the watch rides it. The kill switch: `PI_WATCH_DISABLE=1`
seeds the job disabled at boot (and the job body re-checks it, so a var set
later stops scans without a restart).

## CLI reference

```
unown watch list [--json]     scan every root now; comments with kind badges
                               and new/seen state — never dispatches a run
unown watch run               force one scan+resolve pass NOW (bypasses the
                               interval; same spawn seam, self-heals a down
                               engine first; PI_WATCH_DISABLE=1 wins)
unown watch roots [--json]    discovered roots + mode + marker path
```

In-engine observability: `watch:scan` and `watch:run-finished` events ride the
SSE feed (the dashboard's live activity), and every run is recorded in the
`watch_runs` table with status, exit code, output, turns and tokens.

## Security and trust

- **Opt-in per project** — no marker file, no scanning; `include` globs further
  bound what is read.
- **Report-only by default** — see above; `standard` is explicit.
- **The comment text is untrusted input**: it is injected into the headless
  run's prompt, but that run carries the full guardrail stack (hooks, the
  injection scanner, the bash policy, the path jail) exactly like every other
  engine-spawned session. A malicious `# AI:` comment is a prompt-injection
  attempt against a sandboxed, budgeted, read-only-by-default agent — and the
  no-recursion gate (`UNOWN_AUTOMATION=1`) hides the routine-mutation tools
  inside watch runs, so a comment cannot schedule routines.
- **Bounded reads**: 5,000 files / 512 KB per file / no symlinks / no `.git`,
  `node_modules`, `.unown`.

## Sources (the decision record)

- **Aider `--watch-files`** (aider.chat/docs/usage/watch.html) — the marker
  vocabulary (`AI` / `AI!` / `AI?`), the collect-→-resolve-→-remove loop, and
  the in-code instruction placement. Deviations: the watcher lives on the
  detached engine (always-on, not session-bound); report mode is the default
  (aider's watcher edits by default — Unown's trust posture makes unattended
  edits opt-in); resolution is batched per root per scan with hash dedup
  (aider collects on a debounce); v1 covers line comments only.
- **The routine machinery** (`automations.ts`) — the spawn seam (headless
  `--mode json` runs, mode-restricted toolsets, 30-minute timeout), the
  governor gating, and the no-recursion marker are reused as-is rather than
  re-implemented: one unattended-execution path in the engine, audited once.
