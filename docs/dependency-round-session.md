# The Dependency Round — session log (2026-11-01)

> **Purpose.** Safely update every applicable package in the repo, prove no
> regression at every stage, and ship the result as v0.0.54. The round
> inherited the release-recovery round's discipline: green before touching
> anything, a gate after every stage, the tag only on a green SHA.

- Round owner: the dependency session (lineage: release-recovery round →
  this round; the first v0.0.54 content)
- Status: **complete** — updates landed and gated, v0.0.54 tagged on green
  CI and published
- Related pages: [the research and decision record](dependency-round-research.md) ·
  [the release-recovery round](release-recovery-session.md) ·
  [testing strategy](testing-strategy.md) · [updating](updating.md)

---

## Environment checkpoint (resumable)

- Sandbox lineage `/home/z/my-project/Unown`, clone @ `72110634` (main,
  clean, in sync; 8 commits ahead of `v0.0.53` — the CI-gate rounds).
- bun **1.4.3** (CI's exact pin; the sandbox shipped 1.3.14, upgraded via
  `npm i -g bun@1.4.3` *before any install* — the sub-1.4 lockfile-downgrade
  incident class stays out of play).
- `.env` from `.env.example`; `BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`,
  key set, `BRIDGE_MODEL=agnes-3.0-flash`,
  `UNOWN_HOME=/home/z/my-project/unown-home` (the documented containment
  override).
- Install: `UNOWN_NO_LINK=1 UNOWN_NO_ENGINE_SERVICE=1 bun scripts/install.ts`
  — 7/7 green (root + pi-repo frozen installs, model-data hydration,
  `build:offline`, .env links, engine service skipped by env).
- Playwright chromium installed for the e2e + shot lanes; the PTY harness
  was not needed this round (no TUI changes).

## CP0 — the baseline (green before touching anything)

| Gate | Result |
|---|---|
| `bun run typecheck` | 0 errors |
| `bun run lint` | 0 errors, 4 pre-existing warnings (unchanged all round) |
| `bun test src` | 2063 pass / 0 fail (15 497 expects) |
| engine suite (`pi-repo/packages/self-learning`, `bun test test/`) | 5326 pass / 101 skip / 0 fail — matches the README's documented count; the first pass showed 1 order-flake that vanished on re-run (the flaky-reference class the suite itself documents) |
| bridge suite (`mini-services/llm-bridge`, `bun test`) | 243 pass / 5 skip / 0 fail |
| `bun run build` + standalone | green |
| e2e (`bunx playwright test`) | 15 passed |
| `bun audit --prod` | clean — "No vulnerabilities found (checked 82 packages)" |
| real-user smokes | `bun bin/unown --version` → 0.0.53; `bun run agent:start` → bridge upstream ok 200 / 6 agnes models, engine v0.0.53; `bun bin/unown -p "Reply with exactly: UNOWN_OK"` → `UNOWN_OK`, exit 0; `bun bin/unown doctor` green (2 expected ⚠: no LSP, no PATH shim) |

## CP1 — the research

Delegated sweep of all 28 root packages (`npm view` + `bun outdated`, bun
1.4.3) plus release-note research for every candidate range: **6 real
updates within policy**, everything else at latest; the only available
major anywhere is TypeScript 7 (parked for humans). Scope decisions: root
manifest is the only applicable surface — `pi-repo` frozen (upstream-sync
policy), benchmark fixtures stay (receipt-bearing environments), GitHub
Actions ride their own weekly Dependabot lane. Full record:
[the research doc](dependency-round-research.md).

## CP2 — staged updates, one gate per stage

| Stage | Change | Gate (all green) |
|---|---|---|
| 1 | `bun update next eslint-config-next marked` → next 16.4.3, eslint-config-next 16.4.3, marked 18.1.2 (+69 transitive floats) | typecheck, lint, 2063 unit, build, 15 e2e; **blog regen byte-identical** (37 posts, `check:blog` ok); `check:changelog` ok; audit clean; lock still v1 |
| 2 | eslint 10.13.0 → 10.14.0 (exact) | lint (exercises the whole plugin graph), typecheck, audit |
| 3 | lucide-react 1.61.0 → 1.66.0 (exact) | typecheck (icon exports), 2063 unit, build |
| 4 | framer-motion 14.6.0 → 14.9.0 (exact) | typecheck, 2063 unit, build, 15 e2e — plus the visual A/B below |

## CP3 — the visual A/B (framer-motion is the one with eyes on it)

`scripts/landing_shots.mjs` against the production standalone build: 22
sections × both schemes + 3 reduced-motion, palette asserts per scheme,
**zero console errors** across all 25 frames.

- **Noise floor** (new tree, two passes): 22/25 pixel-identical; the 3
  diffs sit in the live star-count / animated-terminal regions
  (0.006–0.143% of pixels) — the page's own dynamic content.
- **Old tree vs new tree**: 21/25 pixel-identical; the 4 differing images
  differ in the *same* dynamic regions the noise floor identified, mean
  channel deltas 9–165 in ≤0.113% of pixels.
- **Reduced-motion lane (deterministic): 3/3 pixel-identical — 0
  differing pixels.** Settled rendering is unchanged.

The VLM design-review pass (`scripts/agnes_review.mjs` through the Agnes
lane) ran on all 25 shots with a regression-hunting brief and returned
mixed verdicts; its concrete "framer-motion 14.9 regression" claims
(half-finished reveals in reduced-motion frames, where nothing animates)
are contradicted by the pixel evidence above — a leading-brief confabulation,
recorded here as a lesson in briefing reviewers neutrally. Its remaining
feedback (changelog-card clipping, date-format consistency) is standing
design critique older than this round, not a regression; no action in
this round's scope.

