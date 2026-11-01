# Plan: Add `apps/coda/` — local-first markdown notes + task-board PWA (offline-first, installable; Chromium-desktop verified)

## Context
The repo has no self-contained, installable, offline-first user product (everything else is the marketing landing page or the TUI dashboard). Coda adds one: local-first markdown notes + task boards, installable as a PWA, offline-first, with a framework-agnostic pure-TS domain layer that unit-tests headlessly. It lands as a new top-level boundary (`apps/coda/`) with the DOX, docs, and CI wiring a new app requires. v1 honestly claims **Chromium-desktop-only** verification; Safari/Android/Firefox are recorded as untested/deferred (not "cross-platform").

## Capability audit
- tiered-memory — SKIPPED: project/local memory is empty; no recorded Coda conventions.
- existing-skills — USED: `methodical-debugging` + `verification-first` guide the offline/SW + axe determinism work; `repo-exploration` oriented the monorepo facts.
- workflows — SKIPPED: no existing PWA workflow to reuse; Playwright + axe patterns in `e2e/` are reused directly.
- standing-orders — SKIPPED: none recorded.
- routines — SKIPPED: not relevant to a one-shot build.
- repo-map — USED: root `package.json`/`tsconfig.json`/`playwright.config.ts`/`bunfig.toml`/`ci.yml` map the exact root-config seams to touch once.
- project-context — USED: root + `docs/AGENTS.md` DOX chain fixes the required doc updates; `docs/testing-strategy.md` defines the CI gate ledger to extend.
- prior-learnings — USED: specialist findings (root-churn cost, frozen-lockfile red, bunfig preload scope, flaky headless `beforeinstallprompt`, SW scope mismatch) shape the design.
- benchmarks — USED: `benchmarks/` receipt convention + `check:benchmarks` gate for any published figure.
- agent-patterns — USED: builder + reviewer dual review on the domain state-machine step; `documenter` for the DOX step.
- subagent-delegation — USED: `product-strategist`, `solution-architect`, `qa-architect`, `delivery-manager`, `devils-advocate` all consulted.

