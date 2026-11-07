# The Serenade round session log

> The A1 operator's checkpoint journal for the Serenade round — a fresh
> directive (**DRIVE A2 × AUGMENT A2 × PROVE IT**, 2026-11-07), the
> thirty-second lineage on this repo. Vehicle: **Legato** (per the
> §0.9.5 fallback; [the selection receipt](../benchmarks/serenade-round/README.md)).
> Every checkpoint below was lived, not reconstructed.

## Phase 0 — recon, canaries, selection (2026-11-07)

**Bring-up on a fresh clone** (`unown-work/unown`, the thirty-second
lineage's tree):

- bun **1.4.3** installed to `~/.bun` (the container's 1.3.14 cannot
  parse the pi-repo 1.4 lockfile — `UnknownLockfileVersion`; the
  toolchain-restore lane applies). Root `bun install --frozen-lockfile`
  400 pkgs; pi-repo 340 pkgs; `hydrate:model-data` (the build:offline
  gate demands it — models.dev catalog: 400 openrouter, 303 vercel-ai-
  gateway, …); full `npm run build:offline` chain green.
- Stack up via `bun run agent:start`: bridge `:3031` upstream **200**
  (6 agnes models discovered live), engine `:3030` ready v0.0.57 @ the
  checkout HEAD, 9 router jobs, breaker closed; `unown doctor` →
  **"unown is ready to chat"** (the honest ⚠ pair: LSP-servers
  container gap + the first-session model-spec heal).
- `.env` bootstrapped from `.env.example` with `BRIDGE_UPSTREAM_KEY`
  set (Agnes AI); PAT wired into the push remote URL per the house
  pattern; `unown` linked onto `~/.local/bin`.
- **The V-1 stdin law re-learned the honest way**: one manual
  `unown -p` run with an inherited pipe never exited (killed at 300 s;
  the bridge receipt shows the answer had flushed in 919 ms). The rig's
  `< /dev/null` is load-bearing. Logged as a W1-class observation, not
  a new defect — the law was on file.
- **The stale-clone catch**: the first unit battery showed 2 fails
  (landing composition 14-vs-15 bands) — fetch revealed the Sonata
  round-close trio (`4fa89232` the F-10 ripple cure, `123a861c` the
  FUGUE QUEUE COMPLETE checkpoint, `6e3579bb` the memory renders)
  landed 15 minutes before this lineage's clone. Fast-forwarded;
  battery re-run **2654/0/208** — matching the round-close receipt
  exactly. The bring-up never dispatched against a stale tree.
- **V-38 pin re-applied** to the fresh home (models.json 2 +
  model-specs.json 1 → 4096) before any dispatch; the operator lane
  rebuilt at `/home/z/my-project/.a1/` (a1-dispatch.py, a1-continue.py,
  v38-pin.py — the in-repo `scripts/a1/` copies, laws intact).

**Canaries (the frozen vivace rig, stamp 20261107T184451Z):**

- **C1 PASS** (codegen+run: hello.py output 4, 3 turns).
- **C2 PASS** (test-fix: minimal diff, test file untouched).
- **C3 SCHEMA-FAIL rc=3** — the known V-3 prose-wrapped class, counts
  correct in the result text (the standing measured target; the cure
  belongs to the round's augment lane if it fires ≥2×).
- **C4 PASS through the real dispatch harness**: 2 dispatches /
  **10+7 turns** — the first chunk capped (exit 5, the V-12 gate),
  `a1-continue.py` raised the cap to 20 (V-5a cumulative law), the
  continuation landed DONE; operator-verified: `fizzbuzz.py` lines
  3/5/7/15 = Fizz/Buzz/7/FizzBuzz, `fizzbuzz.test.py` 4/4 tests OK.
  (The `-m unittest fizzbuzz.test` dotted-module wrinkle was the
  BRIEF's filename ask — A2 reported the resolution honestly and made
  the direct-run form work. Brief-quality lesson logged.)

**§0.9 selection executed** ([the receipt](../benchmarks/serenade-round/README.md)):
**Legato SELECTED** (E×G×V 8 at full tractability — the pre-registered
fallback; hostile-page ingestion W5 + the 12-ticket schema-retention
test W7 + the weeks-scale reading queue W8 + the W9 gate-discipline
pressure, none of which any prior vehicle drove as its default path).
Parked: the Tauri shell (tractability 0), the memory-app sibling
(overlap with the just-closed Fugue surface), the gallery SaaS
(rehearsed shape). The Sonata teardown duties (GT refresh, matrix
refresh, competition cycle, registry gates, validation-report refresh,
evidence packet) are absorbed as THIS round's Phase 2/3.

**Baseline frozen**: typecheck 0 · unit 2654/0/208 · canaries as
above · snapshot at
[serenade-baseline-2026-11-07.json](../benchmarks/serenade-round/snapshots/serenade-baseline-2026-11-07.json).

**Next: L-1** (the Legato scaffold, ticket 1 of the pre-written
V-1..V-12 queue), dispatched through A2 per the standing brief shape.

## The thirty-third lineage — fresh-sandbox resume, L-1 verified, the DUAL L-2 (2026-11-07)

A sandbox recycle (the V-42 class) opened this lineage on a fresh
container; the bring-up was rebuilt one-pass (bun 1.4.3, root 400 +
pi-repo 340 frozen installs, hydrate:model-data, full build:offline,
stack up — bridge upstream **200**, engine ready v0.0.57 @ `404b07ad`,
9 router jobs; doctor "ready to chat" with the honest ⚠ pair; V-38
pin both homes; canaries **C1 PASS · C2 PASS · C3 the known V-3
class** — stamp `20261107T193607Z`, every verdict matching the frozen
baseline; unit battery at HEAD **2654/0/208** typecheck 0 — the
expect-count 17637-vs-17638 microvariance noted, pass/file counts
identical). Bring-up checkpoint landed as the rebase over the L-1
landing per the ledger-arbiter law.

**L-1 (the scaffold) — cross-machine verified by this lineage** (the
V-14 role; the thirty-second's landing `6718d2c7`, 2 dispatches /
30+24 turns): lane A **1/0/5** ✓ · root typecheck **0** ✓ ·
`/health` `{"ok":true,"port":4017}` ✓ · `/` 200 text/html ✓ · the
7-line zero-dep package.json ✓ · the port-history header ✓ · the
verify server stopped **by pid** (V-13) ✓ — every number of the
landing receipt reproduced on a second tree.

**The DUAL L-2 (the V-32 class, live)**: both lineages dispatched
L-2 concurrently (sessions `01a1b783` there / `01a1b788` here — two
engines, one upstream). The thirty-second's landing `5a4fffe2`
(**34+23 turns**, lane A **56/0/173**, 13 files) reached `main`
first and **governs**; this lineage's landing (30+3 turns, lane A
40/0/127 — a smaller, equally-green variant with the
`snapshotDuringMigration` S-4 law and the host-edge boundary
exemption ruled on) **stands down** per the ledger-arbiter law and
is preserved in the local reflog + `.a1/logs` envelopes as the
duplicate-dispatch evidence. The reconciliation cross-verified the
governing tree: lane A **56/0/173** ✓ · root typecheck **0** ✓ —
every number of `5a4fffe2`'s receipt reproduced here. The standing
operator rulings from the stood-down landing carry forward as
L-3-bound law: (a) the boundary DOM-check exemption pattern — host
edges are enumerated-and-commented in-file, never a silent pattern
match; (b) `snapshotDuringMigration`-shaped S-4 pins belong in the
L-9 golden lane regardless of implementation variant.

**Next: L-3** (the clip pipeline — the hostile-page seam, the round's
top weakness W5 driven for the first time).

### The 34th lineage — the claim-race stand-down + the container-OOM law (2026-11-07)

A second concurrent operator incarnation (this one) brought up in
parallel with the thirty-third: bun 1.4.3 pin, frozen installs,
hydrate, build:offline, the Agnes `.env` lane, stack up (bridge 200,
9 agnes models, engine ready v0.0.57 @ `404b07ad`), doctor
"ready to chat", V-38 pin 3 fields across both homes, smoke
`UNOWN_OK` (1 turn, 3.3 s), canaries **C1 PASS · C2 PASS · C3 the
known V-3 class** (stamp `20261107T195227Z` — the identical triple),
operator lane rebuilt (7 tools; `a1-continue.py` recovered from git
history @ `1b9f04ad` — the file had left the tree in a reorg). It
claimed L-1 and pushed — **rejected non-fast-forward**: the
thirty-third had landed L-1 + L-2 + the dual-L-2 reconciliation in
the bring-up window. **No dispatch had left this lineage's home** —
the claim push itself was the arbitration point, so the race cost
zero duplicate turns (one stage earlier than the Rondo dual-L-2
class). Stood down per the ledger-arbiter law; reset to the
governing tree `feba5680`.

**Unique artifacts folded in** (the [round's validation
log](../benchmarks/serenade-round/validation-log.md)):

- **V-1 — the unit-battery container-OOM law.** This lineage's
  container (4041 MB) OOM-kills the sequential single-process
  `test:unit` at exactly 2006 passes (3 attempts: foreground,
  daemonized, heap-capped — dmesg `anon-rss:3542728kB`); the cure is
  `--parallel=1` per-file isolation: **2654/0/208, 17637 expects,
  177.67 s at bounded ~240 MB RSS**, matching the frozen baseline
  numbers. The sibling lineage's sequential 163.4 s receipt ran green
  on its roomier container — the class is container-memory-headroom
  variance. **Law: on ≤4 GB containers the unit lane runs
  `--parallel=1`; every battery receipt notes its lane.**
- **V-2 — the claim-race record** (the stand-down above; the law
  reaffirmed: push the claim immediately after the bring-up battery,
  before writing any ticket brief).

**Next: L-3 stands** (the clip pipeline — W5's first drive).

### L-3 CLAIMED (ACTIVE) — the 34th lineage (2026-11-07)

**L-3 — the clip pipeline** (ticket 3 of 13): the `Fetcher`/`Extractor`
seam, the 7-entry error taxonomy driven live (T-1..T-7), the
hostile-fixture set + the **B-16 holdout frozen**, the 4018
fixture-server skeleton. The claim push precedes the brief per the V-2
law (claim immediately after the battery). Tree at claim: `42f86893`
(governing `feba5680` + this lineage's fold-in). The governing tree
was re-verified on this machine before claiming: lane A **56/0/173**
· root typecheck **0**.

## The 33rd lineage, part 2 — the split-lane AUGMENT: H-24 PROMOTED (2026-11-07)

With the parallel lineage visibly driving the L-queue (L-1 19:36 ·
L-2 19:45 — a 9-minute cadence), this lineage split lanes per the
V-42 precedent (the L-queue vs the engine-contract surface — zero
overlap) and took the **augment lane**: **H-24, the live-traffic
fixture refresh**, advanced PROPOSE → CANARY → GATE → **PROMOTED** in
one session. The full receipt:
[receipts/h24.md](../benchmarks/serenade-round/receipts/h24.md).

**The build**: `scripts/a1/fixture-refresh.mjs` (the record mode — a
marker automation guarantees a real row shape, the read-only sweep of
every adapter endpoint, the write-path shapes, the always-cleanup law,
the provenance-stamped recording emitted as
`apps/fugue/src/adapter/fixtures-live.gen.ts`) +
`fixtures-live.test.ts` (the refreshed lane — every recorded body
through assertContract, the raw-passthrough runs pin, the shape-diff
fossil detector) + `scripts/a1/h24-gate.mjs` (the paired A/B).

**The live catches (BEFORE, the canary's teeth)**: the FIRST refresh
against the live engine REDDENED at three pins still pinned to the F-2
fixture fiction — `overview.version` (the live wire carries a version
OBJECT), the notes row (uuid ids + `content` + epoch `created_at` +
explicit nulls), and `spend` (the live `{now, routines, total}` shape)
— the third with teeth: `safeSpend()` masked the drift, so **the spend
panel has been silently dead against the real engine**. The §5
reflection dual-laned all three pins (the `assertMemories`
precedent), took `mapNotes` raw-passthrough (the uuid-coercion class
was V-24 fiction #1 living in the mapper), and landed `mapSpend` (the
spend panel ALIVE against the real engine, `data-live-wire` marked).
AFTER: fugue lanes **300/0/939** (the F-9 close was 283), root
**2727/0/215** typecheck **0**, e2e **23+1 skipped** (the first e2e
run's failures were the fresh-sandbox Playwright chromium missing —
the toolchain-restore lane, cured by install, not a regression).

**The gate, MEASURED**: the pre-registered paired A/B — the stub
renames `notes[].content` → `note_body` (the MCP guide's quiet-change
class); the STALE lane (canned `contract.test.ts`) stays **GREEN,
wire-blind**; the REFRESHED lane (recorded from the mutated stub)
goes **RED at `EngineDrift: notes[0].text: …`**. The false-confidence
delta is a receipt, not a claim.

**The promotion** (the five requirements, all receipted): 3 fiction
pins caught at refresh-time vs ~590 turns of live-lane grind (the F-6
baseline); regression-detection improved (the measured delta + every
existing drift test still reddens); zero UI/keyboard regressions (the
e2e battery green incl. the E-04 + a11y pins); $0 metered (zero LLM
calls); retention by construction (all artifacts committed in-repo +
the refresh-then-build law in docs/fugue.md). The fixture-server
seed-from-recording swap is the named follow-up (receipted scope
note). **The registry's fifth promotion.**

**Standing next**: the L-queue continues (L-3+ — the parallel
lineage's cadence governs unless it stalls; this lineage re-checks at
each fetch per the ledger-arbiter law); the augment lane holds H-23
(PROPOSE — the probe-first rule, its harness artifact already
in-repo), H-25 (PROPOSE — next-round candidate by its own anti-scope)
and H-16/H-21 (PROPOSE) as the standing candidates.

### The 34th lineage — the DUAL L-3 stand-down + the H-26 claim (2026-11-07)

The second reconciliation of the round: this lineage's L-3 close
(`775affc1`, 113 turns, all gates green, three operator rulings)
landed SECOND — the 33rd was already mid-dispatch when this lane's
claim pushed (the TOCTOU window: claim checks run at ticket
boundaries only). **The 33rd's `32535105` governs**; the parallel
receipt preserved at
[receipts/l3-parallel-lane-34th.md](../benchmarks/serenade-round/receipts/l3-parallel-lane-34th.md)
(the f5-parallel-lane precedent) with the design delta recorded — the
governing tree's T-3/T-6 split by DOCUMENT STRUCTURE vs this lane's
SCRIPT MARKERS, both honoring PLAN §6.3; the DOM-guard and
holdout-paywalled rulings converged independently. **The cost: 113
duplicate turns** — the exact motivation the 33rd's own teardown filed
as H-26 (the pre-dispatch claim gate) + H-27 (worktree-per-lineage).
Full record: [the round's V-3](../benchmarks/serenade-round/validation-log.md).
The shared A2 project-memory merge kept BOTH lanes' learned bullets
(append-only law).

**Lane partition from here (the file-domain split, per the teardown's
third layer)**: the 33rd drives the L-queue (L-5 ACTIVE, its claim)
AND — as this lane's claim push raced theirs — the **H-26 augment
itself (their `1d1d46f6` CANARY landed mid-write of this lane's
claim; the claim STANDS DOWN, the third race of the session)**. Their
gate is live-verified (exit-7 refusal against the real L-5 claim);
this lane's V-3 record (113 duplicate turns) is the gate's BEFORE
evidence — the receipts pair by construction. **This lane takes the
Phase-2/3 teardown duty instead: the SDLC_CAPABILITY_MATRIX refresh**
(docs-only, zero collision with the 33rd's code lanes) — the Legato
lanes + the round's coverage, the standing duty the Sonata close
left open.
