# Docs (docs/)

## Purpose

User-facing usage documentation for the `unown` terminal agent and the self-learning stack — the pages the README links into and the CLI error messages point at. Internal work contracts live in AGENTS.md files; these pages are the public manual.

## Ownership

- Owns: every page in `docs/` and this doc — the usage manuals (`quickstart.md`, `install.md`, `updating.md`, `update-research.md`, `providers.md`, `usage.md`, `addons.md`, `subagents.md`, `skills.md`, `memory.md`, `memory-classifier-evaluation.md`, `memory-system-review.md`, `memory-platform-swap-assessment.md`, `configuration.md`, `troubleshooting.md`, `resilience.md`, `benchmark-research.md`, `landing-research.md`, `testing-strategy.md`, `BEHAVIOR.md`, `browser.md`, `browser-research.md`, `browser-subagent-tui-research.md`, `blog.md`, `xplat-testing.md`); the command pages (`acp.md`, `custom-commands.md`, `ralph.md`, `recipes.md`, `repomap.md`, `repo-wiki.md`, `routines.md`, `standing-orders.md`, `usage-tracking.md`, `watch.md`, `web-results-store.md`) — each the user manual for its `unown <command>` surface, kept in sync with `cli.ts` HELP in the same change; the platform guides (`windows.md`, `macos.md`); the UX records (`permissions.md`, `split-view.md`, `tui-beautification-plan.md`, `tui-capture-workflow.md`, `tui-dashboard-plan.md`, `tui-responsive-plan.md`); the engine records (`detached-engine-architecture.md` — the engine API contract other docs cite — and `detached-engine-research.md`); and the roadmaps (`sdlc-feature-parity.md`, `sdlc-feature-roadmap.md`, `agentic-asset-workflow.md`).
- `BEHAVIOR.md` is the agent behavior card (default models, memory tier stack, session tools, sandbox model, hooks policy) — a contract page: every change to prompts, models, routing, guard rules, hooks or memory injection updates it in the same change, with the required CHANGELOG Agent Behavior entry.
- `landing-research.md` is a design-rationale doc, not a usage page: it records the research behind the marketing page and the sourcing rules for anything quoted on it. When the page changes materially, update it in the same change.
- Decision records (`memory-classifier-evaluation.md`, `benchmark-research.md`, `testing-strategy.md`, `oh-my-pi-swap-assessment.md`, `opencode-swap-assessment.md`, `memory-platform-swap-assessment.md`, `sdlc-feature-parity.md`, `update-research.md`) share a shape — purpose blockquote with the verdict up front, mini-TOC, stated method, evidence, related pages — and tier every load-bearing claim: `[V]` (verified at a cited `file:line`, API field, or reproduced command), `[C]` (upstream-claimed, not re-derived), `[U]` (unknown — what a spike must settle). A negative claim requires the code-search that would have found it. Each record's corrections register must not be quietly re-litigated.
- The two harness-swap records are candidate-specific, not a general ruling; both conclude the vendored pi base stays. `sdlc-feature-parity.md` is the umbrella record for feature adoption — new adoption decisions extend its tables instead of opening a new record.
- `resilience.md` is the engine failure-mode catalog: every string and limit it quotes is pinned to the code that prints it (`engine-status.ts`, `engine-supervisor.ts`, `engine-cli.ts`, `term.ts`, `cli.ts`, `termhooks.ts`, `tools.ts`).
- `addons.md` mirrors `pi-repo/packages/self-learning/src/addons/config.ts` key for key; `browser.md` mirrors `pi-repo/packages/self-learning/src/browser/` reality — every surface change updates its page in the same change.

## Local Contracts

- Every page: one-line purpose statement at top, bullet mini-TOC of its own sections, "Related pages" cross-links (relative `.md` links).
- Claims must be verified against source before writing — commands against `cli.ts` HELP, tools/hooks against `tools.ts`/`termhooks.ts`, env vars against `.env.example` (keep both in sync), troubleshooting symptoms against real error strings in `cli.ts`/`mini-services/llm-bridge/index.ts`.
- Voice: match the README — concrete, confident, honest about limitations; tables for references; no emojis; no secrets (placeholder keys only).
- Cross-link instead of duplicating: provider wiring → `providers.md`, deep usage → `usage.md`, env reference → `configuration.md`. The README keeps only condensed versions plus the docs index table.
- Same-change sync: CLI surface changes → `usage.md` + `configuration.md` + `cli.ts` HELP; update/rollback/env changes additionally → `updating.md`; install/uninstall changes additionally → `install.md` (the standalone-binary section is where the unsigned/Gatekeeper/SmartScreen truth lives — `install.md` and the `INSTALL.txt` inside each release archive must never disagree on it).
- `xplat-testing.md` is the driving manual for the agent-drivable lane — it must stay in sync with `scripts/xplat.mjs`'s command surface and the scenario table in `scripts/xplat.mjs` (SCENARIOS/OS_CHOICES) in the same change: a scenario renamed or an `--os` choice added here without the driver (or the workflow inputs) moving with it is a docs-drift failure the docs gate cannot catch.
- `unown doctor`'s hard-fail output references `docs/troubleshooting.md` by path — that page must keep existing.

## Work Guidance

- New pages get added to the README's Documentation table and to sibling pages' "Related pages" lines.
- Display artifact warning (this workspace): tool output can render `emory](memory.md)` as `emory](memory.md)` — the FILES are intact; verify with byte-level tools before "fixing" links.

## Verification

- Links resolve: every relative link targets an existing file in `docs/` or an anchor in the same page. Runnable: `bun run check:docs` (`node scripts/check_docs.mjs docs/*.md`), a CI job. AGENTS.md files are exempt from anchor checks (they quote artifacts in prose).
- Real link corruption looks like a bare `emory](`. Gate: `grep -rnP --exclude=AGENTS.md '(^|[^A-Za-z])emory\]\(' docs/*.md` returns nothing.
- Anchor slugs follow GitHub's rule: lowercase, punctuation dropped, each space replaced by one hyphen — a heading containing ` — ` hashes to a double hyphen. Keep paths out of headings (a parenthetical path hashes to a slug nobody would guess).
- Most of this corpus is CRLF. In JavaScript `.` does not match `\r` — always split on `/\r?\n/` before concluding a link is broken. `check_docs.mjs` does.
- Commands referenced: `bun bin/unown --help` covers every command the docs claim.
- Decision records additionally owe a status that moves with the code (`testing-strategy.md` tags every backlog item SHIPPED / PARTIAL / OPEN / DECISION).

## Child DOX Index

(none — flat directory)
