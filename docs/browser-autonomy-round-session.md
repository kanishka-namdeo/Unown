# The Browser Autonomy Round — session log (2026-11-01)

> **Purpose.** Dogfood, stress-test, benchmark and improve Unown's browser
> automation under realistic product-development conditions — not an E2E
> testing exercise, but the browser as a first-class operating environment
> for research, PM operations, documentation navigation, user simulation,
> long-horizon monitoring and self-dogfooding against Unown itself. Every
> task that can reasonably run through the browser runs through the browser
> first; every fallback to an API or local tool is logged with its failure
> point and root cause. Capability verdicts are VALIDATED / PARTIAL / FAILED
> with receipts.

- Round owner: the browser autonomy session (lineage: security round → this
  round)
- Status: **open** — CP0-CP2 complete (browser runtime VALIDATED, stress
  suite 3/3, F1-F3 findings ledger, memory loop closed once); next: CP3
  self-dogfooding
- Related pages: [browser](browser.md) · [browser research](browser-research.md)
  (the seven-product reverse-engineering the tool's shape rests on) ·
  [testing strategy](testing-strategy.md) · [the benchmarks' own
  contract](../benchmarks/AGENTS.md) · [the prior round](security-round-session.md)

---

## Environment checkpoint (resumable)

- Sandbox lineage `/home/z/my-project/unown`, clone @ `22d3e725` (main, clean,
  v0.0.55). bun **1.4.4** (the sandbox shipped 1.3.14 — below the 1.4
  lockfileVersion-3 floor; upgraded before any install).
- `UNOWN_NO_ENGINE_SERVICE=1 bun run agent:install` — 7/7 green; `unown`
  linked → `~/.local/bin/unown`; engine OS service skipped (no systemd user
  bus in the container — the documented container lane).
- `.env` from `.env.example`: Agnes upstream
  (`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`, key set,
  `BRIDGE_MODEL=agnes-3.0-flash`, `BRIDGE_KNOWN_MODELS=agnes-3.0-flash,agnes-2.5-flash`),
  `AGNES_API_KEY` set for the vision tier. `UNOWN_HOME` at its default
  (`~/.unown`) — this round runs the shipped default layout, not the
  containment override.
- Stack: `bun run agent:start` — bridge :3031 (upstream ok 200, six agnes
  models served), engine :3030 (phase ready, M7 bearer token). `unown setup
  --provider bridge` green; `unown doctor` green (one expected ⚠: no LSP
  servers in the container).
- Browser runtime: Playwright `chromium-1200` + `chromium_headless_shell-1200`
  in `~/.cache/ms-playwright` — inside the browser tool's discovery path
  (system Chrome → ms-playwright cache). Headless by default in the sandbox.
- Baseline gates on the pristine tree (all green, before any edit):
  `bun run typecheck` 0 errors · `bun run lint` 0 errors (4 pre-existing
  warnings) · `bun run test:unit` 2067/0 · `check:docs` · `check:changelog`
  (53 stops) · `check:blog` (39 posts) · `check:benchmarks` (6 tracks) ·
  `check:claims` (62 literals) — the v0.0.55 CI receipts stand for the
  engine/bridge/e2e suites.
- The stack is mortal across sandbox recycles: processes die, files persist.
  Resume = re-run `bun run agent:start`, re-check `/health` + `/api/overview`,
  then resume from the latest CP below.

## CP0 — the mission intake (what "browser autonomy dogfooding" means, exactly)

The brief (verbatim intent, condensed): for every task that can reasonably be
executed through browser automation, attempt the browser first; fall back to
APIs, local tools, direct file editing or manual intervention only on browser
limitations, CAPTCHAs, provider policies, unacceptable reliability or
impossibility — and log every fallback (task, attempted browser workflow,
failure point, root cause, fallback used). A capability counts as successful
only when the task completes correctly, results verify, the workflow repeats,
future executions need fewer interventions, and lessons persist into memory.

The nine mission lanes and what each demands from this round:

| Lane | Demand | This round's target |
|---|---|---|
| BROWSER-1 research & competitive intelligence | gather info exactly as a human operator would; capture URLs, insights, screenshots, citations; measure accuracy, repeatability, hallucination rate, time, interventions | the competitor pass (CP4): a real browser-driven sweep with the research record committed |
| BROWSER-2 PM operations | issues, backlog, roadmaps, release notes, triage | GitHub issue creation + board hygiene on this repo (CP3), with the browser-first attempt and its logged fallback |
| BROWSER-3 docs navigation | a technology not previously used this session: discover → navigate → implement → fix → verify, no human guidance | one live build task driven through the docs by the browser (CP2/CP4) |
| BROWSER-4 authenticated platforms | logged-in environments, session persistence, auth stability | browser-profile persistence proof + GitHub authenticated API surface + live-deploy verification; honest about what a PAT cannot log into |
| BROWSER-5 user simulation | act as a real customer: onboarding, account, settings, exports; defects → evidence → repro → issue → fix verification | the landing page + `/demo` app as a real user (CP3) |
| BROWSER-6 long-horizon | monitoring, continuity, resumability, memory reuse | release/changelog monitoring snapshots + a resumable-workflow proof; the multi-day axis is honestly out of one session's reach and recorded as such |
| BROWSER-7 memory integration | all browser-derived learnings stored; recall accuracy, stale rate, time saved | the notes → AutoDream → `.unown/memory/project.md` loop on this round's own browser sessions (CP5) |
| BROWSER-8 failure-driven self-improvement | intentionally meet selector drift, modals, overlays, races, delayed loading; detect → root-cause → memory update → benchmark → improvement | the stress page (CP2): a local page that fights back, plus the findings ledger |
| BROWSER-9 self-dogfooding (mandatory) | Unown against Unown: landing, docs, claims, defects, issues, fixes, PRs, browser-verified | the whole round is this lane; the receipts are the point |

Benchmark suite (the mission's ten): GitHub Issue Creation · Repository Review
· Documentation Discovery · Documentation Navigation · Vercel Deployment · Bug
Reproduction · Competitor Research · Release Monitoring · PR Review ·
Documentation Audit — each with a cold run, a warm run, and the improvement
delta; receipts committed under `benchmarks/browser-autonomy-round/` per the
benchmarks' own contract (pin everything; accuracy paired with cost/latency).

Reporting contract (per browser-intensive task): Task · Browser Actions
Performed · Screenshots/Evidence · Memory Used · Failures Encountered ·
Workarounds Applied · Capability Assessment (VALIDATED/PARTIAL/FAILED) ·
Improvement Opportunities · Memory Candidates · Benchmark Impact.

Standing discipline inherited from the lineage: green before touching
anything, a gate after every stage, push per milestone, media assets are
never deleted, DOX updated in the same change that moves anything it counts.

## CP1 — the browser runtime proof (first light through the tool)

Four live runs against the real stack (receipts under
`benchmarks/browser-autonomy-round/receipts/`):

- **Smoke** (`unown -p`, example.com): title + a11y heading read back
  correctly, screenshot saved — 10.5 s round trip, exit 0. First finding on
  the very first shot: the screenshot is **JPEG data under a `.png` name**
  (1280×720, `file` says JPEG) — the capture default is jpeg
  (`tools.ts` format param) and the save path takes the model's extension
  unchecked (`session.ts:1708`).
- **Stress run 1 — cold, blind** (the goal stated, the trap list withheld):
  PASSED in 33 s / 17 model calls, exit 0. Recovered in-session from the
  newsletter modal, the cookie banner, the two-stage order button, and the
  native `confirm()` (auto-dismissed and cancelled the order; the agent
  explored `browser dialog list`, armed `dialog accept`, re-clicked).
- **Stress run 2 — warm, pre-dream** (fresh session; dream v1 memory carried
  the banner/iframe/screenshot facts, not yet the dialog lesson): PASSED in
  79 s / 18 calls. Same dialog trap, same recovery depth.
- **Stress run 3 — post-dream** (dream v2 carries the dialog lesson, see
  CP5): PASSED in 47 s / 25 calls. The trap was still hit — but the recovery
  was direct (re-arm + re-click, no `dialog list` exploration). Reactive
  recall improved; proactive application did not happen.

| Run | Label | Duration | Model calls | Exit | Success |
|---|---|---|---|---|---|
| 1 | cold (blind) | 33 s | 17 | 0 | yes |
| 2 | warm (pre-dream) | 79 s | 18 | 0 | yes |
| 3 | post-dream | 47 s | 25 | 0 | yes |

Verdict: the browser tool's core loop (navigate → snapshot → refs → act →
verify) is **VALIDATED** on a hostile page — 3/3, zero human interventions,
and every failure class the fixture planted was detected and recovered
in-session. Model-call count on an identical task class is noisy
(17/18/25) — the durable signals are success rate and recovery depth.

## CP2 — the stress page and the failure ledger

The fixture: `benchmarks/browser-autonomy-round/fixtures/stress.html` (+
`stress-frame.html`, the iframe document) — nine planted failure classes:
selector drift (the CTA id is randomized per load; the stable contract is a
`data-stable-name`), a modal that interrupts 1.5 s in (with a re-open trap
on "subscribe"), a cookie banner, an arm-race (the order button punishes
Clicks within 1.5 s of arming by resetting the cart), delayed dynamic
content (the real summary lands 2 s after checkout), an open shadow root
(the variant picker), a same-origin iframe (the address form), and a native
`confirm()` guarding the final click. Success marker:
`#final-status[data-success="true"]`.

The findings ledger:

| # | Finding | Where | Severity | Class |
|---|---|---|---|---|
| F1 | screenshot capture defaults to jpeg but the save path takes any extension unchecked — JPEG data under a `.png` name | `browser/tools.ts:111`, `browser/session.ts:1708-1713` | minor (misleading artifact; downstream type-sniffing may misbehave) | defect |
| F2 | native dialogs auto-dismiss by default — a `confirm()` flow silently cancels; docs warn, `dialog accept` arming recovers, but the memory lesson was applied reactively (faster recovery) not proactively (no pre-arm) in run 3 | `browser/session.ts` dialog handling; `docs/browser.md` CAPTCHAs/dialog section | medium (first-click data loss class) | design + memory-application gap |
| F3 | `fill_form` in a same-origin iframe can silently lose values: the fill reports success against a doomed pre-swap document when the iframe finishes loading after the main page's readyState gate — no per-frame readiness barrier, no post-fill persistence check. Reproduced standalone (receipt `iframe-fill-race-repro.jsonl`): fill "succeeded", snapshot showed `value=""` | `browser/session.ts:876` (`waitForPageReady` gates only the top document), `browser/session.ts:1422-1459` (`fillForm` resolves through `contentDocument` recursion) | high (silent data loss in forms — the tool's flagship journey) | defect |
| P1 | ref-based addressing neutralizes id drift by design — run 3 explicitly noticed the randomized CTA id and sailed through on refs + the stable `data-stable-name` | `browser/a11y.ts`, `browser/tools.ts` | positive | validated claim |
| P2 | refs resolve through open shadow roots and same-origin iframes exactly as documented — the variant picker and the address form were driven by ref in all three runs | `browser/session.ts` findIn recursion | positive | validated claim |
| P3 | modal + overlay interruption handled 3/3, including the newsletter re-open trap (avoided every time) | fixture F2/F3 vs runs 1-3 | positive | validated claim |

