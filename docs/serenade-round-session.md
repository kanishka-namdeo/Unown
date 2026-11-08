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

### The every-3-tickets playbook review #1 (L-1/L-2/L-3 — the 34th lineage, 2026-11-07)

> The §4 cadence audit, overdue by two tickets (the concurrency
> management crowded it out — itself a finding). Data: the receipts
> l1/l2/l3 + the parallel-lane record.

**The economics table (ground truth, session-file turns):**

| Ticket | Turns | Dispatches | Class | The notable |
|---|---|---|---|---|
| L-1 | 54 | 2 | scaffold | dual review; the write gate denied A2 twice (held) |
| L-2 | 57 | 2 | domain | the dual-L-2 raced; PLAN-as-authority held (jsWalled from PLAN over the brief's omission) |
| L-3 | 135 | 3 | pipeline | the keystone; the mid-chunk parser wrinkle; the parallel 113-turn duplicate |
| (L-4 | 102 | 3 | domain | forward data — review #2's) |
| (L-5 | 145 | 3 | UI shell | forward data — the heaviest yet; the boundary pin's mid-run catch) |

**What the protocol did right (keep):**

1. **The capped-chunk chain is the completing lane** — every first
   chunk caps (30–40 turns), every continuation completes; zero lost
   work at boundaries (the split-write law held through L-3's mid-fix
   boundary, the round's hardest test of it).
2. **The honest-deviation protocol earns its keep** — L-2's three
   concerns, L-3's three ruling requests: every one became an operator
   ruling or an accepted-verbatim note; ZERO silent deviations
   discovered at operator verification.
3. **The ruling-refinement chunk** (L-3's +24 turns) — the round's
   cheapest high-value dispatch: the operator rules on the handoff's
   deviations, the refinement rides a resume chunk on the same
   session. **Adopted as the standing close pattern.**
4. **The boundary pin caught real drift mid-run** (L-5's comment-text
   DOM_GLOBS catch) — the enforcement lane works as designed.

**What underperformed (fix):**

1. **The dual-L-3 duplicate — 113 turns wasted** (the round's biggest
   single cost, ~15% of all engine turns to date). Cure already
   landed: H-26 (the claim gate, CANARY) + V-3's manual law. **RULE:
   every dispatch rides the gate; a claim push accepted ≠ ownership —
   fetch + re-check the queue head before EVERY dispatch.**
2. **The class-blind chunk budget** — domain tickets (L-1/L-2)
   complete in 2 dispatches at 54–57 turns; pipeline/UI tickets
   (L-3/L-4/L-5) need 3 at 102–145. The 40-turn first chunk caps
   mid-flight on the heavy class every time. **RULE (review #2 will
   verify): the first-chunk budget scales by ticket class — 40 for
   domain-class, 45–50 for pipeline/UI-class — the marginal turns are
   cheaper than the dispatch-boundary re-orientation (~5–10 turns per
   boundary).**
3. **The receipts-late pattern** — L-5's close commit references
   `receipts/l5.md` before the file is in the tree. **RULE: the
   receipt lands IN the close commit's tree** (the commit message is
   the summary, the file is the record).

**Forward (review #2 at L-6 close):** verify the class-scaled budget
rule on L-6; the claim-gate's first full-ticket test (L-6's chunks
ride it); the H-21 truncation-aware continuation's first live fire if
a chunk hits the output-cap signature.

### The every-3-tickets playbook review #2 (L-4/L-5/L-6 — the 34th lineage, 2026-11-07)

> Review #1's forward note comes due at the L-6 close. Data: the
> receipts l4/l6 + the L-5 close-commit record (the receipt debt
> remediated this same push — see l5.md's header).

**The economics table (L-4/L-5/L-6):**

| Ticket | Turns | Dispatches | Notable |
|---|---|---|---|
| L-4 | 102 | 3 | the search core; the report-only final chunk pattern |
| L-5 | 145 | 3 | the heaviest; the boundary pin's comment-drift catch; the receipt-late debt (now remediated) |
| L-6 | 126 | 3 | queue + states; the aria-live el() seam extension (the third seam-extension of the round); receipt landed IN the close commit |

**Review #1's three rules — the honest scorecard:**

1. **Every dispatch rides the claim gate — HELD.** The 33rd's L-6
   chunks rode the H-26 gate; zero duplicate-dispatch events in the
   L-5→L-7 window (the metric's promotion evidence accrues green).
2. **The class-scaled first-chunk budget — NOT ADOPTED, honestly
   unconvinced.** L-6's first chunk capped at 34 turns (budget 40);
   the ticket completed at 126/3 — inside the class band. The rule's
   marginal benefit is unproven and the 33rd's cadence is
   self-consistent; the rule retires to the register (revisit only if
   a UI-class ticket exceeds ~160 turns).
3. **The receipt lands in the close commit — ADOPTED from L-6.**
   L-6's receipt is in-tree at its close; the L-5 debt is remediated
   this push (l5.md, reconstructed from the close commit's own data,
   the remediation marked in its header).

**New findings (L-4..L-6):**

1. **The seam-extension pattern** — three tickets running have each
   extended a landed module's type surface honestly (aria-live into
   `el()`; the L-3 refinement's `hasScriptMarkers`; L-2's
   emptyDoc). None violated the "no grammar edits" law (all
   additive, all receipted). **RULE (standing, no change needed):
   additive seam extensions land IN the ticket that needs them, with
   the receipt naming them** — the pattern is working.
2. **The empty-state discipline** — L-6's three distinct honest
   panels (all-read vs no-clips vs filtered-empty) match the PLAN's
   Q-3 row exactly; L-5's palette stubs were honest too. The
   never-a-blank law is now tested surface, not aspiration.
3. **The report-only final chunk** (L-4's pattern) — when the work is
   done but the handoff is unpaid, a cheap report-only chunk closes
   cleanly. Worth noting as the standard third-chunk shape.

**Forward (review #3 at L-9 close, the io/export ticket — or at the
round close if the cadence outruns the reviews):** the L-9 golden
lane is the round's byte-stability keystone; the B-16 holdout re-run
rides L-11; the H-26 promotion measure needs L-7..L-13 clean.

### Review #2's revisit clause FIRES (L-7 datum — the 34th lineage, 2026-11-07)

L-7 closed at **197 turns / 4 dispatches** — above review #2's
~160-turn revisit threshold, and with two corrections to the review's
own record:

1. **The class-scaled budget WAS in use** (review #2's "not adopted"
   was premature): L-7's caps ran 40 → 64 → 84 (the receipt names
   chunk 1 "the class-aware budget"). The rule is live in the 33rd's
   cadence — review #2's scorecard line is corrected here.
2. **The first error-cap boundary** (L-7 chunk 1: `error_during_execution`,
   no answer): the third boundary class (turn-cap and timeout were the
   known two). Recovered clean by the split-write law (the work was on
   disk) + the state-reading continuation. Filed as
   [V-4](../benchmarks/serenade-round/validation-log.md).

The heavy-class band is now 102–197 turns / 3–4 dispatches — the
compound UI tickets (L-5 shell 145, L-7 tags+filters 197) sit at the
top. The plan's "each ≤ the Ostinato C-ticket size" is ~2–3× off on
this class; the next round's pre-split should use THIS band.

### The 35th lineage: the recycle test lane (partitioned, 2026-11-07)

A fresh session over the recycled container (the 34th's tree + the
live bridge/engine survived; the toolchain did not — reinstalled,
re-hydrated, rebuilt one-pass). Its reconciliation push raced the
sibling's L-6/L-7/review-#2 window and was arbitrated at the push,
zero engine cost — **V-5** ([the ledger](../benchmarks/serenade-round/validation-log.md)):
the dual L-5-receipt remediation, this lane's reconstruction preserved
as [the parallel receipt](../benchmarks/serenade-round/receipts/l5-parallel-lane-35th.md)
(the fresh gate re-verification), the 34th's pruned H-26 memory bullet
restored. The lane then partitioned per the H-26 precedent — the
sibling drives the L-queue (L-7 → L-8), the 35th took the
PROVE-SNAPSHOT's named owed item:

**The recycle test** ([the receipt](../benchmarks/serenade-round/receipts/recycle-test-35th.md)):
five retained improvements fired or held green with zero authoring
context (the boundary pin caught injected drift; the B-16 holdout
intact 5/5; the taxonomy + queue pins green at the L-6 receipt's
exact numbers; the H-22 guard caught a real durable-lane deletion),
and the sixth — the H-26 claim gate — was live-fired and **caught
refusing a CLOSED ticket**: the closed-path bug the authoring
verification had passed vacuously. Fixed in place as a true state
machine, the deterministic paired A/B receipted (**BEFORE 4/3 vs
AFTER 7/0**, hermetic fixture repos, zero spend), the live re-run
green — **V-6**, the registry's H-26 row corrected. The round-level
reading: the recycle test pays for itself by finding the bug only a
stranger could see.

The H-27 note (the registry row): the 35th's bring-up was the row's
named decision window and it took the surviving-shared-tree lane (the
cheap path — a worktree would have re-cloned and re-installed
everything); the same session's V-5 race is the worktree case's
own evidence. The decision rolls to the next bring-up.

## Phase 1 — THE DRIVE (L-0..L-13, ALL CLOSED 2026-11-07/08)

The ticket ledger (turns = session-file assistant-message ground truth;
dispatches = the a1-dispatch chunks incl. cap/wall boundaries):

| Ticket | Deliverable | Dispatches | Turns | Genuine gaps |
|---|---|---|---|---|
| L-0 | The architecture plan (scored 100/100; PLAN.md 657 lines, 13 tickets + 22 edges none orphaned) | 3 | 49 | — |
| L-1 | The scaffold (zero-dep, 4017, the boundary scanner) | 2 | 54 | — (the AGENTS.md write-gate = the guard working) |
| L-2 | The storage core + grammar (StoragePort, FakeStorage, migration frame) | 2 | 57 | — |
| L-3 | The clip pipeline + THE B-16 FREEZE (7-lane taxonomy, fixtures, 4018 server) | 3 | 135 | — |
| L-4 | The search core (CJK bigram hybrid, the ranking formula) | 3 | 102 | — |
| L-5 | The UI shell (el() law, dialog contract, keyboard-first) | 3 | 145 | the DOM_GLOBS comment-drift catch |
| L-6 | The queue (4-state machine, concurrent-flip guard) | 3 | 126 | — |
| L-7 | Tags + filter combos (the combo algebra) | 4 | 197 | one error-cap recovered |
| L-8 | Highlights (the no-silent-truncation law) | 3 | 141 | — |
| L-9 | The byte-stable io (3 goldens, the refusal gate) | 2 | 87 | — |
| L-10 | The PWA offline (SW, manifest, verify-precache, offline e2e) | 5 | 296 | **G-IDB**: the 3-arg open() (PLAN App.B risk #2 fired) |
| L-11 | The e2e battery + THE B-16 RE-RUN (14 specs) | 8 | 501 | **G-4..G-9** (CORS, aria-pressed, the mid-write syntax break, the opaque-redirect reality, the stale stub tests, the missing Esc branch) |
| L-12 | Docs + landing + 6 REAL captures + README + CHANGELOG | 3 | 124 | — (the F-10 ripple done RIGHT) |
| L-13 | The root wiring (legato:* scripts, the CI job, the runbook) | 2 | 48 | — |

Totals: **47 dispatches, 1962 assistant turns** through A2. The app:
`apps/legato/` — 267 unit tests (Lane A), 14 e2e specs, the 6-still
capture lane, the landing band, the CI job. All green at the close
battery: **typecheck 0 · unit 2934/0/18799 expects (208→234 files) ·
legato:e2e 14/14 · check:docs/changelog/claims/blog/benchmarks ok ·
verify-precache 25/0**.

The §5 reflection ledger (every genuine gap, root-caused + fixed at
the right layer + re-verified): G-IDB, G-4 (CORS), G-5 (aria), G-6
(the wall-timeout mid-write syntax break — the repair receipt), G-7
(the browser-redirect opacity), G-8 (stale stub contracts), G-9 (the
palette Esc coverage gap) + the filterbar propagation/focus/order
trio. Full narratives in the l10/l11 receipts.

The engine's learning loop over the same workload (the W2 axis,
live-probed at close): **66 total runs / 33 dreams / 125 notes (6
pending) / 20 project-memory versions / 0 auto-promoted skills** (the
quarantine held; the mint candidates — hostile-fixture-server-setup,
hostile-clip e2e authoring, byte-stable-export golden pinning — are
exercised with receipts and await the human mv, per the staged-skills
law).

## The round-close CI finding (the honest hand-off, 2026-11-08)

The final push's CI (e8f6e399) is RED — **but the red predates this
round's app work and none of it is the Legato lane**:

- **The Legato CI job: GREEN on its first run** (unit + e2e + the
  zero-dep hash assert) — as are Build+test (ubuntu), Typecheck,
  Production build, Fugue app, Ostinato, Coda, the security scans.
- The failing jobs (reproduced identically on f17d91a7 — the L-9
  close, which touched ONLY `apps/legato/**` + receipts): **Unit
  tests (landing)** (the fugue `auth.test.ts` ECONNREFUSED `:3100`
  signature + Baseline receipt-card chips + Finale h2/blockquote +
  DexSection arrow-walk), **E2E + a11y (landing)**, **Chaconne app
  (Lane A)**, **Landing palette contract** (the changelog rail),
  **Changed-line coverage (src/)**.
- The breakage window: the last green CI = `c2673283` (2026-11-06
  15:11); the first observed failure = `f17d91a7` (2026-11-07 21:41);
  everything between was cancelled-before-completion (the rapid-push
  pattern). The window contains the Fugue round's F-6..F-11 close +
  the 31st/33rd/34th lineages' augment landings + this round's
  L-1..L-9 — the failing surfaces are the former's, not the latter's
  (apps/legato-only commits cannot break chaconne's Lane A or the
  fugue landing tests).
- Local contradiction worth noting: the FULL battery is green on this
  exact tree in THIS container (2934/0/18799) — the CI failures are
  runner-environment-shaped (the `:3100` fixture-server boot race is
  the likely shared root for the landing-unit failures; the chaconne
  Lane A + rail failures need their own look).
- Filed for the owning lanes per the non-overlap law; this round's
  surfaces stand verified green in CI, locally, and by the receipts.
