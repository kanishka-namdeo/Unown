# The Aria demo session (the aria round)

> **Status: open** — the Evolution Programme's sixth gallery app: **Aria, an
> Enterprise CRM**, built end-to-end by Unown as the proving ground for the
> mission's memory/learning validation. The validation round closed at
> v0.0.40 with its four reports; this round carries the programme's next
> leg on the second cold-start machine (2026-10-29): the CRM is the live
> work, the five learning mechanisms run against it, and the round cuts at
> v0.0.41. The grounding research is
> [aria-round-competitor-research.md](aria-round-competitor-research.md).

- [What the app is](#what-the-app-is)
- [The naming receipt](#the-naming-receipt)
- [How it is built](#how-it-is-built)
- [The checkpoints](#the-checkpoints)
- [Where things live](#where-things-live)

Related pages: [the competitor research](aria-round-competitor-research.md) ·
[the validation round session](validation-round-session.md) (closed at
v0.0.40; this machine's receipts live in
[its postscript](validation-round-session.md#postscript--the-second-machine-cross-install-retention-2026-10-29)) ·
[the fugue demo session](fugue-demo-session.md) (the previous gallery round) ·
[the parley demo session](parley-demo-session.md) (the gallery app whose
tenancy/RBAC patterns Aria inherits).

## What the app is

Aria — a **multi-tenant, pipeline-first Enterprise CRM**: accounts, contacts
and leads with the classic conversion path; multiple weighted pipelines with
stages, probabilities and lost-reason discipline; forecast categories on the
commit ladder (Pipeline / Best Case / Commit / Omitted / Closed) with rep →
team → tenant rollups, quotas and pipeline-coverage ratios; an append-only
activity timeline per record; tasks with data-driven SLA policies and
at-risk bands; sequences — a deterministic cadence engine (email/wait/task/
branch steps, enrollment state machines, engagement events, reply-exits);
reporting with weighted pipeline, stuck and slipped deals, stage conversion,
sales cycle and cohort views, plus metric drill-down ("open the number");
CSV import with dry-run validation; and a **deterministic AI-triage layer**
(lead scores with explainability lists, deal-health grades with named
signals, next-best-action cards, pipeline anomaly flags) — rules and
statistics over tenant data, never an external paid service.

The mechanics follow the gallery's established patterns: the repo's
file-backed JSON store with atomic writes and structural reseed
(the [Fugue](fugue-demo-session.md) lane), fail-closed multi-tenancy with
scrypt/session auth and a data-driven RBAC matrix plus a CRM-specific
ownership/visibility layer (the [Parley](parley-demo-session.md) lane),
immutable audit events, two seeded tenants on different plans, and pure,
explicit-`now` domain math so every dashboard number is a testable function.
The CRM's phase-gates adopt the round research's transfer list where it
bites: per-session cost budgets, property-based invariants before phase
ships (deal-stage transitions monotonic; contacts unique by email; totals
recomputable from events), and a cold-start acceptance run in a fresh
sandbox with zero memory.

## The naming receipt

The gallery names apps after musical terms (Focus, Bazaar, Cadence, Parley,
Fugue). **Aria is kept** after the Fugue-precedent collision check — the
queries, the in-category absences (no CRM, no sales product, no coding agent
owns the name), the adjacent-space collisions recorded honestly (WAI-ARIA /
React Aria / aria2 discoverability noise; the Rhymes AI "Aria" model), and
the ranked clean alternatives (Arietta, Arioso, Toccata) live in
[the research's naming section](aria-round-competitor-research.md#naming-diligence--aria).
An aria is the solo voice of the opera — the sixth app carries the gallery's
convention, now validated the way Fugue's rename made mandatory.

## How it is built

Written end-to-end by `unown`, driven headless against the Agnes AI upstream
through the bundled llm-bridge, **in this repository** (the Parley lane —
the app is live on the landing the moment it lands). Operating procedure per
the Parley round's F0/F2 launcher contract: build sessions run backgrounded
through an intermediate-exit launcher (stdin `/dev/null`, file-redirected
stdio, the JSON envelope polled from the log), bounded with `--max-turns`,
resumed rather than re-prompted, one commit per phase, operator QA (build +
tests + typecheck) between phases — **zero human edits to the app's code**.
The plan phase runs in `--plan` mode first and its numbered output is the
build's contract.

| Phase | Sessions | Result | Commit |
|---|---|---|---|
| Plan | 2 (40-turn exploration capped → 1-turn resume) | 40,292-char numbered build contract: data model (every field), 16 modules, ~50 routes with the auth ladder, the deterministic sequence-engine design, the 330-380-test plan, phases with acceptance criteria, 13 risks with mitigations, the embed contract — [`plan.md`](../benchmarks/aria-round/plan.md) | — |
| Lib/domain | 6 sessions (5 capped resumes → 1 clean finish) | 16 modules + 18 test files, 7,146 LOC — **315 tests green** (2,520 expects), typecheck clean, full-repo suite 1,201 pass / 0 fail, zero files outside `src/lib/aria/` | (this round's next commits) |
| API | 7 sessions (6 capped resumes → 1 clean finish; one fresh-session restart after the mega-session's context drag passed 900K input/40 turns) | ~50 routes across 10 groups with the 401/403/404/402/400 ladder, `aria-store` accessor, layout/page/globals stubs, 14 test files — **210 tests green** (1,077 expects), typecheck + lint clean, lib fixes receipted (the plan's `invites` array, the owner-carve-out refinement) | (this round's next commits) |
| UI | (pending) | dashboard, kanban, record timelines, sequences, triage inbox, admin | — |
| E2E + review + drill | (pending) | Playwright e2e, reviewer passes, P0 pins, cold-start acceptance | — |
| Landing embed | (pending) | gallery entry #6, embed contract patches, poster, copy, test pins | — |

Every session's turns/tokens/wall-time/outcome lands in the round's
[UX ledger](../benchmarks/aria-round/ux-ledger.md); every failure lands in
the [validation log](../benchmarks/aria-round/validation-log.md) with the
failure→benchmark→improvement→rerun chain; learning-state snapshots
(baseline / midpoint / final) are receipted under
[the round's lane](../benchmarks/aria-round/README.md).

## The checkpoints

Resumable: each checkpoint states what is done, what is verified, what is
next. A checkpoint is DONE only with measured numbers.

- [x] **CP0 — the round opens** (DONE). Research sweep committed
  ([aria-round-competitor-research.md](aria-round-competitor-research.md):
  16 systems, the top-8 adopt list, the still-ahead ledger, the Aria naming
  receipt). Machine-2 cold start verified: install green (bun 1.4.4,
  hydration + `build:offline`), stack up (bridge `:3031` → Agnes 200,
  engine `:3030` ready, `unown doctor` green — one optional ⚠ LSP), first
  headless sessions answered (probe end-to-end ~6 s when the bridge is
  idle; the 45.6 s background-yield receipt under the engine's autonomous
  burst is recorded in
  [the validation round's machine-2 postscript](validation-round-session.md#postscript--the-second-machine-cross-install-retention-2026-10-29)).
  Learning state at open receipted by the engine snapshot
  `../benchmarks/validation-round/snapshots/baseline-20261028-224309.json`
  — 6 tasks (2 run, 2/2 passed in bwrap sandboxes), 2 cycles
  (`already-passing`), 2 dreams, 7 notes, 0 improvements, 0 skills,
  terminal memory v2 (72 bullets, the F1/F2-corrected tracked file).
- [x] **CP1 — the plan** (DONE — receipt
  [`plan.md`](../benchmarks/aria-round/plan.md)): a 2-session `--plan` run — 40
  turns of read-only exploration (81 tool calls over parley/fugue/cadence/
  the session docs/AGENTS.md), capped and resumed per the gallery
  convention, then one 12,370-token turn producing the 40,292-char numbered
  contract: the complete data model, 16 `src/lib/aria/` modules, ~50 routes
  with the 401/403/404/402/400 ladder, the deterministic sequence-engine
  design, the ~330-380-test plan with the PBT-invariant lane, the phase
  decomposition with acceptance criteria, 13 risks with mitigations, and the
  embed-contract requirements. UX rows A1–A2
  ([the ledger](../benchmarks/aria-round/ux-ledger.md)); operator review
  passed with one note — the plan's gallery-entry receipt numbers are
  placeholders until CP6's counted receipts replace them.
- [x] **CP2 — lib/domain phase** (DONE — operator-verified): all 16 modules
  + 18 test files; `bun test src/lib/aria` **315 pass / 0 fail** (2,520
  expects — above the plan's 200-240 target), `bun run typecheck` clean, the
  full repo suite 1,201 pass / 0 fail with nothing outside `src/lib/aria/`.
  The PBT-invariant lane pins the four contract invariants on the seed's
  real data; the store's atomic-rename/reseed and the engine's
  terminals-are-final contracts operator-spot-checked. UX rows A3–A8
  ([the ledger](../benchmarks/aria-round/ux-ledger.md)).
- [x] **CP3 — API phase** (DONE — operator-verified): all ~50 routes per
  the plan's route map — auth/tenants/members/invites, accounts/contacts
  (the 409 email-uniqueness gate), leads with the atomic conversion,
  pipelines/deals (lost-reason gate, closed-deal-never-reopen), activities/
  tasks, notes/tags, sequences/enrollments/mailbox, the 9 report routes +
  drill-down, the 3 triage routes, import (CSV dry-run), audit, demo-reset,
  forecast snapshots (immutable) — plus the 14-file API suite:
  `bun test src/app/aria` **210 pass / 0 fail**, typecheck clean, `bun test
  src/lib/aria` still 315 green. The adversarial suite carries the parley
  27-probe pattern; the tenancy suite pins cross-tenant 404-never-403 on
  every entity route. Seven lib files gained plan-compliance fixes on the
  way (the `invites` state array, the owner-seat carve-out refinement,
  visibility additions) — receipted in the diff. UX rows A9–A15
  ([the ledger](../benchmarks/aria-round/ux-ledger.md)).
- [ ] **CP4 — UI phase** (dashboard/kanban/timelines/sequences/triage/
  admin; component suite green).
- [ ] **CP5 — e2e + adversarial review + cold-start drill** (Playwright
  e2e; reviewer subagent passes; P0 pins; a fresh-sandbox, zero-memory
  agent stands the app up from the repo alone).
- [ ] **CP6 — landing embedding** (gallery entry #6 with the sources
  comment and receipts; embed contract patches — `?embed=1`,
  `aria-reset` handshake, CSP `frame-ancestors` for `/aria/:path*`;
  poster; "Six apps, live." copy; test pins bumped).
- [ ] **CP7 — the learning-loop evidence** (midpoint + final snapshots;
  UX ledger rows; validation-log entries with the
  failure→benchmark→improvement→rerun chain; any minted skills staged).
- [ ] **CP8 — the release cut** (v0.0.41 — the validation round took
  v0.0.40 with its four reports and the showcase refresh; the aria round
  carries the gallery entry, its own learning evidence, and any
  engine/landing changes it produces, in the same CHANGELOG section).

## Where things live

- The app (as the phases land): `src/lib/aria/` (domain), `src/app/aria/`
  (routes + API handlers), `src/components/aria/` (UI)
- The receipt lane: `benchmarks/aria-round/` —
  [README](../benchmarks/aria-round/README.md) (method),
  `snapshots/` (learning-state receipts),
  [validation-log](../benchmarks/aria-round/validation-log.md) (the F8+
  failure ledger), [UX ledger](../benchmarks/aria-round/ux-ledger.md)
  (per-session rows A1, A2, …)
- The research: [aria-round-competitor-research.md](aria-round-competitor-research.md)
- The build receipts: `.unown/receipts/` (session envelopes, per the
  gallery convention — gitignored, counted in the gallery entry)
- The validation round running alongside:
  [its session record](validation-round-session.md) and
  [its lane](../benchmarks/validation-round/README.md)
