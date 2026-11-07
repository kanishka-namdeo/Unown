# The Serenade round — §0.9 selection receipt + baseline battery

> **Verdict up front:** this track's project selection, executed per the
> A1 directive §0.9 AFTER recon + canaries and BEFORE any app ticket,
> with the scores pre-registered so post-hoc story-telling is impossible.
> **Selected: Legato** — the offline-first read-later / web-clip PWA at
> `apps/legato/`, the Vivace round's §0.9.5 pre-registered fallback
> (pre-scored 2/2/2/2/2 there, PRD already on file). The rejected
> alternatives (a Tauri desktop shell, a memory-app sibling, absorbing
> the teardown duties as the whole round, a gallery SaaS re-pitch) and
> the predicted failure classes are on file below. Baseline battery
> receipted on the frozen tree `6e3579bb` (2026-11-07) before the first
> dispatch.

One-line purpose: name the round's vehicle, justify it against the
weakness map with scores, and freeze the baseline the round's
improvement claims will be measured against.

- Round: [the Serenade round log](../../docs/serenade-round-session.md) ·
  PRD: [the Legato PRD](../../docs/vivace-prd.md) (pre-registered by the
  Vivace lineage; adopted unchanged by this round — the §0.9.5 fallback
  law) · methodology parent: [benchmarks/README.md](../README.md)
- Selection law: the A1 directive §0.9 — weakness-driven, not
  comfort-driven; maximize Exposure × Generalizability × Value subject
  to Tractability ≥ 1 and Measurement = yes; anti-gaming in both
  directions.
- Human approval: the operator's standing instruction for this
  engagement ("resume, don't stop until done") is recorded here as the
  selection-gate approval, per the directive's own §0.9.4 note that
  approval exists to prevent retroactive story-telling — the
  pre-registration below is the anti-retroactivity instrument.

## The recon this selection stands on (all live-verified 2026-11-07)

