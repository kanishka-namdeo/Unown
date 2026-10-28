# The Fugue demo session (the SOTA round)

> **Status: in progress** — this is the SOTA round's session receipt stub, committed mid-round per the cadence round's pattern (`be450e2`). It will carry: what the round built, the agent sessions that built it, what each stage's testing found, the numbered embedding patches, the learning-mechanism validation evidence (the five mechanisms exercised against the live engine), and the benchmark framework's baseline/midpoint/final numbers. The round's grounding research is [sota-round-competitor-research.md](sota-round-competitor-research.md).

- [What the app is](#what-the-app-is)
- [How it was built](#how-it-was-built)
- [What the testing found (and fixed)](#what-the-testing-found-and-fixed)
- [The learning validation](#the-learning-validation)
- [The embedding adaptations](#the-embedding-adaptations)
- [Where things live](#where-things-live)

Related pages: [cadence demo session](cadence-demo-session.md) (the previous
gallery round) · [bazaar demo session](bazaar-demo-session.md) ·
[sota-round competitor research](sota-round-competitor-research.md).

## What the app is

Fugue — an **AI workflow automation platform**: workspaces hold **flows**,
flows compose **steps** (transform, classify, enrich, branch, notify — each a
deterministic simulated inference engine, so the app runs offline, tests stay
hermetic, and the landing embed always answers), and running a flow over a
payload produces a **run** with a per-step timeline of evidence (attempt
number, bounded input/output snapshots, durations, branch redirects). Session
auth (scrypt + httpOnly cookies, a seeded demo user), a fourteen-route JSON
API, a dashboard (flows + editor, run history + inspector, stats), and the
host repo's established file-backed JSON store. A fugue is independent
voices interwoven into one composition — the exact shape of the product, and
the shape of the round: the app, the agent that built it, and the learning
loop that watched them both.

Status (checkpoint 2): scaffold + domain phases shipped in the build repo;
build log below. Named per the round's late-entrants research — the original
name Cascade belongs to Windsurf's flagship agent
([research receipt](sota-round-competitor-research.md#the-late-entrants--zcode-openclaude-codewhale)),
caught before a single build session paid for it.

## How it was built

Written end-to-end by `unown`, driven headless against the Agnes AI endpoint
through the bundled llm-bridge, in a separate build repo
(`/home/z/my-project/fugue-build`, `BRIEF.md` → `PLAN.md` → phases).
Operating procedure per the validation log's F0/F2 entries: every session
runs backgrounded through an intermediate-exit launcher (stdin `/dev/null`,
file-redirected stdio, envelope polled from the log file), receipts under
the build repo's `.unown/receipts/`, one commit per phase, operator QA
(build + tests) between phases — zero human edits to the app's code.

| Phase | Sessions | Result | Build-repo commit |
|---|---|---|---|
| Plan | 2 (25-turn cap → resume) | 26.7k-char numbered plan: data model, route map, engine design, phases, test plan, risks | `fb1a0f6` |
| P0 scaffold | 2 (40-turn cap → resume) | Next.js 16 standalone + Tailwind 4 + bun-test wiring; build green | `7748344` |
| P1 domain | 2 (40-turn cap → resume, mid-fix) | types/seed/store/validation/engine + 5 step processors + stats; **56 tests green**, typecheck clean; the resume caught a real spec gap (per-attempt timelines) | `437d667` |
| P2 auth+API | in flight | 14 routes, scrypt auth, route tests | (pending) |

Checkpoint receipts so far: 9 session ledgers, 442 tool rows, 0 tool
errors. Both capped resumes landed within one continuation each — the
cadence round's chunked-resume pattern holding.

## What the testing found (and fixed)

(to be filled at close)

## The learning validation

Checkpoint 2 — the live engine evidence collected so far (all timestamps
from the engine DB; full accounting at close):

- **Tiered memory**: the build repo carries its own project tier — 8 session
  notes delivered by 9 sessions; project memory versions for the unown
  repo grew through 36 re-renders this round.
- **AutoDream + skill generation (the full lifecycle, live)**: a smoke
  session's `run:finished` fired `dream-check` (16:03:37 → 16:04:45), the
  dream minted `test-cadence-domain` (a real procedure distilled from real
  notes: how to verify the cadence domain), staged it under
  `.unown/skills-staged/`; the operator verified its claims exactly (62
  tests, 2343 expects — measured) and promoted it (the documented human
  gate). Notes → dream → mint → stage → verify → promote, every step
  receipted.
- **Task minting**: 2 engine-minted tasks during the round, both **discarded
  by the solvability gate** — the gate holding, as designed, against
  unsolvable mined patterns (an unmined task would burn a full agent run
  every cycle).
- **The harness's honest quiet**: every harness cycle this round answered
  `already-passing` — including against the round's own mined task
  (`swap-if-else-messages`, ported from a measured edit-bench failure,
passing 12/12 in the engine's full-tool sandbox). No improvement can ship
  from a passing suite; the memory-lift campaign
  ([RESULTS](../benchmarks/edit-bench/results/memory-lift-2026-10-28/RESULTS.md))
  supplies the measured counterpart: prompt-discipline rules buy −32%
task duration, not correctness.
- **Honest nulls kept**: the validation log carries F0/F1/F2 — two
caller-environment closures and one null experiment, all with receipts.
## The embedding adaptations

(to be filled at close — numbered, each naming file + mechanism + why)

## Where things live

(to be filled at close)
