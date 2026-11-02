# The Coda app round — session log

- **Round**: coda-app (the DRIVE track: ship the app THROUGH A2)
- **Started**: 2026-11-02 (round opened; implementation tickets begin in the next operator session)
- **Status**: in flight — C1 (domain core) and C2 (UI + IDB) landed; C3 (PWA layer) is next
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

## Ticket queue (from the PT-5 plan's steps, in delivery-manager sequence)

1. **C1 — scaffold + domain core** ✅ (2026-11-02, see checkpoint log): `apps/coda/` structure per the plan
   (package.json, tsconfig, the pure TypeScript domain layer: notes, tasks,
   boards, search — pure functions, no I/O), unit tests with `bun test`,
   domain README. Verification: tests green, typecheck green, zero imports
   of DOM/node APIs in the domain layer.
2. **C2 — UI + IndexedDB** ✅ (2026-11-02, see checkpoint log): the plan's UI structure over the domain layer, the repo's
   landing conventions consulted (website-excellence skills; design-reviewer
   agent at the checkpoint).
3. **C3 — PWA layer**: offline-first service worker, installable manifest,
   storage persistence; cross-platform verification matrix per the plan.
4. **C4 — e2e + a11y**: Playwright specs + axe-core checks; the repo's e2e
   conventions (e2e/ dir).
5. **C5 — docs/DOX/landing**: `apps/coda/AGENTS.md`, root AGENTS.md child
   index entry, docs page, README section, CHANGELOG entry + rail, landing
   surface if the plan's scope includes it (usage captures via the
   scripts/tui-capture lane or browser tool, never deleting existing media).
6. **C6 — round closeout**: this log's graduation, SESSION.md, retrospective
   per the V3 contract, capability-utilization report.

Each ticket carries the A1 economy header (ALLOWED_INPUTS /
FORBIDDEN_INPUTS / OUTPUT_ARTIFACT / VERIFICATION_EXPECTATION /
EFFORT_BUDGET / chunk protocol notes) — the shape that worked in the
fresh-clone round's M2-A ticket.

## Checkpoint log

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
