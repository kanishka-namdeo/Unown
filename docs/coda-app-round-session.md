# The Coda app round — session log

- **Round**: coda-app (the DRIVE track: ship the app THROUGH A2)
- **Started**: 2026-11-02 (round opened; implementation tickets begin in the next operator session)
- **Status**: COMPLETE (2026-11-03) — C1-C6 all landed; the round is graduated (the C6 checkpoint entry + the capability-utilization report land with it)
- **Mission**: ship **Coda** — a local-first markdown notes + task-board PWA (offline-first, installable, cross-platform) — at `apps/coda/` in this monorepo, **entirely through A2 sessions** (the operator writes no app code; every ticket goes through `unown -p`/`--plan` headless sessions and fails or succeeds on its receipts).
- **Operator decisions (2026-11-02)**: app = Coda PWA; repo path = `apps/coda/` in the Unown monorepo; push lane = direct to `main` after gates; production quality, edge cases, full cross-platform support, docs/landing/README/blog/DOX updates per milestone; never delete media assets.

## Design doc (the round's source of truth)

`benchmarks/plan-mode/results/run-2026-11-02-pt5/pt-5-plan.md` — the PT-5
lane's committed artifact: specialist-reviewed (all five bench agents
consulted live; DRIFT cuts applied, GAPS mitigated, steps re-sequenced,
P0s fixed), scored 87/100, with the full V3 document (capability audit,
approach, steps, risks, learning plan, verification). The implementation
follows ITS steps and file layout; deviations get recorded here with
reasons.

## The A2 ticket protocol on this host (from the fresh-clone round — binding)

1. **Budgeted chunks + resume chains**: the sandbox reaps agent processes
   between operator tool calls. Every ticket session runs as
   `unown -p "<ticket>" --permission-mode acceptEdits --max-turns 8` (first
   chunk) then `unown --resume <session-id> -p "Continue (chunk N): …" --permission-mode acceptEdits --max-turns 8`
   until the final summary lands. Receipts are written incrementally by the
   session (`.unown/receipts/<ticket>.md`) so nothing is lost at a chunk kill.
2. **No `task`-tool exploration between chunks** — subagents die with their
   parent chunk. Plan-mode specialist spawns are fine when they complete
   WITHIN a chunk.
3. **Compile before stopping a chunk** — the one boot-breaker of the
   fresh-clone round (`homedir` from `node:path`) reached the tree because a
   chunk stopped before compiling. The ticket template carries this rule.
4. **No commits by A2** — the tree stays dirty; the operator reviews, gates,
   commits, pushes.
5. The stack (bridge :3031 + engine :3030) is mortal across sandbox recycles:
   `bun run agent:start` first on any resumed session.
6. **Receipts mirror outside the repo immediately** (recovery ×2 lesson): the
   operator appends each chunk's receipt tail to operator-side
   `~/my-project/tickets/receipt-mirror.md` as chunks land; the round log's
   checkpoint entries carry anything not yet committed. The receipts inside
   `.unown/receipts/` are mortal to clone loss AND `unown-home` loss.

## Ticket queue (from the PT-5 plan's steps, in delivery-manager sequence)

1. **C1 — scaffold + domain core** ✅ (2026-11-02, see checkpoint log): `apps/coda/` structure per the plan
   (package.json, tsconfig, the pure TypeScript domain layer: notes, tasks,
   boards, search — pure functions, no I/O), unit tests with `bun test`,
   domain README. Verification: tests green, typecheck green, zero imports
   of DOM/node APIs in the domain layer.
2. **C2 — UI + IndexedDB** ✅ (2026-11-02, see checkpoint log): the plan's UI structure over the domain layer, the repo's
   landing conventions consulted (website-excellence skills; design-reviewer
   agent at the checkpoint).
3. **C3 — PWA layer** ✅ (2026-11-02, see checkpoint log): offline-first service worker, installable manifest,
   storage persistence; cross-platform verification matrix per the plan.
4. **C4 — e2e + a11y** ✅ (2026-11-02, see checkpoint log): the isolated Playwright lane (serve.mjs +
   playwright.coda.config.ts + offline/a11y specs), axe-clean both schemes, three app a11y fixes folded in.
