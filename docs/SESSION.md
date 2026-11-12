# Unown — Session Log (running index)

The repo keeps one session log per engineering round (`docs/*-session.md`).
This file is the **resumable checkpoint index** for in-flight work: each entry
records the mission state so any session can be resumed later without
archaeology. When a round completes, its log graduates to a round-specific
`docs/<round>-session.md` and this index keeps only the pointer.

---

## GRADUATED — the Memory Encore round (2026-11-12, CLOSED at CP6)

`docs/memory-encore-round-session.md` — the memory-UX round: eleven new
product teardowns (Claude Code, Cursor, Windsurf, Gemini CLI, Codex/
AGENTS.md, Copilot, MemOS, A-MEM, HippoRAG 2, Supermemory, OpenMemory —
every claim sourced) asked what the field does that users can SEE, and
shipped the proven patterns: the freshness lane (every learned rule carries
its last-confirmed date, `stale` past 28 days — Claude Code's timestamps ×
Copilot's TTL, softened to visible decay), the session-start recall line
(Claude Code's most-iterated memory-UX moment, honest under the
footer-quiet contract), `/memory show [full]` (Gemini CLI's exact-context
debuggability), and the dashboard memory health card (the audit made
visible where memory lives). Plus the `engineUndreamedNotes()` arity bug
(the phantom "2 undreamed note(s)" warning) and — the verification's own
dividend — two more `dreamAndWait` starvation fixes in the recital runner
(the pre-trigger consumer; the throttled settle exit) and the E3 outbox
observation poll. Verified: all suites green on a fresh bring-up, the PTY
memory matrix **25/25** with the new surfaces, the memory-recital live
re-run **warm 5/5 / cold 0/5 / lift +5 reproduced** (T3 0.67 → 0.89; 8/8
bullets date-stamped end to end).

The v0.0.63 cut, in order: the fold commit (a727c704 — the round's seven
entries into `[0.0.63] - 2026-11-12`, the version bump, the rail
regenerated at 58 stops/569 entries/57 dated, unown-overview re-stamped);
the new stop's chrome breached the e2e budget twin at 4,597w > 4,570 —
cured per the sanctioned order (the round's own listed titles compressed
first, then five historical first-listed leads, bold leads only, bodies
untouched; the MAX_LISTED=1 lesson re-learned: only the first item of the
Added/Behavior buckets renders) landing at 20.2vh / 4,565w in BOTH twins,
five words of headroom; CI green on the bump commit (run #1145, the 3-OS
matrix the version movement gates); `v0.0.63` tagged there and pushed. The
release rendered **15/15 jobs green** (run #101: the CI-green assertion,
the 3-OS release assertions, the production build + SBOM + attestations,
the six per-OS binaries, five per-runner boots, the draft→promote publish
with all 13 assets, the post-publish feed gate, the 3-OS smoke-install
matrix). Published 2026-11-12T07:47:25Z, Latest. deploy-verify green on
both pushed milestones (runs #562/#563); CodeQL + Scorecard green; 0 open
PRs, 0 open code-scanning/dependabot alerts at close (the 7 self-filed
issues are prior-round carry-overs, re-verified against main in their
rounds).

---

## ACTIVE ROUND — none (the round log above graduates; open a new round here)

---
## GRADUATED — the v0.0.62 release cut (2026-11-11, the five-bump gap closed)

v0.0.57 (2026-11-06) had stood as the last tag for five rounds: every round
since bumped `package.json` (0.0.58 → 0.0.62) and closed green, but the
release-cut step itself — pushing the `vX.Y.Z` tag, the only event
`release.yml` answers — had dropped out of the round-close convention after
the v0.0.57 saga (that round's bump commits also stopped folding the dated
CHANGELOG section). Nothing was broken: HEAD was green on CI / CodeQL /
Scorecard / deploy-verify, and the bump commit's 3-OS CI run had been
cancelled mid-flight by the next milestone push (gate 22's documented
cancellation exposure — "the tag path is the backstop"), so the pre-tag
cross-platform verdict was bought the prescribed way instead: the
`xplat release-verify` dispatch on the fold commit — green, all six
per-OS binaries built and booted on their own runners, windows-11-arm
included. The release itself then re-proved the tree on all three OSes
inside the workflow.

The cut, in order: the CHANGELOG fold (the 18 post-v0.0.57 bullets graduate
into `## [0.0.62] - 2026-11-11`, the 35 older stragglers keep riding
`[Unreleased]` per the rolling-lane convention, rail regenerated 57 stops /
562 entries); the new stop's generated chrome then breached the e2e budget
twin at 4,572w > 4,570 (two over) — cured by the sanctioned first move
(the round's own listed title compressed 19 → 12 rendered words, the
0.0.43 compress-without-amendment shape; both ceilings unchanged at
20.5vh / 4,570w, the knife's-edge note standing for the next cut's
amendment arithmetic); CI green on the cure commit; `v0.0.62` tagged
there (193a0c59) and pushed. The release rendered 15/15 jobs green:
ci-green, the 3-OS release assertion, the build (six archives + SBOM +
attestations + manifest + checksums), the five per-runner binary boots,
the draft→promote publish with all 13 assets asserted, the post-publish
feed gate, and the 3-OS smoke-install matrix. Published 2026-11-11T10:26Z,
Latest. Honest scope: 0.0.58–0.0.61 never ship as their own tags
(unreleased version numbers — the 0.0.30/0.0.32/0.0.46 precedent); their
rounds' entries all land in the 0.0.62 section.

---

## GRADUATED — the Memory Recital round (2026-11-11, CLOSED at CP6)

`docs/memory-recital-round-session.md` — the memory system benchtested
**driving the agent like a real user on complex tasks and complex
scenarios** (real `unown -p` sessions → notes → AutoDream → injection →
recall, scored live): the baseline battery scored warm 3/5 and its two
failures root-caused into four learning-loop bugs — the reconcile pass
deleting the just-extracted current-state carrier (T3 "no information"),
stated conventions dropped at extraction (T4), the QA sessions' own
abstention/hallucination answers consolidating into permanent memory
(the negation of a real requirement became project convention; a cold
session's hallucination became that project's first memory), and a
merged temporal marker inventing history. All four fixed (fresh-evidence
protection in `reconcileMemories` with the exact-twin carve-out, the
conventions/abstention-ban extraction lanes, the answer-only withheld
outcome stripped at both guard layers, the no-invented-history reconcile
rule) and re-measured live: **warm 5/5** — now the permanent suite
`benchmarks/memory-recital/` (Track 10: warm/cold arms over LongMemEval's
five abilities + concurrency/contamination/outbox edge probes; live run
warm 5/5 / cold 0/5 / lift +5). Reverse-engineering: the five-product
teardown `docs/TEARDOWN_2026-11-11_five-memory-systems.md` (Mem0 v3
ADD-only + Dream supersede, Zep bi-temporal invalidation, Letta MemFS
git-repo memory + RecoveryBench, Cognee's 9-stage watermarked improve(),
LangChain/LangMem + LlamaIndex priority blocks — each scored against
the live bugs). The ⛨ fresh-evidence indicator chain (DB → dashboard
row/detail → feed). v0.0.62; 9 dependabot PRs applied+closed; CodeQL
alerts #86–#90 closed (the #90 the #86 fix itself opened — its regex
rewritten as a linear scan, proven equivalent on a 13-case battery);
CI green on every pushed milestone.

---
## GRADUATED — the end-user combination round (2026-11-10, CLOSED at M4)

The round closed with v0.0.61: the red main cured (the substring-filter
battery, the chaconne browser lane, the scroll budget's fifteenth
amendment), the blog quote marks, /blog's og card, agent:start's preflight
honesty, and the CLI craft gaps. Records:
`docs/end-user-combo-round-session.md` (the round log, CP0..CP4 receipts)
+ `docs/end-user-standards-2026-11.md` (the grounding research). The M5
review-hardening pass rides the round log's CP5 row.

`docs/end-user-combo-round-session.md` — the **end-user combination
round**, the fourth in the 2026-11-09/10 combination series (plan-mode
TUI ×2, memory-engine, now the whole user surface): drive every
combination of entry lane × management command × service × platform
artifact live, as a real user against the real Agnes upstream, and fix
whatever is below the late-2026 floor
(`docs/end-user-standards-2026-11.md` — the round's grounding research).
Baseline: v0.0.60 @ f8302387, fresh clone, install 7/7 green, doctor
green, print-mode smoke green (4.1 s round trip). Open flags: **F0**
(main's CI is red — runs #1102–#1107, the e2e lanes; reproduce locally
and fix), **F1** (engine DOWN on the `bun install`-only path — the
quickstart lane), plus the 7 open self-filed issues re-verified against
current main (#29 #30 #43 #44 #45 #46 #48). Push per milestone; version
bump at M4.

## GRADUATED — the Serenade round (2026-11-07 → closed by lineage 32+)

The Serenade round's ACTIVE section moved to
`docs/serenade-round-session.md` (L-1..L-3 closed, L-4 active at the last
recorded checkpoint; the later combination rounds carried main forward —
resume from the round log's own latest checkpoint, not this index).

## PARKED ROUND — the Scherzo round (2026-11-07, OPENED by the twenty-sixth lineage; PARKED at S-5 by the round's supersession)

A FRESH A1 directive (**DRIVE A2 × AUGMENT A2 × PROVE IT** — the app and
the proof as twin deliverables; a new task, not a resumption of Rondo):
`docs/scherzo-round-session.md`. **Phase 0 COMPLETE on the pristine tree
`ae8a73db`**: bring-up green in one pass (bun 1.4.3, fd 10.2.0,
chromium-1248, install 7/7, the Agnes `.env` lane, the V-38 pre-seed on
BOTH homes — the split-homes trap cured at canary stage), canaries C1–C4
all green (C4 = a real dispatch through the rebuilt H-11 tooling, 3
turns, 4/4 tests, tree-verified), the baseline battery **ALL GREEN 11/11
lanes** (unit **2366/0/174**, every number matching the Rondo final
receipt). The **§0.9 selection pre-registered**: five candidates scored,
**Bolero** — a recipe-driven website watchdog (runner + server +
dashboard + deploy) at `apps/bolero/` — SELECTED at 2×2×2 (it forces the
four lanes no prior vehicle touched: W3 browser, W4 cross-host
contracts, W5 real-data bridges, W6 ops/deploy); Crescendo is the
declared carry-over; [the PRD](bolero-prd.md) APPROVED. **The H-12
mandate executed**: the continuation-brief generator REBUILT + COMMITTED
in-repo at `scripts/a1-continue.py` (the Rondo closeout's first act —
the retention gap cured by construction; the promotion gate re-runs on
this round's first genuine capped chunk). The registry re-opened with
H-10 re-activated (the firing surface finally exists), H-16 build
scheduled, seeds H-18/H-19 at PROPOSE. The round's validation log:
V-1..V-5 filed (V-1..V-4 operator-tooling; V-5 the research spiral —
H-17's receipted firing surface, the write-now cure standing). **The
DRIVE track is OPEN and moving: S-0..S-4 CLOSED through A2** (the
491-line PLAN; the FROZEN bolero.v1 domain with the planted-drift
round-trip pin 9/0/50; the runner with the REAL-BROWSER e2e smoke
green — 22/0/84 unit, the H-10 surface live; the server with STRICT
ingest + the live-curled /health endpoint 33/0/135; the scheduler with
the operator-handed mechanism, 39/0/150 ×2 consecutive) — turns-to-done
20 → 21 → 32 → 25 → 24 across the five tickets, every continuation
riding the H-12 generator with ZERO operator correction (the promotion
gate's evidence accrues). The parallel **Sonata round** (Fugue, the
engine/learning-loop surface — the twenty-seventh lineage) opened mid-S-3
and coexists under the non-overlap contract; both landings reconciled by
rebase with merged-tree verification each time. **Next: S-5 (the
dashboard PWA) → S-6 (deploy + supervision) → S-7/S-8 (batteries) →
S-9 (docs/landing/blog) → S-10 (closeout).**

**PARKED 2026-11-07 (the honest state)**: S-0..S-5 CLOSED (receipts
s0..s5 — the Bolero vehicle built through the dashboard PWA);
**S-6..S-10 never landed** — the round was overtaken by the event
stream (the parallel Sonata round CLOSED its full F-0..F-11 queue,
then the fresh Serenade directive opened as the governing round).
Bolero's deploy/supervision lane (S-6) is the named carry-over for a
future round; the vehicle's landed surface (domain+runner+server+
scheduler+PWA, bolero:test/bolero:e2e green) stands as receipted.

---

## COMPLETED ROUND — the Sonata track (2026-11-07, OPENED by the twenty-seventh, CLOSED with the FUGUE QUEUE COMPLETE)

A SECOND fresh A1 directive (the same DRIVE × AUGMENT × PROVE charter)
opened in parallel on the same base tree `ae8a73d`. This lane's
round-opening push was rejected at the remote — the Scherzo round had
landed first (the V-42 class, the tenth concurrent-lineage event): **the
ledger-arbiter law applies — Scherzo/Bolero governs the round opening**,
and rather than stand down (both directives demand a full program), this
lane reconciles as a **PARALLEL NON-OVERLAPPING ENGAGEMENT**:
[the Sonata round log](sonata-round-session.md) · vehicle
[Fugue](fugue-prd.md) at `apps/fugue/` — the engine-native automation
console (the learning-loop surface: W1/W2/W7) — deliberately
complementary to Bolero's browser/ops surface (W3–W6).

Phase 0 executed independently and identically where the lanes overlap
(bring-up one-pass with the V-38 pre-seed, canaries C1–C4, the baseline
battery identical to the Rondo close — every number, a three-way
independent verification). **The H-12 mandate is a CONVERGENT DUAL**: both
lanes rebuilt `scripts/a1-continue.py` within the hour — the Scherzo
artifact governs (first landing), the Sonata draft folds as the
converging trail (V-23 precedent). **The non-overlap contract**: Sonata
owns `apps/fugue/**` + `docs/fugue*` + `benchmarks/sonata-round/**` + the
engine/learning-loop augment surface (H-17, H-20, H-14); Scherzo owns
`apps/bolero/**` + `docs/bolero*` + `benchmarks/scherzo-round/**` + the
browser/ops augment surface (H-10 reactivation, H-16 build, H-18/H-19);
shared files (this index, the registry, the ground truth, README,
CHANGELOG, root package.json) are append-only +
fetch-rebase-before-every-push. **Cross-machine verification duty
assumed** (the V-14 role): Scherzo's S-1 receipt re-verified green on
this lane's tree — `bolero:test` **9/0/50** ([V-4](../benchmarks/sonata-round/validation-log.md)).
**Next: F-0** (the Fugue architecture plan through A2, read-only
`--plan`).

## COMPLETED ROUND — the Rondo round (2026-11-06, OPENED by the eighteenth, CLOSED by the twenty-fifth lineage)

The **twenty-fifth lineage** (the seventh resume, 2026-11-06 ~14:47 UTC —
the C-10 takeover lineage, then the A2H-14 closer): bring-up green in one
pass on its own fresh clone @ `296f96d5` (the V-2 recycle class, tenth
tool rebuild: npm-global bun 1.4.3, fd 10.2.0 via the deb-extract lane,
version-pinned chromium-1248, the venv, install 7/7, `.env` Agnes lane,
the `.a1/` tools rebuilt with the V-1 stdin guard + the V-39
brief-sanitizer built in). **The V-38 pin applied PRE-SEED** (both flash
models' maxTokens pre-written to 4096 in UNOWN_HOME before the first
dispatch — a fresh home seeds 65536, the exact flip the upstream punished;
doctor receipts "524,288 ctx / 4,096 out (you entered it)"). Canaries
C1/C2/C3 green. **The C-10 takeover**: the twenty-second's claim window
expired at 14:50:26 UTC with zero dispatch evidence on main (ls-tree
verified) — this lineage claimed + dispatched per the ledger-arbiter law,
and executed chunk 1 (the real-runner capture lane: compose → real runner
CLI run → bridge into the PWA) under the **V-40 split-write law** (the
V-38 pin's output-side ceiling — large single-turn writes are refused;
files land in pieces). **THE ROUND'S GENUINE FIND — V-41**: the capture
lane's bridge surfaced the A2H-13 landing's latent cross-host defect (the
runner's extract-report ext landed as "extract-report" not "json" — the
hyphen trips the PWA's ARTIFACT_NAME_RE at boot; three gate gaps kept it
invisible: the runner-side pin, the extract-value-satisfiable e2e
assertion, and no real-record bridge anywhere). **A2H-14 CLOSED through
A2** (session `01a1b169…`, 5 dispatches / 40 turns): the 3-site fix + the
cross-host round-trip pin; A2's gates + the operator gate + the bridge
probe all green; landed `e2dd23b7`. **The convergent dual (V-42)**: the
twenty-second's lane completed C-10 chunks 2-4 in parallel and landed the
closure mid-flight — first landing governs, this lane's chunk-1 stood down
(the orphaned WIP in the reflog, the V-36 shape); the rebase theirs/ours
inversion caught pre-push by the tree-verify law (reset-to-main + the
selective four-file checkout — the lesson receipted). **The MERGED-TREE
joint verification** (nobody else had: their band without the fix, the
fix without the band): tsc 0 · lint 0e/143w · Lane A 114p/5s/0 · Lane B
157/0 · root 2366/0/174 · the five check gates ok · e2e 20/20 ×2 — the
twenty-second's C-11 dispatch (the round's last ticket) unblocked.
**C-11 CLOSED by the twenty-second (4a531894) — the DRIVE track
COMPLETE, doubly cross-verified** (the twenty-third's + this lane's
receipts side by side; this lane's: every number exact on the close
tree). **The closeout portfolio executed** (the twenty-fifth, per the
resume instructions): (a) the every-3 playbook review for the
C-9..C-11 era (five amendments — the spec-pin pre-seed, the
split-write law, the real-data-bridge acceptance lane, the
window-is-the-floor ruling + the merged-tree-verification duty, the
turn-budget-hook candidate); (c) the OQ-1 PLAN amendment (edge-5's
record-at-end semantics); (d) the §0.9 predicted-failure-classes
reconciliation (2 hits incl. the round's genuine find, 1
miss-by-mitigation, 2 partials, 3 unpredicted honestly ledgered);
(f) the claim-evidence gap formalized as standing protocol
(evidence-with-claim + the extended-grace observation); **(b) the §7
cycle's second teardown** — [the budget-visibility
teardown](TEARDOWN_2026-11-06_budget-visibility.md) (the mid-run
budget-control convergence: Codex 0.142.0's rollout budgets, the
OpenHands visible-limit proposal + Stuck Detector, Strands's
stop-reason reporting — against C-11's 165-turn advisory-budget
receipt; **two PROPOSE candidates filed**: H-16 the mid-run
turn-budget hook (design-sharpened by three shipped systems) + H-17
the conversation-pattern stuck detector (the V-14 manual watch
automated)); (e) [RESULTS.md](../benchmarks/rondo-round/RESULTS.md)
finalized at the DRIVE-complete tree. The engine's learning loop ran
live throughout: 19 runs / 13 dreams this lane's era, the terminal
render clean, the dream consolidation carrying the round's fix
facts. **The Rondo round's remaining open item: the formal round
close (the §6c cross-lane learning summary + the round's status
flip) — the next lineage's first act.**

A FRESH A1 directive (**DRIVE A2 × AUGMENT A2 × PROVE IT** — app + proof
as twin deliverables, DRIVE and AUGMENT tracks, §0.9 weakness-driven
selection, §4 SDLC coverage, §6c learning-mechanism validation) opened a
new engagement: `docs/rondo-round-session.md` — Phase 0 executed by the
eighteenth lineage on the fresh tree at `18e4a98a` (install 7/7, stack
up, doctor ready-to-chat 19✓/2⚠, canaries C1–C4 all green with the V-1
stdin-guard cure, baseline battery: tsc 0, lint 0-143w, unit
**2257/1/161 — one pre-existing deterministic fail root-caused as V-4**
(the encore Finale test, ticket **A2H-9**), rail 55/540/54, blog 46/116,
benchmarks 6/6, claims 62/62, e2e 17/17). The **§0.9 selection executed
with a pre-registered receipt** (`benchmarks/rondo-round/README.md`):
four candidates scored, **Chaconne** — a keyboard-first browser-recipe
runner at `apps/chaconne/` — selected (Exposure 2 × Generalizability 2 ×
Value 2; Tempo scored 1×1×2 and stays parked; §0.9.5 re-scope trigger
armed), the PRD at `docs/chaconne-prd.md` **APPROVED**. **H-9 PROMOTED**
(the operator decision the Etude round reserved — A2H-5/A2H-6 receipts
stand). The registry re-opened for the round with H-10/H-11/H-12 at
PROPOSE. **C-0 CLOSED 2026-11-06** (a parallel lineage, 2 chunks, 11 turns —
`apps/chaconne/PLAN.md` 489 lines, operator-gate verified: 7/7 P0 items
and 11/11 edge cases mapped, none orphaned). **A2H-9 CLOSED 2026-11-06**
(a convergent dual closure — this lineage's 8 chunks across 2 sessions
found the root cause: `bun test src` is a substring filter including 16
`apps/*/src` test files in the battery; the R-2 settings-modal test left
`<h2>Deck settings</h2>` in the shared document → the encore `getByRole`
multi-matched; a 13-line `afterAll` reset fixes it — the battery
**2258/0** restored, twice by A2 + once independently by the operator;
the parallel lineage's 24-turn shard-bisect forensics folded as the
converging trail; receipt `benchmarks/rondo-round/receipts/a2h9.md`).
**C-1 CLOSED 2026-11-06** (the nineteenth lineage — the Chaconne domain
core: 1,367 lines through A2 in 27 turns / 5 dispatch rounds; the operator
gate re-ran every lane — Lane A/B 31/0, root battery **2289/0/166**
(2258 standing + 31 new), typecheck 0, lint 0/143 — and proved the
boundary pin bites with a live DOM-glob injection; four deviations
reviewed and accepted; the V-8 preamble-stop and V-9 cap-abort taxonomy
logged; receipt `benchmarks/rondo-round/receipts/c1.md`). The nineteenth
lineage's bring-up: fresh clone @ `1e4e840b`, V-2 recycle taxes cured
one-pass (bun 1.4.3 pin, fd, venv, install 7/7, Agnes `.env`, `.a1/`
operator tools rebuilt, PAT to the credential store), canaries green,
A2H-9 cure re-verified 2258/0 on the fresh tree. **C-2 CLOSED 2026-11-06** (the nineteenth
lineage — the runner v1: 1,933 lines through A2 in 65 turns / 8 rounds;
the fake-clock spiral V-14 receipted — the operator's §3.7 structural
decision (delete the manual clock, bounded real-clock polls) closed what
three derivations could not; Lane A/B 70/0, root battery 2289/0 holding,
3-test real-browser smoke on LOCAL file:// fixtures; receipt
`benchmarks/rondo-round/receipts/c2.md`). **C-3 CLOSED 2026-11-06** (the nineteenth lineage — the UI shell: 19
files / 3,303 lines through A2 in 33 turns / 4 rounds, the round's
smoothest ticket; Lane A 81p/4s/0, Lane B 110/0, root battery 2329/0/171,
serve.mjs boot verified HTTP 200; the every-3-tickets playbook review
landed the ordered-write brief pattern; receipt
`benchmarks/rondo-round/receipts/c3.md`). **C-4 CLOSED 2026-11-06** (the nineteenth lineage — the recurring loop:
8 files / 2,024 lines in 57 turns / 6 rounds; the test-caught genuine gap
(a crashed-persistence window bricking interval schedules) fixed via the
dedup-HEAL, the round's best §5 receipt; Lane A 109/0, Lane B 138/0, root
battery 2351/0/172; receipt `benchmarks/rondo-round/receipts/c4.md`).
The §7 competition cycle opened:
[the Letta filesystem-memory teardown](TEARDOWN_2026-11-06_letta-filesystem-memory.md)
(74.0% LoCoMo with plain files vs Mem0's 68.5% — the challenge to A2's
Mem0 bet, reckoned; two PROPOSE candidates queued). **C-5 CLOSED 2026-11-06** (the nineteenth lineage — the assertion +
artifact hardening: value checks with expected-vs-actual, the screenshot
determinism pin, the content-addressed extract-report, the completed
precache list; one gate catch — the offline.html forward reference that
would have failed SW install, fixed through A2; Lane A 115/0, Lane B
146/0, root battery 2353/0/172; receipt
`benchmarks/rondo-round/receipts/c5.md`). **C-6 CLOSED 2026-11-06** (the nineteenth lineage — the e2e battery lane
1: the CHACONNE_E2E config + the K-1 keyboard-only flow spec + the a11y
lane start; 6 consecutive green e2e runs; the ARIA fix accepted; the
measurement confound receipted — A2's bare `bun test src` vs the real
`bun run test:unit` 2353/0/172; receipt
`benchmarks/rondo-round/receipts/c6.md`). **Next: C-7 (the resilience
battery), then the C-8..C-11 drive queue.**

The **twenty-first lineage's post-freeze reconciliation** (07:30 UTC):
the B-19 windows-CI fix landed convergently (V-23 — the twentieth's
`c69d6382` governs; this lane's A2H-11 session `01a1afb2…` + receipt
`benchmarks/rondo-round/receipts/a2h11.md` stand as the parallel
evidence, the identical one-call cure from an independent diagnosis
chain); their fix + the C-3 landing cross-machine verified here (V-25:
Lane A 85/0, Lane B 110/0, tsc 0, lint 0/143, battery **2329/0/171**);
V-24 filed (the /tmp/engine-tests-b concurrent-collision law).
**C-4 CLAIMED by this lineage** (the recurring loop — the standing
brief in the round log, dispatched after the claim-push).

**The lane's later arc (08:00-10:00 UTC):** C-4 closed CONVERGENTLY
(V-26 — the nineteenth's `9c316604` governs; this lane's ALL-GREEN
session `01a1afd8…` receipted at `benchmarks/rondo-round/receipts/
c4-convergent.md`; the fourth convergence of the round), their C-4+C-5
cross-machine verified (V-28: Lane A 115/0, Lane B 146/0, battery
2353/0/172 — every number exact), the reset-survivor class law filed
(V-27). **C-6 CLOSED through A2 by this lineage** (session
`01a1b01a…`, 5 rounds + the A2H-12 interlock): the K-1 keyboard-only
e2e battery (zero pointer events), the PLAN §4 config verbatim, the
disk-store seeder — and the battery's first real CLI invocation caught
**B-20: the runner CLI was a silent no-op** (the dead isMain guard —
path-vs-URL, always false; fixed through A2 as A2H-12 with
`import.meta.main`; V-29's e2e-first coverage law); operator gate:
battery **×3 green**, tsc 0, lint 0/143, test:unit **2353/0/172
exact-hold**; the P1 artifact-grammar mismatch BLOCKED-noted for a
pre-C-8 ticket (V-30). **Next: C-7 (the resilience battery).**

The **twenty-fourth lineage** (the sixth resume, 2026-11-06 — a THIRD
concurrent incarnation of the same C-7 bring-up window, reconciled at
`19e0486d`: the twenty-second's `63b3a84c` claim governs, the
twenty-third's standby + verifier roles stand, this lane stood down per
the ledger-arbiter law — V-33): bring-up green in one pass on its own
fresh clone @ `2b94f45f` (bun 1.4.4 at `~/.bun` — the 1.4.3 pin did not
survive the recycle; the full battery green on it, the concern logged
as un-triggered drift; the chromium-1200-vs-1248 trap hit and cured via
the version-pinned `bunx playwright@1.64.1 install chromium` variant —
the fourth confirmation; the `.a1/` tools rebuilt as durable scripts:
`a1-dispatch.py` with `--output-format json` envelope parsing, `battery.sh`),
the full battery re-receipted on the sixth independent tree — Lane A
115 tests/0 fail, Lane B 146/0, root `bun run test:unit` 2353/0/172,
tsc 0, lint 0/143, e2e 6/6 (7.3 s), every number exact. **The lane then
executed the AUGMENT portfolio while C-7 runs on the parallel lane**:
**H-12 BUILT + LIVE-CANARIED** (`.a1/scripts/a1-continue.py`, the
continuation-brief generator — 2/2 canary points, zero operator
correction, the V-15 pins demonstrably riding into the artifact's own
verdict line; two generator defects caught at build), **H-10 STAGED +
GATE-DESIGNED** (`.unown/skills-staged/browser-resilience/SKILL.md` —
minter-validated, audit-clean, never auto-loaded; the WITH/WITHOUT
paired-gate protocol pre-registered with external methodology anchors;
the `a1-paired-runs.py` harness + the frozen ticket brief ready), the
**A2H-7 watcher re-run** receipts (both lanes ×8 on live dispatch
traffic, a2h7/r24/), the **H-11 tally accrual** (22/0 round dispatch
runs), and the **H-8/H-9 retention evidence** on the full post-recycle
sandbox (verify_resume_hint ALL ASSERTIONS HELD; verify_resume_picker
3-consecutive PASS + one honest transient — the receipt
`benchmarks/rondo-round/receipts/h-retention-r24.md`). The engine's own
learning loop ran live throughout: 3 dreams, 33 notes, a canary-gated
project-memory ship (v2), governor 16/60 calls, breaker closed. **The
lane's standing commitment: the H-10 paired runs are the teardown
window's first act on the frozen post-C-7 tree.**

The **twenty-third lineage** (the fifth resume, 2026-11-06 late — the
OTHER half of a DUAL-INCARNATION claim: the parallel twenty-second's
checkpoint `63b3a84c` landed first and governs; this lane stood down at
the rebase per the ledger-arbiter law, the V-9/V-19 shape):
bring-up green in one pass on the same fresh clone @ `2b94f45f` (the V-2
recycle class, ninth tool rebuild: bun 1.4.3 npm-global, fd 10.2.0 via
the GitHub `.deb`+dpkg-extract lane, the venv, install 7/7, `.env`
Agnes lane, `.a1/` tools rebuilt — the H-11 dispatch helper included,
self-tested; the chromium-1200-vs-1248 pitfall re-hit then cured via
the repo binary — the twenty-first's drift note is a STANDING trap,
third confirmation); stack up (bridge 200, engine UP v0.0.57 @ HEAD,
doctor 19✓/2⚠), canaries C1–C4 all green (C4 operator-verified 4/4 —
completing the pair the twenty-second skipped), the chaconne e2e
battery re-verified **6/6 (9.0 s)** on the fifth independent tree.
**C-7 CLOSED through A2 by this lineage** — the twenty-second's ACTIVE
window expired at ~11:49 UTC with zero dispatch evidence (V-32's
disposition), the standby dispatched with the standing brief: session
`01a1b0b2…`/`01a1b0b3…`, **89 turns / 7 rounds**; the 4-lane
resilience spec (the REAL SIGKILL harness + the log-bytes twin, the
corrupt panel, the O-1 offline boot + storm-check), offline.html + the
sw.js entry **+ the O-1 root-cause fix (the `.js`-convention precache
keys)**, verify-precache.ts; the operator gate: e2e **7 consecutive
green**, test:unit **2353/0/172 exact-hold**, tsc 0, lint 0/143; V-35
filed (the operator's own drift-test revert caught by A2's pin, cured
through A2); receipt `benchmarks/rondo-round/receipts/c7.md`.
**A2H-13 (the V-30 reconciliation) dispatches next on the post-C-7
tree** (the gate opens), then C-8. **A2H-13 CLOSED through A2 by this
lineage** (session `01a1b0df…`, 56 turns / 6 chunks): ruling (a) the
ext → `json` (the domain's vocabulary), the domain FROZEN; the 4-file
diff + the two cross-host pins through `assertData` (the dotted name
THROWS — RED by construction); one latent defect caught at A2's own
gate (the flow specs' stale old-grammar seeds); the operator gate:
Lane A **113/4/0 (+2)**, e2e 10 passed, test:unit **2353/0/172
unchanged**, tsc 0, lint 0; V-30 RESOLVED; receipt
`benchmarks/rondo-round/receipts/a2h13.md`. **C-8 CLAIMED then CLOSED through A2 by this
lineage** (session `01a1b0ef…`, 10 rounds / ~135 turns — the round's
heaviest): the 4 committed goldens (unicode RAW UTF-8, sha256-pinned)
+ regen-golden.ts `--check` (the drift gate) + the 4-lane io spec
(EXPORT byte-equal, ROUND-TRIP, REFUSED never-partial, CORRUPT);
**the operator gate's flake catch** (12-13/14 on cold cross-runs
after A2's warm x3 — the filechooser race) cured through A2
(DOM-condition waits + the 15 s bounded retry + fail-fast);
**12 consecutive green** (A2's 6/6 + the operator's 6/6, 6 cold
boots); V-39 filed (the prompt-guard silent kill — dispatch briefs
never carry literal kill-command text); receipt
`benchmarks/rondo-round/receipts/c8.md`. **C-9 stands CLAIMED by the
twenty-second** (the a11y completion, tolled for the V-38 Agnes
degradation window — the upstream's degenerate-200 class, every
dispatch failing at 0 input tokens since ~13:46 UTC; the smoke-poll
backoff armed on that lane).

The twenty-third lineage's later arc (the session's close): the
**V-38 cure applied + re-smoked green on this lane's stack** (the
spec pin 65536→4096, operator-pin provenance, the engine restarted —
the cross-lane corroboration receipted); the **overdue C-4..C-8
playbook review** landed (six amendments, the cold-boot x3 law
effective C-9); the **cross-machine verifications of C-9, C-10, and
C-11** (every number exact — C-11 a CONVERGENT DUAL with the
twenty-fifth); the **A2H-13 receipt's honest V-41 amendment** (the
call-site defect the twenty-fifth's capture lane caught, fixed as
A2H-14, verified green by this lane); **V-39 filed** (the
prompt-guard silent kill — the H-11 helper patched with the
GUARD-KILL classification). **The Rondo DRIVE track is COMPLETE:
C-1..C-11 all closed and verified.** This session's next-lane state:
the round CLOSEOUT queue (the resume instructions' list) — the
twenty-fifth's C-9..C-11 playbook review already landed as item (a).

The **twentieth lineage** (a PARALLEL resume — the V-9 dual-incarnation
event: the nineteenth's checkpoint `6885f2f3` landed first and governs;
both bring-ups independently re-verified the same green state) also
resumed 2026-11-06: bring-up green in one pass (V-8 — the recycle class
cured again: bun 1.4.3 via the npm `.exe` lane, fd via the new apt lane
after the GitHub 403, chromium-1248, install 7/7, stack up, doctor
19✓/2⚠, C1 smoke guarded), the full battery re-receipted at `1e4e840b`
**9/9** (unit **2258/0/161** — corroborating the nineteenth's
159.2 s run at 158.1 s), and authored the **standing C-1 brief** (in the
round log) under the V-9 dispatch-claim protocol: the nineteenth's claim
governs for 30 minutes, then the brief serves whichever lineage
dispatches.

The twentieth's lane then executed **three satellite/engine tickets**
while the C-queue ran on the parallel lineages: **A2H-7** (the #30
watcher, both churn lanes 16/16 no-hang, receipts committed), **A2H-8**
(the #43 iframe-race probe — the v0.0.55 silent-loss path NOT
reproducible on v0.0.56, the F3 fix confirmed; the residual
loud-failure window + partial-application gap receipted; two evidence
comments posted upstream on issue #43), and **A2H-10** (the B-18
reasoning-noise filter at the dream's write boundary —
`sanitizeMemoryText()` at all three lanes, 14 pins, the honest
A2/operator split with four draft defects caught by the gate pins;
package suite 5470/0, tsc 77=77 parity) — **the round's first
Unown-code enhancement, shipping as v0.0.57** (tagged). The combined
state verified green post-rebase: **2289/0/166**, typecheck 0, rail
56/543/55. C-1 (the nineteenth's lane, quadruply verified per V-14)
and the C-2 claim (the twenty-first's lane) run in parallel; B-18's
post-fix render observation is the pending close evidence.

**The release saga (resolved 07:52 UTC)**: B-19 — the Windows
release-blocker behind BOTH the un-rendered v0.0.56 AND the first
v0.0.57 attempts (automation-spend's beforeAll doing raw SQL on the
lazily-created automations table; Windows alphabetical discovery makes
it the first store caller on a fresh DB) — root-caused, reproduced
deterministically, fixed with the one-call cure, and **the v0.0.57
release rendered with all 15 jobs green and 13 assets across 6
platforms** ([the release](https://github.com/kanishka-namdeo/Unown/releases/tag/v0.0.57)).
C-3 (the web app shell) also closed on the parallel lane (Lane A
81p/4s/0, Lane B 110/0, root battery 2329/0/171); the §7 competition
cycle opened (the Letta filesystem-memory teardown). **Next: C-4 (the
scheduler — the injected-clock lane), then C-5..C-11; B-18's terminal
render observation rides the next A2 session end.**

The **nineteenth lineage** re-receipted the checkpoint on the same tree
(`1e4e840b`) after the second sandbox recycle of the round (V-8: `.a1/`,
`unown-home/`, the bun pin and the venv reclaimed; cured in one pass —
bun 1.4.4, fd 10.5.1, the REPO's playwright chromium-1248, install 7/7,
stack up, doctor 19✓/2⚠, baseline battery ALL PASS with unit **2258/0**
on the fresh install). **H-11 FORMALIZED**: `.a1/scripts/a1-dispatch.py`
— the stdin-guarded dispatch helper (envelope capture, subtype+capped
double gate, session-id recovery) — self-tested green; every dispatch
rides it now. **C-1 CLAIMED** (ACTIVE) by this lineage.

---

## PARKED ROUND — the Etude round (2026-11-05, PARKED by the eighteenth lineage)

The STABILISE × HARDEN × PROVE engagement parked OPEN when the fresh
Rondo directive arrived (new task, not a resume — nothing deleted, the
queue stands): `docs/etude-round-session.md`. Phase 0 stood complete on
the seventeenth lineage (recon, the baseline suite + C1–C3 canaries at
`benchmarks/etude-round/`, the matrix re-opened); A2H-5/A2H-6 CLOSED
through A2 (B-13/B-14 fixed, receipts in the round log); H-9 canary
complete — **promoted 2026-11-06 by the CONVERGENT DUAL operator
decision** (both parallel lineages promoted it independently the same
day — the Etude lineage's operator gate and the Rondo round's opening
decision; the registry row records both). **The E-0 gate: a
dual-incarnation event, receipted in the round log** — a parallel
lineage approved Tempo with the five market-research amendments ([the
research record](etude-round-market-research.md)) and captured the
learning baseline
(`benchmarks/etude-round/snapshots/etude-baseline-2026-11-06.json`, the
engine snapshot drained) the same day the Rondo round's §0.9 selection
(Chaconne over Tempo, scored 1×1×2 comfort-zone) landed on `main` first;
the ledger-arbiter law gives the Rondo selection precedence — the
amended PRD, the frozen E-1..E-6 queue and all the receipts stand as the
parked round's record. Tempo stays a carry-over candidate with the
Reprise queue.

---

## PARKED ROUND — the Vivace round (2026-11-06, PARKED at the triple-incarnation reconciliation)

A third parallel lineage's fresh-directive round, opened 2026-11-05 (late)
on the same tree at `18e4a98a` and parked at the reconciliation before any
ticket ran: `docs/vivace-round-session.md` — Phase 0 stands receipted (the
Agnes upstream hand-verified, the calibration canaries frozen into a
rerunnable rig — `benchmarks/vivace-round/run-canaries.sh`, C1 PASS · C2
PASS · C3 content-pass with the schema class exit 3, the V-3 finding; the
pre-declared tuning/holdout split; the pre-registered §0.9 selection of
**Legato**, an offline-first read-later/web-clip PWA). At the
reconciliation the ledger-arbiter law applies twice over: **Chaconne
governs** (the Rondo round's selection landed on `main` first and its C-0
plan is closed), Tempo stays carry-over #1, and **Legato parks as
carry-over #2** — a future-round candidate whose selection record, PRD and
frozen rig stand intact. The lineage's independent harvest of the encore
Finale defect (its "B-17", root-caused in parallel as this round's V-4)
folds into **A2H-9's forensics dossier**: the attribution matrix
(bun 1.4.3 × 1.4.4 both fail in-suite; changelog-data revert excluded;
isolated and sibling runs pass; **GitHub CI green on the same commit** —
the check-runs receipt) narrows the shard-bisect to cross-file pollution
under constrained CPU. The round's renumbered seed hypotheses (H-13
hostile-page-clip, H-14 schema-contract memory rule, H-15
schema-strict-final — the C3 class cured at the right layer) sit at
PROPOSE in the registry as parked candidates.

---

## PARKED ROUND — the Reprise round (2026-11-05, PARKED by the seventeenth lineage)

The Ostinato engagement's P1 continuation round parked OPEN when the fresh
Etude directive arrived (new task, not a resume — nothing deleted, the
queue stands): `docs/reprise-round-session.md` — the PRD's P1 backlog
(stats heatmap, deck-level review settings, CSV Anki-style import, the
in-app `?` shortcut sheet) ships through A2 tickets R-1..R-5 under the
inherited freeze law. **R-1 CLOSED 2026-11-05** (the code lane + the e2e
heatmap spec + the B-12 harvest). **R-2 CLOSED 2026-11-05 by a parallel
lineage mid-Etude-Phase-0** (deck-level review settings —
`Deck.settings.newCardsPerSession`, the pre-cap queue cap resolution, the
`d` settings modal on the create-form pattern: Lane A 121/0, Lane B
128/0, tsc 0, proof 19/0, the e2e battery **17/17** with 3 new specs;
9 A2 dispatches, the degradation curve measured — V-10's pricing lesson;
one genuine defect + one receipt-overclaim caught at the operator gates,
V-9) — landed as `782f090b` and reconciled by the Etude round's rebase.
The sixteenth lineage's bring-up receipts stand (install 7/7, unit
2235/0/160, the full gate set green — its H-3 PTY audit's fresh-install
claim corrected by the Etude round's V-3: the lanes pass pre-warmed
homes only until A2H-5/A2H-6 land). **R-3..R-5 remain OPEN as carry-over
candidates** for the Etude round's queue (R-3: CSV Anki-style import was
next).

---

## COMPLETED ROUND — the Ostinato round (2026-11-04, CLOSED by the thirteenth lineage)

The DRIVE-track app round of the A1 engagement (STABILISE × HARDEN ×
PROVE) is **COMPLETE and graduated to its own log**:
`docs/ostinato-round-session.md` — the full record (the mission, the
validation log V-1..V-25, the bug register B-1..B-11 all FIXED, the
ticket queue, the gate receipts, the §7 capability report). The summary:
**Ostinato**, a keyboard-first, offline-first spaced-repetition flashcard
PWA at `apps/ostinato/` (the repo's second user product, after Coda) —
vanilla TS, zero deps, SM-2 scheduling (the Wozniak 1990 line, injected
clock), markdown decks, a 17-command palette, crash-safe mid-review
resume (every-transition persistence + atomic writes), byte-stable JSON
import/export, an 18-entry precache with a static derivation proof —
landed through six drive tickets O-1..O-6 plus three hardening tickets
A2H-1..A2H-3 (two registry promotions: H-6 the status-line collision
guard, H-4 pump-while-typing), with the hardening battery **12/12**
(keyboard-only flow, axe wcag2a/2aa both schemes + focus pins, offline,
crash-resume, resize), four live execution rounds harvesting **nine
defects (B-3..B-11)** the unit lanes could not see, the calibration
canaries C1–C3 baselined (C2's cap-overflow honestly receipted), the
closeout landing band + fourteenth scroll-budget amendment (17.3vh /
4,145w measured), docs/ostinato.md + the README surface, the round's
blog post (46th), the committed closeout re-run receipts
(`benchmarks/ostinato/receipts/run-20261104T181704Z/`), and the
graduation (the round log, this index, the registry's live records, the
matrix's headline lanes receipted, the §7 capability report). Honest
scope: **Chromium-desktop-only** — WebKit/Firefox/mobile remain `[U]`s
recorded in the PRD and the matrix. No version bump: an app-round
commit, riding `## [Unreleased]` per the deployment contract.

Carry-overs (the next round's queue, if the engagement continues): the
PRD's P1 backlog (stats heatmap, deck-level review settings, CSV import,
the `?` shortcut sheet), the #30 live-hang capture (armed upstream), the
subagent-reuse axis (queued upstream), and the browser-lane candidates
the matrix still gaps (`[U]` lanes above).

---

The spend-and-memory-health round (2026-11-04) is COMPLETE and graduated to
its own log: `docs/spend-and-memory-health-round-session.md` — the
settings-evolution lineage's S2-ledger head, both pinned BM-3 search misses
flipped to **12/12, 100%** (receipted): **S2-11** the automation spend
meter + ceilings (the governor's ledger covers engine learning jobs only —
routine spend is now metered per-routine + globally over rolling 24h/7d
windows through `GET /api/automations/spend`, `unown routines spend`, and
the hub's Automation spend meter card; boundable via per-routine
`--spend-cap` + the global `PI_AUTOMATION_MAX_TOKENS_DAY`, both default OFF
by the governor-asymmetry ruling; enforcement graduated with recorded
`spend_ceiling` skips, never a lifecycle change; manual run-now bypasses
but counts) and **S2-4** the memory health card (the fail-open reconcile
pass gained a durable failure record that survives restarts; duplicate
count over normalized text, conflict count over supersede links; warnings
reconcile-failing/tier-at-cap/reconcile-stale; `GET /api/memory/health` +
the hub card). 31 new pins (10 + 21); full package 5454/0/105-skip;
package tsc parity 77=77 both tickets; root tsc 0 / lint 0-142 / unit
2125/0 / check:* all ok at the close (the rail regenerated at 54 stops/525
entries + the blog at 45 posts/112 tags in the same commit). The round's
A2 lane: 16 budgeted chunks across two sessions, with the operator's
completions receipted in each ticket's DECISIONS — including the at-cap
tick-loop deadlock the gate test caught (fixed with the `held` exclusion
set) and the schema layer the chunk-3 receipt had overclaimed (tsc cannot
see SQL strings; the tests exposed it). The round also receipted the
programme's first DUAL-INCARNATION event of this shape: a seventh parallel
lineage brought itself up mid-round (`a380ff19`) and both claimed SM-1 per
the ledger law — the sixth landed first (`061384bb`), the rebase was clean,
and the seventh's in-flight dispatch reconciles on its next fetch. The
S2-11 and S2-4 rows are CLOSED; the release-monitor routine's first weekly
run (2026-11-08) and everything else below still stands.

The hints-ranking round (2026-11-03) is COMPLETE and graduated to its own
log: `docs/hints-ranking-round-session.md` — the browser-autonomy
lineage's polish lane, taken from this queue's own carry-over: the #45
tool-time browser-memory hint digest became **category-balanced** (the
render is newest-first and a mid-round dream's burst of same-class facts
pushed the oldest load-bearing entry — the stress-checkout dialog lesson
— below the 8-entry cap; the selection is now round-robin across the new
ordered `BROWSER_HINT_CLASSES` classifier, file order within a class,
exhausted classes drop out — the lexical cousin of MMR's diversity
constraint, grounded by the round's research receipt: hermes-agent #677's
composite scoring, MMR (Carbonell & Goldstein 1998), PrecisionMemBench).
HR-1 (the implementation, via A2 in 4 budgeted chunks on a fresh session)
shipped: the classifier + round-robin `collectHints` shared by both
digests, 6 new pins in the browser suite (59/0; baseline 53/0), the
`.env.example` `UNOWN_BROWSER_HINTS` doc (the recon drift-finding — the
every-env-var-documented contract), and `docs/browser.md`'s
Category-balanced property bullet. HR-2 (the closeout) landed the
CHANGELOG Agent Behavior entry (`## [Unreleased]` — the first v0.0.56
content) + the rail regenerated in the same commit (54 stops/523
entries), the README round-table row, the round's blog post (the 44th —
44 posts/109 tags), the `A2_GROUND_TRUTH.md` drift-log entry, and this
rotation. Full gate set green at the close: root tsc 0, lint 0/142
baseline, unit 2125/0, check:docs|changelog|blog|benchmarks|claims ok
(claims 62/62), pi-repo self-learning tsc 651=651 pristine parity (zero
new errors). The round also receipted the programme's FIFTH
fresh-lineage bring-up: a full sandbox recycle ate the tree MID-TICKET
(the first dispatch's chunk 4); nothing on `main` was lost because the
round-opening commit (claim, design, research receipt) was pushed before
dispatch — the recovery was a re-dispatch with all learnings baked in,
not a re-plan. The queue's hint-digest ranking item is CLOSED (this
round); the release-monitor routine's first weekly run (2026-11-08) and
everything else below still stands.

The doc-truth round (2026-11-03) is COMPLETE and graduated to its own log:
`docs/doc-truth-round-session.md` — the A1 maintenance track that closed
every honest null and every documented drift the Coda round's graduation
carried forward: (T1) the L1 doc-drift sweep — every §7.4 flag re-derived
from its live source and corrected (the four receipt-only pin decisions,
no pin tests added this round); (T2) the PWA installability/offline-load
benchmark — the PT-5 plan's honest "not measured" null flipped by a real
receipted measurement under `benchmarks/coda-pwa/` (offline boot-from-cache
91 ms median vs online 175 ms median, N=5, the 84 ms delta is the
precache's measured effect; re-runnable on demand, zero model traffic);
(T3) the Coda landing usage capture — the first user-product band on the
landing page (`CodaSection` after `LiveDemoSection`, aqua, `#coda`),
framing the two stills from the new committed in-repo capture lane
(`apps/coda/scripts/capture-usage.mjs` → `public/landing/coda/`, the
e2e spec's own interactions, 1280×800 @2×, PROVENANCE.md sidecar),
plus the thirteenth scroll-budget amendment (15.5 → 16.5vh,
3,950 → 4,060 words — compressed first, canonical e2e twin measured
16.3vh / 4,033w, both gate files moved together, OG shots regenerated);
(T4) the instruction-surface PR-lane candidate — a decision doc
(`docs/instruction-pr-lane-research.md`, evaluation only) that prices
the three live guard events of the round (E1 T2's `benchmarks/AGENTS.md`
ownership-list edit refused and operator-landed; E2 T3's landing
`AGENTS.md` amendment-ledger entry refused and operator-landed; E3 the
Coda round's `apps/coda/AGENTS.md` child DOX operator-landed) and lands
the scoped recommendation: NO-GO on a new standing session-side
`git push` / `gh pr create` primitive, GO zero-cost on documenting the
propose-via-PR path through tools that already exist operator-side — the
gate stays FINAL in-session, byte-for-byte. The T5 closeout (this
graduation) landed the round's blog post
(`content/blog/2026-11-03-the-doc-truth-round.md` — the 43rd post,
`check:blog` green at 43 posts / 106 tags, media reusing the two
committed `public/landing/coda/` stills), the permissions.md's
propose-via-PR paragraph (the Zero-Cost GO's doc edit), the CHANGELOG
`## [Unreleased]` entries for the T4 decision doc + the T5 closeout
content (the blog post rides the round's entries, no double-listing),
and the `A2_GROUND_TRUTH.md` drift-log entry (§7.4's eight flags
RETIRED with T1's receipts; §8 gains the `benchmarks/coda-pwa/` lane
+ the landing capture lane classed per the capability-attribution rule
— both Level-3 compositions of existing mechanisms, no new class).
36 chunks across T1–T5 (8+6+12+3+7, the pre-split law the
round's deviation record prices: registry-derivation +4, measurement
+2, landing-amendment +6 over the authoring baseline, the closeout's
five-file graduation surface +3); 2 operator
unblocks (the amendment ruling + the one-line hue revert, both
operator-side from the receipt's draft-and-land record); 2 instruction-
guard events (the round's E1/E2, the T4 evidence set); the full gate
set green at the gate (typecheck 0, lint 0/142 baseline,
check:docs/changelog/blog/benchmarks/claims all rc=0, the e2e battery
15 passed / 5 skipped (the CODA_E2E marker, by design) / 0 failed).
The round's capability-utilization report + the queue carry-overs
landed at the bottom of the round log.

The Coda app round (2026-11-02 → 2026-11-03) is COMPLETE and graduated to its
own log: `docs/coda-app-round-session.md` — the DRIVE track's app round: the
repo's first user product, **Coda** — a local-first markdown notes + task-board
PWA (offline-first, installable, cross-platform) at `apps/coda/`, planned by
the PT-5 lane (7 live specialist spawns, verdicts applied, 87/100) and
delivered through C1–C5 agent ticket sessions plus the C6 closeout. Receipts:
51/51 domain tests in both bun lanes, 5/5 isolated e2e (the CODA_E2E-guarded
Playwright lane), the offline proof end to end, the CI `coda` job green,
the C6-3a blog post, and the V3-contract retrospective merged into the PT-5
plan via the PTY lane. The next round opens from the queue below.

The exit-resume round (2026-11-02) is COMPLETE and graduated to its own log:
`docs/exit-resume-round-session.md` — the Ctrl+C-exit → resume lane, opened
by the operator's report that the exit hint printed `pi --session-dir 'C:\…'`
on Windows: the hint now names the launcher you actually ran (`unown --resume
<id>`), quotes for the host shell (double quotes on win32 — single quotes are
literal characters in cmd.exe), prints on BOTH exit paths (interactive quit
and SIGTERM/SIGHUP) after terminal restore, and the first Ctrl+C on an empty
editor shows the "Press Ctrl+C again to exit" notice. The round's deeper fix:
an exit DURING a running turn rode a fire-and-forget abort that raced
`process.exit()` — a first turn with no finalized assistant message yet was
lost entirely (the no-assistant guard buffers in memory: no file, no hint);
the exit now runs the same cooperative abort matrix as Esc//abort and awaits
idle (bounded 2 s) before disposing, with the aborted marker normalized at
the agent-loop boundary. Receipt: `scripts/tui-capture/verify_resume_hint.py`
(boot → double Ctrl+C → parse the printed command → run it VERBATIM →
history visible; the same for a mid-stream-interrupted session), plus 50 unit
tests across the three touched packages. Research record:
`docs/exit-resume-round-research.md`.

The fresh-clone round (2026-11-01 → 2026-11-02) is COMPLETE and graduated to
its own log: `docs/fresh-clone-round-session.md` — the operator-directed
bring-up (clone → setup → run, proven on two cold machines including a
recycled lineage) plus both lanes it surfaced, both closed: issue #30 (the
`unown -p` exit hang — the armed /proc watcher committed as
`scripts/issue30_watcher.mjs` with 22/22 clean-run non-repro receipts across
idle + dream-churn lanes, and the issue's request (b) shipped as the
`UNOWN_PRINT_EXIT_TRACE=1` exit-path instrumentation through an eleven-chunk
A2 ticket) and PT-5 (the live plan-mode V3 specialist-spawn receipt, above).
Its `A2_GROUND_TRUTH.md` (the dated capability snapshot, 8 doc-drift flags)
stays the operator's recon reference until the next teardown refresh.

The browser autonomy round 2 (2026-11-01) is complete and graduated to its
own log: `docs/browser-autonomy-round-2-session.md` — the continuation round
that closed round 1's entire carries-over queue: #46 fixed on all three
fronts (the claims gate's memory route is now EXACT with a
Manual-notes-remedy failure line — the silent-drift half root-caused to
`extractTemplates` reading markdown code spans as template segments, so a
pruned line passed on an unrelated 12-char window; the renderer's
Manual-notes preservation pinned against cap-pruning renders; the convention
documented in loop.tsx and docs/memory.md), #44 fixed (screenshot extension
honored, format clashes fail loudly — pinned unit/live/e2e), **#45
implemented and measured** (the tool-time browser-memory hint lane: the
first browser call carries a bounded digest of browser-relevant memory, the
first navigate to a known host carries its slice — stress-checkout run 6
PRE-ARMED the dialog accept before the triggering click, the trap prevented
for the first time in six runs; BROWSER-7's proactive-application verdict
moves to VALIDATED), the warm docs-navigation benchmark run on a second
technology (MDN Canvas roundRect: 12 calls / 39.5 s, all overloads +
exception verified, zero interventions, plus a fresh-project control where
the lane correctly stays silent), and the hostile-page-checkout skill
promoted and session-verified. Commits: `6224668c` → `fe8b5f9c` →
`c1272620` + the closeout.

The browser autonomy round (2026-11-01) is complete and graduated to its
own log: `docs/browser-autonomy-round-session.md` — the browser dogfooding
& self-improvement mission: nine lanes receipted (research, PM ops, docs
navigation, user simulation, long-horizon monitoring, memory, failure-driven
improvement, self-dogfooding), two real defects found AND fixed in-round
(the F3 iframe fill_form silent-loss race — live-pinned against a real
Chromium; the F4 dev-server no-hydration-by-IP-literal trap — config-pinned),
the memory loop receipted both ways, a systemic dream-drift class filed
(#46, second occurrence), the competitor research committed (nobody
persists failure memory — the open axis), and the ten-benchmark suite with
honest nulls under `benchmarks/browser-autonomy-round/`. The parallel plan
mode V3 round (`docs/plan-mode-v3-session.md`) raced this round on main
(two rebases, zero conflicts) and has since completed (M1–M8, with the
round retrospective) — its status line now says so.

The security round (v0.0.55, 2026-11-01) is complete and graduated to its
own log: `docs/security-round-session.md` — every open Dependabot advisory
(follow-redirects 1.16.2 HIGH, minimatch 11.0.1 MEDIUM, regenerated on all
five vendored surfaces) and every open CodeQL finding (CSPRNG task ids, the
linear trailing-slash sweep across eleven sites) addressed, the
coverage-v8 PR declined on its exact-pin peer contract, v0.0.55 tagged on
green 3-OS CI and published.

The dependency round (v0.0.54, 2026-11-01) is complete and graduated to its
own log: `docs/dependency-round-session.md` (research and decisions:
`docs/dependency-round-research.md`) — six within-policy updates, each stage
gated, the framer-motion bump proven by an A/B pixel diff, v0.0.54 tagged on
green 3-OS CI and published.

The completed rounds before it: the Settings Evolution round (v0.0.49 +
v0.0.52 — `docs/settings-evolution-session.md`), the plan-mode todo
unification + footer quiet rounds (v0.0.53 —
`docs/plan-mode-todo-unification-round-session.md` +
`docs/footer-quiet-round-session.md`), and the release-recovery round that
re-cut v0.0.53 after its first tag landed against red CI
(`docs/release-recovery-session.md`).

**The next round's queue (recorded, in priority order)**: the doc-truth round
(2026-11-03) closed its whole scope — the Coda round's three carries-forwards
(the landing usage capture, the instruction-surface PR-lane candidate, the PWA
benchmark receipt) plus the L1 doc-drift sweep are all DONE and receipted in
`docs/doc-truth-round-session.md`; what IT carries forward: the
`docs/permissions.md` propose-via-PR paragraph's follow-up is a drift-trip
trigger only (NOT a scheduled ticket — the convention works at 3-for-3 clean
landings; the trigger is an observed receipt-drift incident tied to a
guard-event draft, per the decision doc's §9), and the four T1 receipt-only
pin surfaces stay a deliberate no-pin (legitimately-growing registered
content). Then the
browser autonomy round 2 closed its predecessor's carries-overs (#46, #45, #44, the
warm docs-navigation benchmark, the skill promotion) — what remains of the
browser-autonomy lineage: the release-monitoring routine's first weekly run
(`auto-mvxw0wne-onkwcn`, 2026-11-08 — the multi-day lane's first real
datum); the hint-digest ranking refinement is CLOSED (the hints-ranking
round, 2026-11-03 — the category-balanced round-robin selection, see the
graduated log above); the S2 ledger's head — S2-11 (the spend meter) and
S2-4 (the memory health card) — is CLOSED (the spend-and-memory-health
round, 2026-11-04, both misses flipped 12/12 — see the graduated log
above); then the pre-existing queue: S2-7/S2-8/S2-9, the
S2-3/S2-16 L-pair, S2-22 (see the settings log's "Resume-from-here"); the
injection-scanner ML classifier (the production TODO); the delegation
round's subagent-reuse axis; OB-7 (fleet outcomes in the brief); the
landing next-round queue (cmd-K search, blog hover-previews); the term.ts
snapshot-class follow-up (release-recovery CP2); the plan mode V3 round's
own milestones (its session log owns that queue). When the first v0.0.56
content lands, re-add `## [Unreleased]` to CHANGELOG.md and regenerate the
rail in the same commit; the version bump itself is the release commit
(package.json version + dated heading + rail + tag on the green SHA).

### Environment checkpoint (2026-11-04, the Ostinato round — eighth lineage bring-up)

- Sandbox recycled again; re-cloned @ `189fa033` (=`origin/main`) into
  `/home/z/my-project/Unown`; PAT rewired into the remote + the off-repo
  credential store (`/home/z/my-project/.creds`, exposed as
  `/home/z/my-project/.secrets` per the survival convention). bun **1.4.3**
  re-pinned **project-locally** at `/home/z/my-project/.tools/bun-linux-x64`
  (a new pattern — prior lineages' global upgrades died with recycles; a
  project-local binary survives). `UNOWN_NO_LINK=1
  UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts` green; `.env` authored
  minimal + duplicate-free (the Agnes lane: upstream URL, key,
  `BRIDGE_KNOWN_MODELS`, `PI_MODEL_ID=agnes-3.0-flash`,
  `UNOWN_HOME=/home/z/my-project/unown-home`).
- Stack: bridge `:3031` (upstream 200, 6 agnes models), engine `:3030`
  (v0.0.55/`189fa033`, fresh DB). Doctor "ready to chat" (20✓/2⚠:
  model-spec + LSP — the honest first-session pair). Smoke 1/1 `UNOWN_OK`
  exit 0 in 3.7 s, dispatched through the REBUILT daemonizer (the recycle
  had reclaimed `scripts/dispatch-bg.py` + `tickets/`; rebuilt and
  re-validated: PPID-1 supervisor, log/pid/exit receipts, mirror
  re-staged).
- The round-opening commit (this one) lands the Phase 0 artefact set: the
  PRD, the reliability coverage matrix, the augmentation registry (empty
  per Phase 0), the benchmark scaffold (canaries armed, honest nulls), the
  ground-truth refresh, this rotation, the CHANGELOG entry + the
  regenerated rail. O-1 (canaries + the app skeleton) dispatches next,
  after the H-1 smoke and the H-3 PTY-audit pre-checks.
- **O-1 LANDED 2026-11-04 (the ninth lineage's first push)**: canaries
  C1 3/3 · C2 2/3 (variant B's cap-overflow receipted — the honest
  baseline spread) · C3 3/3; the skeleton at `apps/ostinato/` (13 files,
  Lane A 5/5, Lane B 5/5, receipt tree-verified). The H-3 pre-dispatch
  audit harvested bug-register B-1 (the first-flight tip overwrites the
  `/abort` notice) + B-2/V-9 (the PTY backpressure law) — fix tickets
  **A2H-1/A2H-2** join the queue after O-2. The registry's PROPOSE rows:
  H-4 (pump-while-typing), H-5 (isolated UNOWN_HOME per lane), H-6 (the
  status-line collision guard). Next: O-2 (the domain core), then the
  A2H pair.
- Operator tools that must survive recycles:
  `/home/z/my-project/scripts/dispatch-bg.py` +
  `/home/z/my-project/tickets/` + `/home/z/my-project/.secrets` + the
  project-local bun at `/home/z/my-project/.tools/`.

### Environment checkpoint (2026-11-04, the spend-and-memory-health round — seventh lineage bring-up)

- Sandbox recycled again after the round-opening commit; re-cloned @ `b66014cf` (=`origin/main`) into `/home/z/my-project/Unown`. bun **1.4.3** re-pinned (the sandbox ships 1.3.14). `UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts` green; `.env` from `.env.example` with the Agnes lane set IN PLACE (key set, `UNOWN_HOME=/home/z/my-project/unown-home`).
- Stack: bridge `:3031` (upstream 200, 6 agnes models), engine `:3030` (v0.0.55/`b66014cf`, fresh DB — the known recycle limit). Doctor "ready to chat" (LSP + model-spec the honest ⚠). Smokes 3/3 `UNOWN_OK`; the pipe-holding quirk reconfirmed environmental — long dispatches ride the rebuilt `/home/z/my-project/scripts/dispatch-bg.py` daemonizer (validated end-to-end: PPID 1, log/pid/exit receipts), and A2 receipts mirror at `/home/z/my-project/tickets/receipt-mirror.md`.
- Pre-ticket baseline ALL green: typecheck 0, lint 0 errors, unit **2125/0** (157.9 s), check:docs|changelog|blog|benchmarks|claims ok (claims 62/62). SM-1 (S2-11 via A2, ~4 chunks) dispatches next.
- Reconciliation update: the seventh lineage's in-flight SM-1 (chunks 1–2, tree preserved on `sm1-wip` @ `46cc2f8c`) is superseded by the sixth lineage's SM-1 @ `061384bb` + SM-2 @ `2efef3e9` (the dual-incarnation arbiter: first-on-main wins; adopt on fetch — receipted in the round log). The round's remaining ticket: **SM-3, the closeout**. Operator tools that must survive recycles: `/home/z/my-project/scripts/dispatch-bg.py` + `/home/z/my-project/tickets/` (receipt mirror, prompts, logs) + `/home/z/my-project/.secrets/` (PAT + Agnes key).

### Environment checkpoint (2026-11-02, the fresh-clone round — resume + ground truth)

- Sandbox recycled after the round's M1; re-cloned @ `5fe50ca8` into
  `/home/z/my-project/Unown`. bun **1.4.3** re-pinned (1.4.4 still has the
  frozen-lockfile regression). `UNOWN_NO_ENGINE_SERVICE=1 bun run agent:install`
  7/7 green again; `.env` with the Agnes upstream +
  `UNOWN_HOME=/home/z/my-project/unown-home` (persistent across recycles).
- Stack re-up: bridge :3031 (upstream ok 200, 6 agnes models), engine :3030
  (phase ready, v0.0.55). Doctor green (1 expected ⚠: no LSP).
- **Issue #30 probe: 6/6 clean headless runs** against an idle engine — the
  issue's correlation is active-engine-harness windows, so the M2 repro lane
  now pairs `unown -p` loops with live engine churn plus an armed /proc
  watcher (see the round log's refined M2 plan).
- `A2_GROUND_TRUTH.md` opened at the repo root — the A1 operator's dated
  capability snapshot (8 doc-drift flags recorded; the utilization audit
  classifies #30 as triggered-but-unverified → Level 4 instrumentation
  first).
- Operator decisions (2026-11-02): the DRIVE app is **Coda** (local-first
  markdown notes + task-board PWA) at `apps/coda/` in this monorepo; push
  lane direct to `main`; this round finishes (#30 → PT-5 → closeout) before
  the Coda round opens.

### Environment checkpoint (2026-11-01, the browser autonomy round — closeout)

- Sandbox lineage `/home/z/my-project/unown`, the round's commits `e7e0a43d`
  (open) → `5eb1b973` (receipts) → `0e9eca7e` (F4+F5 fixes, CI green) →
  `0d0c64ff` (F3 fix, rebased) → `7c2ae976` (the birthday-flake freeze +
  occurrence-2 restoration, rebased).
- **Parallel-round discipline** (new, earned the hard way): the plan mode
  V3 round pushed twice mid-flight; both reconciled by fetch → rebase
  (zero conflicts — disjoint surfaces) → fast gates → push. A rejected
  push is a fetch, never a force.
- Engine-suite sandbox honesty: full-suite runs under a live engine +
  concurrent agent sessions flake in engine-adjacent timing tests
  (outbox/automations/PLM) on BOTH trees — the control experiments
  (isolation runs, pristine-tree runs, quiet-sandbox reruns) are the
  receipts; CI is the authoritative gate.
- The round's stack facts: bridge + engine mortal across recycles (re-run
  `bun run agent:start`); the fixture server `python3 -m http.server 8090
  --directory benchmarks/browser-autonomy-round/fixtures`; the release
  monitor routine `auto-mvxw0wne-onkwcn` lives in the engine DB (weekly,
  read-only).

### Environment checkpoint (2026-11-01, the browser autonomy round)

- Sandbox lineage `/home/z/my-project/unown` (fresh lineage — prior
  workspaces reclaimed), clone @ `22d3e725` (main, v0.0.55). bun **1.4.4**
  (upgraded in-sandbox from 1.3.14 — the 1.4 lockfileVersion-3 floor).
- `UNOWN_NO_ENGINE_SERVICE=1 bun run agent:install` 7/7 green; `.env` with
  the Agnes upstream (key set, `agnes-3.0-flash`); `UNOWN_HOME` at its
  default. Stack: bridge :3031 (upstream ok 200), engine :3030 (phase
  ready). `unown doctor` green (1 expected ⚠: no LSP in the container).
- Baseline gates green on the pristine tree: typecheck 0, lint 0 errors,
  unit 2067/0, all five `check:*` gates ok.
- Playwright `chromium-1200` in the ms-playwright cache — the browser
  tool's discovery path; headless default in the sandbox.

### Environment checkpoint (2026-11-01, the dependency round)

- Sandbox lineage `/home/z/my-project/Unown`, clone @ `72110634` (8 commits
  past `v0.0.53` — the CI-gate rounds). bun **1.4.3** (CI's pin; the
  sandbox's 1.3.14 was upgraded before any install — sub-1.4 bun rewrites
  the root bun.lock down to v1-with-dropped-overrides).
- `UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts` green;
  `.env` from `.env.example` with the Agnes upstream
  (`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`, key set,
  `BRIDGE_MODEL=agnes-3.0-flash`), `UNOWN_HOME=/home/z/my-project/unown-home`.
- Playwright chromium installed for the e2e + shot lanes. A stale
  `next-server` process on :3111 serves the previous build's chunk names —
  kill with `pkill -9 -f next-server` (the renamed process defeats a
  `standalone/server.js` pattern).
- Real-user smokes green: bridge upstream ok 200 (6 agnes models), engine
  v0.0.53, `unown -p` round trip `UNOWN_OK`, doctor green (2 expected ⚠).

### Environment checkpoint (2026-11-01, the recovery session — updated)

- Sandbox recycled between sessions (the prior workspace was reclaimed);
  the repo re-cloned @ `53b8d766` (v0.0.53's first tag) into
  `/home/z/repos/Unown` — the PTY harness needs
  `UNOWN_ROOT=/home/z/repos/Unown` (its default points at the prior
  sandbox's path).
- bun **1.4.3** (CI's exact pin; `npm i -g bun@1.4.3`).
- `UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts` green;
  `.env` from `.env.example` with the Agnes upstream
  (`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`, key set,
  `BRIDGE_MODEL=agnes-3.0-flash`); `bun run agent:start` — bridge :3031
  (upstream ok 200, 6 agnes models), engine :3030 (v0.0.53).
- Playwright chromium installed for the e2e lane (the sandbox ships without
  it); `python3 -m pip install pyte pillow` for the PTY harness.
- The prior settings-round environment notes (bun 1.4.4, the
  `/home/z/my-project/Unown` lineage) are history — superseded above.

- Round 1 cloned @ `68055455` (v0.0.48); round 2 cloned @ `499a9412` (v0.0.50,
  main) — one sandbox lineage, `/home/z/my-project/Unown`.
- bun **1.4.4** (floor 1.4 — lockfileVersion 3; upgraded in-sandbox from 1.3.14).
- `bun run agent:install` 7/7 green — `unown` linked → `~/.local/bin/unown`;
  engine OS service skipped in the container (no systemd user bus — the
  agent-side auto-start fallback carries it, per docs/routines.md).
- `.env` from `.env.example`; `BRIDGE_UPSTREAM_KEY` set (Agnes AI);
  upstream `https://apihub.agnes-ai.com/v1`, model `agnes-3.0-flash`;
  `UNOWN_HOME=/home/z/my-project/unown-home` (the documented override —
  sandbox containment).
- `bun run agent:start` — bridge :3031 (upstream ok 200, 6 agnes models),
  engine :3030 (phase ready, token auth, v0.0.50).
- `unown doctor` — green (2 expected warnings: unverified model spec, no LSP).
- Real-user smokes: `unown -p "Reply with exactly: UNOWN_OK"` → `UNOWN_OK`;
  PTY lane `verify_settings_hub.py` EXIT=0 (hub opens, editor persists,
  subcommands answer).

### Architecture facts established (read before resuming)

- The TUI's built-in `/settings` is hard-intercepted in
  `pi-repo/packages/coding-agent/src/modes/interactive/interactive-mode.ts`
  (`setupEditorSubmitHandler`) BEFORE extension dispatch; extension commands
  dispatch through `session.prompt()` → `_tryExecuteExtensionCommand`, and
  the autocomplete provider FILTERS OUT extension commands whose names clash
  with built-ins. An extension-registered `/settings` is therefore shadowed
  in the editor path — overriding requires the two minimal vendored patches
  (guard the interception with `!isExtensionCommand(text)`; let the extension
  command replace the built-in in autocomplete). The repo DOES patch vendored
  files when justified (precedent: `/abort` round 68055455 touched
  agent-session.ts + runner.ts + interactive-mode.ts with tests + PTY lane).
- Unown's settings surface (post-hub): the `/settings` control centre
  (`src/settings/` — 89 registry items across the ten IA sections; the
  cross-cutting search/health/diff/recent/transfer surfaces) plus the
  surfaces it links: `/permissions`, `/project-settings`, `/providers`, the
  ~65 other Unown slash commands, env vars (`.env.example`), CLI flags
  (`cli.ts` HELP), and the config files (`settings.json`, `addons.json`,
  `models.json`, `auth.json`, `mcp.json`, hooks config, permissions config,
  `.unown/settings.json`, and the hub-owned `settings-hub.json` +
  `settings-history.jsonl`). The open items live in the S2 ledger
  (`docs/settings-evolution-session.md`).
- Round conventions (from `/abort` + PLM rounds): competitor research doc,
  session log, code (self-learning ± vendored pi), unit tests BOTH suites,
  PTY verification script under `scripts/tui-capture/`, CHANGELOG entry,
  landing/blog/DOX updates, push per milestone.

### Phase ledger

| Phase | Status | Artifact |
|---|---|---|
| 0 setup + run | ✅ done (rounds 1+2) | this file |
| 1 inventory | ✅ shipped | `docs/settings_inventory.md` |
| 2 competitor research | ✅ shipped (+ round-2 pass) | `docs/settings_competitor_review.md` · `docs/settings-round2-research.md` |
| 3 user journeys | ✅ shipped | `docs/settings_user_journeys.md` |
| 4 IA redesign | ✅ shipped | `docs/settings_ia_redesign.md` |
| 5 edge-case catalogue | ✅ shipped | `docs/settings_edge_case_catalogue.md` |
| 6 trust engineering | ✅ shipped | `docs/settings_trust_recovery_framework.md` |
| 7 missing settings | ✅ partial — the rest is the S2 ledger | `src/settings/` + `dream-review.ts` |
| 8 TUI redesign | ✅ shipped | `src/settings/` + vendored patches + `verify_settings_hub.py` |
| 9 benchmarks | 🔜 round 2 M2 | `benchmarks/settings-ux/` (to be built) |
| 10 self-improvement | 🔜 round 2 M6 | learning artifacts |
