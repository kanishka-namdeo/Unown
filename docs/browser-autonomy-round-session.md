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
- Status: **open** — CP0 intake complete, baseline green, browser runtime
  proof in flight
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

- [ ] `unown -p` browser smoke: navigate, read the a11y tree, screenshot —
      the print-mode envelope's exit code and turn count recorded.
- [ ] The stress page: shadow roots, same-origin iframes, an overlay modal,
      delayed content, a native dialog — the v2 claims (refs through shadow
      roots and iframes; popups tracked; dialogs answerable) read against
      real behaviour.
- [ ] The landing page driven as a user (local dev server) — see CP3.

## CP2 — the stress page and the failure ledger

Planned: a local page that fights back, the eight failure classes the brief
names, and the findings ledger with root causes.

## CP3 — self-dogfooding: Unown against Unown (BROWSER-9 + BROWSER-5 + BROWSER-2)

Planned: the landing page and `/demo` as a real user; product-claim
validation against the engine sources; the defect ledger; issues filed;
fixes and PRs where feasible; browser-verified fixes.

## CP4 — the competitor research pass (BROWSER-1 + BROWSER-3 + BROWSER-6)

Planned: the browser-driven sweep with citations; one docs-navigation build
task; release-monitoring snapshots.

## CP5 — the memory loop on this round's own sessions (BROWSER-7)

Planned: notes → AutoDream → `.unown/memory/project.md`; recall and staleness
checks; skill candidates.

## CP6 — the benchmark suite and the closeout

Planned: cold/warm receipts under `benchmarks/browser-autonomy-round/`; the
mission's table; the CHANGELOG `[Unreleased]` section; README + DOX + blog;
the final report in the mission's format.
