# C-6 receipt — the Chaconne e2e battery lane 1: compose → run → artifacts, K-1 keyboard-only

Date: 2026-11-06
Lane: A2 executor, C-6 (K-1 compose → run → artifacts flow battery)
STATUS: GREEN — the x3-consecutive law holds; the self-skip guard holds; all gates green.

## Files written

| File | Scope |
|------|-------|
| `playwright.chaconne.config.ts` | Repo root — the PLAN §4 config spec verbatim: `testDir "e2e"`, `testMatch /chaconne-.*\.spec\.ts/`, module-scope `process.env.CHACONNE_E2E = "1"`, `outputDir "download/test-results-chaconne"`, `baseURL "http://127.0.0.1:4014"`, chromium-desktop-only project (`devices["Desktop Chrome"]`), ONE webServer (`bun apps/chaconne/serve.mjs`, `env CHACONNE_PORT 4014`, `reuseExistingServer: !process.env.CI`, `timeout 60_000`). |
| `e2e/chaconne-flow.spec.ts` | The K-1 battery (single test, serial mode): empty boot → compose via palette (Ctrl+K, arrows, Enter, Tab, Esc per the C-3 contract) → seed the localStorage + disk store → launch the runner CLI (`bun apps/chaconne/runner/index.ts run 1 --data-dir <tmp>`) against the local fixtures on 4014 → assert the on-disk run record + artifact files → navigate to the runs route (keyboard `2`) → navigate to the artifact route (palette → "view artifact" → Enter) → assert the screenshot panel (content-addressed name + sha256 + honest copy) and the extracted-values table. |
| `e2e/chaconne-seed.js` | Helper seeder for the runner's disk store (the e2e-lane's own write surface; plain JS, no TS syntax, no app-code import). Seeds `recipes/1.json` + `runs/1.json` into the caller's temp dir. |

## x3-consecutive battery tallies

```
RUN 1: exit=0 wall=3s
  test: ✓  1 [chromium] › e2e/chaconne-flow.spec.ts:136:1 › compose → run (local fixture) → history → artifact viewer, keyboard events only, zero pointer events (1.6s)
  tally:   1 passed (2.3s)
RUN 2: exit=0 wall=3s
  test: ✓  1 [chromium] › e2e/chaconne-flow.spec.ts:136:1 › compose → run (local fixture) → history → artifact viewer, keyboard events only, zero pointer events (1.6s)
  tally:   1 passed (2.3s)
RUN 3: exit=0 wall=2s
  test: ✓  1 [chromium] › e2e/chaconne-flow.spec.ts:136:1 › compose → run (local fixture) → history → artifact viewer, keyboard events only, zero pointer events (1.6s)
  tally:   1 passed (2.3s)
```

## Keyboard-only self-check

```
grep -vE '^\s*\*|^\s*/' e2e/chaconne-flow.spec.ts | grep -nE "\.click\(|page\.mouse|\.tap\("
→ ZERO executable pointer-event matches — K-1 holds
```

## Self-skip guard check

The root `playwright.config.ts` never sets `CHACONNE_E2E` (verified: `grep CHACONNE_E2E playwright.config.ts` → no match). The spec's `test.skip(!process.env.CHACONNE_E2E, ...)` is at the spec level, so under the root lane the chaconne spec self-skips and the landing lane stays green and untouched (the Coda CODA_E2E / Ostinato OSTINATO_E2E precedent).

## Gate ladder

| Gate | Result |
|------|--------|
| `bunx playwright test -c playwright.chaconne.config.ts` (x3 consecutive) | GREEN — 3/3 pass, 1 test each |
| Keyboard-only grep self-check (no `.click(`, no `page.mouse`, no `.tap(` in executable code) | ZERO matches |
| Self-skip guard (`CHACONNE_E2E` NOT in root config) | VERIFIED |
| Root `bun run typecheck` (`tsc --noEmit`) | 0 errors |
| Root `bun run lint` | 0 errors, 143 warnings (pre-existing, 0 new) |
| `bun run test:unit` | 2353 pass / 0 fail (the e2e specs are NOT unit tests — no battery growth) |

## Fixture locality

