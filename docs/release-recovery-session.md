# The Release-Recovery Round — v0.0.53 re-cut (2026-11-01)

> **Purpose.** The v0.0.53 tag was cut against red CI: the release workflow's
> `ci-green` gate blocked everything downstream, latest stayed v0.0.52, and the
> changelog's 0.0.53 entry described a release that never shipped. This round
> diagnosed the red, repaired it (plus one production defect the failing test
> had hidden), re-verified the whole tree like a real user, and re-cut the
> release. It also left the 0.0.54 queue prepared.

- Round owner: the recovery session (resumed from the todo-unification +
  footer rounds' lineage)
- Status: **complete** — the repair landed, the tag moved, the release published
- Related pages: [the todo round's log](plan-mode-todo-unification-round-session.md) ·
  [the footer round's log](footer-quiet-round-session.md) ·
  [the settings round's log](settings-evolution-session.md) (the snapshot-class
  finding this round re-met) · [testing strategy](testing-strategy.md)

---

## CP0 — the discovery: the release that never was

Resumed after a sandbox recycle (the previous session's workspace was reclaimed;
the repo re-cloned at `53b8d766` — the `release: v0.0.53` commit, tree clean,
in sync with `origin/main`, tag `v0.0.53` present). The task: prepare for the
next version bump. The GitHub API told the real story first:

- **Latest published release: v0.0.52** (2026-10-31T15:01:14Z, 13 assets) —
  NOT 0.0.53.
- Tag `v0.0.53` → `53b8d766`; the **Release workflow run for the tag failed**
  (run `41221777895`): `CI green on the tagged commit` failed
  (16:52:52Z→17:04:00Z) and every downstream job — the 3-OS verify matrix, the
  artifact build, the 5-leg smoke, publish, feed verify, install smoke — was
  **skipped**.
- CI on main was red for the entire round chain: `53b8d766` ✗, `caa93195` ✗,
  `644975df` ✗, `9fd5de32` / `4e43ff8c` / `a256e650` / `f49ef307` cancelled,
  `f1be8569` ✗ — every push since `7aeaf1ec` (v0.0.52, the last green). The
  todo-unification and footer rounds had landed with a red pipeline; the
  session logs' "5426/0" claims came from local runs that hit a friendlier
  file order (below).
- The failing job: `Build + test` on **all three OSes**; the failing test:
  `pi-repo/packages/self-learning/test/plan-mode-todo-unification.test.ts:202` —
  the round's own M1 fallback pin — `expect(legacy.length).toBeGreaterThanOrEqual(1)`
  → **Received: 0**. Ten of the file's eleven tests passed.

**Root cause (reproduced locally, both directions).** `registerTodoAddon`
sets module-level bridges (`seedForegroundTodosImpl` and friends) that nothing
ever resets — a one-way latch, correct only for a process that registers
exactly once. `bun test` runs every file in ONE process and the file order
varies by platform/runner (the exact variance `test/_env.ts` documents);
`goal.test.ts` registers the addon before the unification file runs, so
`isTodoOverlayAvailable()` answered true inside the M1 fallback test and the
legacy `plan-steps` widget never mounted. Reproduction matrix (bun 1.4.3,
matching CI):

| Run | Result |
|---|---|
| the file alone | 11/11 PASS |
| `goal.test.ts` → the file (the CI order) | M1 fallback FAIL — the exact CI assertion |
| full suite `bun test test/` | 4 fail (M1 + three pre-existing order ghosts, CP2) |

**The production defect the failing test had hidden.** The same latch is not
just a test problem: `/reload` re-runs extension factories **in the same
process** (`interactive-mode.ts` → `session.reload`), and the `/addons`
toggle's answer is "disable (until /reload)". After a todo-addon disable +
`/reload`, the stale latch kept `isTodoOverlayAvailable()` true for an overlay
that could never mount again — tools.ts kept the legacy plan-steps fallback
retired, and the session ran with **no progress surface at all** until a full
process restart. The M1 fallback test was, unknowingly, pinning the right
contract through the wrong lens.

Research pass: bun's single-process file-order variance is documented in the
repo's own `_env.ts` comments (three prior CI incidents cite it); the
codebase's established test-seam pattern (`resetDelegationLedgerForTest`,
`setMemoryPlatformForTests`, `_setMlClassifierForTests`, …) is the sanctioned
shape for module-singleton resets; Keep-a-Changelog semantics (the date is the
release date) and the repo's version contract (tag === package.json ===
`unown --version`) govern the re-cut. Next: M1.

## CP1 — the fix: bridges as a (re)registration-cycle contract

- `src/addons/todo.ts` — **`resetTodoAddonBridges()`**: restores the five
  todo-owned module slots to their unregistered defaults. The tools-owned pair
  (the plan-sync reader, the completed listener) is deliberately NOT reset:
  the unown-tools extension registers before this addon in every cycle and
  re-arms its own.
- `src/addons/index.ts` — the addons factory calls the reset at the **top of
  every cycle**, before the conditional registrations. Boot and `/reload`
  both converge to "bridge state mirrors the CURRENT addons.json": enabled
  cycles re-register immediately (the reset is invisible to them); a disabled
  cycle leaves the fallback lane live.
- `test/plan-mode-todo-unification.test.ts` — a describe-level `beforeEach`
  reset makes every test start from the unregistered state (order-proof by
  construction), and a new **RELOAD pin** drives two REAL addons-factory
  cycles through `createUnownAddonsExtension` (cycle 1: default config →
  bridges live; the `/addons` durable write → todo off; cycle 2: fresh
  factories, same process → the latch reset, and approving a plan mounts the
  legacy `plan-steps` widget, never the `unown-todos` overlay). The shared
  `addons.json` is snapshotted and restored byte-exactly (the models-catalog
  `SAVED_MODELS` pattern).
- Pin validation: the RELOAD test run against the **unfixed** source fails
  (1 fail, `git stash` lane); against the fixed source the file passes in
  both orders — alone 12/12, `goal.test.ts` → the file 44/44.

Environment fact re-confirmed (the todo round's GAP-REGISTER was right): the
interactive edit tool rewrites whole files tabs→spaces — two source edits
showed as 410/1678-line phantom diffs in `git diff --stat` and were reverted;
**every edit this round went through byte-exact Python patchers** (kept in the
session workspace), `git diff --numstat` audited after each. Pushed as
`engine(addons)`. Next: M2.

## CP2 — the snapshot-class ghosts (the null hypothesis first)

With the M1 fix in, the full suite still failed 3 tests in the local order.
Null hypothesis run (fix stashed, clean `/tmp/engine-tests-b`): **the same 3
fail without the fix** — pre-existing order-dependence, not collateral. Two
distinct ghosts, one root cause class (the settings round's "term.ts
module-scope `UNOWN_HOME` snapshot" finding):

- `models-catalog.test.ts` ×2 (`writeAgentConfig`): ENOENT on
  `/tmp/engine-tests-b/unown-home/agent/models.json`. Mechanism: in the local
  order term.ts first loads **inside `settings-hub.test.ts`'s redirected-home
  window**, so `UNOWN_AGENT_DIR` freezes a directory settings-hub deletes in
  `afterAll` — `writeAgentConfig` wrote into the ghost tree while the test
  read the real redirect. (Any predecessor that creates the agent file first —
  `model-spec-wiring`, `cli/golden` — masks it; that is CI's luck, not CI's
  guarantee. The settings-hub comment records the macOS leg tripping this
  window class once before.)
- `engine-token-mirror.test.ts` H6: the file imported `../src/term.ts`
  **before** `./_env.ts` (against the suite's first-import convention) and
  asserted the call-time `sharedEngineTokenPath()` against the module-scope
  snapshot.

Fixes (surgical, both verified):

- The H6 test now follows the convention and asserts **call-time against
  call-time** (`resolveUnownHome()` on both sides).
- `writeAgentConfig` resolves the agent dir **at call time**
  (`join(resolveUnownHome(), "agent")`) — `unown-home.ts`'s documented
  contract: "the env override is read at CALL time, not module load".

The poison order (`settings-hub` → `models-catalog` → `engine-token-mirror`)
passes 45/45 after the fix. **Recorded follow-up (not owed by this round):**
the snapshot class remains open for other `term.ts` consumers
(`printModelsOverview` and friends still read the module-scope const; the
general cure — call-time resolution everywhere, or per-test env scoping in
settings-hub — wants its own round with the subprocess-pin pattern). Pushed
with M1's verification trail. Next: M3.

## CP3 — verification like a real user (the full matrix)

Engine lane (bun 1.4.3 = CI's pin):

| Gate | Result |
|---|---|
| self-learning unit `bun test test/` (clean tree, the reproducing order) | **5326 pass / 0 fail / 101 skip** (5427 total) |
| integration suite (`PI_TEST_SCOPE=integration`) | 13/0 |
| llm-bridge suite | 248/0 (5 env-skips) |
| version consistency (`bun bin/unown --version` === package.json) | 0.0.53 = 0.0.53 |
| CLI boot + doctor | `--help` boots; doctor green (2 expected ⚠: unverified model spec, no LSP) |

Landing lane: lint 0 errors (1 pre-existing FlowsPage warning); typecheck
clean; `bun test src` 2063/0; docs links, theme contract, changelog rail
(51 stops / 500 entries), blog (36 posts), benchmarks (6 tracks), claims (62
literals) all green; production build green; artifact builder dry-run (6
targets) + `build-artifacts.test.mjs` 21/0 + `release-manifest.test.mjs` 9/0;
changed-line coverage gate passed; **e2e 15/15** (after installing the
sandbox's missing Playwright chromium — an environment fact, not a repo
defect).

Real-user lane (the stack live: bridge :3031 with the Agnes upstream OK 200,
engine :3030 v0.0.53 @ `53b8d766`; `.env` carries the Agnes key; dist rebuilt
via `agent:install` so the vendored tree includes the fix):

- Print smoke through the full chain: `unown -p "Say OK"` → `OK`, exit 0.
- **`scripts/tui-capture/verify_todo_unification.py` — ALL 14 CHECKS PASSED**
  against the live model: planning suspension, no legacy widget, the approval
  dialog's single checklist, the seeded overlay mounted AT approval, the
  footer chip, post-execution single-surface, and the session-file ground
  truth (exactly ONE seed entry, ids `[1, 2, 3]` all pending at seed, the
  executing plan persisted, FINAL todo/plan lockstep with zero mismatches).
- **`scripts/tui-capture/verify_footer_quiet.py` — 9/9 checks held** (the
  merged row, two-row rest, ambient silence, busy hint swap, turn-chip dedup,
  the engine-down attention row, the classic kill switch) — the footer round's
  lane on the repaired tree.

Pushed as `verify(...)`. Next: M4.

## CP4 — the paper trail, the re-cut, and the 0.0.54 preparation

- CHANGELOG `[0.0.53]`: the date corrected to the actual publish date
  (2026-11-01, Keep-a-Changelog semantics), the re-cut clause in the intro,
  two Fixed bullets (the recovery story; the snapshot-class pair), the
  recovery receipt link. The rail regenerated **in the same commit** (51
  stops, 500 entries — the F39 lesson).
- The footer round's session log gained its **CP5** — the honest release
  record the round never wrote (the cut went red; this round repaired and
  re-cut).
- `docs/SESSION.md` refreshed (it still declared the Settings Evolution round
  active — three rounds stale) and re-pointed at this round + the 0.0.54
  queue.
- `docs/AGENTS.md` + the README Documentation table carry this page; the DOX
  chain walked (Read-Before-Editing honored; no media assets touched — the
  PTY stills from CP3 landed in the captures tree per the harness's own
  convention).

The re-cut procedure (the version contract holds: package.json is already
0.0.53, so the tag must be `v0.0.53`):

1. Push the fix + docs commits to `main`.
2. Wait for CI green on the pushed SHA (the `ci-green` job polls the same
   signal; a tag on a red SHA can never release — the exact failure mode this
   round repaired).
3. Delete the never-published tag and re-point it:
   `git push origin :refs/tags/v0.0.53 && git tag v0.0.53 <green-sha> && git
   push origin v0.0.53`. Moving it is honest here: no release object, no
   assets, no feed entry, no installs ever referenced the old tag — the
   alternative (cutting 0.0.54 and leaving a phantom 0.0.53 in the changelog)
   would document a release that never existed.
4. Watch the release workflow end-to-end (3-OS verify, 6 artifacts + SBOM +
   attestations, 5-leg binary smoke, draft → published with 13 assets, feed
   verify, installer smoke) and record the receipts in this log's closeout.

## Closeout — the re-cut executed, with receipts

- Commits: `b4ae0d0f` (engine: the bridge-cycle contract + the snapshot-class
  pair + the pins) and `ae1d6c0c` (docs: the paper trail), pushed to `main`.
- **CI on `ae1d6c0c`: 18/18 jobs green** (run `41234835139`) — the first
  green CI on main since `7aeaf1ec` (v0.0.52).
- Tag moved: `v0.0.53` deleted at `53b8d766` and re-cut at `ae1d6c0c`
  (lightweight, matching the release line's existing tag shape).
- **Release workflow run `41235703871`: completed / success** — ci-green →
  the 3-OS verify matrix → the production build with 6 cross-compiled
  artifacts + SPDX SBOM + attestations → the 5-leg binary smoke → draft →
  published → feed verify → installer smoke.
- **The release is live**: `v0.0.53` published 2026-10-31T20:00:03Z with
  **13 assets** (6 platform archives 31.5–48.1 MB, `install.sh` +
  `install.ps1`, `release.json` severity `normal`, `sha256sums.txt` with 12
  entries, `sbom-spdx.json`, `release-checklist.md`, `version.txt` =
  `0.0.53`); latest now points at it. The checklists and receipts ride the
  release body itself.
- Post-publish state: `main` green at the docs closeout commit; the 0.0.54
  queue below is the next session's opening position.

**The 0.0.54 queue (recorded, prepped):** the S2 ledger's head — S2-11 (the
spend meter) and S2-4 (the memory health card), each flipping a pinned,
waiting benchmark miss; then S2-7/S2-8/S2-9, the S2-3/S2-16 L-pair, S2-22;
the injection-scanner ML classifier (the production TODO); the delegation
round's subagent-reuse axis; OB-7's fleet outcomes in the brief; the landing
next-round queue (cmd-K search, blog hover-previews); and the snapshot-class
follow-up from CP2. Convention note: `## [Unreleased]` is added when the
first 0.0.54 content lands (the rail gate rejects 0-entry stops); the bump
itself is the release commit — package.json version + the dated heading +
the regenerated rail + the tag, per the 0.0.53 re-cut's own receipts.
