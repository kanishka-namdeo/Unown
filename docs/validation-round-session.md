# The validation round — session record

> The Memory & Learning System Validation Programme, executed as a round:
> a cold-start, from-zero validation of Unown's five learning mechanisms on
> a fresh clone of this repository. The repo is the controlled environment;
> the engine DB starts empty; the tracked `.unown/memory/project.md` (v12,
> 79 rendered bullets at open) is the only learning that carries over. The
> round's question is the mission's question: does Unown genuinely become a
> more capable agent over time through the operation of its memory and
> learning systems — measurable, receipted, on live work?

- [What the round is](#what-the-round-is)
- [How the validation runs](#how-the-validation-runs)
- [The checkpoints](#the-checkpoints)
- [The learning-loop evidence](#the-learning-loop-evidence)
- [Where things live](#where-things-live)

Related: [the competitor research](validation-round-competitor-research.md) ·
[the evidence sweep](../benchmarks/research/2026-10-29/memory-validation-round.md) ·
[the benchmark lane](../benchmarks/validation-round/README.md) (method +
snapshots) · [the failure ledger](../benchmarks/validation-round/validation-log.md) ·
[the UX ledger](../benchmarks/validation-round/ux-ledger.md) ·
[the prior learning report](unown-learning-report.md) (the warm-install
validation this round complements)

## What the round is

The prior learning reports validated the five mechanisms on a warm,
long-lived install (the gallery-app rounds). This round is the complement:
**a fresh clone, a fresh engine DB, and the tracked memory as the only
continuity** — the deployment every new contributor or new machine actually
experiences. If the mechanisms work, the round should show: the engine
re-learning from zero (cycles, dreams, minting), the tracked memory paying
off immediately (recall probes answered from v12 content), consolidation
growing the memory further (dreams), and a measurably better second
exposure to a workflow (repeat tasks).

## How the validation runs

1. **Baseline** — after the engine's opening autonomous burst drains, the
   full learning state is snapshotted (`benchmarks/validation-round/`).
2. **The five mechanisms, one by one** — each mechanism exercised through
   its real trigger (real headless agent sessions for the terminal path;
   REST-driven cycles/dreams/mints for the engine path), each with its
   receipt cited in the reports.
3. **The UX ledger** — every real agent session logged with turns/tokens/
   wall-time/outcome/memory-used; interventions and clarifications counted
   (headless sessions start at zero by construction — any non-zero is a
   finding).
4. **Midpoint + final snapshots** — the growth trajectory.
5. **The reports** — the mission's four reports plus the public showcase
   refresh, then the release cut (v0.0.39).

## The checkpoints

Resumable: each checkpoint states what is done, what is verified, what is
next. A checkpoint is DONE only with measured numbers.

- [x] **CP0 — the round opens** (DONE). Clone + install + stack up
  (bun 1.4.4; bridge :3031 → Agnes upstream 200; engine :3030 ready,
  v0.0.38); typecheck green; unit suites green at baseline (landing 681,
  bridge 216, engine 4,867 pass / 0 fail). Competitor research + evidence
  sweep committed. Baseline snapshot receipted:
  `snapshots/baseline-20261028-202136.json` — 6 tasks (3 passing at
  capture), 3 autonomous cycles (`already-passing`), 2 autonomous dreams
  (engine project tier v1 → v3), 9 runs (9/9 passed), 9 notes; terminal
  memory v12, 79 bullets, 0 staged skills.
- [ ] **CP1 — tiered memory validation** (the recall probes + cold
  sessions; UX ledger rows V1..Vn).
- [ ] **CP2 — the self-improving harness validation** (a real cycle with
  mine→patch→ship on a failing task, or the honest already-passing record).
- [ ] **CP3 — task minting validation** (a mint from a real failure; suite
  expansion or the honest discard receipt).
- [ ] **CP4 — AutoDream + skill generation validation** (terminal-note
  dream; version bump; provenance; staged skill mint).
- [ ] **CP5 — the repeat-task improvement measurement** (cold vs warm
  same-shape tasks; the UX deltas).
- [ ] **CP6 — midpoint + final snapshots; the four reports; the showcase
  refresh**.
- [ ] **CP7 — the release cut** (v0.0.39; builds compile; artifacts;
  tag; CI green).

## The learning-loop evidence

(Filled as the round runs — every claim cites its receipt: a snapshot, a
ledger row, an API response, or a committed file.)

At open, the engine's own first minutes are already evidence: with zero
operator input, the router ran three harness cycles (all seed baselines
passing under `agnes-3.0-flash` — `already-passing`, no improvement mined)
and two AutoDream consolidations (3 notes each; engine project tier v1 →
v3; entries added 4+4, pruned 4+0) before the baseline snapshot drained.
That is the autonomy the mission wants visible: the loop runs because it is
scheduled, not because a user pressed a button.

## Where things live

- The benchmark lane: `benchmarks/validation-round/` (README — method;
  `snapshot.mjs` — the driver; `snapshots/*.json` — the receipts;
  `validation-log.md` — the failure ledger; `ux-ledger.md` — the per-session
  UX metrics)
- The research: `docs/validation-round-competitor-research.md` (curated) +
  `benchmarks/research/2026-10-29/memory-validation-round.md` (the full
  sourced sweep)
- The reports (CP6): `docs/learning-system-validation-report.md`,
  `docs/memory-effectiveness-report.md`,
  `docs/learning-progress-report.md`,
  `docs/end-user-experience-report.md`
- The release: `CHANGELOG.md` `[0.0.39]`, `content/blog/2026-10-29-the-validation-round.md`,
  the landing showcase band refresh, tag `v0.0.39`