## CP2b — the memory loop on this round's own sessions (BROWSER-7, early evidence)

The learning loop closed on browser work within the hour, unprompted:

- The three terminal sessions delivered notes to the engine (outbox →
  `POST /api/notes`); the engine's `auto-dream` job (10 min interval)
  consolidated them into `.unown/memory/project.md` **v1** — five
  browser-derived facts: the cookie banner, the newsletter dismissal path,
  the cross-frame address form, the screenshots directory convention, and
  the JPEG-under-`.png` quirk (it caught F1 from the transcripts alone).
- An explicit `unown note` with the dialog lesson + `POST /api/dreams/run`
  produced **v2**, carrying the exact procedural fix: "arm 'browser dialog
  accept text=OK' before clicking the button that opens the confirm,
  one-shot policy, re-armed after each use".
- Run 3 (post-dream) then recovered from the dialog trap directly — no
  `dialog list` exploration — but still did not pre-arm. **Recall:
  VALIDATED. Proactive application: PARTIAL.** The gap is a real improvement
  opportunity: browser lessons land in session-start memory, but the moment
  they matter is the tool call itself — a tool-time procedural hint lane
  (surface matching memory entries when the browser tool is invoked) would
  close it. Filed with the round's improvement ledger (CP6).

## CP3 — self-dogfooding: Unown against Unown (BROWSER-9 + BROWSER-5 + BROWSER-2)

