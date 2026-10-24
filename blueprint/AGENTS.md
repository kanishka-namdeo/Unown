# Blueprint (blueprint/) — Unown v1 frozen reference

## Purpose

Unown v1 — the Claude Code harness this project grew out of ("using AI to improve AI" on Anthropic's own practice). Frozen reference material: the v1 scripts are NOT part of the v2 runtime, are never wired into the live stack, and are never "fixed" or modernized — divergence from v2 is the point of the freeze. New v2 features inspired by v1 patterns cite the blueprint doc.

## Ownership

- Owns: everything under `blueprint/` and this doc — `README.md` (the five-mechanism table + v1 quickstart), `CLAUDE.md` (v1's historical agent doc — does NOT bind v2 work; the repo root AGENTS.md is the binding rail), `docs/` (ARCHITECTURE, RESEARCH, SANDBOXING, SECURITY, RUNBOOK, COST), `memory/` (the four-tier CLAUDE.md hierarchy + `digest.py`), `harness/` (the v1 self-improving loop with `EDITABLE_SURFACES` and sha-pinned evals — preserve unchanged), `dreams/` (the consolidation pipeline), `router/` (GitHub event dispatch), `sandbox/` (the disposable keyless test rig + 6 scenarios).

## Local Contracts

- The v1 → v2 mapping (where v2 implementations live): v1 `CLAUDE.md` tiers → v2 tiered memory (`pi-repo/packages/self-learning/src/memory.ts`); v1 `harness/` → `harness.ts`; v1 `.github/workflows` routing → `router.ts` jobs; v1 `dreams/` → `dream.ts`; v1 `.claude/hooks/` → `hooks.ts`/`termhooks.ts`.
- Nothing here is executed by v2 or CI. Do not run, import or extend these scripts.
- `docs/SANDBOXING.md` records that the shipped `sandbox/` is a logical test rig, not a security boundary — the v2 OS-level sandbox (bubblewrap/seatbelt/jail) is the security boundary.

## Work Guidance

- Read for design intent and historical rationale; the research deep-dive is `docs/RESEARCH.md`.
- Changes here are limited to documentation of the freeze itself — never behavioral edits.

## Verification

- None runs from this tree (frozen). The freeze is verified by absence: no v2 code path imports `blueprint/`.

## Child DOX Index

(none — flat reference tree)
