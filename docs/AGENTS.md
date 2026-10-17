# Docs (docs/)

## Purpose

User-facing usage documentation for the `unown` terminal agent and the self-learning stack — the pages the README links into and the CLI error messages point at. Internal work contracts live in AGENTS.md files; these pages are the public manual.

## Ownership

- Owns: `quickstart.md`, `providers.md`, `usage.md`, `subagents.md`, `skills.md`, `memory.md`, `memory-classifier-evaluation.md`, `configuration.md`, `troubleshooting.md`, `benchmark-research.md`, `landing-research.md`, `testing-strategy.md`, `oh-my-pi-swap-assessment.md`.
- `landing-research.md` is a design-rationale doc, not a usage page: it records the research behind the marketing page and the sourcing rules for anything quoted on it. When the page changes materially, update it in the same change — that file is why the page's claims stay defensible.
- Four pages are decision records, not usage pages: `memory-classifier-evaluation.md`, `benchmark-research.md`, `testing-strategy.md`, `oh-my-pi-swap-assessment.md`. They share a shape — purpose blockquote with the verdict up front, mini-TOC, a stated method section, evidence, related pages.
- Decision records tier every load-bearing claim: `[V]` (verified at a cited `file:line`, npm/GitHub API field, or reproduced command), `[C]` (upstream-claimed, not re-derived), `[U]` (unknown — what a spike must settle). Counts must state their scope. A negative claim ("symbol X is absent") requires the code-search that would have found it — a grep of a barrel file is not proof, because star exports hide the symbol in a sibling module.
- `oh-my-pi-swap-assessment.md` is the standing answer to "should we replace the vendored pi harness". Reopen it, in the same change, only when one of its §9 revisit triggers becomes true; its §11 corrections register and Appendix F reproduce the checks that flipped its own earlier claims and must not be quietly re-litigated.

## Local Contracts

- Every page: one-line purpose statement at top, bullet mini-TOC of its own sections, "Related pages" cross-links (relative `.md` links).
- Claims must be verified against source before writing — commands against `pi-repo/packages/self-learning/src/cli.ts` (HELP), tools/hooks against `tools.ts`/`termhooks.ts`, formats against `tools.ts` (`.unown/agents/*.md` frontmatter) and `skill-seeds.ts` (SKILL.md contract), env vars against `.env.example` (keep both in sync), troubleshooting symptoms against real error strings in `cli.ts`/`mini-services/llm-bridge/index.ts`.
- Voice: match the README — concrete, confident, honest about limitations; tables for references; no emojis; no secrets (placeholder keys only).
- Cross-link instead of duplicating: provider wiring → `providers.md`, deep usage → `usage.md`, env reference → `configuration.md`. The README keeps only condensed versions plus the docs index table.
- `unown doctor`'s hard-fail output references `docs/troubleshooting.md` by path — that page must keep existing.
- When the CLI surface changes (new command/flag/env var), update `usage.md` + `configuration.md` + `cli.ts` HELP in the same change.

## Work Guidance

- New pages get added to the README's Documentation table and to sibling pages' "Related pages" lines.
- Display artifact warning (this workspace): tool output can render `[memory](memory.md)` as `emory](memory.md)` — the FILES are intact; verify with byte-level tools (od/grep -P) before "fixing" links.

## Verification

- Links resolve: every relative link targets an existing file in `docs/` or an anchor in the same page.
- Real link corruption looks like a bare `emory](` (the `[memory]` label losing its `[mem`). Gate: `grep -rnP --exclude=AGENTS.md '(^|[^A-Za-z])emory\]\(' docs/*.md` returns nothing. The contract file is excluded because it quotes the artifact; requiring a non-letter before it is what keeps legitimate labels that merely end in "memory" (`[Inspecting memory](#inspecting-memory)`, `[Memory](memory.md)`) from matching. The looser `(?<!\[m)emory\]\(` form is **wrong** on exactly that count and returns seven false positives.
- Anchor slugs follow GitHub's rule: lowercase, punctuation dropped, **each** space replaced by one hyphen — so a heading containing ` — ` hashes to a **double** hyphen (`## Part 1 — Products studied` → `#part-1--products-studied`). Collapsing runs of spaces is the classic false-negative when checking your own TOC links.
- Most of this corpus is CRLF. In JavaScript `.` does not match `\r`, so a heading scan that splits on `\n` and anchors with `(.*)$` silently matches **nothing** — always split on `/\r?\n/` before concluding a link is broken.
- Commands referenced: `bun bin/unown --help` covers every command the docs claim.

## Child DOX Index

(none — flat directory)