5. **C5 — docs/DOX/landing + root wiring** ✅ (2026-11-03, see checkpoint log): the plan's step 7+8 atomically — `apps/coda/AGENTS.md`, root AGENTS.md child
   index entry + repo layout, docs page, README section, CHANGELOG entry + rail, testing-strategy gate entry,
   tsconfig include + eslint scope + package.json coda scripts + bunfig preload scope + the CI `coda` job
   (lockfile-unchanged assert + `bun test apps/coda` + the isolated playwright lane) — landing surface if the
   plan's scope includes it (usage captures via the scripts/tui-capture lane or browser tool, never deleting
   existing media). Documenter-style verified file:line refs.
6. **C6 — round closeout** ✅ (2026-11-03, see the checkpoint log): this log's graduation,
   SESSION.md, the V3-contract retrospective (merged into the PT-5 plan via the PTY lane),
   the capability-utilization report, the carried-forward lane-label fix, and the round's
   blog post.

Each ticket carries the A1 economy header (ALLOWED_INPUTS /
FORBIDDEN_INPUTS / OUTPUT_ARTIFACT / VERIFICATION_EXPECTATION /
EFFORT_BUDGET / chunk protocol notes) — the shape that worked in the
fresh-clone round's M2-A ticket.

## Capability utilization report (the round closeout, per the A1 directive §7)

