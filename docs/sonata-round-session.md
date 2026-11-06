# The Sonata round log

> **Status: ACTIVE (PARALLEL ENGAGEMENT)** — opened 2026-11-07 by the
> **twenty-seventh lineage** (a FRESH A1 directive: **DRIVE A2 × AUGMENT A2
> × PROVE IT** — the app and the proof as twin deliverables; the app is the
> vehicle, the proof is the cargo). A parallel incarnation of the same day
> landed the **Scherzo round** (vehicle: Bolero) FIRST — the ledger-arbiter
> law gives Scherzo the round opening; this track reconciles as the
> **non-overlapping parallel engagement** (the reconciliation note below).
> Phase 0 executed same-day: recon refresh, one-pass bring-up, canaries
> C1–C4, the baseline battery, the §0.9 selection (**Fugue** — the
> engine-native automation console, receipt
> [benchmarks/sonata-round/README.md](../benchmarks/sonata-round/README.md)),
> the [Fugue PRD](fugue-prd.md) APPROVED per the operator's standing
> no-permission instruction, the registry re-opened (H-17 taken by this
> lane, **H-20 seeded**, H-14 revived), and **H-12's generator mandate
> executed as a CONVERGENT DUAL** — the Scherzo artifact at
> [scripts/a1-continue.py](../scripts/a1-continue.py) governs; this lane's
> draft folds as the converging trail (preserved operator-side).

One-line purpose: the resumable checkpoint for the Sonata round — every
ticket, receipt, validation entry, and environment checkpoint lands here or
is linked from here.

- Directive: the A1 system prompt (DRIVE × AUGMENT × PROVE) — the Rondo
  round's directive verbatim; a new engagement, not a resumption
- Suite: [benchmarks/sonata-round/](../benchmarks/sonata-round/) ·
  vehicle PRD: [fugue-prd.md](fugue-prd.md) ·
  registry: [a1-augmentation-registry.md](a1-augmentation-registry.md) ·
  ground truth: [A2_GROUND_TRUTH.md](../A2_GROUND_TRUTH.md)
- Prior round: [the Rondo round](rondo-round-session.md) (CLOSED 2026-11-06,
  Chaconne shipped, DRIVE complete, doubly cross-verified)

## The parallel-engagement reconciliation (V-4, the V-42 class)

This lane's round-opening push was rejected at the remote: the parallel
Scherzo round had landed first (its Phase 0 + S-0 + S-1 were already on
`main`). Per the ledger-arbiter law: **Scherzo/Bolero governs the round
opening**; this track does NOT stand down (both directives demand a full
program) but runs as the **non-overlapping parallel engagement**:

- **Non-overlap contract**: Sonata owns `apps/fugue/**` + `docs/fugue*` +
  `benchmarks/sonata-round/**` + the engine/learning-loop augment surface
  (H-17, H-20, H-14); Scherzo owns `apps/bolero/**` + `docs/bolero*` +
  `benchmarks/scherzo-round/**` + the browser/ops augment surface (H-10
  reactivation, H-16 build, H-18/H-19). Shared files (SESSION.md, the
  registry, A2_GROUND_TRUTH.md, README, CHANGELOG, root package.json):
  append-only + fetch-rebase-before-every-push.
- **The vehicles are complementary halves of the weakness map**: Bolero =
  W3 browser / W4 cross-host / W5 real-data / W6 ops; Fugue = W1 automation
  churn / **W2 the learning loop (the structural gap)** / W7 memory quality.
- **The H-12 mandate is a convergent dual** (the V-23 class): both tracks
  rebuilt `scripts/a1-continue.py` within the hour — the Scherzo artifact
  governs; this lane's draft folds as the converging trail.
- **Cross-machine verification duty assumed** (the V-14 role): Scherzo's
  S-1 receipt re-verified green on this lane's tree — `bolero:test`
  **9/0/50**; and this lane's Phase 0 baseline (identical numbers) is the
  three-way independent verification of the continuation baseline.

## The mission

Ship **Fugue** — a self-hosted, engine-native automation console at
`apps/fugue/` — THROUGH A2 (A1 never writes app code), and PROVE that
driving A2 improved during the process: turns-to-done trend, paired
augmentation deltas, retained improvements, reruns passing. Every SDLC lane
exercised; every advertised learning mechanism intentionally exercised
(§6c); every genuine-gap failure converted to a benchmark and rerun to pass
(§5); evidence packet complete (§8).

## Phase 0 receipt (2026-11-07, tree `ae8a73d` = origin/main)

