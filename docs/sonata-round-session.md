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
| F-2 | The `EngineAdapter` seam: the interface + typed error taxonomy (`EngineLocked`, `EngineDown`) + `FakeEngineAdapter` (canned, injected clock) — unit lane touches no network | Lane A | **CLOSED** 2026-11-07 ([receipt](../benchmarks/sonata-round/receipts/f2.md): 6 files/1,266 lines · Lane A 92/0/281 ×2 · the 14-method surface + the typed error taxonomy) |
| F-3 | Real HTTP adapter + fixture-server lane: `rest-adapter.ts`, `runner/engine-client.ts`, stub engine :4130, per-endpoint drift pins | `bun test apps/fugue/test/adapter-contract.test.ts` | **CLOSED** 2026-11-07 ([receipt](../benchmarks/sonata-round/receipts/f3.md): 7/0/41 · Lane A 99/0/324 · root 2494/0/191 · 1,174 lines · the live-pinned REST contract) |
| F-4 | PWA shell + job authoring: `index.html`, `sw.js`, `serve.mjs` (:4015), manifest, palette + job editor + job list | Lane A + serve boot HTTP 200 + e2e smoke | **CLOSED** 2026-11-07 ([receipt](../benchmarks/sonata-round/receipts/f4.md): 19 files/~2,475 lines · Lane A/B 134/0/17 · smoke 3 passed · the spike: proxy path CONFIRMED · 28 turns/4 dispatches, zero gate-catches) |
| F-5 | Run history + job detail: grouped runs, error verbatim, spend meter with throttle state, honest panels | Lane A + e2e flow | **CLOSED** 2026-11-07 ([receipt](../benchmarks/sonata-round/receipts/f5.md): ~1,300 lines · Lane A/B 155/0/20 · e2e 7 passed w/ the fixture lane firing · 2 gate-catches cured (the forward-looking-pin class) · V-11/V-12 filed) |
| F-6 | The LIVE loop: a routine created through the PWA against the real engine, `run now`, the run + session note land back (the real-data bridge lane — the V-41 law) | `bun run fugue:e2e` live lane ×3 (≥1 cold boot) + operator witness receipt | **CLOSED** (receipt f6.md — the operator witness: the full live loop network-traced through the PWA's own UI, 10 cure cycles, V-23..V-26; the runs-route render link routed to F-7 item 1) |
| F-7 | Learning views: dreams journal (gated/rolled-back), memory tiers + health, skills-staged queue, Manual-notes editor — **PLUS item 1: the runs-route render link (V-26, evidence in f6.md) + the live-lane re-run to green** | Lane A + e2e battery | **NEXT** |
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

## Environment checkpoint (2026-11-07, the TWENTY-NINTH lineage — the second recycle bring-up)

The sandbox was recycled after the F-4 close (a fresh directive, not a
resumption: the twenty-eighth lineage's environment — bun, UNOWN_HOME,
playwright browsers, the credential store — all gone; only the repo
survived via the remote). Full re-bring-up per the standing checklist,
one pass, on tree `6cc078dd` = origin/main (F-4 CLOSED):

- bun **1.4.3** re-fetched via the V-2 zip lane
  (`bun-v1.4.3` GitHub release → `/home/z/my-project/.bun/bin/bun`,
  symlinked into `/home/z/.bun/bin` so the a1 toolchain resolves it;
  system bun is 1.3.14 — never used) · operator toolchain re-mirrored
  `cp scripts/a1/* + scripts/a1-continue.py` → `/home/z/my-project/.a1/scripts/`
  (the V-2 recycle tax: one `cp`)
- install **7/7** (`UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1`, then
  `bun scripts/link.ts` → `/home/z/.local/bin/unown`) · `.env` Agnes lane
  set (duplicate-key audit CLEAN) · stack up via `dispatch-bg.py stack`
  (bridge :3031 upstream 200 `upstreamKeyIsSet:true`, engine :3030
  v0.0.57 @ `6cc078dd` = HEAD, 9 router jobs, breaker closed, memory
  platform live, lexical-ml fallback noted)
- V-38 pre-seed on the fresh home (0 fields — nothing seeded yet), then
  the C1 smokes seeded the home and the ride-along pin landed 3 fields
  (models.json 2 + model-specs.json 1) — **V-11 FILED** (see the
  V-ledger): the C2 canary CRASHED — the committed `scripts/a1/v38-pin.py`
  writes `source:"operator"` when it pins, `"operator"` is NOT a member
  of the engine's `SpecSource` enum, and doctor's `formatSpecShort`
  (`model-spec-detect.ts:879`) does `SOURCE_LABELS[unknown].split` →
  TypeError. The 28th-lineage receipt says `source:"user"` — the
  committed code had drifted from its own receipt. **CURED at the
  operator-tooling layer**: the pin now writes `source:"user"` (the
  receipted value; provenance rides `operatorPin`) + a post-pin enum
  guard (a dispatch can never leave home with a source doctor cannot
  render); the home sidecar repaired; doctor re-run GREEN **21 pass /
  1 warn (lsp-servers, the honest pair)** with the V-38 label intact
  ("524,288 ctx / 4,096 out (you entered it)"). Upstream robustness
  issue **#48** filed (diagnostics must fail open on a malformed sidecar —
  doctor hard-crashed on a bad enum value).