The visitor journey (receipt `visit-landing.jsonl` + the resumed compile
`visit-landing-2.jsonl`): hero, install command, dex search, FAQ, blog and
console/net audit all extracted correctly — the install command matches
`docs/install.md` exactly, the latest blog post resolves, and the only
defects found were dev-server-class (below). The demo-app user simulation
(`demo-user.jsonl`) burned its full 40-turn budget investigating a "dead"
`+` button on `/demo` — which turned out to be the round's most valuable
find:

- **F4 (defect, fixed in this round)**: the dev server was silently
  un-interactable via `127.0.0.1` — Next 16 blocks "cross-origin" dev
  resources (fonts, the HMR socket) from unrecognized origins, hydration
  silently never completes, every interactive element is dead with zero
  on-page console errors. The terminal agent found the symptom; a second
  browser stack (agent-browser, an independent CDP implementation)
  reproduced it; `localhost` vs `127.0.0.1` isolated the cause; the dev
  log carried the one-line fix. Shipped: `allowedDevOrigins:
  ["127.0.0.1"]` in `next.config.ts`, pinned by `src/next-config.test.ts`
  (2 tests), symptom row in `docs/troubleshooting.md`, CHANGELOG
  `[Unreleased]` entry + rail regen. Verified through the browser after
  the fix: the `/demo` composer opens via `127.0.0.1`, 1 dialog, 5
  textboxes, zero console errors. Production was never affected (the
  live deploy hydrated fine throughout) — and the e2e lane boots a
  production build, which is why CI could never catch it.
