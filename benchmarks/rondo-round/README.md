# The Rondo round — benchmark suite

One-line purpose: the baseline benchmark suite, the calibration canaries
and the §0.9 selection receipt for the Rondo round (the 2026-11-06 A1
engagement, DRIVE × AUGMENT × PROVE IT) — what is measured, how the
baseline was captured, where the receipts live.

- Opened: 2026-11-06 (the eighteenth lineage's Phase 0)
- Round log: [docs/rondo-round-session.md](../../docs/rondo-round-session.md)
- Methodology parent: [../README.md](../README.md) (pin everything ·
  anti-tamper · pair accuracy with cost · receipts committed, never
  regenerated)

## What this round measures

The engagement's cargo is proof that driving A2 improved, so the baseline
is the gate surface itself, receipted on a fresh lineage before any
ticket — plus the §0.9 selection receipt (the anti-retroactivity
artefact) and the pre-registered failure classes the selected vehicle is
predicted to harvest.

| Baseline lane | Receipt (2026-11-06, tree `18e4a98a`, bun 1.4.3) |
|---|---|
| Install | 7/7 steps green (`UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1`) |
| Bridge health | `:3031` ok, upstream 200, 6 agnes models, default `agnes-3.0-flash`, lanes 3/2/45 s |
| Engine health | `:3030` ready, v0.0.56 @ `18e4a98a` = checkout HEAD, 9 router jobs scheduled, breaker closed, fresh DB (the recycle limit) |
| Doctor | "ready to chat", 19 ✓ / 2 ⚠ (model-spec self-heal + LSP — the honest pair) |
| C1 smoke ×2 | `UNOWN_OK`, exit 0, 2 s / 4 s (stdin guarded — the V-1 cure) |
| C2 doctor gate | "ready to chat", exit 0 |
| C3 engine lane | UP, SHA = HEAD, 9 jobs, breaker closed |
| C4 code canary | fresh-dir fizzbuzz + bun:test task: exit 0 in 13 s, subtype success, exactly 2 files, 4/4 tests — operator-verified independently |
| Typecheck | 0 errors |
| Lint | 0 errors / 143 warnings |
| Unit | 2258 tests / 161 files: 2257 pass / 1 fail — the fail root-caused in [the validation log](validation-log.md) |
| check:docs | ok once the round's own pages landed (the mid-battery race is V-3) |
| check:changelog | 55 stops / 540 entries / 54 dated |
| check:blog | 46 posts / 116 tags |
| check:benchmarks | 6 tracks / 6 resolved |
| check:claims | 9 jobs · 62/62 literals |
| ostinato e2e battery | 17/17 (9.6 s) |

## The §0.9 selection receipt (pre-registered)

The directive's selection procedure — candidates generated from the
weakness map (live open issues #29/#30/#43/#44/#45/#46 + the prior rounds'
validation logs), scored 0–2 per axis BEFORE any app ticket, human
approval recorded in [the round log](../../docs/rondo-round-session.md).

| Candidate | Exposure | Tractability | Measurement | Generalizability | Value | Ruling |
|---|---|---|---|---|---|---|
| **Chaconne** — browser-recipe runner (`apps/chaconne/`) | 2 (browser-flow defect classes #43/#44 as the product; service lifecycle #30-kin; 12-ticket long-horizon; concurrency) | 1 (all in-house patterns: zero-dep UI law + root playwright; no core rewrite) | 2 (fixture-page determinism, artifact sha256 pins, e2e battery) | 2 (browser-resilience learnings transfer to every future browser ticket; the seed backlog's browser bundle) | 2 (proven self-hosted category: n8n, Browserbase, Huginn) | **SELECTED** — 2×2×2 = 8 |
| Tempo — time-tracking + invoicing PWA (the parked Etude proposal) | 1 (third house-pattern PWA; money-math + crash-safety only) | 2 | 2 | 1 (one-off pattern reuse) | 2 | Parked — comfort-zone, no augmentation headroom (the §0.9 anti-gaming rejection): 1×1×2 = 2 |
| Third gallery-shaped multi-tenant SaaS (nocturne/parley kin) | 1.5 (long-horizon yes; browser no; rehearsed shape) | 2 | 2 | 1.5 | 1.5 | Rejected — rehearsed shape: 3.4 |
| Native desktop app (Tauri/Electron shell) | 2 | 0 (no toolchain in the target environment; effectively a core-adjacent rewrite) | 1 | 1 | 1 | Rejected per §0.9 (Tractability 0 → environment gap, not a vehicle) |

**Predicted failure classes (pre-registered before C-0)**:

1. fill/iframe flakes in the runner's browser lanes (#43 kin);
2. screenshot artifact handling (extensions, paths, hashes — #44 kin);
3. long-horizon chunk degradation on the UI tickets (the 570 KB
   context lesson);
4. runner-service lifecycle (start/stop/crash-adjacent — #30 kin);
5. proactive-memory gaps across C-tickets (#45 kin — does A2 reuse
   prior-ticket learnings unprompted?).

Each prediction gets reconciled at the round's teardown — no
retroactive story-telling.

**The reconciliation (2026-11-06, the round closeout — the
twenty-fifth lineage, at the DRIVE-complete tree)**:

1. **fill/iframe flakes — HIT (the e2e variant)**: the browser-lane
   flake class fired as C-8's filechooser race (12-13/14 cold
   cross-runs; the DOM-condition-waits + bounded-retry cure), and the
   #43 kin was probed directly (A2H-8: not reproducible on v0.0.56,
   the residual ref-readiness window receipted, feeding C-2's
   verify-value-landed design).
2. **screenshot/artifact handling — DIRECT HIT (the round's genuine
   find)**: the artifact-name grammar became the round's deepest seam —
   V-30 (the PWA grammar vs the runner's dotted ext) → A2H-13 (the
   rename ruling) → **V-41 (the landing's latent call-site defect,
   caught only by the real-runner capture lane) → A2H-14** (the fix +
   the cross-host round-trip pin). Extensions, paths, and hashes — all
   three, exactly as predicted.
3. **long-horizon chunk degradation — MISS (the discipline prevented
   it)**: the fresh-session-per-ticket + capped-continuation economics
   held; no context degradation shaped any failure. The closest call —
   C-11's 165-turn single dispatch — stayed in-scope and green, but
   its spend shape receipted the turn-budget-hook candidate (the
   mitigation that would catch the NEXT degradation attempt mid-run).
4. **runner-service lifecycle — PARTIAL (the adjacent class fired
   operator-side)**: the #30 product hang never reproduced (the armed
   watcher's three receipt sets: both lanes ×8 across three lineages,
   zero hangs); the #30-adjacent event was V-1 (the operator
   harness's stdin confound — a different class, receipted as such).
5. **proactive-memory gaps — PARTIAL-HIT**: the engine's loop ran
   live across the round (the twenty-fifth's lane alone: 19 runs /
   13 dreams, the memory carrying the fix facts across tickets, B-18
   rendered clean); the C-11 capture-refresh consuming the V-41
   proof design is the learnings riding in practice. The clean
   unprompted-reuse measurement stays the §6c closeout's.

**The unpredicted classes that fired** (the honest ledger): the
provider capability flip (V-38 — an environment class outside the
vehicle's surface), its output-side ceiling (V-40), and the
concurrent-lineage churn (V-42 — the round's ninth event, a known
engagement-shape class, not vehicle-specific). All three converted
into standing laws (the spec-pin pre-seed, the split-write law, the
window-is-the-floor ruling).

## Holdout discipline (the fairness laws)

Tuning vs holdout, split up front: the C-tickets are TUNING surfaces
(their failures feed briefs and augmentation candidates freely); the
HOLDOUT is (a) the frozen re-run tasks minted from this round's
genuine-gap failures (§5 reflex), (b) the standing PTY lanes + battery
re-run at every teardown, and (c) the etude-round lane set, which stays
frozen as an independent regression surface. Verifier fixes regrade into
new dirs; retries get new ids; single-run claims stay single-run
labelled (the 2–6 pp noise band respected — multi-trial for any ≤3 pp
claim).

## Learning-layer baseline

Before the first C-ticket, the standing learning surfaces' receipts:
engine KPIs at 0 runs / 0 dreams (fresh DB — the recycle limit; the
accumulation baseline is therefore ZERO by construction this lineage),
`benchmarks/memory-eval/ops-accuracy` opsF1 0.992 and the quality-axes
4/4 PASS standing from the memory round (linked, not restated). The
round's own memory accumulation (`.unown/memory/project.md` growth,
dream count, skill candidates) is receipted per-ticket in the round log
— the §6c plan.

## RESULTS.md

Honest nulls until the round's tickets land receipts; the file carries
the baseline table above plus the before/after pairs as they accrue.