- Tree `6e3579bb` (fast-forwarded over the Sonata round-close trio
  `4fa89232`→`6e3579bb`; the stale-clone landing 2-fail was the F-10
  ripple, cured upstream before this lineage's first dispatch).
- Bring-up one-pass on a fresh clone: bun 1.4.3 (the container's 1.3.14
  cannot parse the 1.4 lockfile — the toolchain-restore lane applies),
  root + pi-repo frozen installs, `hydrate:model-data`, full
  `build:offline` chain, stack up (bridge upstream **200**, 6 agnes
  models live; engine ready, 9 router jobs), doctor "ready to chat".
- Canaries on the frozen vivace rig: **C1 PASS · C2 PASS · C3 the known
  V-3 schema class** (content correct, exit 3 — the standing measured
  target) · **C4 PASS through the real dispatch harness** (2 dispatches
  / 10+7 turns: the capped chunk fed `a1-continue.py`, the continuation
  landed DONE, operator-verified artifacts).
- Unit battery at `6e3579bb`: **2654/0/208** (17638 expects) — matches
  the Sonata round-close receipt exactly. Typecheck 0.
- The V-38 pin re-applied to the fresh home (3 fields → 4096) before
  any dispatch; the V-1 stdin law re-learned the honest way (one manual
  `-p` run with an inherited pipe never exited — the rig's
  `< /dev/null` is load-bearing, not decorative).

## The weakness map (input to selection; each entry sourced)

| # | Weakness | Evidence (dated) |
|---|---|---|
| W1 | `unown -p` exit-hang (#30): the /proc-level capture still pending; correlates with the first-run window and engine churn; survived 31 lineages as the frontier item | [GT §7.1](../../A2_GROUND_TRUTH.md) · re-hit by this lineage's manual first run (inherited pipe; V-1 law) 2026-11-07 |
| W2 | Learning-loop accumulation: NOW has live evidence from the Fugue runtime (43+ runs, 30+ dreams, 4 staged candidates) but the validation-report refresh + the honest W2 verdict are a standing teardown duty | [sonata round-close](../../docs/sonata-round-session.md) 2026-11-07 |
| W3 | Advisory budgets: a 165-turn dispatch stayed green with the cap gate firing post-hoc (H-16 filed, unresolved) | C-11 receipt, [rondo RESULTS](../rondo-round/RESULTS.md) |
| W4 | Manual spiral detection: the V-14 watch is operator-eyeball work (H-17 filed, unresolved) | V-14 receipts, Vivace/Rondo |
| W5 | Browser residual gaps: hostile-page clipping NEVER driven as a product surface (the browser lane's #43 window + partial-application atomicity; the hostile-clip fixture B-16 was drafted for exactly this and never consumed) | [GT §7.5](../../A2_GROUND_TRUTH.md) · vivace-prd hardening map |
| W6 | Engine starvation under background load (#29) + metered upstream (~20 RPM): batch-over-parallel discipline still manual | [GT §7.2/§7.6](../../A2_GROUND_TRUTH.md) |
| W7 | Memory quality: 110-bullet render-cap pruning risk, reactive-not-proactive recall; a 12-ticket evolving-schema build is the retention test that was never run | [GT §7.7](../../A2_GROUND_TRUTH.md) |
| W8 | Long-horizon retention across weeks never validated (read-later is inherently a weeks-scale product surface) | [learning report's gap list](../../docs/learning-system-validation-report.md) |
| W9 | Gate discipline: the F-10 landing ripple class (a landing band landed without the composition-root test) — the "close battery always runs full test:unit" law is 3 commits old and unproven under a NEW round's pressure | 4fa89232 receipt, 2026-11-07 |

## The candidates (scored 0-2 per §0.9; pre-registered 2026-11-07)

| Candidate | Exposure | Tractability | Measurement | Generalizability | Value | E×G×V | Verdict |
|---|---|---|---|---|---|---|---|
| **A. Legato** — offline-first read-later / web-clip PWA (clip URLs → readable text, full-text search, tags, highlights, queue, byte-stable import/export, PWA offline) | **2** (W5 hostile pages as the DEFAULT product path — not a fallback lane; W7 the 12-ticket evolving-schema retention test; W8 the weeks-scale reading queue; W9 every landing ripple risk; W3/W4 exercised by every multi-chunk ticket) | **2** (the `apps/` lane proven by five vehicles; vanilla TS + zero deps + serve.mjs + Playwright battery is the house pattern; the PRD's V-1..V-12 queue is pre-written) | **2** (byte-stable export goldens, search-correctness units, keyboard e2e battery, the drafted hostile-clip fixture B-16, offline e2e) | **2** (hostile-clip skill, schema-contract memory rule, e2e stabilizer — the exact reusable cargo the registry wants; every future fetch/parse ticket inherits it) | **2** (read-later is a real, widely-used category — Pocket/Instapaper kin; for Unown users: the missing local-first reading companion) | **8** | **SELECTED** — the §0.9.5 pre-registered fallback, and the ONLY candidate whose product surface is the round's top UNOPENED weakness (W5/W7/W8) |
| **B. Tauri/Electron desktop shell** over an existing app | 1 | **0** | 1 | 1 | 1 | — | **REJECTED per §0.9** (Tractability 0: this sandbox has no GUI/native toolchain — the same ruling as Rondo's and Sonata's; an environment gap, not a product judgment) |
| **C. Memory-app sibling** (a second-brain UI over the engine's memory tiers) | 1 | 2 | 2 | 1 | 1 | 2 | **PARKED** — overlaps the just-closed Fugue learning-views surface (W2) exactly where A2 is now strongest; diminishing returns; the honest W2 verdict needs the teardown refresh, not a second UI |
| **D. Absorb the Sonata teardown duties as the whole round** (GT refresh, matrix refresh, competition cycle, evidence packet — no new app) | 1 | 2 | 1 | 1 | 1 | 1 | **PARKED as Phase 2/3 of THIS round instead** — the directive requires a real application shipped through A2; the teardown duties are absorbed as the round's closing phases, not its vehicle |
| **E. Multi-tenant gallery SaaS** (nocturne/parley kin re-pitch) | 1.5 | 2 | 2 | 1.5 | 1.5 | 3.4 | **REJECTED** — the rehearsed shape (Rondo's and Sonata's own scoring stands; no new weakness exposed) |

Anti-comfort-zone check (the law that parked Legato in the Sonata
round): that ruling held when the alternative was Fugue — a surface NO
prior round had driven. With Fugue closed, Legato is no longer the
fifth-app-of-the-same-pattern; it is the FIRST vehicle whose default
path is hostile-real-world-page ingestion (every prior app consumed
either fixtures or the engine's own REST). The fallback law
(§0.9.5: "Legato stays evidence-ready") executes as written.

## Predicted failure classes (pre-registered before L-0)

1. **Hostile-page extraction quality** (the readability-lite lane will
   meet encodings, redirect chains, JS-walled 403s, gigantic pages —
   the error taxonomy will need real curation, not fixture-only wins).
2. **Schema drift across the 12-ticket queue** (W7 kin — late tickets
   losing early-ticket schema facts to the render cap; the schema-
   contract note must be re-derived, not remembered).
3. **Cap/chunk boundaries on the heavier tickets** (V-3/V-9/V-11 are
   multi-file; the V-12 cap gate + a1-continue lane will fire — the
   turns-to-done series must count chunks honestly).
4. **e2e flake on the offline/service-worker lane** (the PWA precache
   battery is the newest e2e surface; the Ostinato atomic-write
   pattern is the cure precedent).
5. **The W9 gate-discipline pressure** (every landing/docs ticket
   must run the FULL close battery — the F-10 law's first full-round
   test).

## Baseline battery (frozen at `6e3579bb`, 2026-11-07)

- typecheck **0** · unit **2654/0/208** (17638 expects, 163.4 s)
- canaries C1 **PASS** · C2 **PASS** · C3 **known V-3 class** ·
  C4-harness **PASS (2 dispatches / 10+7 turns)**
- Full snapshot: [snapshots/serenade-baseline-2026-11-07.json](snapshots/serenade-baseline-2026-11-07.json)

The round's improvement claims (turns-to-done, paired augmentation
deltas, retention) measure against THIS page. Any later number that
cannot be diffed against it does not count.