Incidental receipt: the shot pass's palette assert once refused to
photograph the page — a stale `next-server` process was serving the
previous build's chunk names (CSS HTTP 500). Exactly the failure mode the
assert exists for; killing the stale process restored a clean pass.

## CP4 — the release

- **The fold tripped the landing scroll budget on the first local cut** — the
  52nd rail stop's chrome measured the page at 3,930 words against the 3,920
  ceiling (the e2e budget gate caught it before the release commit left the
  machine). The sanctioned first move — compressing the round's own listed
  changelog title — turned out to be a **page-level no-op**: the rail prints
  titles only for the `Added`/`Behavior` buckets (`LISTED` in
  `changelog.tsx`), and this round's entries are all `Changed`/`Fixed`, so
  the stop spends chrome alone (measured 3,930 before AND after; the CHANGELOG
  title edit stays — it is what GitHub and the file read). The **twelfth
  ceiling amendment 3,920 → 3,950** carries the stop's chrome plus one stop
  of headroom, documented in all three surfaces the budget lives
  (`e2e/landing-budget.spec.ts`, `scripts/landing_audit.mjs`, the landing
  AGENTS.md ledger — the 0.0.48 no-divergence lesson applied; the first cut
  of this record claimed "post-compression 3,923" from arithmetic instead
  of a measurement and was corrected). Full e2e 15/15 after the fix.
- Version bump 0.0.53 → 0.0.54, `[Unreleased]` folded into
  `## [0.0.54] - 2026-11-01`, rail regenerated — release commit
  `3facce9a`.
- The bump commit triggered the full 3-OS CI matrix (the spend-gate rule):
  **run 41287629614 green, 19/19 jobs** — cross-platform gate detected the
  bump, macOS + Windows `Build + test` legs ran, security scan (audit
  clean), e2e, coverage, docs, theme, palette, mermaid all green.
- Tag `v0.0.54` cut on the green SHA `3facce9a`; release workflow run
  `41288475612`: `ci-green` passed (the gate that failed v0.0.53's first
  cut), then the 3-OS release assertions, the 6-binary build + SBOM, all
  five artifact smoke legs, publish, feed verification and the 3-OS
  install smokes — **completed success on attempt 2**.
- **The one flake, with its receipt.** Attempt 1's Windows assertion failed
  on a single engine test — `delegations store schema (the F34 boot pin) >
  a FRESH database constructs and carries both delegations objects` —
  timing out at 5,076 ms against its 5,000 ms limit. The same test on the
  same SHA on the same `windows-latest` runner family took **220.99 ms**
  in the push-event CI run's Windows `Build + test` leg (job `124792077390`),
  a 23x variance — a runner-level disk hiccup on fresh-DB construction, not
  a code change (the round touches no engine source; `pi-repo/` is
  byte-identical). Failed jobs were rerun via the API
  (`rerun-failed-jobs`, attempt 2); the test passed and the release
  published. Recorded here as the borderline-timeout flake class for the
  next Windows red.

## CP5 — the closeout

- Blog post `content/blog/2026-11-01-the-dependency-round.md` (release
  type, text-only per the release-post media rule — no referenced visual
  changed, and the pixel diff is the round's evidence) + regenerated blog
  data and feed.
- README documentation-table row for the round; `docs/updating.md`'s
  Related pages gains the round's research record;
  `unown-overview.md` re-stamped (version, commit, date, repo-stat
  snapshot).
- The living project memory (`.unown/memory/project.md`) rides along —
  AutoDream re-rendered it while the stack ran this session (all lines
  preserved, order reshuffled; the f16e8fda precedent).
- SESSION.md's active round graduates to the completed-round pointer and
  the next round's queue stands as recorded.
- Post-release user-side verification: `unown update --check` →
  `unown 0.0.54 — up to date (latest release: v0.0.54)`, exit 0; the
  published release carries 13 assets (six per-OS binaries, installers,
  `release.json`, SBOM, checksums), published 2026-11-01T09:51:07Z.

## Phase ledger

| Phase | Status | Artifact |
|---|---|---|
| 0 environment + baseline | ✅ | CP0 above |
| 1 research + decisions | ✅ | `docs/dependency-round-research.md` |
| 2 staged updates + gates | ✅ | CP2 above |
| 3 visual A/B (framer-motion) | ✅ | CP3 above |
| 4 CHANGELOG + deps commit | ✅ | `6a46d0ce` |
| 5 version bump + 3-OS CI + tag v0.0.54 | ✅ | `3facce9a` + run `41287629614` (19/19) + tag on the green SHA |
| 6 release workflow (build/publish/feed/install) | ✅ | run `41288475612` |
| 7 blog + README row + overview re-stamp + DOX closeout | ✅ | CP5 above |

**Resume-from-here:** the round is complete; the next round's queue is
recorded in `docs/SESSION.md` (the S2 ledger's head, the injection-scanner
ML classifier, the delegation round's subagent-reuse axis, OB-7, the
landing next-round queue, the term.ts snapshot-class follow-up). The
engine/bridge services can be stopped with `bun run agent:stop`; a stale
`next-server` on :3111 is killed with `pkill -9 -f next-server` (the
process renames itself — a `standalone/server.js` pattern misses it).