Bring-up, one pass, per the standing checklist (bun 1.4.3 pinned from the
GitHub release zip; `UNOWN_HOME=/home/z/my-project/unown-home`;
`UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1`; install **7/7**; `.env` Agnes
lane set in place with the duplicate-key audit 1/1; the **V-38 pre-seed
applied BEFORE the first dispatch** — both flash models `maxTokens:4096`,
`source:"user"`, doctor receipts *"524,288 ctx / 4,096 out (you entered
it)"*).

Canaries: **C1** ×2 `UNOWN_OK` (1.66 s / 1.61 s, 1 turn each, exit 0) ·
**C2** doctor `ok:true` **21 pass / 1 warn** (lsp-servers — the honest pair) ·
**C3** engine UP, v0.0.57 @ `ae8a73d` = HEAD, 9 router jobs, breaker closed ·
**C4** DRIVE-lane code canary: fizzbuzz in a fresh dir, **3 turns / 7.0 s**,
exactly 2 files, **4/4 tests**, operator-verified independently (the H-2
tree-verify law).

Baseline battery (frozen tree `ae8a73d`; every number in
[the suite README](../benchmarks/sonata-round/README.md)): tsc 0 · lint
0e/143w · unit **2366/0/174** (157.30 s) · check:docs ok · changelog
56/544/55 · blog 46/116 · benchmarks 6/6 · claims 62/62 · ostinato e2e
**17/17** (10.0 s) — **identical to the Rondo close numbers** (the tree is
the Rondo close tree plus docs).

The learning engine is live from minute one this round: at baseline-receipt
time the engine had already executed its seeded `fix-fizzbuzz` harness
baseline (**1 run, passed, 4 turns, bwrap-isolated**; 0 dreams) — unlike
prior rounds' structurally-zero 0/0 openings.

## The ticket queue

| Ticket | Scope | Verifier (external, named) | State |
|---|---|---|---|
| F-0 | Architecture plan — read-only `--plan` run + materialization; `apps/fugue/PLAN.md` | operator gate: PLAN.md maps every PRD P0 item + every edge case to a named verifier, none orphaned | **CLOSED** 2026-11-07 ([receipt](../benchmarks/sonata-round/receipts/f0.md): plan 98/100 · PLAN.md 395 lines · 11/11 tickets · 12/12 edges) |
| F-1 | Domain core: `src/domain/{types,ids,invariants,io,schedule,storage,model}.ts` — Job, five ScheduleSpec kinds, RunRecordView/EngineStatusView, deterministic ids, assertData, canonical JSON + the `"fugue.v1"` schema gate, the pure schedule projection | `cd apps/fugue && bun test` (Lane A); `bun test apps/fugue` (Lane B) | **CLOSED** 2026-11-07 ([receipt](../benchmarks/sonata-round/receipts/f1.md): 64/0/206 ×2 · root 2439/0/184 · 3,323 lines · the V-18 timezone ruling) |
| F-2 | The `EngineAdapter` seam: the interface + typed error taxonomy (`EngineLocked`, `EngineDown`) + `FakeEngineAdapter` (canned, injected clock) — unit lane touches no network | Lane A | NEXT |
| F-3 | Real HTTP adapter + fixture-server lane: `rest-adapter.ts`, `runner/engine-client.ts`, stub engine :4130, per-endpoint drift pins | `bun test apps/fugue/test/adapter-contract.test.ts` | **CLOSED** 2026-11-07 ([receipt](../benchmarks/sonata-round/receipts/f3.md): 7/0/41 · Lane A 99/0/324 · root 2494/0/191 · 1,174 lines · the live-pinned REST contract) |
| F-4 | PWA shell + job authoring: `index.html`, `sw.js`, `serve.mjs` (:4015), manifest, palette + job editor + job list | Lane A + serve boot HTTP 200 + e2e smoke | NEXT |
| F-5 | Run history + job detail: grouped runs, error verbatim, spend meter with throttle state, honest panels | Lane A + e2e flow | pending |
| F-6 | The LIVE loop: a routine created through the PWA against the real engine, `run now`, the run + session note land back (the real-data bridge lane — the V-41 law) | `bun run fugue:e2e` live lane ×3 (≥1 cold boot) + operator witness receipt | pending |
| F-7 | Learning views: dreams journal (gated/rolled-back), memory tiers + health, skills-staged queue, Manual-notes editor | Lane A + e2e battery | pending |
| F-8 | Import/export + schema-gate e2e: byte-stable goldens, foreign-schema dry-run refusal | e2e io battery | pending |
| F-9 | a11y lane: axe wcag2a/2aa light+dark, tab order, Esc focus-return | e2e a11y battery | pending |
| F-10 | Docs + landing band: `docs/fugue.md`, README section, REAL captures + PROVENANCE | `bun run check:docs` | pending |
| F-11 | CI gate + root wiring: root scripts, ci.yml fugue job, runbook, honest-scope statement | `bun run fugue:test` + `fugue:e2e` + `typecheck` on a clean tree | pending |

