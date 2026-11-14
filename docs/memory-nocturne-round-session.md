# Memory Nocturne round — session log (2026-11-15)

> The evidence-chain round: eight systems torn down
> ([TEARDOWN_2026-11-15_eight-memory-systems.md](TEARDOWN_2026-11-15_eight-memory-systems.md)),
> the one pattern every one of them validates that Unown lacked — the
> provenance chain from a distilled rule back to the note that produced it —
> shipped as the evidence lane, plus the #48 cure and the issue inventory's
> verification.

## The round's path

1. **Bring-up + the issue inventory.** Fresh clone at `eb09a0ac` (v0.0.66),
   full stack up (engine :3030, bridge :3031, Agnes upstream verified), the
   local-ml ONNX lane installed and probed (bge-small q8, semantic recall
   operational — it had been running lexical-fallback). All suites green on
   the fresh tree (self-learning 5,567 / root 2,094). The seven open issues
   re-verified against HEAD: #29 (yield window: armed on ARRIVAL, resume
   timer — fixed by M5), #30 (`print-exit-trace.ts` — fixed), #43
   (frame-inclusive ready probe, F3 — fixed), #44 (`extensionFormat` —
   fixed), #45 (`browser/hints.ts`, the proactive hint lane — fixed), #46
   (the claims gate now covers loop.tsx's dream-beat literals against
   `.unown/memory/project.md` — fixed), **#48 still broken**: a foreign
   `source` value in `model-specs.json` crashed `unown doctor` through
   `specSourceLabel` → `undefined.split`.
2. **The research (five lanes, all primary-source).** Mastra (sparse clone
   @ `ca59cc1`, 1.65M weekly downloads — OM's stranded-chunks audit and the
   recall-tool pointers), Letta 2026 (the MemFS pivot, provenance-in-commit,
   compaction-event trigger), the MCP memory-server lane (MemoryMesh's
   all-or-nothing validation; mcp-memory-service's #1460 needs-review
   lesson; Basic Memory's markdown-at-scale + authored valid-time), the
   repo-intelligence lane (issues/PRs/alerts/CI/releases via the GitHub
   API), and the fresh-papers + memory-UX sweep (WikiTrace, MAPE, Mnemos's
   ablation, the indicator catalog). The convergence finding: **every
   validated-strong system links distilled knowledge back to raw evidence**
   — and Unown, which archives the raw material, exposed no chain.
3. **The evidence lane (the round's CP1).** `memory-evidence.ts` — the
   per-scope side record (`evidence-<scope>.json`, the dormancy record's
   exact shape: atomic write, corrupt = empty, bounded — 1000 entries/scope
   oldest-dream eviction, 12 notes/entry, 96-char excerpts). The dream path
   (`consolidate()`) links every surviving ADD to the batch (the honest
   attribution unit — extraction is ONE call), prunes to the live set, and
   the dream identity is now ONE per group iteration (`project-<uuid>`,
   shared by the dreams row and the evidence entry). The placement law
   (Letta): pointers never enter the rendered tier — render budgets stay
   untaxed, `renderFooterMatches` idempotence holds, and the side record
   never touches platform rows (a bookkeeping write must not refresh
   `updatedAt` — the freshness stamp and the SRO winner order depend on it).
4. **The surfaces (CP2).** The health card's `evidenceLinkedCount` (the
   dashboard memory screen's quiet-when-zero fragment, `unown doctor`'s
   store line, `/api/memory/health`); the doctor's evidence-coverage finding
   (info severity — coverage is a counter, not a ratio to alarm on: pre-lane
   memories and seeds legitimately carry none); the dream note's
   ", N evidence-linked" fragment; per-record evidence in the interchange
   export (sanitized on import — provenance-only, the park line names the
   dream and first excerpt, `--apply` writes it into
   `metadata.provenance.importedEvidence`).
5. **The #48 cure (CP3).** `SpecSource` gains `"unknown"`;
   `specSourceLabel` is total by construction; `readSpecSidecar` sanitizes
   every record at load (the record is never dropped — the raw value
   survives in `unknownSource` and renders as "(raw: operator)").
   Pinned by the sidecar suite's foreign-source case.
6. **Live verification (as a real user).** Engine restarted on the new
   code; a real terminal note delivered to `/tmp/evidence-live-check`; the
   project dream ran (`project-950007de…`); the evidence record landed
   (memory `55b75e02…` → dream → note `ef36ab4a…` with its excerpt); the
   health card answered "7 memories, 2 evidence-linked"; the export carried
   3 evidence records; `unown memory doctor` (run from /tmp) rendered
   "evidence coverage: 2 of 7 live memories link back to the note batch
   that produced them".

## Verification receipts

- Self-learning suite: **5,592 pass / 0 fail** (248 files — the new
  `test/memory-evidence.test.ts` adds 19: the pure builders, the record's
  bounds/eviction/atomicity, hygiene, the sanitizer, and the end-to-end
  project-dream integration against the fake platform + bridge stub).
- Root suite: **2,094 pass / 0 fail**; claims gate green (62 literals);
  changelog rail green.
- The interchange suite extended with 5 evidence cases (round-trip, hostile
  entry sanitization, the park line).
- Live engine receipts: the dream row, the evidence record file, the health
  endpoint, the export payload, and the doctor render (quoted above).

## Issue inventory (the repo-intelligence lane)

- **Closed as fixed at HEAD** (verification comments posted): #29, #30,
  #43, #44, #45, #46, #48.
- **CI posture**: the latest commit is green; the historical red streaks
  (the engine-test flake class on Windows, the v0.0.65 release retry) are
  already superseded by later rounds' fixes — the release lane for v0.0.67
  is the fresh verdict.
- **Housekeeping noted, not actionable this round**: the v0.0.65 orphan tag
  (tag exists, no published release — v0.0.66 superseded it 90 minutes
  later); Dependabot's 46 closed-unmerged PRs (updates land by direct push;
  zero open alerts); the two dismissed CodeQL env-injection alerts carry
  documented defenses.

## What this round did NOT ship (recorded for the next round)

- The needs-review band for the deterministic SRO pass (the mcp-memory-service
  #1460 lesson: protected/hard-won losers route to a review state instead of
  silent supersession) — designed, deferred: the deterministic pass is
  exact-match on subject|relation, so the false-positive class is narrower
  than theirs was; the band earns its complexity only with a live misfire.
- Gist-distillation-before-archive (Mnemos: a fading memory's lesson
  outlives its details) — an AutoDream extension worth its own cost budget.
- The compaction-event dream trigger (Letta) — pi's auto-compact is the
  seam; needs its own round to wire honestly.
