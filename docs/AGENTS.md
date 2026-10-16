# Docs (docs/)

## Purpose

User-facing usage documentation for the `unown` terminal agent and the self-learning stack — the pages the README links into and the CLI error messages point at. Internal work contracts live in AGENTS.md files; these pages are the public manual.

## Ownership

- Owns: `quickstart.md`, `providers.md`, `usage.md`, `subagents.md`, `skills.md`, `memory.md`, `configuration.md`, `troubleshooting.md`, `benchmark-research.md`, `testing-strategy.md`.

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
- `grep -P '(?<!\[m)emory\]\(' docs/*.md` returns nothing (no real link corruption).
- Commands referenced: `bun bin/unown --help` covers every command the docs claim.

## Child DOX Index

(none — flat directory)