Satellites: **A2H-15** = the H-12 generator rebuild (DONE — Phase 0 commit) ·
the #30 watcher armed through all dispatch churn (the A2H-7 pattern) ·
A2H-16+ reserved for genuine gaps as they convert (§5).

Standing brief shape for every F-ticket: the prompt-economy header (ROLE /
ALLOWED_INPUTS / FORBIDDEN_INPUTS / OUTPUT_ARTIFACT / HANDOFF_SCHEMA /
EFFORT_BUDGET ≤4 chunks × ≤8 turns / NON-OVERLAP / ACCEPTANCE naming the
SCRIPT) · stdin guard · `--output-format json` · subtype AND capped AND
result-text read (V-5/V-11/V-12) · split-write law (V-40) · no literal
kill text (V-39) · fresh session per ticket · byte-exact continuations
(`scripts/a1-continue.py`).

## Validation log

See [benchmarks/sonata-round/validation-log.md](../benchmarks/sonata-round/validation-log.md)
(the V-ledger; round-scoped numbering, Rondo's V-1..V-43 inherited by
reference where a law carries over).

## Environment checkpoint (2026-11-07, the twenty-sixth lineage bring-up)

- Sandbox: Linux 5.10 x86_64 · 4.1 GiB RAM · 9.9 GiB disk · Node 24.22.2 ·
  Python 3.12.16 · bun **1.4.3** at `/home/z/my-project/.bun/bin/bun`
  (the `bun-v1.4.3` GitHub-release zip lane — the install script's tag
  format 404s on this network)
- Chromium **1248** via the repo's own playwright
  (`PLAYWRIGHT_BROWSERS_PATH=/home/z/my-project/.ms-playwright`)
- Clone: shallow depth-100 @ `ae8a73d`; PAT in the operator credential store
  (`/home/z/my-project/.secrets/`), never in `.git/config`
- Engine REST surface pinned live (trust order: live CLI > docs):
  `/api/overview` · `/api/automations` → `{automations:[]}` · `/api/runs` →
  `{runs:[{id, task_id, kind, status, started_at, ended_at, sandbox_id,
  cycle_id, improvement_id, tokens_in, tokens_out, tool_calls, turns, error,
  sandbox_isolation}]}` · `/api/dreams` · `/api/notes` · `/api/memories` ·
  `unown routines list/create/edit/pause/resume/run/skip/snooze/history/
  trigger/hook-url/spend/delete` (full flag surface verified live)

## Resume instructions (the standing laws carried forward)

The Rondo standing laws all carry (stdin guard V-1 · cumulative caps V-5 ·
preamble-stop watch V-11 · capped-first reads V-12 · spiral watch V-14/§3.7 ·
tree-verify H-2 · post-fix re-run V-31 · tag-push V-21 · split-write V-40 ·
guard-kill V-39 · spec-pin V-38 · merged-tree verification V-42). The
Sonata-specific additions:

1. **Process-mortality law (V-1, this round)**: background processes spawned
   directly by a shell call die when the call returns — installs run
   FOREGROUND; the stack re-starts via `agent:start` whenever a call opens
   with the bridge down (the detached supervisor children survive).
2. The ledger-arbiter law in full (evidence-with-claim; 30-min window is the
   FLOOR; extended-grace 60 min; per-chunk first-landing-governs).
3. Every ticket close: receipt at `benchmarks/sonata-round/receipts/` +
   queue-row flip + this log's V-entry; every 3 tickets the playbook review.
4. §0.9.5 re-scope trigger ARMED: if by F-5 the exposure was misjudged (too
   easy → zero genuine gaps; too hard → all gaps need core), propose the
   pivot (Tempo carry-over #1, Legato #2 — both evidence-ready).

## Related pages

- [The Fugue PRD](fugue-prd.md) · [the selection receipt](../benchmarks/sonata-round/README.md)
- [The augmentation registry](a1-augmentation-registry.md) · [the ground truth](../A2_GROUND_TRUTH.md)
- [The Rondo round log](rondo-round-session.md) — the prior round (Chaconne)
- [SESSION.md](SESSION.md) — the cross-round index
