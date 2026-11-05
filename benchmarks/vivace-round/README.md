# The Vivace round — the engagement's benchmark suite

One-line purpose: the baseline benchmark suite + calibration canaries for
the Vivace round (the 2026-11-05/06 A1 engagement, eighteenth lineage) —
what is measured, how the baseline was captured, and where the receipts
live.

- Opened: 2026-11-05 (the eighteenth lineage's Phase 0) · **PARKED
  2026-11-06 at the triple-incarnation reconciliation** (Chaconne governs;
  the rig + receipts stand as the parked record and revivable material —
  the C3 schema class is H-15's evidence)
- Round log: [docs/vivace-round-session.md](../../docs/vivace-round-session.md)
- Methodology parent: [../README.md](../README.md) (pin everything ·
  anti-tamper · pair accuracy with cost · receipts committed, never
  regenerated)

## What this round measures

The engagement's cargo is driving-improvement evidence on a real vehicle
app, so the baseline has two halves: the standing gate surface (receipted
fresh by this lineage before any ticket) and the three calibration
canaries (frozen, rerunnable, the improvement target of any augmentation).

| Baseline lane | Receipt (2026-11-05, tree `18e4a98a`, bun 1.4.4) |
|---|---|
| Install | `bun run agent:install` → 7/7 steps (engine-service step carries the documented container/systemd caveat; stack started via `bun run agent:start` instead) |
| Bridge health | `:3031` ok, upstream **200** (Agnes), key set, **9 models** discovered live, default `agnes-3.0-flash`, lanes maxConcurrency 3 / 400 ms spacing / 45 s background yield |
| Engine health | `:3030` ready, v0.0.56 @ `18e4a98a`, bearer token active (unauth curl correctly refused), 9 router jobs scheduled |
| Doctor | "unown is ready to chat", 19 ✓ / 2 ⚠ (model-spec self-heal pair + LSP container pair) |
| Upstream pre-verify | direct `POST /v1/chat/completions` → `AGNES-OK` (87 tokens) before any agent run |
| Headless smoke | C1 canary PASS (below) |
| Typecheck / lint / unit / gates | the pre-ticket battery, receipted in the round log's environment checkpoint |
| Canaries | C1 PASS · C2 PASS · C3 content-pass/schema-fail (exit 3) — [validation-log.md](validation-log.md) |

## The calibration canaries (frozen + rerunnable)

[`run-canaries.sh`](run-canaries.sh) wipes and re-seeds fixtures from
[`fixtures/`](fixtures/) on every attempt (the V-2 pin lesson), runs all
three with `--output-format json < /dev/null`, and stamps envelope +
stderr into `sessions/`. Current baseline (stamp `20261105T202532Z`):

| Canary | Probes | Baseline |
|---|---|---|
| C1 codegen+run | provider chain, bash tool, honest reporting | PASS · 3-4 turns · 4-5 s |
| C2 test-fix | minimal-diff editing, external verification, receipt accuracy | PASS · 4 turns · ~6 s |
| C3 delegate+schema | headless `task` delegation, `--output-schema` gate | content PASS · schema exit 3 (the V-3 class) · 2 turns · ~20 s |

Improvement claims this round are measured against this table: an
augmentation re-runs the rig (≥3 runs, mean±spread reported for any
load/timing-sensitive claim, per §3.5) and reports the paired delta.

## Tuning vs holdout split (pre-declared, §3.6)

- **Tuning set** (may be studied, briefs adapted against): C1, C2, C3 and
  their fixtures; the Vivace tickets' first-run failures.
- **Holdout set** (frozen at Phase 0, never tuned against, only measured):
  - **B-15** — the schema-strict variant: C3's exact fixture + schema, with
    the brief adding one sentence ("Reply with ONLY the raw JSON object —
    no prose, no code fences"). Measures whether the V-3 class is
    brief-curable at zero augmentation cost.
  - **B-16** — the hostile-clip task (frozen at ticket V-3 when the clip
    pipeline exists): a local fixture server serving a JS-walled,
    redirect-happy, odd-encoding page; the task is to produce a clean clip
    record. Measures the browser/fetch resilience weakness (W2 in the
    PRD) on a deterministic local target — no live-network flakiness.
- Retries get new stamps and are reported separately; nothing is
  overwritten; the suite grows monotonically (§5).

## RESULTS.md

Honest nulls until the round's tickets land receipts; the file carries the
baseline table above plus the before/after pairs as they accrue.