- **F5 (incident, honest receipt)**: M2 pushed **red CI** — the dream
  render of the tracked `.unown/memory/project.md` (committed in M2)
  pruned the "Failed cycles auto-recover" line at the 110-memory render
  cap, and that line is quoted by the landing page's memory preview
  (`loop.tsx:118`), reddening `check:claims`. Root cause is a fragile
  coupling: a dream-managed volatile file is a claims-gate writing
  source. The repo's own precedent (the parley scrypt note, restored by
  hand 2026-10-29 after two dream erasures) names the remedy — the
  `## Manual notes` lane survives every re-render. The line is restored
  there with its provenance; `check:claims` green again (62/62). Process
  debt owned: M2 should have re-run the full gate set after committing
  dream output, not just `check:docs`. Improvement candidate: the
  claims gate could special-case memory-file literals with a clearer
  failure message pointing at the manual-notes lane.
- The demo-app user simulation will be re-run against the fixed dev
  server (the warm run doubles as the user-simulation benchmark).

The honest null: turn-count did not improve across cold → warm → post-dream
(17 → 18 → 25); the improvement showed up as recovery depth on the dialog
trap (2 exploratory actions → 1 direct action), not as prevention.
Benchmark impact recorded in
`benchmarks/browser-autonomy-round/receipts/stress-checkout-summary.json`.

## CP4 — the competitor research pass (BROWSER-1 + BROWSER-3 + BROWSER-6)

Planned: the browser-driven sweep with citations; one docs-navigation build
task; release-monitoring snapshots.

## CP5 — the memory audit at close (BROWSER-7, full round)

CP2b carries the early evidence (dreams v1/v2, the recall-vs-application
split). This checkpoint closes the loop at round end: the full memory diff
attributed per lane (which browser-derived facts survived, which went
stale), the recall/staleness numbers over the round's own sessions, and the
skill candidates minted from recurring browser procedures.

## CP6 — the benchmark suite and the closeout

Planned: cold/warm receipts under `benchmarks/browser-autonomy-round/`; the
mission's table; the CHANGELOG `[Unreleased]` section; README + DOX + blog;
the final report in the mission's format.
