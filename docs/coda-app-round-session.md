# The Coda app round — session log

- **Round**: coda-app (the DRIVE track: ship the app THROUGH A2)
- **Started**: 2026-11-02 (round opened; implementation tickets begin in the next operator session)
- **Status**: in flight — design doc receipted, ticket queue defined, no app code yet
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

1. **C1 — scaffold + domain core**: `apps/coda/` structure per the plan
   (package.json, tsconfig, the pure TypeScript domain layer: notes, tasks,
   boards, search — pure functions, no I/O), unit tests with `bun test`,
   domain README. Verification: tests green, typecheck green, zero imports
   of DOM/node APIs in the domain layer.
2. **C2 — UI**: the plan's UI structure over the domain layer, the repo's
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

- **2026-11-02 (round opened)**: PT-5 receipted (the design doc), the round
  log + SESSION.md opened, the protocol inherited from the fresh-clone
  round. No app code yet — C1 dispatches in the next operator session.
