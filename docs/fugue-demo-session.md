# The Fugue demo session (the SOTA round)

> **Status: closed at the round's release** — the full record:  what the round built, the agent sessions that built it, what each stage's testing found, the numbered embedding patches, the learning-mechanism validation evidence (the five mechanisms exercised against the live engine), and the benchmark framework's baseline/midpoint/final numbers. The round's grounding research is [sota-round-competitor-research.md](sota-round-competitor-research.md).

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

Every phase ended in operator verification (build + suite + typecheck; E2E at
P4), and the round kept a failure→root-cause→fix→rerun ledger — the
validation log (F0–F3, all receipted):

- **F0** — the print-mode "hang": never a Unown defect (eight controlled
  runs, genealogy evidence: the process tree exits 6–31 s every time; the
  caller's harness waits on its own pipe). The unattended-caller contract
  became the round's operating procedure.
- **F1** — the memory-lift experiment: a null result kept honestly. Four
  editing-discipline rules (a simulated memory patch authored from the
  baseline's three measured structural-swap failures) did NOT lift the
  matched-model edit-bench headline — 103/106 both sides. What moved: the
  swap category healed one failure, a non-target remove-mutation flipped,
  and mean task duration fell 32% (16.8 s → 11.4 s, early-stop dominant) at
  +50% token overhead — the selfimprove round's "memory buys efficiency,
  not correctness," reproduced on a fresh axis.
- **F2** — background runners killed at tool-call teardown: caller
  environment (the host kills direct descendants even across setsid/nohup);
  the surviving pattern is the intermediate-exit spawn — captured in a
  reusable launcher and the operating procedure.
- **F3** — the embed contract dead in production, a three-layer root cause:
  the sync searchParams read (Next 15+/16 passes a Promise — the read
  silently returned undefined and the route prerendered embed:false),
  a zombie next-server serving a deleted build behind every false test, and
  Turbopack's static analysis needing force-dynamic for parity. Fixed with
  the bazaar/cadence/parley page shape, verified live: ?embed=1 serializes
  embed:true, no-query false, /fugue?embed=1 renders 200.
- The production review pass (5 sessions): 8 MUST-FIXes (a scrypt
  RangeError→500 on corrupt digests, store shape validation, read-path
  retention, an a11y status chip, a reload-free list re-key, a false config
  doc, cross-file test pollution, missing label pins) and 6 NOTEs with
  rationale — including a timing-side-channel analysis (N5) left documented.
- The E2E login "bug" was a spec locator defect (hasNot misuse), honestly
  root-caused as such — the AuthScreen was correct.

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

The numbered host-integration patches (the cadence checklist, adapted):

1. **Scoped layout + stylesheet** — `src/app/fugue/layout.tsx` is a
   pass-through (`.fugue-scope` wrapper, `globals.css` imported for
   /fugue routes only; the root layout owns html/body). Fugue ships
   light-by-default: no `dark` class, matching its clean-SaaS design.
2. **Server-read embed flag** — every page reads `?embed=1` server-side
   and passes it as an explicit prop (the bazaar/cadence/parley
   sync-outer + Suspense + async-inner shape + `force-dynamic`, per F3).
3. **Frame headers** — `next.config.ts` carries `frame-ancestors 'self'`
   + `X-Frame-Options: SAMEORIGIN` for `/fugue/:path*` (the block was
   committed by the parley round's CSP pass).
4. **The reset channel** — the landing's Reset button posts
   `{source:"unown-landing", type:"fugue-reset"}`; the Shell mounts the
   origin-checked listener only in embed mode (`useEmbedChannel`,
   gated — a real bug the pin caught) and POSTs the auth-gated
   `/fugue/api/reset` route, then re-fetches.
5. **Host test-env restoration** — `src/test-dom-setup.ts` captures and
   restores Node's Response/Request/Headers around happy-dom's
   registration (Set-Cookie/Cookie are filtered WHATWG headers in the
   shim; the api suites pin the real cookie flags). The fugue build
   repo's preload pioneered the same documented pattern.
6. **Cross-file hygiene** — the fugue component tests register their
   fetch routers and restore the NATIVE fetch in afterEach (a leaked
   router was measured poisoning the cadence suite in the shared bun
   process).
7. **Data-dir placement** — the JSON store resolves under the host's
   gitignored `data/fugue/` (same lane as the other demo apps).
8. **Gallery data + pins** — the fifth `LiveDemoApp` entry with its
   receipts; the live-demo tests pin route/reset/poster/receipt chips.
9. **Poster** — `scripts/landing_demo_poster.mjs` shot the production
   `/fugue/flows?embed=1` frame (2880×1800, IHDR-pinned by the tests).
10. **The showcase band** — the landing's eleventh section,
    "Built & Improved With Unown," carries the round's loop receipts and
    four PTY-lane Mission Control stills (see below).
11. **Coverage parity** — page/layout/reset-route/Stats tests to the
    80% changed-line bar (Shell 98%); every previously-failing row green.

## Where things live

- The app (embedded): `src/app/fugue/`, `src/lib/fugue/`,
  `src/components/fugue/` — app-as-built plus the embedding patches
  above. The build repo (verbatim source, agent receipts, phase
  commits): `/home/z/my-project/fugue-build` (8 commits, brief → review).
- The benchmark framework: `benchmarks/sota-round/` — the three metric
  groups, the baseline/midpoint/final snapshots, `report.mjs`'s trajectory,
  and the validation log (F0–F3).
- The memory-lift campaign:
  `benchmarks/edit-bench/results/memory-lift-2026-10-28/` (jsonl + summary +
  RESULTS.md; the env-gated `UNOWN_BENCH_MEMORY_LIFT` lane in
  `run-unown.mjs`).
- The three mission reports: `docs/unown-learning-report.md`,
  `docs/benchmark-improvement-report.md`,
  `docs/competitor-comparison-report.md` (shared across the round's
  parallel workstreams, receipts-first).
- The showcase band: `src/components/landing/built-improved.tsx` + its
  data file; the stills under `public/landing/tui/sota-round/stills/`
  with `.pane.txt` audits (captured live from the PTY lane against the
  running engine).
- The promoted skills: `.unown/skills/test-cadence-domain` (host repo) and
  `.unown/skills/{run-fugue-verification,verify-fugue-tests}` (the build
  repo) — dream-minted, claims operator-verified, promoted through the
  staged-skills human gate.