- Canaries re-run green: C1 ×2 `UNOWN_OK`/1 turn (rc=0) · C2 doctor
  21/1 · C3 engine UP v0.0.57 @ HEAD, 9 jobs, breaker closed · C4
  fizzbuzz **3 turns / 7.5 s / exactly 2 files / 4/4 tests
  operator-verified** (session `01a1b4f7…`)
- Chromium **1248** re-installed via the repo binary
  (`node_modules/.bin/playwright install chromium` →
  `/home/z/.cache/ms-playwright`, the default cache)
- **Battery on the recycled tree — every number IDENTICAL to the F-4
  close receipts**: typecheck 0 · lint 0e/143w · check:docs ok ·
  changelog 56/544/55 · blog 46/116 · benchmarks 6/6 · claims **62/62** ·
  unit **2529/0/196 via 6 chunk processes (V-7; the chunk map
  byte-confirmed — lib 1283/81 · app 461/35 · components 338/29 ·
  next-config 2/1 · bolero+chaconne+coda 190/24 · fugue+ostinato
  255/26, src-scoped; the unscoped shape also runs green 258/33 +
  262/27 picking up the golden/contract files outside src/)** ·
  ostinato e2e **17/17** (8.8 s) · chaconne:test 119/18 · chaconne:e2e
  20 · fugue Lane A **134/0/17** · Lane B **134/0/17** · contract lane
  7/0/41 · serve boot 200 + `{"ok":true,"port":4015}` · e2e smoke
  **3 passed** (1.5 s) · V-9's chunk-shape error signature reproduced
  unchanged (ECONNREFUSED :3100, 338/0/29 — filed, not blocking)

**The 28th/29th-lineage reconciliation (the V-42 merged-tree duty).**
The 29th lineage's bring-up receipted "Next: F-5" — meanwhile the 28th
(the lineage that closed F-4) had ALREADY completed F-5 through A2 on
its own tree when the push collided. Reconciled per the
ledger-arbiter law: the 29th's landed bring-up + V-11 (the v38-pin
enum fix) + dream-render commits govern the base; the 28th's F-5
CLOSED (a816ec06) rebases on top — its V-entries renumbered clear of
the collision (throttle trap → V-13, stalled-stream hang → V-14); the
merged tree re-verified green (Lane A/B, claims, the e2e fixture lane,
the unit chunk) before the push. Exposure to date: 14 V-entries (5
genuine-gap flavored), the F-1 spiral cured through the V-18 lane, F-4
closed with ZERO operator gate-catches, F-5 closed with TWO (a NEW
catch class: the forward-looking e2e pin). **Next: F-6 (the LIVE
loop) — the first tickets of the learning-views band; the
turns-to-done trend 61 → 28 → ~120(F-5, environment-inflated; ~60
like-for-like) is the signal the round must interpret honestly.

