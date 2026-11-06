# The Scherzo round — benchmark baseline + §0.9 selection receipt

- **Round**: Scherzo (opened 2026-11-07 by the twenty-sixth lineage — a
  FRESH A1 directive: DRIVE A2 × AUGMENT A2 × PROVE IT; not a resumption)
- **Tree**: `ae8a73db` (= `origin/main` @ open, v0.0.57)
- **Operator workspace**: `/home/z/my-project/.a1/` (off-repo) with
  in-repo durable mirrors at `scripts/a1/` + `scripts/a1-continue.py`
  (the H-12 rebuild — the Rondo closeout's mandated first act, done)

## 1. Baseline battery (the pristine tree, 2026-11-07)

Run via `.a1/scripts/battery.sh` (11 lanes, detached under the
daemonizer; logs `/tmp/battery-*.log`):

| Lane | Result |
|---|---|
| `bun run typecheck` | 0 errors |
| `bun run lint` | 0 errors (warnings allowed) |
| `bun run test:unit` | **2366 pass / 0 fail / 174 files, 158.05 s** |
| `bun run check:docs` | ok |
| `bun run check:changelog` | ok — rail 56 stops / 544 entries / 55 dated |
| `bun run check:blog` | ok — 46 posts / 116 tags |
| `bun run check:benchmarks` | ok |
| `bun run check:claims` | ok |
| `bun run ostinato:e2e` | 17 passed (10.5 s) |
| `bun run chaconne:test` | 119 tests / 335 expect() (1.74 s) |
| `bun run chaconne:e2e` | 20 passed (19.2 s) |

**ALL GREEN** — identical to the Rondo round's final receipt (2366/0/174),
confirming the pristine tree.

Bring-up canaries (the C1–C4 set): C1 smoke ×2 `UNOWN_OK` (1,653 ms /
1,709 ms, exit 0) · C2 doctor "ready to chat" (19 ✓ / 2 ⚠: no LSP,
model-spec curated) · C3 engine UP (v0.0.57 @ `ae8a73db`, 9 jobs,
breaker closed, bwrap sandbox active) · C4 real dispatch through the
rebuilt H-11 helper: fizzbuzz + bun:test in a fresh dir, 3 turns,
**4/4 tests**, exactly 2 files tree-verified (H-2).

## 2. Weakness map (dated, sourced — the §0.9 input)

From [A2_GROUND_TRUTH.md](../../A2_GROUND_TRUTH.md) §7 + the Rondo
validation log + this lineage's canaries:

1. **W1 — long-horizon budget discipline**: C-11's 165-turn single
   dispatch (EFFORT_BUDGET ×20); H-16 mid-run turn-budget hook at PROPOSE.
2. **W2 — stuck-pattern spirals**: V-18's fake-clock spiral (~40 turns);
   H-17 conversation-pattern stuck detector at PROPOSE.
3. **W3 — browser resilience**: H-10's honest null — the skill's firing
   surface never occurred all round (no real browser-flow vehicle).
4. **W4 — cross-host artifact contracts**: V-41 — runner↔PWA grammar
   drift invisible to 3 gate gaps (the Rondo round's genuine find).
5. **W5 — real-data bridges**: C-10's lesson — the real-runner capture
   lane was a late addition, not a designed-in verifier.
6. **W6 — the ops/deploy lane**: the SDLC matrix's thinnest lane — all
   prior vehicles are local-first PWAs; no server supervision, health
   endpoints, or monitoring lanes ever exercised.
7. *(standing)* W7 — schema-strict outputs (Vivace C3 exit-3 class;
   H-14/H-15 parked).

## 3. §0.9 selection (pre-registered BEFORE any ticket)

Candidates scored 0–2 per axis (Exposure × Generalizability × Value,
subject to Tractability ≥ 1 and Measurement = yes):

| Candidate | Exposure | Tractability | Measurement | Generalizability | Value | Product | Verdict |
|---|---|---|---|---|---|---|---|
| **Bolero** — recipe-driven website watchdog (runner + server + dashboard + deploy) | 2 (W3/W4/W5/W6) | 2 | 2 | 2 | 2 | **8** | **SELECTED** |
| Crescendo — GitHub PR analytics service | 2 (W4/W5/W6) | 1 (credential surface in dispatches; API variance) | 2 | 2 | 2 | 4–8, capped by Tractability risk | runner-up, carry-over |
| Harmony — real-time collab board (WebSocket) | 2 (W1/W2/W4) | 1 (WS infra heavy for a flash model) | 2 | 1 | 1 | ~4 | rejected |
| Legato — offline-first read-later PWA (Vivace carry-over #2) | 1 | 2 | 2 | 1 | 2 | 2 | stays parked (comfort-zone) |
| Tempo — Etude's parked vehicle | 1 | 2 | 2 | 1 | 2 | 2 | stays parked (scored 1×1×2 at E-0) |

**Bolero wins**: the first vehicle that structurally forces the browser
lane (W3), the two-host contract (W4), real external data (W5) and the
ops/deploy lane (W6) — every one of them evidenced by a Rondo receipt,
none of them comfort-zone. The PRD: [docs/bolero-prd.md](../../docs/bolero-prd.md).

### Pre-registered predictions (§0.9.4 — no retroactive story-telling)

1. Contract drift between runner and server (V-41 class) — surfaces as a
   gate catch ≥ once despite the day-one frozen grammar + round-trip pins.
2. Real-site flake — the fixture-first law keeps it out of verifiers.
3. Long-horizon overruns on server tickets — chunk discipline + H-12
   continuation lane absorb it; H-16 builds this round.
4. Async/timing spirals in the scheduler (V-18 class) — the operator
   hands the mechanism down (bounded real-clock polls).

### Seed augment hypotheses (pre-registered)

- **H-10 re-activation** (existing row): the browser-resilience skill
  finally has a firing surface — the round decides promote-or-retire.
- **H-16 build** (existing PROPOSE row): the mid-run turn-budget hook.
- **H-18** (new): the cross-host contract-pin skill (V-41 generalization).
- **H-19** (new): ops-lane memory rules (server supervision/health).

## 4. Holdout discipline (§3.6)

- **Tuning set**: the S-tickets themselves (S-0..S-10).
- **Holdout set**: frozen re-run tasks from this round's genuine-gap
  failures; the standing battery re-runs at every teardown (V-31: claims
  valid only for the final tree); the frozen Rondo lanes (chaconne e2e
  20/20, ostinato e2e 17/17, root 2366/0) stay in every battery as
  regression anchors.
- Noise band 2–6 pp: multi-trial (≥3 runs) for any ≤3 pp claim;
  `pass@k` reported where applicable. Tuning tasks never count as
  promotion evidence (H-10's paired-runs protocol is the template).

## 5. Receipts

`benchmarks/scherzo-round/receipts/` — one receipt per ticket close
(the Rondo convention: envelope path + session id + turns + gate
outputs + operator verification, committed, never regenerated).
