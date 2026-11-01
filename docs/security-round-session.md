# The Security Round — session log (2026-11-01)

> **Purpose.** Address every open Dependabot advisory and every open CodeQL
> code-scanning finding on the repo, prove no regression at each stage, and
> ship the result as v0.0.55. The round inherited the dependency round's
> discipline: green before touching anything, a gate after every stage, the
> tag only on a green SHA.

- Round owner: the security session (lineage: dependency round → this round)
- Status: **in flight** — fixes landed and gated; the v0.0.55 release and
  closeout follow (see the phase ledger)
- Related pages: [the dependency round](dependency-round-session.md) (the
  scope policy this round's declines lean on) ·
  [the release-recovery round](release-recovery-session.md) (the tag-on-green
  rule) · [testing strategy](testing-strategy.md) · [updating](updating.md)

---

## Environment checkpoint (resumable)

- Sandbox lineage `/home/z/my-project/Unown`, clone @ `60fc9324` (main, clean,
  in sync with origin; v0.0.54). bun **1.4.3** (CI's exact pin).
- `.env` from `.env.example`; `BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`,
  key set, `BRIDGE_MODEL=agnes-3.0-flash`,
  `UNOWN_HOME=/home/z/my-project/unown-home` (the documented containment
  override). Stack boots via `bun run agent:start` (bridge :3031, engine :3030).
- Playwright chromium installed for the e2e lane. A stale `next-server` on
  :3111 serving the previous build's chunks is the known shot-lane trap —
  killed (`pkill -9 -f next-server`) before the build.

## CP0 — the intake (what "address dependabot and code sense" meant, exactly)

Read from the GitHub API with the PAT (never committed — remote URL only):

| Source | Open items |
|---|---|
| Dependabot alerts | 4: #47 follow-redirects ≥1.16.0 ≤1.16.1 (HIGH, fixed 1.16.2), #48/#49/#50 minimatch <11.0.1 (MEDIUM, fixed 11.0.1) |
| Code-scanning alerts | 3: #81 js/insecure-randomness (`src/lib/sigil/demo-data.ts:120`), #82 + #83 js/polynomial-redos (`providers-cli.ts:270`, `setup.ts:947`) |
| Secret scanning | 0 open |
| Dependabot PRs | 7: #31, #32 (the advisories above), #34 transformers 4.3.2, #37 coverage-v8 5.0.5, #40 codeql-action 4.39.1, #41 harden-runner 2.22.3, #42 download-artifact 8.0.2 |

Baseline gates on the pristine tree: `bun run typecheck` 0 errors; the
full suites are the dependency round's green receipts (v0.0.54 CI 19/19).
The sandbox re-proved typecheck + the sigil subset before any edit.

## CP1 — the research

- **CVE-2026-116689 / GHSA-mrwp-f3q8-3g9p** (follow-redirects): 1.16.0/1.16.1
  validate `sensitiveHeaders` with `instanceof Array` — a cross-realm array is
  silently dropped, so caller-declared credential headers can follow a
  redirect to an attacker-controlled origin. Affected: 1.16.0–1.16.1; fixed
  1.16.2. `pi-repo/bun.lock` had **already resolved 1.16.2** — only the npm
  `package-lock.json` lagged at 1.16.1 (the surface alert #47 scanned).
- **CVE-2026-118764 / GHSA-g3hv-75wg-m249** (minimatch): vulnerable range
  `< 11.0.1`. At `optimizationLevel ≥ 2`, `firstPhasePreProcess` repeatedly
  expands attacker-controlled `**/..` segments in a fixpoint loop and
  `secondPhasePreProcess` compares the expanded entries pairwise — a short
  malicious glob burns CPU and memory at compile time. Fixed in 11.0.1, whose
  engine swap to `@isaacs/nonrecursive-glob-match` will not be backported
  (upstream's words) — the fix is necessarily a major. Consumers in the tree:
  `coding-agent/src/core/model-resolver.ts` (`minimatch(id, glob, {nocase})`)
  and `package-manager.ts` (`minimatch(path, pattern)` ×6) — the plain
  function API is unchanged in v11.
- **`@vitest/coverage-v8@5.0.5`** (PR #37): the npm registry shows
  `peerDependencies: { vitest: "5.0.5" }` — an EXACT pin. The isolated bump
  Dependabot proposes cannot satisfy the frozen vendored workspace it targets
  (vitest is pinned 4.1.12 in eight packages). Declined; the paired vitest 5
  migration is an upstream-sync decision per the dependency round's policy.
- **Action SHAs verified against tags** with the API before applying:
  `v4.39.1` → `9b32540…` (codeql-action, dereferenced through the annotated
  tag), `v8.0.2` → `9000827…` (download-artifact), `v2.22.3` → `46b06ce…`
  (harden-runner). PR #40's title confirmed the current codeql-action pin is
  3.39.0 — the workflow's `# v3` comment was stale on both sides; the applied
  edit updates the comment to the real `# v4.39.1` and moves `init` AND
  `analyze` together (Dependabot's patch moves only `analyze`, which would
  leave the pair mismatched inside one workflow).
- **Root `bun.lock` minimatch** (10.2.6 + nested 3.1.5s): dependents are the
  eslint chain only (`@eslint/config-array`, `typescript-estree`,
  `eslint-plugin-import/jsx-a11y/react`) — dev-only, `bun audit --prod` clean,
  no advisory fires on the root bun lock, and the root stream ignores majors
  by policy. Left alone, recorded here as the decision.

## CP2 — the CodeQL fixes (behavior-identical by design)

- **#81 insecure-randomness:** `uid()` in `src/lib/sigil/tasks.ts` drew its
  random half from `Math.random()`; task ids are persisted and
  cross-referenced (focus log, sessions, localStorage, the `/demo/api/tasks`
  route). Now `crypto.getRandomValues` — the same fix class as the engine's
  `generateSessionId` precedent (`sessions.ts`: randomBytes after its own
  js/insecure-randomness finding). Id shape unchanged
  (`<time36>-<8 base36 chars>`); the API exists in browser, Bun and Node, so
  the client components that import `tasks.ts` keep working. Pinned by
  `src/lib/sigil/tasks.test.ts` — four tests, including a `Math.random` spy
  stubbed deterministic that proves the ids still vary.
- **#82/#83 polynomial-redos:** `.replace(/\/+$/, "")` on uncontrolled input
  is O(N²) in the trailing-slash run. New `url-trim.ts` — one backward
  `charCodeAt` scan, no regex engine, allocation-free when nothing trims —
  and the idiom swept from **all eleven** inline sites (setup ×2,
  providers-cli, term ×2, server ×2 — including the CORS `Origin`
  normalization — usage-cli, websearch, uninstall ×2), not just the two
  flagged lines, so the next scan cannot simply flag the next copy. Pinned by
  `test/url-trim.test.ts` — five tests including the hostile-input contract:
  a 100 000-slash URL trims in one linear pass under 100 ms (the old regex's
  quadratic rescan blows far past that), plus byte-identity for the empty
  string, `/`, interior-slash and Windows-path shapes the uninstall
  normalizers feed it.

Gates after CP2: root typecheck 0 errors; root suite **2067 pass / 0 fail**
(was 2063 + the 4 new tests); engine suite **5331 pass / 101 skip / 0 fail**
(was 5326 + the 5 new tests); bridge 243/0; build green; 15/15 e2e.

## CP3 — the dependency and CI fixes

| Change | Surfaces | Gate |
|---|---|---|
| follow-redirects 1.16.1 → 1.16.2 | `pi-repo/package-lock.json` (`npm update follow-redirects --package-lock-only` — npm's conservative `--package-lock-only` alone preserves satisfied ranges, so the re-resolution was forced explicitly) | `npm audit --omit=dev` in pi-repo: **0 vulnerabilities** |
| minimatch 10.2.6 → 11.0.1 | all five: coding-agent `package.json` (the exact pin), `npm-shrinkwrap.json` + `install-lock/package-lock.json` (via the repo's own generators — `shrinkwrap:coding-agent`, `install-lock:coding-agent`), `pi-repo/package-lock.json` (`npm install --package-lock-only --ignore-scripts`), `pi-repo/bun.lock` (`bun install`, diff = 4 lines: the pin, the new `@isaacs/nonrecursive-glob-match@1.0.3` entry, the entry swap) | `check:shrinkwrap`, `check:install-lock:coding-agent`, `check:pinned-deps` all green; neither 11.0.1 nor the new engine dep carries `hasInstallScript`, so the generators' allowlist is untouched; the **288** coding-agent vitest tests covering minimatch's consumers pass (one pre-existing failure in the same run — `model-resolver.test.ts`'s fireworks-catalog check — proven pre-existing by stashing the dep changes and re-running: same failure on the pristine tree; it reads the sandbox's hydrated model catalog, not minimatch, and it is not a CI lane in this repo) |
| download-artifact v4.3.0 → v8.0.2 | `release.yml` ×2, `xplat.yml` (from Dependabot's branch — verified the workflows were untouched on main since the branch base) | YAML parses; SHAs verified against tags |
| codeql-action v3.39.0 → v4.39.1 | `codeql.yml` — `init` + `analyze` in sync, comments corrected | same |
| harden-runner v2.22.2 → v2.22.3 | `scorecard.yml` | same |
| transformers 4.3.1 → 4.3.2 | `benchmarks/nonllm/package.json` + committed lock (from Dependabot's branch) | `npm audit --omit=dev --audit-level=high` in that dir: 0 vulnerabilities |
| coverage-v8 4.1.12 → 5.0.5 | **declined** (PR #37) — peer contract pins vitest exactly 5.0.5 | decline comment posted on the PR with the registry receipt |

Post-change gates: `bun install --frozen-lockfile` green at both roots;
`bun audit --prod` clean at both roots (79 root / 180 pi-repo packages);
engine suite re-run with minimatch 11 installed: **5331/0**; bridge 243/0;
root build + 15/15 e2e (the sigil demo feeds the landing page's live-demo
iframe — the uid change is inside it).

## CP4 — the release (pending at the round's opening)

- `## [Unreleased]` re-added to CHANGELOG.md with the round's entries (per
  the recorded v0.0.55 contract in `docs/SESSION.md`), the landing rail
  regenerated (`landing_changelog.mjs`: 53 stops, 506 entries) and
  `check:changelog` green; the scroll-budget e2e passed with the new stop
  (3,950-word ceiling, no amendment needed).
- Real-user smokes with the stack up: `bun bin/unown --version` → 0.0.54;
  `bun run agent:start` → bridge + engine up;
  `bun bin/unown -p "Reply with exactly: UNOWN_OK"` → **UNOWN_OK**, exit 0
  (the full round trip through the Agnes upstream, exercising the edited
  boot path in `term.ts`/`setup.ts`); `unown doctor` green with the two
  expected ⚠ (no LSP, no PATH shim); engine `/api/overview` → `ok:true`.
- Version bump 0.0.54 → 0.0.55, `[Unreleased]` folded into
  `## [0.0.55] - 2026-11-01`, rail regenerated — release commit (lands
  after the fix commits' CI is green).
- The bump commit triggers the full 3-OS CI matrix (the spend-gate rule);
  tag `v0.0.55` cut on the green SHA; the release workflow's `ci-green` gate
  then builds and publishes the six per-OS binaries + installers + SBOM.

## CP5 — the closeout (pending at the round's opening)

- Blog post `content/blog/2026-11-01-the-security-round.md` (release type,
  text-only — no referenced visual changed).
- README documentation-table row for the round; `docs/updating.md` related
  pages; `unown-overview.md` re-stamped (version, commit, date, repo-stat
  snapshot).
- SESSION.md's active round graduates to the completed-round pointer; the
  next round's queue stands as recorded.
- Dependabot PRs closed with receipts pointing at the landing commits
  (#31, #32, #34, #40, #41, #42 applied — #32's five-surface regen supersedes
  the two-surface PR; #37 declined with the peer-contract reason). The four
  Dependabot alerts and three CodeQL alerts verified closed via the API on
  the post-push scan.

## Phase ledger

| Phase | Status | Artifact |
|---|---|---|
| 0 environment + intake | ✅ | CP0 above (API-read alert census) |
| 1 research + decisions | ✅ | CP1 above (advisory anatomy, peer-contract receipt, SHA verification) |
| 2 CodeQL fixes + pinning tests | ✅ | CP2 (uid CSPRNG, url-trim sweep ×11) |
| 3 dependency + CI fixes | ✅ | CP3 (five-surface minimatch, follow-redirects, actions, bench, decline) |
| 4 CHANGELOG + rail + smokes | ✅ | CP4 |
| 5 version bump + 3-OS CI + tag v0.0.55 | ⏳ pending — the release commit |
| 6 release workflow (build/publish/feed/install) | ⏳ pending |
| 7 blog + README row + overview re-stamp + DOX closeout | ⏳ pending |

**Resume-from-here:** the fixes are landed and gated (phases 0–4); next:
the version bump release commit, the tag on green CI, then the closeout
(blog, README row, overview re-stamp, SESSION graduation, PR closures and
the alert-cleared verification). The next round's queue stays recorded in
`docs/SESSION.md`.
