# Unown v1 blueprint (blueprint/)

## Purpose

Frozen reference: Unown v1, the Claude Code harness blueprint this project grew out of ("using AI to improve AI" on Anthropic's own practice). Documents the five mechanisms in their original Claude-Code-era form so design intent stays recoverable. Not runtime code for v2.

## Ownership

- Owns: everything under `blueprint/` — `README.md` (entry point + mechanism table), `CLAUDE.md` (v1's agent doc, historical), `docs/` (ARCHITECTURE, COST, RESEARCH, RUNBOOK, SANDBOXING, SECURITY), the five pattern dirs (`memory/`, `harness/`, `dreams/`, `router/`, `sandbox/`), and v1 operational artifacts (`.claude/`, `.github/workflows/`).

## Local Contracts

- Read-only reference material: v1 scripts (`dream.py`, `run_evals.py`, `run_sandbox.py`, `dispatch.py`, …) are NOT part of the v2 runtime; never wire them into the live stack.
- The v2 implementations of the five patterns live in `pi-repo/packages/self-learning/` — when porting or comparing, map: v1 `CLAUDE.md` tiers → v2 tiered memory; v1 `harness/` → v2 harness loop; v1 `.github/workflows` routing → v2 router jobs; v1 `dreams/` → v2 AutoDream; v1 `.claude/hooks/` → v2 `hooks.ts`/`termhooks.ts`.
- `CLAUDE.md` here is v1's historical agent contract — it does not bind v2 work; the repo root AGENTS.md is the binding rail.
- `harness/EDITABLE_SURFACES`, `evals/tasks.jsonl` + sha-pinned fixtures, and `patches/` document v1's bounded-fix experiment — preserve them unchanged.
- `dreams/consolidated/` and `dreams/sessions/` are output dirs kept via `.gitkeep`; v1 runtime wrote there, v2 does not.

## Work Guidance

- Mine this tree for rationale when changing a v2 mechanism (the design discussion lives here, not in v2 code).
- Do not "fix" or modernize v1 scripts — divergence from upstream v1 is the point of the freeze. Add a note in this doc instead if something here misleads.
- New v2 features inspired by v1 patterns should cite the relevant blueprint doc in their commit/PR.

## Verification

(none — reference material; nothing here is executed by the v2 stack or CI)

## Child DOX Index

(none — subdirectories are reference materials documented by their own READMEs; no child is a work boundary)