- **Most used capability**: the budgeted-chunk headless lane (`unown -p` + `--resume` + `--max-turns 8`) — every C6 sub-ticket rode it (7 chunks across 3 sessions); no alternative dispatch lane survives this host's reaping.
- **Highest leverage capability**: the receipt-first protocol + the operator gate set — every C6 deviation (4 caps, 1 pane-anchor miss, 2 frontmatter rejects, 1 wrong-path operator probe) was caught by a receipt or a gate, none by luck.
- **Most under-used capability**: recipes — C6's docs-shaped tickets (the blog post, the graduation) are exactly the parameterized, schema-checkable work `unown recipes` exists for, yet each rode a bespoke prompt; a `round-graduation` recipe is a Level-5 candidate only AFTER the L1–L4 sweep (the existing doc-drift lane). MCP servers: still none configured (deliberate, doctor-noted).
- **Highest-ROI augmentation**: `scripts/tui-capture/verify_plan_retrospective.py` — a Level-3 composition (PTY capture lane + the todo-overlay session-crafting pattern + the execution-mode-guarded `plan_retrospective` tool) that closed the V3 loop where print mode structurally could not; built entirely from existing mechanisms, zero engine changes — the directive's reuse-over-create law embodied.
- **Trigger failures observed**: none this ticket set. The instruction-set guard fired zero times (no instruction-surface writes attempted — the draft-and-land protocol is now learned behavior).
- **Routing failures observed**: none — but authoring-class tickets consistently cap at 8 turns mid-work (4 of 7 chunks); the next EFFORT_BUDGET for authoring-class tickets should pre-split at ~2 expected chunks.
- **Verification failures observed**: one — the `/plan show` pane anchor (the notify scrolled off the 36-row pane; resolved by the lane's own file-gate-is-authoritative rule). Environment class, not engine: a fresh lineage needs `bunx playwright install chromium` (the cache ships 1200, the pinned playwright wants 1248 — bring-up receipted in the ground truth).
- **Subagent efficiency**: zero spawns this ticket set — correct (sequential doc work; the spawn rule forbids sequential-execution spawns). Round-wide: PT-5's 7 planning specialists, design-reviewer at C2 (OK-WITH-NOTES), delegation-auditor queued post-C4.
- **Capability duplication candidates**: none new.
- **Capabilities promoted**: the crafted-session PTY lane — one pattern (session crafting), two tools served (the todo overlay, now the plan retrospective).
- **Capabilities retired**: none.
- **Turns-to-done (C6)**: C6-1 = 2 chunks; the retrospective = 1 PTY session (2 tool calls, ~1 min); C6-3a = 3 chunks; C6-3b = 2 chunks. **Operator unblocks: 0** — the round's first zero-unblock ticket set (C1: 1, C2: 1, C3: 2, C4: 1, C5: 0, C6: 0).

## Checkpoint log

- **2026-11-03 04:56 UTC (C6 COMPLETE — the round closes: the lane fix, the V3-contract retrospective, the blog post, the graduation)**: delivered through A2 in seven headless budgeted chunks across three sessions (C6-1 `01a19faf…` 2 chunks; C6-3a `01a19fbc…` 3 chunks; C6-3b `01a19fbe…` 2 chunks) plus ONE PTY-lane session — **the round's first ticket set with ZERO operator unblocks** (C1: 1; C2: 1; C3: 2; C4: 1; C5: 0; C6: 0 — the protocol laws are compounding). On disk: (1) the carried-forward fix — `apps/coda/src/domain/README.md` "## Tests" lane labels now match the round's law (Lane A = the local-cwd run, preload-free, purity-ENFORCING; Lane B = the root run, happy-dom-masked), verified 51/51 BOTH lanes + the purity grep clean; (2) the **V3-contract retrospective merged into the PT-5 plan** through the NEW lane `scripts/tui-capture/verify_plan_retrospective.py` (landed in-repo, reproducible): a crafted post-approval session (the todo-overlay crafting pattern — `enabled:false, executing:true`, planFile at the REAL benchmark artifact, 9/9 steps completed, steps parsed from the plan file itself) resumed through the real TUI in a PTY; the live session read `.unown/receipts/c6-part-2-retrospective.md` and called `plan_retrospective` — 2 tool calls, ~1 min, the merge surgical (+15 lines: `## Retrospective`, outcome `delivered`, failure class `none`, 5 lane-tagged learnings, 2 improvements), the close-out note delivered to the engine (live `/api/notes` receipt: "the plan-mode V3 loop is closed"), and all five file gates PASS (header landed / outcome line / body verbatim / original sections intact / single section). The lane exists because `plan_retrospective` is execution-mode-guarded and print mode is plan-read-only BY DESIGN (docs/plan-mode-v3.md non-goals) — the PTY lane is the sanctioned interactive path, scripted end to end (pane stills + dumps + the crafted session kept as provenance in the operator's capture root). (3) the round's **blog post** `content/blog/2026-11-03-the-coda-round.md` ("Coda: the round where unown shipped its first user product", type feature, tags pwa/local-first/agent-driven/testing — three new, checked against blog-data.ts first) with real browser-lane media (`public/blog/2026-11-03-the-coda-round/coda-fresh.png` + `coda-app.png`, captured through the real UI — the same interactions the e2e spec drives, one note + one task via the pre-armed prompt lane); regen clean (42 posts, 103 tags) after two in-session frontmatter fixes (description 174→143 chars; media list unquoted to house style); (4) the **graduation** — this log's Status + queue C6 ✅, SESSION.md's ACTIVE ROUND → the completed-round paragraph + the carry-overs prepended to the next-round queue (the browser-lane usage capture, the instruction-surface PR lane candidate, the not-measured PWA benchmark receipt). **Operator gates, all green on the C6 tree**: claims 62/62 (the session's AutoDream churn is claims-clean — it rides this commit receipted), typecheck rc=0, lint 0 errors (142-warning vendored baseline), `check:docs` ok, `check:blog` ok (42 posts), `check:changelog` ok (54 stops, 519 entries), Lane A 51/51 + Lane B 51/51, the coda playwright lane 5/5 (8.9 s), `node --check` sw.js ok, the lane driver parses clean. Deviations receipted: four 8-turn caps hit mid-work (the budgeted-chunk design working as intended — every resume chain completed); the `/plan show` pane anchor missed (the notify scrolled off the 36-row pane — WARN receipted, the file gate is authoritative); C6-3b's first chunk capped with no answer produced (the exit contract honored — error, not false success). Receipts: `.unown/receipts/c6-part-1.md` + `c6-part-3.md` (both sub-parts) + the retrospective body `c6-part-2-retrospective.md` (all mirrored operator-side per protocol law 6). **The Coda round is COMPLETE.**

- **2026-11-03 04:33 UTC (C6 CLAIMED — the closeout dispatches from this lineage)**: THIS incarnation (the `e0ca8ab4` author — the third fresh lineage, bring-up receipted in the ground truth's drift log the same hour) **claims C6 (the round closeout) before any dispatch**, per the ledger-arbiter law. No C6-shaped commit, branch, or CI run exists on the remote at claim time (verified by fetch immediately before this entry; `main` was at `e0ca8ab4`, this lineage's own ground-truth receipt). Scope: the queue's C6 (this log's graduation, SESSION.md, the V3-contract retrospective on the PT-5 plan — via the PTY lane, since `plan_retrospective` is execution-mode-guarded and print mode is plan-read-only by design — and the capability-utilization report) PLUS the C5-carried-forward app fix (the domain README's swapped Lane A/B labels) PLUS one operator-directed addition: **the round's blog post** (`content/blog/`, per the standing orders — every meaningful round in this repo has one, and Coda is the first user product app; no Coda post exists). If another incarnation resurfaces with C6 in flight, the C4-collision laws apply unchanged (fetch before every push; adopt the remote; re-gate locally; reconcile deltas as follow-ups; never force-push).

- **2026-11-03 03:03 UTC (C5 COMPLETE — the root wiring + CI + DOX/docs, plan steps 7+8 atomically)**: delivered through A2 in
  thirteen budgeted chunks (fresh session `01a19f43-b80d-7268-a3e2-a70b9d8a90ca`, dispatched under the stale-claim
  takeover above) plus four operator landings. The wiring: root `tsconfig.json` covers `apps/coda/**/*.ts` (root
  typecheck green with the app in scope); `eslint.config.mjs` gains the **domain-purity scope** — `no-restricted-globals`
  (DOM + Node) on `apps/coda/src/domain/*.ts` with a `*.test.ts` twin (DOM-as-mock allowed, Node forbidden) — the
  global-reference half of the design doc's P1 pair (`boundary.test.ts` is the import half); `bunfig.toml` UNTOUCHED by
  a receipted decision (bun's `[test] preload` cannot be path-scoped; Lane A stays preload-free by cwd — no
  `apps/coda/bunfig.toml` exists, verified — and CI pairs Lane B with the boundary test by construction); root
  `package.json` gains `coda:dev`/`coda:test`/`coda:e2e`; `.github/workflows/ci.yml` gains the **`coda` job** (74 added
  lines, ZERO deletions — existing jobs byte-untouched): frozen-lockfile install, a git-HEAD-based lockfile-drift
  assert (`sha256sum bun.lock` vs `git show HEAD:bun.lock` — self-maintaining, no hardcoded hash to bump), Lane A +
  Lane B unit runs, chromium, the isolated self-skip-guarded Playwright lane, the `playwright-report-coda` artifact.
  The docs: `docs/coda.md` (user/developer page), `docs/AGENTS.md` + README (section + docs-table row), CHANGELOG
  `### Added` entry + the GENERATED landing rail (`landing_changelog.mjs` regeneration — hand-edits would red
  `check:changelog`), testing-strategy §6 **gate 23**, and the two AGENTS.md surfaces the operator landed VERBATIM
  from the session's verified drafts (`.unown/receipts/c5-agents-drafts.md`) — `apps/coda/AGENTS.md` (the child DOX:
  zero-dep law, lane semantics, the domain-purity pair, the type-keyword law, node --check law, the CODA_E2E guards,
  the SW scope law, the IDB data story, Chromium-desktop-only scope) + root `AGENTS.md` (repo-layout bullet + Child
  DOX Index entry). **The sharp finding of the ticket**: the **instruction-set write gate is FINAL** — the session's
  writes to `AGENTS.md` at any depth are hard-denied with no permission-mode unlock (docs/permissions.md's
  hard-coded layer), so instruction-surface DOX flows draft-and-operator-land — receipted as the D-operator class.
  Four deviations receipted: the chunk-2 cap-cut (a stray `}]` + dead config objects, repaired by chunk 3's rewrite —
  compile-before-stop is LOAD-BEARING), the AGENTS.md draft-and-land protocol, the engine's mid-session dream churn
  on `.unown/memory/project.md` (benign, claims gate 62/62 held, rides this commit receipted), and the 7-lines
  correction (the drafts said "5 lines" for a 7-line package.json; fixed in the landed DOX + docs/coda.md).
  Carried forward to C6: `apps/coda/src/domain/README.md`'s lane-A/lane-B labels are SWAPPED vs the round's law
  (frozen app file this ticket; fix in an app-code follow-up). **Operator gates, all green**: Lane A 51/51, Lane B
  51/51, app tsc, root typecheck, lint 142-warning baseline unchanged, the purity rule FIRES on a `document` probe,
  `check:docs`/`changelog` (54 stops, 519 entries)/`blog`/`benchmarks`/`claims` (62/62), YAML parse (18 jobs),
  `node --check` + instruction-chars (61 files, 0 findings — the operator-landed AGENTS.md included), the coda
  playwright lane 5/5 (8.7s), `playwright.config.ts` byte-untouched, `bun.lock` byte-identical (`b844886a…`).
  Receipt: `.unown/receipts/c5-root-wiring.md`, mirrored operator-side per protocol law 6. **C5 closes the round's
  code tickets; C6 (this log's graduation, SESSION.md, the V3-contract retrospective, the capability-utilization
  report) is all that remains.**

- **2026-11-03 02:33 UTC (C5 CLAIM TRANSFER — the stale-claim takeover, ledger-arbiter rule exercised)**: the C5
  claimant (the `d34691be` author, per the stand-down marker below) has been silent for **6.5 hours** at the
  time of this entry: its last commit is `d34691be` (19:46 UTC), the last remote activity of ANY kind is the
  deploy-verify run on `521da305` finishing 20:02 UTC, and no C5-shaped commit, branch, or CI run has appeared
  since — the same backend outage that killed THIS incarnation's session ~20:07 (its third full working-clone
  loss of the day; recovered again: re-clone → bun 1.4.3 → `agent:install` with build → `.env` → stack up →
  doctor green → Agnes round-trip probe `AGNES_OK`) almost certainly took the claimant's host with it. Per the
  ledger rule recorded at the stand-down ("claim a ticket in this log BEFORE dispatching it" — the ledger is
  the arbiter), THIS incarnation (the `b1ffac0b` author lineage) **claims C5 now, before any dispatch**, and
  records the takeover transparently rather than letting the round stall on a dead claim. If the original
  claimant resurfaces with C5 in flight, the C4-collision laws apply unchanged: fetch preflight before every
  push, adopt the remote, re-gate locally, reconcile deltas as follow-up commits, never force-push. C5 scope
  stands as the queue entry states it (plan steps 7+8 atomically, with the CODA_E2E-guard invariant inherited
  into the ci.yml wiring).

- **2026-11-02 (C4 COMPLETE — the e2e + a11y lane, green operator-side)**: delivered through A2 in twelve
  budgeted chunks (fresh session `01a19d4f-ea03-7bb1-ab16-bebd93927535` — the recycle-×2 restart; the original
  attempt burned two exploration-only chunks and died with its session directory) plus ONE operator unblock.
  On disk: `apps/coda/scripts/serve.mjs` (the transpiling static server, productionized from the operator's
  C2-era blueprint), `playwright.coda.config.ts` (the ONLY root addition; testMatch `/coda-.*\.spec\.ts/`,
  no config-level colorScheme — the a11y spec drives both schemes per-context; webServer = the serve.mjs),
  `e2e/coda-offline.spec.ts` (SW-controller waitForFunction → manifest fetch assert → note+task create with
  PRE-ARMED prompt dialogs → offline reload → data survives → offline-first second note → survives →
  non-precached navigation offline lands on offline.html → beforeinstallprompt soft-gated), and
  `e2e/coda-a11y.spec.ts` (axe wcag2a/2aa/21a/21aa, zero-violation, light+dark × empty+content states).
  **The lane's findings were real**: three axe violations fixed in app code (status transient contrast
  4.32:1 → 5.34:1 light / ~8.7:1 dark via `--c-accent-strong`; cycle-button label-in-name per WCAG 2.5.3;
  nested-interactive — note rows restructured to flat sibling buttons) and C2's "spinbutton" debt verdicted
  **STALE** (it's `input type="date"`, axe-clean, keyboard-operable). **The operator unblock (the
  `transform/transformSync` class)**: A2's serve.mjs used `transpiler.transform()` (async — returns a
  Promise) and `new Response(promise)` coerced every module URL to the literal string `[object Promise]` —
  the app sat at "Booting…" with `Unexpected identifier 'Promise'` — one operator line to `transformSync()`
  (the `homedir` precedent, receipted as D-operator). Gates, operator-verified end to end: lane 5/5 green
  (8.7s operator re-run), 51/51 domain both lanes, tsc green, node --check clean, root typecheck+lint zero
  new findings (142 warnings all pre-existing baseline), lockfile byte-identical (`b844886a…`),
  playwright.config.ts byte-untouched, visual boot check via screenshot + VLM ("layout intact, no
  breakage", status "Ready."). Receipt: `.unown/receipts/c4-e2e-a11y.md`, mirrored to operator-side
  `tickets/receipt-mirror.md` per protocol law 6 (first ticket to exercise the law). C4's sharpest learning:
  the A2 receipt-append discipline drifted for ten straight chunks (the receipt sat at its chunk-2 skeleton
  while the lane work went on) — only the operator's chunk-11/12 "receipt is the completion gate" pressure
  produced the full record; the ticket template's next revision moves the receipt append INSIDE the
  per-chunk task list, not the closing instruction.

- **2026-11-03 (C4 COLLISION RECONCILED — the dual-incarnation race on `main`, and the root-lane guard)**: a
  SECOND incarnation of this operator programme (separate host, same lineage — its entry above) landed C4 on
  `main` (`b1ffac0b`) while THIS incarnation's own 15-chunk C4 session (`01a19da6…`) was still in flight —
  both spawned from the same recycle, both re-cloned fresh, both drove the same ticket; its push won the
  race by ~11 minutes. Per the Git Preflight law: the local implementation was preserved on branch
  `c4-a1-parallel` (never force-pushed), the remote adopted, and the adopted tree re-gated green (51/51
  both lanes, node --check, precache 23/23, lane 5/5 in 8.8 s, tsc/lint/claims clean). The re-gate found the
  one real gap: the landed specs had NO self-skip guard, so the ROOT config (testDir "e2e", recursive
  collection) swept the 5 coda tests into the landing lane — `bunx playwright test` collected 20 tests and
  CI's "E2E + a11y (landing)" job would run them against the Next server on :3210 and red (the plan's
  step-6 invariant: "the landing lane untouched"; this incarnation's local implementation had shipped the
  `CODA_E2E` marker for exactly this). The guard landed through a fresh two-chunk A2 session
  (`01a19dc6…`): `test.skip(!process.env.CODA_E2E, …)` at the top of both coda specs, the marker armed
  (`process.env.CODA_E2E = "1"`) inside `playwright.coda.config.ts`. Proof, operator-run: a root-lane run
  against a dummy :3210 server fails the 15 landing specs against the dummy but **SKIPS all 5 coda tests**;
  the coda lane itself stays 5/5 (8.7 s); tsc/lint/claims green. **Laws for C5+ from the collision**:
  (1) `git fetch` before EVERY push — the preflight law is load-bearing against dual incarnations, not
  ceremony; (2) any spec added under the root config's testDir is a ROOT-LANE contract change — it carries
  the `CODA_E2E`-style self-skip guard (C5's ci.yml wiring inherits this invariant for the coda job);
  (3) on a same-ticket race: adopt the remote, re-gate locally, reconcile deltas as follow-up commits —
  never force-push over `main`; (4) both incarnations independently found and fixed the same three axe
  defect classes and the same transform/transformSync bug class — convergent validation that the lane's
  defects were real, not noise.

- **2026-11-03 (C4 reconciliation CONFIRMED from the b1ffac0b author — and a C5 stand-down marker)**: the
  incarnation that LANDED C4 (`b1ffac0b`, session `01a19d4f…`, 12 chunks) confirms the reconciliation from
  its side: adopted `d34691be` (its own competing hotfix — a spec relocation to `apps/coda/e2e/` with an
  `.e2e.ts` suffix, built in parallel for the same CI red — was ABANDONED on the rebase conflict; the guard
  achieves the same green with less churn; the relocation remains a receipted-valid alternative operator-side),
  re-gated the adopted tree fully (Lane A 51/51, coda lane 5/5 in 8.8 s, root `--list` 20 collected /
  5 self-skip at run, app tsc + root typecheck green, CI on `d34691be` 4/4 — CI + CodeQL + Scorecard +
  deploy-verify). **C5 assignment**: the `d34691be` author's entry claims C5 — this incarnation
  **stands down on C5 dispatch** (a second same-ticket race on C5's shared root surface — tsconfig,
  eslint, package.json, bunfig, ci.yml, AGENTS.md, README, CHANGELOG — would be near-certain conflict
  churn). This incarnation's remaining lanes, if the operator directs: watch/support + verification of the
  C5 landing, the queued L1 doc-drift scans, or the issue-#30 armed repro lane. The ledger is the arbiter:
  claim a ticket in this log BEFORE dispatching it.

- **2026-11-02 (OPERATOR RECOVERY ×2 — two sandbox recycles in one day; nothing lost on `main`)**: recycle 1 wiped the
  working clone's contents (recovered in ~10 min: re-clone → bun 1.4.3 → install → `.env`); recycle 2 (a backend
  outage that killed the tool gateway mid-dispatch) wiped the clone AND `unown-home/` AND the operator-side
  `tickets/`+`scripts/`+`.secrets/` scratch. Both credentials died each time (PAT lived only in the git remote URL,
  Agnes key only in gitignored `.env`) — the operator re-provisioned both by message; an off-repo recovery copy
  now also lives at operator-side `.secrets/credentials.env` (gitignored), acknowledging it too is mortal to the
  deepest recycle class. `main` never moved: `f9872c4`, CI 21/21. Full bring-back, receipted by probes: clone →
  `bun install` (lockfile `b844886a…` byte-identical) → `agent:install` → `.env` (Agnes lane +
  `UNOWN_HOME=/home/z/my-project/unown-home`) → **`unown setup --provider bridge --model agnes-3.0-flash`**
  (the non-interactive provider re-registration — the lost `unown-home/agent/models.json`/`settings.json` were
  recreated by this one command) → stack start → `AGNES_OK` through a raw bridge completion → `UNOWN_OK` through
  a full `unown -p` probe (exit 0). C4's first dispatch (session `01a19b1c…`, recycle 1) had burned two
  exploration-only chunks with zero file writes, and its chunk-3 dispatch never spawned (recycle 2) — so C4
  restarts FRESH against this stack with the same ticket (the A2 sessions directory itself was wiped: all resume
  chains from C1–C3 are gone; their receipts remain in the round log's checkpoints). LESSON (now protocol law 6):
  receipts are mirrored outside the repo the moment they are written (operator appends each chunk's receipt tail
  to `~/my-project/tickets/receipt-mirror.md`), and the round log's checkpoint entries are the durable surface
  of record for anything not yet committed.

- **2026-11-02 (C2 COMPLETE — UI + IndexedDB adapter)**: delivered through A2 in seven budgeted chunks
  (session `01a199b4-8be8-7b7d-af0c-33720a696345`, receipt-first discipline HELD this time) plus the operator's
  browser boot check. On disk: the vendored browser-module story (fuse.js 7.5.0 + marked 18.1.2 ESM copies under
  `public/vendor/` + a relative-path import map — zero package.json deps still holds), `src/db/idb.ts` (one db,
  one store, the whole serialized CodaData document — no schema fork), seven UI modules (shell/status/search/
  notes/editor/tasks/sanitize — the XSS lane is a hand-rolled allowlist pass: forbidden elements + on* handlers +
  javascript:/data:text/html URLs), `app.ts` (write-through persistence, corrupt-state choice UI, DomainInvariantError
  surfaced never swallowed), `main.ts`, `coda.css` (light+dark, 4/8 rhythm, single accent). The design-reviewer
  bench agent ran WITHIN chunk 7 (13 turns): **OK-WITH-NOTES** — numeric WCAG contrast AA-clean, no FAIL-grade
  debt; its focus-ring + sanitizer findings partially folded in, the rest recorded as C3/C4 debt (focus rings on
  task/search controls, prompt()-based task creation, spinbutton date presentation, 4.04:1 hover near-miss).
- **C2's sharpest learning (binding for C3+)**: `tsc`-green + `bun test`-green does NOT prove browser-link-green.
  `tasks.ts` imported `TaskStatus` without the `type` keyword; Bun's isolated-module transpile kept it as a value
  import; the browser's module linker rejected it; `void app.boot()` swallowed the rejection and the app sat at
  "Booting…" with ZERO console errors. Only the operator's headless boot check caught it. RULE: every type-only
  symbol imported across modules carries the `type` keyword, and every ticket with a UI surface gets an operator
  (or C4-lane) browser boot check before commit. Second catch: the import map pointed at `./vendor/` while the
  files live at `public/vendor/` — plain static servers 404'd it; fixed to `./public/vendor/`. The operator's
  throwaway transpiling server (`Bun.serve` + `Bun.Transpiler` + extensionless-import resolution) is receipted as
  the blueprint for C4's `serve.mjs`.
- **2026-11-02 (C1 COMPLETE — scaffold + pure-TS domain core)**: delivered through A2 in ten
  budgeted chunks (session `01a19949-5524-755d-9775-948ff64cfe2f`) plus one operator one-line
  unblock (an `ImportMeta` ambient that never merged because the shim `.d.ts` is a global
  script — `declare global` only augments from modules). On disk: `apps/coda/` scaffold
  (zero-dep package.json, strict app-local tsconfig, bootable stub) + the six-file domain
  layer (types/store/repository/search/markdown + README) + six test suites — **51/51 green
  in BOTH bun lanes**, including `boundary.test.ts`, the import-boundary purity mechanism
  the design doc's P1 fix demanded (grep alone is bypassable). Receipt:
  `.unown/receipts/c1-scaffold-domain.md` (local, gitignored by convention). Five ticket
  gates operator-verified before commit: both lanes, app-local tsc, root typecheck + lint
  (zero coda findings), lockfile byte-identical (`b844886a…`), DOM-grep clean modulo the
  scanner's own documented patterns. The domain's own tests caught a real losslessness bug
  (9 markdown round-trip failures → writer/parser grammar misalignment → fixed 50/50) —
  test-first earning its keep. Four deviations D1–D4 receipted (no-`types` tsconfig via a
  local bun-test shim; the Store/Repository internal seam; purity check as a test file not
  a scripts/ entry — the PostToolUse hook chokes on TS scripts; LEGAL_TRANSITIONS makes all
  six directed edges legal with out-of-machine values throwing).
- **C1's protocol learnings (binding for C2+)**: (1) the receipt-last pattern died at the
  9.5-minute wall three times — future tickets write the receipt FIRST and append
  incrementally, never last; (2) read-before-edit is mandatory for receipt edits — chunk 10
  burned its whole budget on oldText mismatches reconstructed from memory; (3) issue #30
  gained its sharpest datum yet: two fully-instrumented captures show the print run's
  COMPLETE exit lifecycle (answer_flushed → agent_end → drain_done → exit event) finishing
  in ~1.6–2.5 s while the caller still hangs — and one capture where the CLI exited cleanly
  (code 1, capped lane) and the shell STILL hung — so the blockage is OUTSIDE the CLI's own
  exit paths, in post-exit/process-tree teardown (fd inheritance by a spawned child is the
  live suspect). The trace log now carries this; the repro lane is armed for the next hang.
  (4) The step-0 probe's Lane A/B split is now receipted law: `cd apps/coda && bun test`
  (no bunfig preload) ENFORCES DOM-free domain code; `bun test apps/coda` from root (the
  future CI lane) masks it via happy-dom — CI must pair Lane A with the boundary test, which
  it does by construction.
- **2026-11-02 (round opened)**: PT-5 receipted (the design doc), the round
  log + SESSION.md opened, the protocol inherited from the fresh-clone
  round. No app code yet — C1 dispatches in the next operator session.

- **2026-11-02 (C2 CI incident — the memory-prune class strikes a third time)**: C2's push reddened the
  landing-palette JOB (which also runs `landing_claims.mjs --check`): the engine's 110-cap dream render,
  running while the C2 session worked, pruned `- bin: Cross-platform CLI launcher … [note 1].` from
  `.unown/memory/project.md` — a line the landing's `loop.tsx` memory preview quotes, so the claims gate
  reddens without it. Third occurrence of issue #46's dream-render-prunes-landing-quoted-lines class (first
  two restored 2026-11-01/10-29, both noted inside the file itself). Operator restored the line into the
  `## Manual notes` durable lane per the gate's own printed remedy; `landing_claims.mjs --check` back to
  62/62 locally. LESSON for the rest of this round: every memory-churn commit MUST run
  `bun scripts/landing_claims.mjs --check` before push — the engine dreams between our commits and its
  prunes are invisible until the gate says otherwise.