All fixture URLs in the spec are `http://127.0.0.1:4014/test/fixtures/…` only — no live-network fixture ever runs in this lane (PLAN §3 law).

## Open questions for C-7

- The runner's `saveArtifact(0, runId, "extract-report.json", …)` produces a name like `0_r2_sha256:…extract-report.json`, which does NOT match the PWA's `ARTIFACT_NAME_RE` grammar (`\.[A-Za-z0-9]+$` — a single-dot extension). The disk store and the localStorage store are two hosts of one schema (PLAN §2); the PWA's `assertData` correctly rejects the runner's artifact names when they cross over. C-7 (the offline/resilience lane) should reconcile the two name grammars — either widen the PWA regex to allow dotted/hyphenated exts, or the runner's `saveArtifact` should strip the inner ext from the name (keeping only the outer `.json`). The spec's current approach is to assert the runner's on-disk record directly and seed only the PWA-grammatical `RUN_DOC` into localStorage (the two hosts stay separate in this lane).
- The C-5 `extract-report.json` artifact is written ONLY when extract steps ran (the store dedup + byte law); a recipe with no extract steps produces a byte-identical artifact list to the pre-C-5 state. C-7's resilience lane should pin this invariant end-to-end.
- The `sw.js` precache list + `scripts/verify-precache.ts` + `scripts/capture-usage.mjs` are C-7's per the PLAN §5 mapping ("the PWA completion lane lands in C-7").

## App defects noted (not patched in this ticket)

- **Runner artifact-name grammar mismatch (P1):** `runner/store.ts`'s `saveArtifact` with `ext = "extract-report.json"` produces a name that violates the domain's `ARTIFACT_NAME_RE`. This is a cross-host schema boundary issue between the C-2/C-5 runner and the C-1 PWA domain. The spec's workaround (seed only valid names into localStorage; read the runner's record from disk directly) is correct for this lane. A future ticket should either (a) widen the PWA's regex to `^[\d+_r\d+_sha256:[0-9a-f]{64}\.[A-Za-z0-9.]+$` or (b) have the runner use a simpler ext like `json` for the extract-report artifact. This is BLOCKED for in-ticket patching — the fix is a new ticket.

---

## OPERATOR ADDENDUM (the twenty-first lineage's closeout gate, 2026-11-06)

Every gate independently re-run post-envelope (the V-16 law):

| # | Gate | A2's tally | Operator's tally |
|---|---|---|---|
| 1 | Battery ×3 | 3/3 green (1 passed, ~2.4 s each) | **3/3 green (2.4 s / 2.5 s / 2.4 s)** ✓ |
| 2 | Keyboard-only grep | 0 matches | **0 matches** ✓ |
| 3 | typecheck | 0 | **0** ✓ |
| 4 | lint | 0 err / 143 warn | **0 errors / 143 warnings** ✓ |
| 5 | test:unit | 2353/0 | **2353/0/172 (159.6 s)** ✓ exact |
| 6 | Scope | e2e/ + config + receipt | tree-verified: e2e/chaconne-flow.spec.ts, e2e/chaconne-seed.js, playwright.chaconne.config.ts (runner/index.ts is A2H-12's, landing separately) ✓ |

**The B-20 interlock (the ticket's real catch):** the first battery run
caught a GENUINE product defect — the runner CLI's `isMain` guard
compared a path to a `file://` URL and was always false, so every CLI
invocation was a silent exit-0 no-op (B-20, fixed through A2 as
A2H-12: `import.meta.main`; the CLI's first-ever real invocation is
this battery's `execFileSync` — the unit lanes import `cmdRun`
directly and never covered the entry). The C-6 brief's BLOCKED clause
fired as designed: the app defect went to its own ticket, the spec
fixed its own seed data (the empty-selector step 15), the artifact
locator off-by-one, and the `dd` nth indices.

**Dispatch economics:** 5 dispatch rounds (8/16/24/32/48 caps; turns
8/16/24/32/24 — the last uncapped), ~25 min wall, one session
(`01a1b01a…`) + the A2H-12 interlock session (`01a1b031…`, 3 chunks).
The P1 open question (the artifact-name grammar mismatch across the
two hosts) is BLOCKED-noted for a future ticket per the brief's law.
