# The Sonata round — §0.9 selection receipt + baseline battery

> **Verdict up front:** the Sonata track's project selection, executed per
> the A1 directive §0.9 AFTER recon + canaries and BEFORE any app ticket,
> with the scores pre-registered so post-hoc story-telling is impossible.
> **Selected: Fugue** — the engine-native automation console at
> `apps/fugue/`. The rejected alternatives (Legato, Tempo, a native desktop
> app, a multi-tenant gallery SaaS) and the predicted failure classes are
> on file below. Baseline battery receipted on the frozen tree `ae8a73d`
> (2026-11-07) before the first dispatch.
>
> **Parallel-engagement note (V-4)**: the Scherzo round (vehicle: Bolero,
> the browser/ops surface) landed its opening first — the ledger-arbiter
> law gives it the round; this track runs as the NON-OVERLAPPING parallel
> engagement (Fugue: the engine/learning-loop surface). The two vehicles
> are complementary halves of the weakness map; the non-overlap contract
> is receipted in [the round log](../../docs/sonata-round-session.md).

One-line purpose: name the round's vehicle, justify it against the weakness
map with scores, and freeze the baseline the round's improvement claims will
be measured against.

- Round: [the Sonata round log](../../docs/sonata-round-session.md) ·
  PRD: [fugue-prd.md](../../docs/fugue-prd.md) ·
  methodology parent: [benchmarks/README.md](../README.md)
- Selection law: the A1 directive §0.9 — weakness-driven, not
  comfort-driven; maximize Exposure × Generalizability × Value subject to
  Tractability ≥ 1 and Measurement = yes; anti-gaming in both directions.
- Human approval: the operator's standing instruction for this engagement
  ("do not stop for permission; keep going until done") is recorded here as
  the selection-gate approval, per the directive's own §0.9.4 note that
  approval exists to prevent retroactive story-telling — the pre-registration
  below is the anti-retroactivity instrument.

## The weakness map (input to selection; each entry sourced)