## Approach
Self-contained static app at `apps/coda/` — **vanilla TS + hand-rolled service worker, zero new root deps** — reusing root `marked`/`fuse.js` via upward Node resolution. Keeps the domain layer genuinely pure and root churn minimal.
- **Domain** (`apps/coda/src/domain/`, pure TS, no DOM): `types.ts` (Note {id,title,body,createdAt,updatedAt,tags[]}, Task {id,boardId,title,status:todo|doing|done,dueAt?,noteIds[],timestamps}, Board {id,name,taskOrder[]}), `repository.ts`, `store.ts` (in-memory + JSON serialize/deserialize — one serializable store so export/sync is a non-rewrite), `search.ts` (Fuse, substring fallback), `markdown.ts` (`.md` round-trip). Purity enforced by an **import-boundary check** (domain/** imports nothing outside domain/** + pure modules) + `no-restricted-globals` ESLint rule scoped to `domain/` + a grep for DOM globals — not grep alone.
- **UI** (`apps/coda/src/ui/`): single-board notes list + markdown editor, task list (status toggle + due date), global search, install affordance. No multi-board/drag/live-preview in v1.
- **PWA**: `public/manifest.webmanifest` (display:standalone, start_url `/`, icons ≥192px), hand-rolled `public/sw.js` that **precaches every emitted asset + stale-while-revalidate runtime handler** (not shell-only), scope pinned to the app base; registration in `main.ts`. Deferred: sync, native, mobile.
- **Persistence**: IndexedDB adapter in separate `src/db/` module (domain stays DOM-free); JSON export/import via `store.ts`.
- **Root seams (touch once, separate commit)**: `apps/coda/tsconfig.json`, `playwright.coda.config.ts` (own webServer `apps/coda/scripts/serve.mjs` + project so the landing lane is untouched), root `package.json` scripts, tsconfig include, eslint scope, `bunfig.toml` preload-scope check, one CI job, DOX/docs.

## Specialist review
### product-strategist — DRIFT (cuts applied)
- v1 = Chromium-desktop-only installable PWA; one board, fixed 3 statuses; **markdown export/import is the "local-first" proof**; first-verified target = one green offline-persistence spec.
### solution-architect — ALIGNED
- Static app over nested Next; hand-rolled SW over workbox; IndexedDB in a separate adapter; reuse `fuse.js`.
### qa-architect — GAPS (mitigated)
- Keep Coda dep-free at root (frozen-lockfile stays green); verify `bunfig.toml` `[test].preload` scope before first `bun test apps/coda`; `waitForFunction` on SW controller (no sleeps); assert IDB survival via DOM; installability via manifest fetch, real prompt behind a headed-only env.
### delivery-manager — DELIVERABLE (re-sequenced)
- Scaffold-first is correct; the real gate is root-wiring (step 7) — split it: (a) tsconfig/eslint/bunfig + frozen-lockfile proof, (b) package.json scripts, (c) CI job last after e2e passes locally. Run the bunfig preload probe + dry `bun test apps/coda` on an empty dir **before step 1**. Floor = domain + tests + UI/IDB + offline e2e + one CI job; cuttable = axe spec, markdown export/import, installability fetch-assert. Human review before step 5 (SW) and before step 7 (root churn). Commit boundary: app commit (steps 1–6) + wiring commit (steps 7–8) so `git revert` is clean.
### devils-advocate — P0s found (fixed in Approach/Steps)
- **P0 SW scope mismatch**: pin the app base; e2e asserts `navigator.serviceWorker.controller` + manifest reachability, else install fails silently.
- **P0 dep resolution**: `apps/coda/package.json` must have **zero `dependencies`**; add a CI step that asserts the root lockfile is unchanged after `bun install`.
- **P1 offline coverage**: SW must precache every emitted asset + network-fall-through + cache-write; assert offline reload of each route, not just `/`.
- **P1 purity grep is bypassable**: use an import-graph boundary check + scoped `no-restricted-globals`, not grep alone.
- **P1 "cross-platform" overpromise**: scrub from the objective; state Chromium-desktop-only explicitly.
- **P1 root-churn is ≥8 files**: any single miss turns a gate red (tsconfig→typecheck blind; CI→no protection; bunfig→wrong preload; root AGENTS→DOX closeout fails).

## Synthesis
- consensus: pure-TS domain with a serializable store; Chromium-desktop-only installable PWA; hand-rolled SW; isolated Coda Playwright lane; markdown export/import as the local-first proof.
- conflicts: nested-Next vs static → **static vanilla-TS**; grep-purity vs import-boundary check → **import-boundary + scoped ESLint** (grep kept as a secondary proof only).
- missing now resolved: SW base/scope pinning, zero-dep package.json + lockfile-unchanged CI proof, full-asset precache, bunfig preload probe before tests, split root-wiring commit.
- confidence: 84

## Steps
0. Harness probe (files: bunfig.toml read-only check, dry `bun test apps/coda` on empty dir) — de-risk the preload scope before any domain test; verify root lockfile baseline hash.
1. Scaffold boundary (files: apps/coda/package.json [ZERO `dependencies`/`devDependencies` fields], apps/coda/tsconfig.json, apps/coda/index.html, apps/coda/src/main.ts) — self-contained; reuse root `marked`/`fuse.js` via upward resolution; keep root lockfile untouched.
2. Pure-TS domain layer + in-memory store (files: apps/coda/src/domain/{types,repository,store,search,markdown}.ts) — DOM-free; JSON serialize/deserialize; markdown round-trip. **Dual review: worker + reviewer subagent on the state-machine invariants.**
3. Domain unit tests, test-first (files: apps/coda/src/domain/*.test.ts) — tasks.test.ts first (todo→doing→done; done→doing reopen legal; illegal transition throws), notes CRUD, boards taskOrder, search (case-insensitive, special chars, empty, ranking).
4. UI + IndexedDB adapter (files: apps/coda/src/ui/*, apps/coda/src/db/idb.ts, apps/coda/src/app.ts) — single-board notes/editor/tasks/search; IDB isolated from domain; `marked` render behind a preview toggle.
5. PWA (files: apps/coda/public/{manifest.webmanifest, sw.js, offline.html}, icons, registration in apps/coda/src/main.ts) — pin base/scope; SW precaches every emitted asset + stale-while-revalidate + offline fallback; ≥192px icons. **Human review before this step.**
6. Isolated Playwright e2e + a11y (files: playwright.coda.config.ts [webServer = apps/coda/scripts/serve.mjs], e2e/coda-offline.spec.ts, e2e/coda-a11y.spec.ts, apps/coda/scripts/serve.mjs) — offline spec = fresh context → `waitForFunction` on SW controller → create note+task → `context.setOffline(true)` → reload each route → DOM shows data; a11y = axe `wcag2a/2aa/21a/21aa` both screens; installability via manifest fetch + SW-controller assert, real prompt behind headed-only env.
7. Root wiring, split + separate commit (files: tsconfig.json [include apps/coda/**], eslint scope [no-restricted-globals on apps/coda/src/domain/**], package.json [coda:dev/test/e2e], bunfig.toml [preload scope], .github/workflows/ci.yml [new `coda` job: `bun install` lockfile-unchanged assert + `bun test apps/coda` + `bunx playwright test -c playwright.coda.config.ts`]) — CI job lands LAST, after step 6 passes locally. **Human review before this step.**
8. DOX + docs, same wiring commit (files: apps/coda/AGENTS.md, root AGENTS.md [Child DOX Index + repo layout], docs/coda.md, docs/AGENTS.md, docs/testing-strategy.md [gate entry], README.md, CHANGELOG.md) — **via documenter subagent with verified file:line refs.**

## Risks
- **SW scope/base mismatch silently breaks installability** → pin base in config; e2e asserts `navigator.serviceWorker.controller` + manifest reachability.
- **New app deps trip frozen-lockfile CI** → `apps/coda/package.json` declares zero deps; CI step asserts the root lockfile hash is unchanged after install.
- **Root-config churn turns a gate red** (tsconfig/eslint/CI/bunfig/DOX, ≥8 files) → step 7 is one atomic, separately-committed wiring change; any single miss is caught by the step-0 harness probe and the CI `coda` job.
- **"Pure domain" silently becomes DOM-dependent** → import-graph boundary check + scoped `no-restricted-globals` + node-env import test; reviewer subagent checks at step 2.
- **Offline claim overstates coverage** → SW precaches all emitted assets + runtime cache-write; e2e asserts offline reload of every route.

## Learning plan
- memory: record the root-config seam list (tsconfig include, isolated playwright webServer, one CI job, frozen-lockfile dep visibility, bunfig preload scope, zero-dep app package.json) so the next top-level app wires up fast.
- benchmark: when real, receipt a PWA installable/offline-load measurement under `benchmarks/` wired to `check:benchmarks`; otherwise the figure stays "not measured".
- Pitfall: `beforeinstallprompt` is unreliable in headless Chromium — soft-gate, never hard-fail PWA install e2e on it.
- Pitfall: a grep-only DOM check is bypassable; enforce domain purity via an import-boundary test + scoped ESLint `no-restricted-globals`.

## Verification
- Harness: `bun test apps/coda` (empty-dir probe at step 0, then real at step 3).
- Purity: import-boundary check + `grep -rE 'document\.|window\.|indexedDB|localStorage' apps/coda/src/domain/` returns nothing.
- Type/lint: `bun run typecheck` + `bun run lint` cover `apps/coda/` after step 7.
- PWA e2e + a11y: `bunx playwright test -c playwright.coda.config.ts` (offline persistence across every route + axe zero-violation + manifest/SW installability all green).
- Landing lane untouched: `bunx playwright test` (root config) still green.
- Frozen lockfile: CI `coda` job's `bun install` assert shows the root lockfile hash unchanged.
- Docs gate: `bun run check:docs`.
- Closeout: two commits (app = steps 1–6, wiring+docs = steps 7–8) so `git revert` is clean; CHANGELOG entry; execution ends with `plan_retrospective`.
