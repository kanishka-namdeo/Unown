# The sentinel round's competitor research

> **Verdict up front:** four agent products were reverse-engineered to ground
> this round's method — bolt.diy (how a live preview is framed and sandboxed),
> OpenHands (how an agent's work is verified with machine-checkable gates and
> receipt ledgers), gpt-pilot (how a big build is decomposed into
> testable-committable wholes with re-plan-not-patch recovery) and Cline (how
> long unattended builds stay safe: per-run checkpoints, plan/act backstops,
> stream-retry middleware). The round adopted eight patterns from them; the
> mapping is the last section.

- [What each product is](#what-each-product-is)
- [bolt.diy — the live preview and the showcase](#boltdiy--the-live-preview-and-the-showcase)
- [OpenHands — verification gates and receipts](#openhands--verification-gates-and-receipts)
- [gpt-pilot — decomposition and recovery](#gpt-pilot--decomposition-and-recovery)
- [Cline — unattended-build safety](#cline--unattended-build-safety)
- [What this round adopted](#what-this-round-adopted)

Related pages: [live-preview competitor research](live-preview-competitor-research.md)
(the commerce round's reverse-engineering — bolt.new, OpenHands, opencode,
aider, v0 on the showcase question) · [the sentinel session
record](sentinel-demo-session.md) (what this round's research fed) · [testing
strategy](testing-strategy.md) (the standing record this round's findings
extend).

## Method

Each repo was shallow-cloned read-only during the round (2026-10-28) and read
against its own docs; claims below carry the file path or doc URL they came
from. Tiering follows the docs' decision-record convention: `[V]` verified at
a cited path, `[C]` upstream-claimed, `[U]` unknown.

## What each product is

| Product | What it is | What this round took from it |
|---|---|---|
| [bolt.diy](https://github.com/stackblitz-labs/bolt.diy) | the open-source bolt.new workbench — LLM streams an artifact parsed and executed in a browser-side WebContainer | the showcase frame: sandboxed iframe + curated app gallery + reset/refresh choreography |
| [OpenHands](https://github.com/OpenHands/OpenHands) | All Hands' agent platform (now Agent Canvas + [software-agent-sdk](https://github.com/OpenHands/software-agent-sdk)) | verification: machine-checkable per-phase gates, append-only receipts, stuck-detection nudges |
| [gpt-pilot](https://github.com/Pythagora-io/gpt-pilot) | Pythagora's spec-to-app pipeline (unmaintained; read-only) | decomposition: epics → tasks where a task is one testable committable whole; re-plan-don't-patch |
| [Cline](https://github.com/cline/cline) | the most-deployed open agent extension | safety: per-run checkpoints, plan/act command-guard backstop, buffer-until-proven stream retry |

## bolt.diy — the live preview and the showcase

The whole built app runs in the visitor's browser tab (a WebContainer node
runtime); dev-server ports surface as `https://<previewId>…webcontainer-api.io`
URLs in a sandboxed iframe
(`allow-scripts allow-forms allow-popups allow-modals allow-storage-access-by-user-activation allow-same-origin`)
[`app/components/workbench/Preview.tsx`][V]. Preview refreshes toggle a
`ready` flag false→true inside `requestAnimationFrame` (forcing an iframe
remount), debounced 300 ms, and a `BroadcastChannel('preview-updates')` syncs
refreshes across tabs [`app/lib/stores/previews.ts`][V]. A dedicated popout
route (`/webcontainer/preview/:id`) mounts the same sandboxed iframe so one
embeddable URL serves workbench and showcase alike [V]. Their showcase is
curated, not a free-for-all: seven example-prompt pills and eleven pinned
starter templates, all in versioned constants files their tests pin
[`app/utils/constants.ts`][V]. Their E2E flagship drives a full agent flow
with a poll-timeout plus one deterministic nudge fallback, then asserts the
preview iframe really renders the built app (300 s timeout)
[`tests/e2e/hello-website.spec.ts`][V]. Pitfalls they document: COEP
`credentialless` is required (any subresource without CORP headers breaks
isolation), and WebContainers are Chromium/Firefox-only with commercial
licensing terms — neither survivable on a Vercel-hosted landing page `[U →
resolved: not applicable, we iframe our own Next.js routes instead]`.

## OpenHands — verification gates and receipts

The old monorepo's SWE-bench harness defines a task as `setup()` + an
instruction template that mandates a five-step plan ("write a reproduce
script → confirm the failure → edit → rerun → edge cases") + `verify_result()`
in plain code, and scores outcomes in a FRESH container (patch applied,
FAIL_TO_PASS/PASS_TO_PASS run), never transcript self-reports
[`evaluation/benchmarks/swe_bench/run_infer.py` @ 0.18.0][V]. Every run emits
an `EvalOutput` JSONL row with the full serialized event history plus token
metrics [V]. The SDK's conversation store is an append-only log — one JSON
file per event — that resume, replay and debugging all read [V]. A
StuckDetector scans the last ~20 events for repeat cycles and injects a
one-time nudge before hard-stopping with a distinct reason
[`openhands-sdk/openhands/sdk/conversation/stuck_detector.py`][V]. Their
dogfooding jewel is the `verify-openhands` skill: launch the real product
isolated, run `doctor` preflight, drive the real UI by testid, and append
every verdict to an `evidence/ledger.jsonl` — "arrange, don't fake" [V].
Their behavior-test taxonomy separates required task-completion (`t*`),
optional behaviors (`b*`) and protocol edges (`a*`), against real repos pinned
at pre-fix commits so the agent cannot see the solution [V].

## gpt-pilot — decomposition and recovery

Spec → epics → tasks → steps, and the granularity trick is in the wording:
epics are asked for as "epics" to keep the plan high-level, while "each task
is one testable whole that the user can test and commit"
[`core/prompts/tech-lead/epic_breakdown.prompt`][V] — task = commit =
human-verifiable unit, never splitting a feature's frontend from its backend
[V]. On a failed command, recovery is re-plan-not-patch: the ErrorHandler
regenerates the REMAINING step list from the failure analysis instead of
stacking hotfixes, capped at `MAX_CODING_ATTEMPTS = 3` with loop detection at
3 iterations [`core/prompts/error-handler/debug.prompt`][V]. Every command's
output gets an LLM `{analysis, success}` verdict at temperature 0 that knows
neighboring steps (a "failed" command may be fixed by later steps)
[`core/agents/executor.py`][V]. Progress state only becomes durable at
commit points — the two-state pattern (`next_state` mutated, `commit()`
persists and mints a fresh one) means an in-flight failure never corrupts the
record [`core/state/state_manager.py`][V]. Caveat recorded upstream: the repo
carried a credential-stealing worm Aug 2025–Jun 2026 and is officially
unmaintained [C] — read-only inspection only, which is how this round used
it.

## Cline — unattended-build safety

Plan/Act is not just prompting: plan mode keeps read-only commands available
but a hard backstop (`extensions/tools/command-guard.ts`) returns a tool
error for file-mutating commands BEFORE approval or execution [V]. Checkpoints
snapshot inside the user's repo without touching it — a 3-parent
`git stash create --include-untracked`-style commit stored under private
refs `refs/cline/checkpoints/{sessionId}/{runCount}`, triggered by the
`beforeModel` hook on iteration 1 of each new user run, with durable
checkpoint history so restarts never duplicate [`sdk/packages/core/src/hooks/checkpoint-hooks.ts`][V].
Restore is transactional: stash-capture the worktree, `update-ref` CAS,
refuse if HEAD moved, offer Files/Task/Both granularity [V]. Provider
resilience: a `retry-empty-response` middleware retries a stream that dies
before its first output part (buffering until proven, aggregating billed
usage), and error classification walks nested bodies with veto rules so a
rate-limit never mis-triggers compaction [V]. Approval rejections return as
structured tool results the model can self-correct on [V].

## What this round adopted

| # | Pattern (source) | How this round applies it |
|---|---|---|
| 1 | task = one testable committable whole (gpt-pilot) | the sentinel build brief is phased scaffold → domain → UI → API → tests, each phase ending green and committed |
| 2 | machine-checkable phase gates (OpenHands) | every phase's brief names its own verify command (unit tests, curl checks, build) before the next phase starts |
| 3 | append-only receipts (OpenHands) | the session receipts ledger (`.unown/receipts/*.jsonl`) is the round's evidence; counts in the gallery read from it |
| 4 | stuck-detection + nudge (OpenHands) | `--max-tool-repetitions` loop guard + chunked resume sessions carry a one-shot corrective prompt each |
| 5 | re-plan-don't-patch, capped attempts (gpt-pilot) | review-round fixes regenerate the approach when a fix fails twice instead of stacking hotfixes |
| 6 | sandboxed-iframe showcase + curated gallery (bolt.diy) | the third gallery app iframes its own deployment route, same-origin sandbox, poster + switcher, per-app reset handshake |
| 7 | poll-with-nudge E2E (bolt.diy) | the QA round's browser pass retries a stalled interaction once with a deterministic nudge before declaring failure |
| 8 | per-run checkpoints + buffer-until-proven streams (Cline) | auto-checkpoints stay on; the bridge's degenerate-completion guard (2026-10-23) already implements the stream half — verified still on in `/health` |

Sources: bolt.diy @ `353b44c`, OpenHands Agent Canvas @ `main` + monorepo tag
`0.18.0`, software-agent-sdk @ `main`, gpt-pilot @ `9b763fd`, Cline @
`f817e59` — all shallow-cloned 2026-10-28; the full research transcripts are
preserved in the round's build environment (`/home/z/my-project/research/`).