- **2026-11-02 (C3 COMPLETE — the PWA layer, proven offline end to end)**: delivered through A2 in eight
  budgeted chunks (session `01a19a0f-76e8-7f1b-8df9-669452ffffc2`) plus two operator interventions (running
  the fixed icon script; the browser checks that caught two ship-blockers). On disk: manifest (standalone,
  relative start_url), a zero-dep hand-rolled PNG icon generator (its own CRC32 + zlib IDAT; the bug was a
  DataView byteOffset), svg/192/512 icons, offline.html, the hand-rolled **sw.js at the APP ROOT** (the
  plan's `public/sw.js` layout was its own P0 — scope law forbids a public/-nested worker from controlling
  the root; caught live by the operator's browser check), versioned coda-v1 precache of all 23 browser-
  closure URLs (domain/markdown correctly excluded — zero runtime importers), fail-soft install, SWR +
  network-first + offline fallback + clients.claim, registration in main.ts, storage.persist() ask, and the
  C2 a11y debt folded into coda.css. **The offline proof**: SW activated → controlled page → offline reload
  boots the full app from cache → a note created offline SAVES → survives the return online. Screenshot
  receipted operator-side. Gates: 51/51 both lanes, tsc green, node --check green, verify-precache 23/23,
  lockfile byte-identical. C3's addition to round law: every non-TS artifact gets `node --check` (the dead
  TypeScript signature that shipped inside sw.js evaluated-failed in the browser while tsc stayed green —
  tsc never sees sw.js), and scripts cited in docstrings must exist when the docstring lands.
