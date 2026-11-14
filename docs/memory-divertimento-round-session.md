# The Memory Divertimento round — fix what broke, prove the patterns, make it delightful (2026-11-14, IN FLIGHT)

**Mission:** evaluate the detached memory system architecture by
reverse-engineering similar products/tools/projects (at least five — this
round tore down five new-wave platforms and swept the 2025–2026 papers and
the consumer memory-UX field) to understand what they are doing that is
proven better by user experience or research, then augment Unown, fix
whatever breaks, improve the overall architecture, add visual indicators
for user delight, and cover the edge cases.

The name: a *divertimento* is a light, delightful musical form — the round
that ships the proven architecture patterns **and** the user-delight
surfaces, after Recital (benchtested the loop live) and Encore (the visible
layer) and v2 (the memory model).

The findings in one paragraph: the teardown
([TEARDOWN_2026-11-14_new-wave-memory-platforms.md](TEARDOWN_2026-11-14_new-wave-memory-platforms.md))
and the research grounding
([memory-divertimento-round-research.md](memory-divertimento-round-research.md))
agree with an in-repo audit: the v2 round's three upgrades are
**half-shipped** — the review queue is an orphan module with zero callers
(hoists still auto-write), the recall path leaks superseded memories as
current (the soft-delete-leak class MIRIX's security review fixed), and
the per-type budget never replaced the flat cap. The field's proven
upgrades since: deterministic (subject, relation, object) supersession —
similarity-based conflict detection measures at AUROC 0.59, chance
(MemStrata); usage-conditioned decay with recurrence reset (MIRIX's
experience pool: `score = sim × 0.5^ignored_pushes`, retire at 3 ignored,
recurrence resets); the doctor that proves the loop (memU); interchange
with a human gate (memU's whole pitch); and the consumer-UX law — visible
provenance (Gemini Statement+Rationale) with honest counts, never silent
influence (the ChatGPT anti-pattern, quantified: 96% of memories created
unilaterally).

## Phase ledger

| Phase | Status | Artifact |
|---|---|---|
| CP0 research + code map + baseline bring-up | ✅ done | teardown + research docs + this file's code map + the verified baseline below |
| CP1 the integrity lane — wire the review queue, seal the recall path, per-type budget, env/docs sync | ✅ done | `memory-review.ts` (user-level queue, `-r<N>` re-park) + new `memory-review-ship.ts` (the only write path: re-dedupe + re-guard at decision time, `shippedVersion` stamped after both writes land) + `hoist.ts` rewired (park, never auto-write) + search-path `latest_only` on `searchMemories`/`searchAcrossScopes`/`/api/memories` (+ `/memory search --all` badged) + `renderTypeShares`/`allocateTypeBudget` + `## Preferences`/`## Episodes` sections + per-type footer + `/api/memory/review` routes + `/memory review` + `unown memory review` (degraded local read) + the dashboard review card + `reviewQueueDepth`/`review-pending` + env/docs sync + DOX (self-learning AGENTS.md, memory.md, configuration.md, unown-overview re-stamp) + CHANGELOG×4 + tests: memory-review 18, memory-review-ship 8, hoist 18 reworked, memory-recall-integrity 15, manual-notes/budget/freshness re-pinned |
| CP2 deterministic supersession — SRO keys in the reconcile | ✅ done | `parseSro`/`normalizeSroPart`/`sroClaimKey`/`sroFullKey`/`sroContradictionGroups`/`applyDeterministicSroSupersedes` + the post-LLM wiring in `reconcileMemories` (`sroApplied`/`sroSkipped` on ReconcileResult, never re-opening an LLM verdict) + `MEM0_CUSTOM_INSTRUCTIONS` SRO tagging + `RECONCILE_SYSTEM` no-merge rule + the reconcile listing enrichment + `DreamOutcome.sroApplied` + the dream-note ", K deterministic" fragment + `countSroTagged`/`sroTaggedCount` on the health card + docs (memory.md, AGENTS.md, unown-overview) + `test/memory-sro.test.ts` (15) |
| CP3 usage-conditioned decay — render-exclusion dormancy with recurrence reset | ✅ done | `mem0DormantAfter`/`DormancyEntry`/`readDormancyRecord`/`writeDormancyRecord`/`isDormantId`/`trackDormancyFromPlan`/`reviveDormantByIds`/`dormantCountFor`/`dormantCountAll`/`dormancyScopeKey` + `computeRenderPlan` (extracted from the render, byte-identical) + dream.ts consolidate wiring (`dormantNew`/`dormantResets` on DreamOutcome) + server.ts `annotateAndReviveDormancy` (badge + revive on every search lane) + memory-health `dormantCount` + dashboard-types + env/docs (PI_MEM0_DORMANT_AFTER in .env.example + configuration.md; memory.md; AGENTS.md; unown-overview) + `test/memory-dormancy.test.ts` (10) |
| CP4 the delight lane — provenance badges, honest counts, the AutoDream digest | ✅ done | tools.ts search badges (type/hard-won/freshness stamp/dormant-revived) + the store-free `memory-stamps.ts` (single definitions, re-exported; the terminal tools never import the engine DB) + `countProjectStaleRules`/`MemoryBarInfo.stale` + the recall line's `(N stale)` fragment + dreams-table `entries_superseded`/`entries_dormant` (schema + migrations + threading through all dream-row writes) + `latestDreamNews` digest fields + `DreamNews.superseded/dormant` + `dreamNewsToastText` digest + /memory show's `not injected · N dormant` line + the dashboard fact line's dormant/sro counts + docs (memory.md delight section, AGENTS.md, unown-overview) + `test/memory-delight.test.ts` (6) |
| CP5 `unown memory doctor` — the audit that proves the loop | ✅ done | new `src/memory-doctor.ts` (`auditProjectMemory`/`renderMemoryDoctorReport`/`liveMemoryDoctorEngine`) + the cli.ts subcommand + HELP + the `unown doctor` store row + docs (memory.md, AGENTS.md, unown-overview) + `test/memory-doctor.test.ts` (6) |
| CP6 memory interchange — export/import behind the human gate | ✅ done | `src/memory-interchange.ts` (schema v1 builders, the parse/refuse, the trust gate, injectable park/write appliers) + `GET/POST /api/memory/interchange` (engine-side validation, one source of truth) + `unown memory export [--out]` / `import <file> [--apply]` + the unknown-flag guard's per-family subcommand surfaces (the live smoke's own find: --reason had been broken since CP1) + docs (memory.md incl. a duplicate-bullet cure, AGENTS.md incl. a duplicated-CP5-sentence cure, README, CHANGELOG) + `test/memory-interchange.test.ts` (21) + 4 parse-args pins; **the same-day parallel-lineage reconciliation** (two lineages shipped CP6 within the hour — first-landing `1397ca4f` governs, the second folded in): the dedupe lane (`importDedupeKey`/`classifyImportRecords{existingTexts}`/`duplicates`, the route injects the queue for park + the scopes' live rows for apply — re-imports converge), the pre-parse `IMPORT_MAX_FILE_BYTES` CLI cap (5 MiB via statSync before readFileSync/JSON.parse), `shipChangedBy` (the approve's attribution names memory-import, never "hoisted from 0 project(s)"; the memory:changed emit carries changedBy), the memory.md dedupe bullet + the unown-overview doubled-doctor-sentence cure + the interchange counted + re-stamped, and `test/memory-interchange-reconcile.test.ts` (9) + `test/memory-interchange-api.test.ts` (5) |
| CP7 verification + docs/landing/blog/DOX + CHANGELOG + version + release | ✅ done | the full battery (engine 5727/0 · root unit 2094/0 · e2e 15/15 · both landing twins green at 4,608w ≤ the amended 4,612 ceiling / 20.2vh · typecheck 0 · lint 0 errors · all five landing checks green, rail 61 stops / 590 entries · Dependabot 0 · code-scanning 0) + the v0.0.66 cut (the CHANGELOG fold — the interchange entry MOVED from the 0.0.65 section where the landed CP6 had parked it post-tag into [0.0.66] where the code actually ships, plus the reconciliation Fixed entry; the 0.0.66 title compressions -2w; the historical-lead hygiene compressions v0.0.31/v0.0.2/v0.0.7; the budget-twin amendment 4,590→4,612 both twins, the 61st stop's +23w structural cost per the 0.0.44/0.0.48/0.0.62/0.0.65 precedent; package.json 0.0.66; unown-overview re-stamped) |

## CP0 — the research, the code map, the baseline (2026-11-14)

**Research** (every claim sourced, the grading convention `[V]/[C]/[U]`):

- Five new-wave platforms, none covered by the earlier teardowns:
  **memU** (NevaMind-AI, 14.6k★ — the store-verifies/agent-distills split,
  the self-mining contamination fix, 22 published ADRs), **MIRIX +
  MIRIX-2.0** (six typed stores, AutoDream with `dry_run`, the
  experience-pool decay `score = sim × 0.5^ignored_pushes` with recurrence
  reset and retire-at-3, the 2026-11-09 security review's 11 fixed defect
  classes including deleted-memories-still-searchable), **Nemori**
  (predict-calibrate distillation — only prediction-error deltas become
  knowledge), **Memobase** (the profile artifact; **temporal 85.05 vs the
  Mem0 store Unown runs at 55.51 on LoCoMo** — the round's clearest
  proven-better signal), **Hindsight** (61k★, refine-don't-overwrite
  observations, purpose-built small models).
- The 2025–2026 papers: LightMem (ICLR 2026, 68.64% LongMemEval-S at
  ~57× token reduction), MemStrata/Temporal Validity (**similarity-based
  supersession at AUROC 0.59 = chance; the deterministic SRO rule takes
  stale-fact errors 15–40% → ~0%**), CALM, StateGraph, DISCERN (recall
  saturated, resolution is the frontier), CAMeR (time-driven decay
  collapses to ~zero; use-conditioned reinforcement is the driver), RSPM,
  MemDream, the LongMemEval-V2 AgentRunbook-C result (**files + a coding
  agent gathering evidence: 72.5% vs best RAG 48.5%**), the memory-security
  literature (Memory Trust Gap; poisoning as a live class).
- The consumer-UX field: ChatGPT's two-track memory and its documented
  failures (context rot, invisible influence, untrustworthy deletion);
  Gemini's **Statement + Rationale** schema and Memory-history timeline;
  Claude Code's explicit-truncation discipline and visible load
  indicators; the scrutable-memory research (Memory Sandbox; TEARS;
  CareCall).

**The code map — where this round lands** (verified at HEAD `0d1a8cf0`,
v0.0.64):

| Concern | Sites |
|---|---|
| The orphan review queue | `src/memory-review.ts` (park/list/approve/discard, `:85-180`; queue `<project>/.unown/memory/review-queue/`, `:61-63`) — zero callers; `src/hoist.ts:304-341` still auto-writes both user tiers |
| The leaking recall path | `filterLatestOnly` runs only in `renderProjectMemoryMarkdown` (`src/memzero.ts:2122`); `searchMemories` (`:1300-1309`), `searchAcrossScopes` (`:1330-1352`) and `GET /api/memories` (`src/server.ts:917-989`) never apply it |
| The flat cap | render cap loop `src/memzero.ts:2133-2163` (110/60, type-agnostic); `RENDER_SECTIONS` `:2178` (six classic sections, no preference/episode) |
| Reconcile (CP2 lands here) | `reconcileMemories` `src/memzero.ts:1538-1785`; `RECONCILE_SYSTEM` `:1482-1500`; SUPERSEDE stamping `:1690-1725`; fresh-evidence protection `:1613-1686` |
| Freshness/typing (CP3 extends) | `memoryFreshnessStamp` `src/memzero.ts:145-200`; `MemoryType`/`mem0StaleDaysForType` `:254-286`; render `:2098-2259` |
| The TUI/CLI/dashboard surfaces (CP4 lands here) | `/memory search|show` `src/tools.ts:4630-4725`; `unown memory` (no subcommands) `src/cli.ts:220`, `cmdMemory` `:1807-1817`; the recall line `src/engine-status.ts:450-454` + latch `src/termhooks.ts:571-578,739-749`; the dream-news toast `src/engine-status.ts:427-433`; the health card `src/dashboard/screens/memory-screen.ts:191-234`; `MemoryHealth` `src/memory-health.ts:149-170` |
| The dream outcome (CP4's digest) | `DreamOutcome` `src/dream.ts` (entries_merged/pruned/added); dream rows `src/store.ts:97-108` |
| Health/API (CP1 adds routes) | `engineMemoryHealth` `src/memory-health.ts:342-355`; `GET /api/memory/health` `src/server.ts:992-1001`; no `/api/memory/review` routes exist |

**The baseline bring-up, verified on the pristine tree `0d1a8cf0`:** bun
1.3.14 → 1.4.4 (the ≥1.4 floor; the lockfile needs it); root + pi-repo
`bun install`; model data hydrated (40 provider files); `build:offline`
green (52 files / 8.5 MiB); `.env` bootstrapped from `.env.example` with
the Agnes AI upstream injected (`BRIDGE_UPSTREAM_URL` +
`BRIDGE_UPSTREAM_KEY`, gitignored 0600, no credentials in the tree);
`agent:start` boots engine (:3030) + bridge (:3031); print-mode smoke
round-trips through the Agnes upstream. Suites: typecheck 0; lint 0
errors (144 pre-existing warnings, unchanged); root unit **2094/0**;
engine **5598/0** (+105 live-gated skips, after `build:offline` — without
it the suite shows ~250 fails, the known first-run trap, re-confirmed);
bridge 248/0; `check:docs` / `check:changelog` (59 stops / 576 entries /
58 dated) / `check:claims` (62 literals) / `check:benchmarks` all green;
`unown doctor` green with the stack up; `bin/unown --version` = 0.0.64.

## The plan, checkpoint by checkpoint

- **CP1 (the integrity lane — "fix whatever breaks"):** wire the review
  queue end-to-end (hoist promotions park into it — never auto-write;
  `/api/memory/review` list/approve/discard + depth; `unown memory
  review` CLI; `/memory review` TUI command; dashboard drill-in +
  `reviewQueueDepth` in the health card); apply `filterLatestOnly` on the
  search path with a `latest_only` flag (superseded results badged, never
  silently current); the per-type render budget + `RENDER_SECTIONS`
  extension; the MIRIX soft-delete-leak class as a pinned regression
  battery; env/docs drift sync; dead-code removal.
- **CP2 (deterministic supersession):** SRO keys — normalized
  (subject, relation, object) per memory; same-SRO + newer confirmed
  evidence supersedes deterministically inside the existing bi-temporal
  stamps; similarity-only conflicts demote to the review queue instead of
  auto-supersede; the numeric-merge guard as a reconcile test case.
- **CP3 (usage-conditioned decay):** per-memory consecutive
  render-exclusion counters; dormancy at the threshold (default 3) —
  excluded from injection candidacy, badged in search, reversible by
  re-assertion (recurrence reset) or a search hit; the health card and
  recall line learn the dormant count.
- **CP4 (the delight lane):** `/memory search` results carry provenance
  (scope badge, source kind, confirmed date, dormant/superseded badges —
  the repo's own open item #8); the recall line gains honest counts
  (stale · dormant, only when non-zero); the dream-news toast extends
  into the post-consolidation digest (+learned · superseded · dormant ·
  vN — the "AutoDream Wrapped" mini); `/memory show` lists the dormant
  section under the exact-stack contract; the dashboard Memory screen
  gets the review-queue card. Cross-platform + keyboard verified via the
  PTY matrix lane.
- **CP5 (`unown memory doctor`):** the audit pass — duplication
  (normalized-text groups), recall-integrity (the CP1-sealed path),
  tier-budget usage vs caps, placement (which tier a rule belongs in),
  review-queue depth, dormant/stale counts, derivable-from-repo content
  (report-only), remediation hints; a live retrieval probe (the memU
  `doctor` shape); wired into `unown doctor`'s memory row.
- **CP6 (interchange):** `unown memory export` — schema v1 JSON carrying
  memories (text, type, SRO, confirmedAt, provenance, supersede links,
  dormancy) + metadata; `unown memory import` — trust-gated: structural
  quarantine per rule, char caps, schema-version refusal, and imports
  land in the **review queue** by default (the human gate), `--apply`
  writes directly; source tagged `import`.
- **CP7 (verification + ship):** the full local battery; the PTY memory
  matrix extended to the new surfaces; the live memory-recital re-run;
  README/docs/landing/blog/DOX; `unown-overview.md` re-stamped; CHANGELOG
  entries per milestone; version bump; release cut; Dependabot +
  code-scanning addressed; deploy-verify green.

## CP6 — memory interchange, shipped (2026-11-15)

The pre-registered design, implemented and verified live:

- **`src/memory-interchange.ts`** (pure, the sessions-export pattern): the
  schema-v1 builders (`buildMemoryInterchangeRecord/File` — text, type, SRO
  triple, confirmedAt, provenance, supersede links, dormancy, honest meta
  counts), the parse (`parseMemoryInterchangeFile` — version refusal with
  the remedy, structural checks, the 5k-record cap), the trust gate
  (`classifyImportRecords` — 600-char cap, unknown scopes quarantined never
  rerouted, superseded rows never re-import, the guard's flags verbatim),
  and the two appliers with injectable sinks (`parkImportedRecords` → the
  review queue, `writeImportedRecords` → the platform with
  `source: import` + origin + infer:false).
- **Engine routes** `GET/POST /api/memory/interchange`: the export walks the
  engine scope + every dreamed project scope (getAll + the dormancy side
  records); the import owns the validation (one source of truth) and emits
  `memory:review:changed` / `memory:changed` on the bus.
- **CLI**: `unown memory export [--out <path>]` (default
  `unown-memory-export-<date>.json`) and `unown memory import <file>
  [--apply]`, both with the engine-down remedy; HELP rows; README command
  block.
- **The live smoke's own find, fixed with the feature**: the top-level
  unknown-flag guard refused the ENTIRE memory-subcommand flag surface —
  `--json` on doctor, `--reason` on review discard (**broken since CP1 wired
  it**), and the new `--out`/`--apply`. The guard now honors per-family
  subcommand flag surfaces (keyed on the first word; a VALUE flag passes its
  value; anything undocumented still refuses) — pinned by four new
  parse-args tests.
- **Verified live end to end** against the real engine (the Agnes stack):
  export (2 memories, full field fidelity) → import (2 parked, evidence
  names the origin file) → `memory review` listing → the poisoned file (1
  accepted, 3 quarantined: guard/superseded/unknown-scope, each reason
  printed) → the version-2 file (exit 2 + the remedy) → `--apply` (written
  rows carry source/origin/kind/SRO) → `--out`/`--reason`/`--json` flags →
  discard-with-reason cleanup.
- **Tests**: `test/memory-interchange.test.ts` (21) + the parse-args pins;
  the full engine suite **5814/0**; the neighboring suites green.
- **Docs**: memory.md's new interchange section (+ a duplicate doctor bullet
  cured), the self-learning AGENTS.md contract (+ a duplicated CP5 sentence
  cured), README's command block, CHANGELOG (1 Added).

## CP1 — the integrity lane, shipped (2026-11-14)

The "fix whatever breaks" checkpoint — every finding from the CP0 audit,
closed and pinned:

1. **The review queue, wired.** The hoist now parks every promotion in a
   USER-LEVEL queue (`~/.unown/memory/review-queue/` — one inbox across
   projects, visible from any session; a decided candidate is never
   overwritten, a same-id re-observation parks under a `-r<N>` id). The
   only write path is `approveAndShipMemoryReview` (`memory-review-ship.ts`):
   re-deduped against both tiers at decision time (a rule that already
   landed is skipped, never duplicated — which makes a mid-flight retry
   converge), re-guarded by the deterministic layer (sanitize drops flagged
   lines; a nothing-clean block is refused with the flags and the candidate
   stays pending, retryable), provenance names the observing projects AND
   the review decision, and the candidate is stamped approved with
   `shippedVersion` only AFTER both writes land. Decisions surface four
   ways: `/memory review`, `unown memory review` (engine-down degrades to
   a read-only local listing), `POST /api/memory/review/[approve|discard]`
   (404 unknown / 409 already-decided / 422 guard-gate / 503 write-failed),
   and the dashboard Memory screen's review card (`memoryReview` resource;
   `memory:review:changed` + `hoist:finished` invalidations). The health
   card carries `reviewQueueDepth` + the amber `review-pending` warning.
2. **The recall-integrity seal.** `filterLatestOnly` now runs on every
   search lane (`searchMemories`, `searchAcrossScopes`, the API's scoped +
   across forms); superseded results render with `· superseded <date>`
   badges in the `--all`/`latest_only=0` audit view; the no-q LIST stays
   whole by design (an inspection surface).
3. **The per-type render budget.** Shares + waterfall (single-type stores
   keep the flat-cap behavior at the same total), `## Preferences`/
   `## Episodes` sections (typed before regex; Episodes render last), the
   per-type kept/pruned footer.
4. **Docs**: `.env.example` + `configuration.md` + `memory.md` + the
   self-learning `AGENTS.md` contract + `unown-overview.md` re-stamped;
   four CHANGELOG entries; the rail regenerated (59 stops / 580 entries).

Measured at the milestone: engine suite **5623/0** (5728 ran, 105 live-
gated skips), root unit **2094/0**, root e2e **15/15** with the landing
budget twin green at MAX_WORDS 4590, typecheck 0, lint 0 errors, all five
landing checks green.


## CP2 — the deterministic SRO supersede, shipped (2026-11-14)

MemStrata's measured verdict drives the design: similarity-based conflict
detection sits at AUROC 0.59 (chance) on contradicted-vs-duplicated facts;
a deterministic (subject, relation) rule takes stale-fact errors 15-40% to
~0%. Unown's adaptation, gradual and backward-compatible:

- **Extraction tags SRO triples** (`[subject, relation, object]` — the
  claim, the property, the exact value; the object keeps numbers, flags
  and versions: the differentia that makes "X is 20" and "X is 22"
  different claims). The reconcile listing renders them so the LLM sees
  the claim keys too.
- **A deterministic pass follows the LLM verdict** inside
  `reconcileMemories`: two LIVE rows with the same claim key and
  different objects are a contradiction resolved by recency alone —
  newest confirmedAt wins, losers take the same bi-temporal stamps
  (supersededBy + invalidAt, retained verbatim), **differing values are
  never merged or averaged** (the MIRIX numeric-merge class).
- **Never re-opens an LLM verdict** (rows the LLM touched are out of
  scope); rows without triples keep full LLM authority (legacy back-compat
  by construction); same-batch timestamp ties go to the LLM (it sees both
  rows in one listing); the fresh-evidence protection extends to the pass.
- **Surfaces**: `ReconcileResult.sroApplied/sroSkipped`, the dream note's
  ", K deterministic" fragment, the health card's `sroTaggedCount`
  adoption indicator.

Measured: the SRO suite 15/0 (input shapes, group rules, the apply pass,
the reconcile integration, the back-compat pin); engine suite 5638/0
(+15) with zero fallout; full-suite re-run at the CP2 milestone below.


## CP3 — usage-conditioned decay, shipped (2026-11-14)

The MIRIX experience-pool law (retire at 3 ignored pushes, recurrence
resets), CAMeR's finding (time-driven decay collapses; use-conditioned
reinforcement is the driver), and MemDream's soft/reversible decay,
adapted to Unown's render budget:

- **Dormancy**: a LIVE memory excluded by the per-type budget
  `PI_MEM0_DORMANT_AFTER` (default 3) consecutive renders goes dormant —
  a badge + reversible state, never a deletion. Searchable (with a
  `dormant` badge; the hit REVIVES it), and one inclusion resets the
  counter (revives + lastRevivedBy recorded).
- **Side-record bookkeeping** (`dormancy-<scope>.json` under PI_MEM0_DIR),
  never on the platform rows — a counter bump is not a re-assertion, and
  platform.update would refresh updatedAt (falsely refreshing the
  freshness stamp, flipping the SRO winner order). Self-heals: prunes ids
  absent from the live set; a rollback converges.
- **One plan, two consumers**: `computeRenderPlan` extracted from the
  render (byte-identical — all render pins re-run green); the dream path
  and the text render share the exact in/out list.
- **Surfaces**: DreamOutcome.dormantNew/dormantResets; the health card's
  all-scope dormantCount; the search lanes' annotate-and-revive
  (`dormant: true · revivedBy: "search"` on the response rows).

Measured: dormancy suite 10/0; engine 5648/0 (+10); render pins 96/96
after the computeRenderPlan refactor.


## CP4 — the delight lane, shipped (2026-11-14)

Five surfaces, each quiet when healthy (the Encore pattern — no standing
zeros): the /memory search provenance badges (the repo's own open item
#8); the recall line's honest `(N stale)` count; the dream digest toast
(learned · superseded (kept for audit) · went dormant — threaded
end-to-end through the dream rows' new columns); /memory show's
`not injected · N dormant` line; the dashboard fact line's dormant/sro
counts. The stamp helpers moved to a store-free memory-stamps.ts (single
definitions, re-exported) so tools.ts stamps search results without
importing the engine DB into the terminal process.

Measured: delight 6/6; the stamp/supersede/typing/recall battery 106/106
after the dedup; engine 5654/0.


## CP5 — the memory audit pass, shipped (2026-11-14)

`unown memory doctor [--json]` (the deferred gap #4, closed; the memU
doctor law: prove the loop): tier budgets + the injection budget (the
terminal resolution — engine-down safe), the stale count, a LIVE
recall-seal probe (a superseded row answering a default recall bare is a
LEAK finding), the store's health + the review-queue depth
(degraded-to-absent engine-down), placement findings (report-only), and
derivable-from-repo findings. `unown doctor`'s memory row gains a one-line
store summary. Live-smoked against the running engine: sealed, healthy.

Measured: doctor suite 6/6; engine 5660/0.

### The parallel-lineage reconciliation (2026-11-15, the same hour)

Two lineages shipped CP6 within the hour — the landed `1397ca4f` (the
sessions-export pattern: one /api/memory/interchange route, engine-side
validation, injectable appliers, platform-write apply) and the reconciling
one (the export/import route pair, the review-queue ship lane for apply,
env-tunable caps, the API/CLI batteries). First-landing-governs (the
coordination protocol, TEARDOWN_2026-11-07): the landed shape governs; the
second lineage's independently-verified value folded INTO it — the dedupe
lane (the convergence law at classification time), the pre-parse byte cap
(the OOM surface is the parse, not the record count), and shipChangedBy
(the approve's attribution names the lane that wrote). The second lineage's
`--apply` semantics (user-tier ship lane) stood DOWN for the landed
platform-write semantics (fresh rows, infer:false, source:import — the
MIRIX id-resurrection class impossible by construction). The hoist
order-dependence bisect (budget.test.ts's cleanup resets the firstMint
expression — the 93-file prefix repro) stands in this log as corroboration
of the v0.0.65 flake cures that fixed the same test upstream.

Measured at the reconciliation: interchange 21 + reconcile 9 + api 5;
memory neighborhood 140/0; the live round trip re-smoked on the restarted
engine (export 7 → park 7 → re-import 0 · 7 duplicate; the poisoned apply
quarantines + writes the clean row; the 6 MB file refuses pre-parse; the
probe rows and candidates cleaned, queue depth 0).

## CP7 — the verification + the v0.0.66 cut, shipped (2026-11-15)

The full battery on the final tree: engine **5727/0** (105 live-gated
skips), root unit **2094/0**, root e2e **15/15**, typecheck 0, lint 0
errors, all five landing checks green (rail 61 stops / 590 entries),
Dependabot 0 open, code-scanning 0 open.

The landing budget twin needed the release amendment (the thirteenth
ceiling move): the 61st stop's chrome measured +23w net (tile chrome +
the newest stop's two visible titles − the 0.0.65 titles the latest
marker rotates out) against five words of carried headroom — the round's
own titles compressed first (-2w), then **4,590 → 4,612** in BOTH twins
(the 0.0.48 lesson) with the comment documenting the cost. The
historical-lead compressions (v0.0.31/v0.0.2/v0.0.7) re-learned the
FAQ-collapsed lesson a third time: only the latest stop's item titles
reach innerText — hygiene, not budget.

The honest fold: the interchange entry moved OUT of the [0.0.65] section
into [0.0.66] — the landed CP6 commit (1397ca4f) wrote its entry into
the 0.0.65 section AFTER the v0.0.65 tag had been cut (the tag points at
15c3bc16), so the released 0.0.65 binaries never contained the
interchange; [0.0.66] is where the code actually ships.


**The cut, in order.** The fold commit (a58ad45c): the interchange entry
honestly moved from the post-tag [0.0.65] section into [0.0.66] (the
landed CP6 commit had parked its entry in 0.0.65 AFTER that tag was
cut), the reconciliation + legato entries, the 0.0.66 title
compressions, the budget-twin amendment 4,590→4,612 (both twins), the
version bump, the overview re-stamp. The fold's CI was cancelled
mid-flight by the rail cure 410eb09d (the parallel legato fix had left
the rail stale — main's red at run #1166; the cure's regenerated rail
closed it) — the v0.0.62 precedent: the pre-tag cross-platform verdict
was bought via the xplat release-verify dispatch instead (run
43638033447: six binaries, three-OS tests, six runner boots, all
green). `v0.0.66` tagged on 410eb09d; the release rendered **15/15
jobs green** (run #106) and published 2026-11-14T20:59:08Z as Latest
with all 13 assets.
## Session checkpoint protocol

This file is the resumable state: each CP updates its ledger row and adds
its section when it lands; `docs/SESSION.md`'s ACTIVE ROUND entry carries
the pointer and the open flags. Push on every milestone; the phase ledger
above is the first thing to re-read on resume.