| # | Weakness | Evidence (dated) |
|---|---|---|
| W1 | `unown -p` exit-hang (#30): live capture still pending; correlates with engine churn; 3 receipted non-repro sets; the watcher is armed | [GT frontier D.1](../../A2_GROUND_TRUTH.md) · A2H-7 receipts, 2026-11-06 |
| W2 | **Learning-loop accumulation never exercised end-to-end on a real workload**: fresh DB = 0 runs/0 dreams each bring-up; task minting NEVER fired (no pattern repeated ≥2×); no skill PROMOTE this round; H-10's paired-null | [learning-system-validation-report](../../docs/learning-system-validation-report.md) "what was NOT validated" · [GT D.7/E.3/E.5](../../A2_GROUND_TRUTH.md) |
| W3 | Advisory budgets: a 165-turn single dispatch stayed green with the cap gate firing post-hoc (H-16 filed) | C-11 receipt, [rondo RESULTS](../rondo-round/RESULTS.md), 2026-11-06 |
| W4 | Manual spiral detection: the V-14 watch is operator-eyeball work (H-17 filed) | V-14 (C-2 fake-clock spiral) · A2H-14 cap continuations |
| W5 | Browser residual gaps: the #43 ref-readiness window + partial-application atomicity; H-10's hostile-variant question open | A2H-8 receipts + upstream issue comments, 2026-11-05 |
| W6 | Engine starvation under background load (#29): bridge lanes fixed in-repo but the issue stands; ~20 RPM free tier; batch-over-parallel discipline | [GT D.8](../../A2_GROUND_TRUTH.md) · bridge lanes receipt |
| W7 | Memory quality: 110-bullet render-cap pruning risk (H-14), dream-canary tool-drift (V-17b), reactive-not-proactive recall (#45 kin) | [GT D.7](../../A2_GROUND_TRUTH.md) · Vivace PRD W3/W4 |
| W8 | Long-horizon retention across weeks never validated (only the tracked memory's v12-carried history) | [learning report's gap list](../../docs/learning-system-validation-report.md) |

## The candidates (scored 0-2 per §0.9; pre-registered 2026-11-07)

| Candidate | Exposure | Tractability | Measurement | Generalizability | Value | E×G×V | Verdict |
|---|---|---|---|---|---|---|---|
| **A. Fugue** — the engine-native automation console: a self-hosted web app at `apps/fugue/` for authoring/observing scheduled agent jobs, built ON Unown's own engine (routines REST + `--mode json -p` runs + notes→dreams→memory loop), vanilla-TS PWA + an `EngineAdapter` seam | **2** (W2 the learning loop IS the runtime; W1 automation churn feeds the armed watcher; W3/W4 orchestration-heavy tickets; W6 background lanes under routine traffic; W7 memory of job outcomes) | **2** (consumes the LIVE-verified engine REST + routines CLI — no core edits; the `apps/` lane is proven four times over; the adapter seam is the Chaconne `PageAdapter` precedent) | **2** (pure schedule/domain units; fixture-server contract tests; a live-engine e2e lane; byte-stable export goldens) | **2** (engine-contract learnings transfer to every future automation ticket; the first app whose runtime exercises minting/consolidation on real workload) | **2** (self-hosted agent-ops category — n8n/Huginn/changedetection.io kin; for Unown users: the missing web mission-control) | **8** | **SELECTED** — max E×G×V at full tractability, and the ONLY candidate whose product surface is the round's #1 structural weakness (W2) |
| **B. Legato** — offline-first read-later / web-clip PWA (Vivace carry-over #2, pre-scored 2/2/2/2/2 there) | 2 (W5 hostile pages, W7 schema retention, W8 long-horizon) | 2 (proven lane; B-16 hostile fixture exists) | 2 | 2 (H-13 hostile-clip skill) | 2 | 8 | **PARKED — carry-over #2.** The tie with Fugue is broken by the anti-comfort-zone clause: Legato would be the FIFTH app of the same house pattern (Coda, Ostinato, Chaconne + parked Tempo), and its headline exposure (W5, hostile browser) overlaps the just-closed Rondo round's browser work — diminishing returns exactly where A2 is now strongest. Fugue opens a surface NO prior round has driven. Legato stays evidence-ready as the §0.9.5 fallback. |
| **C. Tempo** — keyboard-first offline time-tracking + invoicing PWA (Etude carry-over #1) | 1 | 2 | 2 | 1 | 2 | 2 | **PARKED** — the Rondo §0.9 ruling stands (the third-app-of-the-same-pattern comfort-zone rejection; no augmentation headroom) |
| **D. Native desktop app** (Tauri/Electron shell over an existing app) | 2 | **0** | 1 | 1 | 1 | — | **REJECTED per §0.9** (Tractability 0: this sandbox has no GUI/native toolchain — the same ruling as Rondo's; an environment gap, not a product judgment) |
| **E. Multi-tenant gallery SaaS** (nocturne/parley kin) | 1.5 | 2 | 2 | 1.5 | 1.5 | 3.4 | **REJECTED** — the rehearsed shape (Rondo's own scoring stands) |

## Predicted failure classes (pre-registered before F-0)

1. **Engine REST/schema drift mid-round** (upstream-change class — the engine
   ships ~4 releases/day; the adapter's typed contracts may drift under the
   app; the anti-rot law applies to our own dependency).
2. **Background/interactive lane contention + budget-governor throttles** on
   the live-loop tickets (infra class; #29/#30 kin — routine traffic through
   the bridge while interactive dispatches run).
3. **Memory/minting still not firing** despite the repeated-pattern runtime
   (the honest-null risk again — H-10's null is the precedent; a null here
   would itself be receipted as the W2 gap's depth).
4. **App-side long-horizon schema drift** (W7 kin — late tickets losing
   early-ticket schema facts to the render cap; H-14's revival is the
   designed counter).
5. **Advisory-budget blowouts on orchestration-heavy tickets** (H-16 kin —
   the F-5/F-10 shapes are exactly the C-11 shape).
6. **The #30 hang class during routine-driven churn** (the watcher is armed;
   a capture would be a FIND, not a failure of the round).

## Seed augment hypotheses (the round's PROPOSE backlog)

- **H-17 (carried, TAKEN BY THIS LANE)** — the conversation-pattern stuck
  detector; F-4's run-history surface is its data source and its first
  consumer. (The parallel Scherzo lane took H-16's build; H-17 is
  Sonata's, per the non-overlap contract.)
- **H-20 (new seed)** — the engine-contract skill: a skill encoding the
  engine REST contract + drift recovery + token discovery, authored
  operator-side AFTER the repeated usage pattern consolidates across F-2..F-6
  (and if the pattern genuinely repeats ≥2× in notes, the MINTING lane
  finally has its live candidate — W2's designed exercise). Renumbered
  from the first-draft H-18 after the Scherzo landing took that id for
  its cross-host contract-pin skill.
- **H-14 (revived)** — the schema-contract memory rule for Fugue's storage
  schema (the Vivace design, applied to this vehicle).

## The baseline battery (frozen tree `ae8a73d`, 2026-11-07)

| Lane | Result |
|---|---|
| install | **7/7** (`UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1`, bun 1.4.3) |
| doctor | `ok:true` — **21 pass / 1 warn** (lsp-servers) · V-38 pin receipted ("524,288 ctx / 4,096 out (you entered it)") |
| C1 smoke ×2 | `UNOWN_OK` · exit 0 · 1 turn · 1.66 s / 1.61 s |
| C3 engine | UP · v0.0.57 @ `ae8a73d` = HEAD · 9 router jobs · breaker closed |
| C4 code canary | fizzbuzz · 3 turns / 7.0 s · exactly 2 files · **4/4 tests** (operator-verified) |
| typecheck | **0 errors** |
| lint | **0 errors / 143 warnings** |
| unit (`bun run test:unit`) | **2366 pass / 0 fail / 174 files** (157.30 s) |
| check:docs | ok |
| check:changelog | 56 stops / 544 entries / 55 dated |
| check:blog | 46 posts / 116 tags |
| check:benchmarks | 6 tracks / 6 resolved |
| check:claims | 9 jobs engine-data · 62/62 page literals |
| ostinato e2e | **17/17** (10.0 s) |
| engine KPIs | **1 run / 0 dreams** at receipt time — the harness-cycle's seeded `fix-fizzbuzz` baseline (passed, 4 turns, bwrap); the loop live from minute one |

Every number identical to the Rondo close (the tree is the Rondo close tree
plus docs) — the baseline is a CONTINUATION baseline, which is exactly what
makes the round's improvement claims attributable to the round's own work.

## Tuning vs holdout (pre-declared)

- **Tuning**: the F-tickets' own lanes (Lane A/B, fugue e2e, goldens) — their
  failures feed briefs and augment candidates freely.
- **Holdout** (never tuned against): (a) the standing battery lanes above,
  re-run at every teardown; (b) frozen re-run tasks minted from this round's
  genuine-gap failures (§5 reflex, new dirs never overwriting); (c) the
  carried B-15/B-16 frozen fixtures; (d) the PTY lane fleet (fresh-session
  ritual when a PTY surface is touched).
- Fairness laws: verifier fixes regrade into new dirs; retries get new ids;
  single-run claims stay single-run labelled; the 2–6 pp noise band —
  multi-trial for any ≤3 pp claim; K ≥ 3 for load/browser-sensitive claims.

## Related pages

- [The Sonata round log](../../docs/sonata-round-session.md) · [the Fugue PRD](../../docs/fugue-prd.md)
- [The Rondo round's receipt](../rondo-round/README.md) — the prior §0.9
- [The validation log](validation-log.md) — the round's V-ledger
