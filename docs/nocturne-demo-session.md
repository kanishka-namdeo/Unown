# The Nocturne demo session (the nocturne round)

> **Status: closed at v0.0.41** — the Evolution Programme's seventh gallery
> app: **Nocturne, an AI-native incident operations platform**, built
> end-to-end by Unown as the proving ground for the mission's
> memory/learning validation. The aria round (the CRM, gallery app #6)
> opened the v0.0.41 window on the second cold-start machine; this round
> landed in the same window (2026-10-29): the incident-ops platform is the
> live work, the five learning mechanisms ran against it, and the round's
> receipts live in
> [`benchmarks/nocturne-round/`](../benchmarks/nocturne-round/).

- [What the app is](#what-the-app-is)
- [How it is built](#how-it-is-built)
- [The five mechanisms, receipted](#the-five-mechanisms-receipted)
- [The failure ledger](#the-failure-ledger)
- [The checkpoints](#the-checkpoints)
- [Where things live](#where-things-live)

Related pages: [the aria demo session](aria-demo-session.md) (the previous
gallery round) · [the fugue demo session](fugue-demo-session.md) ·
[the learning report](unown-learning-report.md) ·
[the memory docs](memory.md)

## What the app is

Nocturne — a **multi-tenant, deterministic incident operations platform**
(the PagerDuty domain, demo scope): alert ingestion with dedup keys and
windows, correlation into incidents, services with severity rules and
tiered escalation policies (who gets paged, in what order, on what
timers); weekly on-call rotations with handoffs and latest-wins overrides;
the incident lifecycle (triggered → acknowledged → resolved, plus snooze)
with ack/resolve SLA timers, breach detection and at-risk bands;
event-sourced incident timelines; per-service runbooks with checklists; a
**public per-tenant status page** (component statuses + active incidents);
postmortems with action items on resolved incidents; and analytics — MTTA
/ MTTR, incident counts by severity and service, breach rate, on-call
load. The deterministic AI-native layer is the triage lane: dedup,
correlation, escalation and SLA engines are all clock-injected and
seeded over ~9 weeks of incident history so every analytic shape is real.

## How it is built

Exactly the gallery convention: a 52,587-char numbered build contract
written by the agent from its own read-only exploration of the six sibling
apps ([the plan](../benchmarks/nocturne-round/plan.md)), then executed in
phases — **Lib** (21 domain modules + invariant suite) → **API** (~50
routes with the 401/403/404/402/400 ladder) → **UI** (13 components +
provider + public status page) → **Embed** (CSP, favicon, gallery entry
#7, live-captured poster) → **Verify** (the 10-step live Chromium pass).
Every build session was a real headless `bin/unown -p` run through the
detached launcher, capped at 40 turns, resumed on cap, one commit per
phase, operator QA between phases, **zero human edits to app code** (the
operator's three interventions were process-level: a fed diagnosis for
F9, a resetType catch for the embed, and the workspace-reset recovery).

The full per-session evidence — turns, tokens, wall time, interventions,
outcomes per session — is the round's
[UX ledger](../benchmarks/nocturne-round/ux-ledger.md) (N1–N28).

## The five mechanisms, receipted

| Mechanism | The round's receipt |
|---|---|
| Tiered memory | The tracked project memory carried the sibling patterns into every session (every ledger row marked "memory used: yes"); it grew v4 → v6 → v2-render (73 → 86 → 104 → 89-deduped bullets) across the round — [snapshots](../benchmarks/nocturne-round/snapshots/) |
| Self-improving harness | 16+ harness cycles and 46+ sandbox runs across the round (9/9 passed post-reset); the seed-invariant catch (P8.1) and the regression pins (F9/F12/F13) are the shipped defense |
| Task minting | The solvability gate and mint caps held; the F9 candidate lesson ("ids come from the bumping allocator") is the mint-shaped lesson of the round |
| AutoDream | 20+ dreams consolidated the build notes into project memory live — including the escalation-invariant lesson mid-build, which the very next session used |
| Skill generation | `fix-nocturne-seed-invariants` — minted from the build's own failure, operator-promoted through the staged-skills human gate, and *used* by the later fix sessions |

## The failure ledger

The round's [validation log](../benchmarks/nocturne-round/validation-log.md)
records the full chain for every failure: **F8** (the operator's blocking
shell timeout killed a live session — the launcher contract was rebuilt),
**F9** (a session-id collision P0 in `loginSession` — the API test lane
surfaced it, the agent misdiagnosed it twice, the operator traced it, the
fed diagnosis fixed it in 14 turns, regression-pinned), **F10** (the
landing phase shipped a page/route conflict that broke the production
build — caught post-push, fixed, build gate added), **F11** (four lint
errors shipped — lint added to the closeout), **F12** (the provider/API
detail-shape mismatch — the live browser pass caught what 31 component
tests papered over; provider-shape pins added), **F13** (the
unauthenticated session probe's 401 console noise — solved by porting
aria's `hasSession` pattern). Plus one environment event: the workspace
reset mid-round, recovered entirely from the push-per-milestone
discipline (the un-pushed work was rebuilt; nothing pushed was lost).

## The checkpoints

- **CP0 (baseline)** — the round opened with the engine snapshot
  ([baseline](../benchmarks/nocturne-round/snapshots/nocturne-baseline-20261029-093457.json)):
  6/6 seed tasks passing, 0 cycles, 0 dreams, terminal memory v4 (73
  bullets) — the retained learning of all six prior gallery rounds.
- **CP1 (plan + lib)** — the 52,587-char contract; the domain layer
  green at 360/360; memory v6 (86 bullets); 13 dreams; the
  escalation-invariant catch; the first minted skill.
- **CP2 (API + UI)** — ~50 routes + 78 API tests (the F9 P0 found,
  fixed, pinned); the UI at 28/28 and the full repo at 1909; memory at
  104 bullets; 37 engine runs.
- **CP3 (embed + verify)** — the live-captured poster, gallery entry #7,
  the 10-step Chromium pass at **10/10 twice consecutively with zero
  console errors**; the full repo at 1916 tests, typecheck + lint +
  build clean; the final
  [snapshot](../benchmarks/nocturne-round/snapshots/nocturne-final-20261029-153828.json).
- **CP4 (release)** — the round cuts at v0.0.41 with the aria round.

## Where things live

- `src/lib/nocturne/` — the pure domain layer (21 modules + tests; the
  dedup/correlate/escalation/rotation/sla engines; the deterministic seed)
- `src/app/nocturne/` — the routes + ~50 API route handlers + the public
  status page
- `src/components/nocturne/` — the provider, shell, 11 screens, the error
  boundary, the component + invariant tests
- `benchmarks/nocturne-round/` — the plan, the UX ledger, the validation
  log, the session envelopes, the snapshots, the 10-step `ui-pass.mjs`
- `public/nocturne/` + `public/landing/nocturne/` — the favicon and the
  live-captured poster