## The 30th-lineage reconciliation (2026-11-07 — the TWELFTH concurrent-lineage event)

A THIRD parallel incarnation (the 30th lineage, a fresh directive on
the same charter) rebuilt its environment at `76375e36` and drove F-4
to a full local close (main session `01a1b4a4…`, 9 dispatches / 88
turns + completion session `01a1b509…`, 6 dispatches — Lane A 119/0,
Lane B 121/0, e2e 3× 5/5, root 2516/0/197, its own spike-CONFIRMED
implementation) WITHOUT seeing the 28th's landing. The push revealed
`6cc078dd`..`a1d46bf1` already on main: **the 28th's F-4 governs**
(first-landing); the 30th's implementation is stashed as the
convergent dual (the V-23 precedent) and its UNIQUE evidence folds in:

- **V-15** — the 30th's cross-machine verification of the a1d46bf1
  tree found the F-5 flow spec's pick-gap race (deterministic 3/3 on
  the slower machine, invisible on the 28th/29th's faster runs);
  CURED through A2 (session `01a1b547…`) — the spec now polls the
  honest refresh's observable effect between picks. The merged tree
  re-verified by the 30th: flow file 3× 4/4, full suite 2× 7/7,
  Lane A/B 155/0/20, contract 7/0/41, typecheck 0. The slower machine
  is the better oracle — green there means green anywhere.
- **V-16/V-17** — the harness pattern-kill class (the V-39 mechanism
  observed live: a pattern-kill matched the dispatch argv's brief text
  and silently killed the tree thrice) + the GUARD-KILL self-reference
  trap; both cured with laws (pid-file-only termination; token-clean
  pins + history scrubbing).
- **V-18** — the W2 minting receipt: the 30th's F-4 churn fired the
  task-minting lane on real repeated patterns (`write-large-files-chunked`,
  `fix-boundary-test-glob-conflict` — STAGED, promotion stays a human
  mv); the first genuinely-earned skill candidates in any round.
- **V-13 restored** — the 28th/29th renumbering pass had duplicated
  the V-11 text into V-13, losing the throttle-trap entry the f5
  receipt cites; restored from the receipt's own paragraph (noted
  inline).

The 28th/29th/30th trio is now ONE lane going forward: **Next: F-6
(the LIVE loop)**.

## Environment checkpoint (2026-11-07, the twenty-eighth lineage — the RECYCLE bring-up)

The sandbox was recycled between F-3 and F-4 (the twenty-seventh
lineage's environment — bun, UNOWN_HOME, playwright browsers, the
credential store — all gone; only the repo survived via the remote).
Full re-bring-up per the standing checklist, one pass:

- bun **1.4.3** re-fetched via the V-2 lane (GitHub release zip →
  `/home/z/my-project/.bun/bin/bun`) · clone re-made at
  `/home/z/my-project/unown` @ `76375e36` = origin/main · PAT restored
  to `/home/z/my-project/.secrets/` (never in `.git/config`) · operator
  toolchain re-mirrored to `/home/z/my-project/.a1/scripts/` (the V-2
  recycle tax: one `cp`)
- install **7/7** (`UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1`) · `.env`
  Agnes lane + duplicate-key audit clean · **V-38 pre-seed applied
  before the first dispatch** (both flash models pinned 4096,
  `source:"user"` provenance) · stack up via `agent:start` (bridge
  :3031 upstream 200, engine :3030 v0.0.57 @ `76375e36` = HEAD)
- Canaries re-run green: C1 ×2 success/1 turn (772 ms / 785 ms — warm
  bridge beats the 1.66 s cold receipt) · C2 doctor 21 pass/1 warn
  (lsp-servers, the honest pair) · C3 engine ready · C4 fizzbuzz 3
  turns / 6.4 s / exactly 2 files / **4/4 tests operator-verified**
- Chromium **1248** re-installed via `bunx playwright install chromium`
  (→ `/home/z/.cache/ms-playwright`, the default cache — the prior
  custom `PLAYWRIGHT_BROWSERS_PATH` lane is unnecessary on this sandbox)
- **Battery on the recycled tree**: typecheck 0 · lint 0e/143w ·
  check:docs ok · changelog 56/544/55 · blog 46/116 · benchmarks 6/6 ·
  claims **62/62 after the V-8 restoration** · unit **2494/0/191 via
  6 chunk processes (V-7)** · ostinato e2e **17/17** (10.1 s) ·
  chaconne:test 119/18 · chaconne:e2e 20 · fugue Lane A **99/0/12** —
  every number identical to the F-3 close receipts

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

## The 29th lane's F-5 marathon (the parallel record, superseded — see receipts/f5-parallel-lane-29th.md)

The 29th lineage (this lane) ran its own F-5 to a green close in parallel
with the 28th: 27 dispatches / ~520 turns through FIVE operator-gate QA
cycles, 18 files, Lane A/B 160/0/20, e2e 9/9 ×2 — then found the 28th's
landing on origin/main at push time (the twelfth concurrent-lineage
event). Reconciled per the ledger-arbiter law: the 28th's implementation
governs; this lane's unique artifacts folded in — the §7 competition
teardown ([TEARDOWN_2026-11-07_pi.md](TEARDOWN_2026-11-07_pi.md): the
chassis moved to earendil-works/pi, the vendored npm line deprecated,
upstream fixed the output-cap truncation class in #11227/#11233 +
#10799 — the drift-audit Drive ticket routed, H-21/H-22/H-23 seeded at
PROPOSE), the a1-continue generator fixes (envelope-cmd brief +
stale-envelope guard), the PROCESS-CLEANUP auto-append in a1-dispatch,
V-19..V-22 (the parallel lane's entries), and the SIXTH #46-prune hand
restoration (claims 62/62 re-verified on the merged tree — H-22 is now
the registry's most urgent PROPOSE row).

The lane's own verdict on the marathon (preserved as the measurement
record): the turns-to-done trend honestly inverted on its F-5
(F-4 28 → ~520), decomposed in the parallel receipt — ~112 turns of
planned work, ~40 to the V-19 truncation burn, ~90 to the three V-20
process deaths, ~250 to the five QA cycles whose root cause (V-21) was
a design conflict the PLAN row never surfaced. The probe-first law
(H-23) is that lesson's cure.

## The F-6 checkpoint (2026-11-07, the 29th lane — the live loop closed on the witness)

F-6 CLOSED per the receipt (f6.md): the live loop is network-traced
end-to-end through the PWA's own UI — create (real id) → engine row →
selection (real id) → palette run-now → the engine executes the routine
(manual/succeeded, ~1.6 s) → the history re-fetch returns the run to the
browser → the cold boot survives (E-03) → the notes land (the real
shape). Ten cure cycles, each a real probe-proven defect; four of them
the fixture-masks-the-wire class (V-24) — the deepest finding of the
round: **the F-3 contract fixtures pinned a fiction of the engine**, and
every fixture-green gate certified that fiction. The one open render
link routes to F-7 with the evidence (V-26). The live lane's spec, the
cures, and all fixture gates are green (157/0/20 · typecheck 0 ·
fixture e2e 7 ×2).

**The every-3-tickets playbook review (F-4/F-5/F-6 — ONE rule change,
measured):** the amendment is the **live-scale verification law**
(V-25): every live-lane await names its scale; the operator witnesses
the live lane personally; no fixture-green gate certifies live behavior
(the fixture is a hypothesis — V-24). Measure: F-7's first live-lane
run either lands green first-try (the law working) or its failure class
is NEW (not fixture-scale drift). The probe harness
(`scripts/probe-live.mjs` + the compose probe) joins the a1 toolchain
as the standing instrument (H-23's evidence lane).

## Environment checkpoint (2026-11-07, the THIRTY-FIRST lineage — the third recycle bring-up)

The sandbox was recycled after the F-6 close (the prior environment —
bun, UNOWN_HOME, playwright browsers, the credential store — all gone;
only the repo survived via the remote). Full re-bring-up per the
standing checklist, one pass, on tree `a5e4a9fa` = origin/main (F-6
CLOSED):

- bun **1.4.3** re-fetched via the V-2 zip lane (GitHub release →
  `/home/z/my-project/.bun/bin/bun`, symlinked into `/home/z/.bun/bin`)
  · clone re-made at `/home/z/my-project/unown` @ `a5e4a9fa` · PAT
  restored (remote URL + `/home/z/my-project/.secrets/`) · operator
  toolchain re-mirrored `cp scripts/a1/* + scripts/a1-continue.py` →
  `/home/z/my-project/.a1/scripts/` (the recycle tax: one `cp`)
- install **7/7** (`UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun
  scripts/install.ts`, then `bun scripts/link.ts`) · `.env` authored
  minimal + duplicate-free (audit 0 duplicates; the Agnes lane +
  `UNOWN_HOME=/home/z/my-project/unown-home` +
  `PI_ENGINE_MAX_TOKENS_HOUR=400000` — the V-13/V-23 raise carried
  from line one this time) · stack up via `dispatch-bg.py stack`
  (bridge :3031 upstream 200 `upstreamKeyIsSet:true`, engine :3030
  v0.0.57 @ `a5e4a9fa` = HEAD, 9 router jobs, breaker closed, budget
  limits 60/**400000** — the raise verified live in `engine status`)
- **V-1 reconfirmed live (the stdin-slurp class)**: a raw
  `unown -p "Reply with exactly: UNOWN_OK"` run from the operator's
  shell harness hung past 300 s — the session file shows the child
  slurped the harness's own trailing script (`__workspace_agent_exit_code=…`)
  from the inherited stdin pipe; through `a1-dispatch.py` (stdin
  DEVNULL) the identical smoke is clean. No new V-entry — Rondo's V-1
  law is the receipt; every dispatch rides the tool, no exceptions.
- Canaries green: C1 ×2 `UNOWN_OK`/1 turn (1085 ms / 810 ms, rc=0,
  V-38 label intact — "524,288 ctx / 4,096 out (you entered it)") ·
  C2 doctor ready (the honest ⚠ lsp-servers pair only) · C3 engine UP
  v0.0.57 @ HEAD, 9 jobs, breaker closed · C4 fizzbuzz **3 turns /
  8.0 s / exactly 2 files / 4/4 tests operator-verified** (session
  `01a1b674-dd8c…`)
- Chromium 1248 (headless shell) re-installed via the repo binary
- **Battery on the recycled tree — every operative lane green**:
  typecheck 0 · lint 0e/143w · Lane A **157/0/20 (511 expects — exact
  F-6-close match)** · contract **9/0/50** (the F-6-close 8/0 + the
  final commit's fixture addition) · fugue fixture e2e **7 passed +
  1 live-skipped** · claims **62/62** · docs ok · blog 46/116 ·
  benchmarks 6/6 · ostinato e2e **17/17** (9.7 s) · unit
  **2550/0/199** (163.66 s)
- **One anti-rot catch cured**: `check:changelog` FAILED on the clean
  main tree — the F-6-close commit added a CHANGELOG entry (the V-15
  close) without regenerating the landing rail; regenerated
  (`changelog-data.ts`: 544→545 entries, Unreleased 35→36) and
  re-verified green. Lands with this checkpoint commit.

**Next: F-7** (the learning views — dreams journal, memory tiers, the
skills-staged queue, the Manual-notes editor — **plus item 1: the
runs-route render link (V-26, evidence in receipts/f6.md) + the
live-lane re-run to green**), dispatched through A2 per the standing
brief shape.
