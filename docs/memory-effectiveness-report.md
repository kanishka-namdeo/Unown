# The memory effectiveness report — creation, retrieval, reuse, impact

> The mission's second deliverable: is Unown's memory actually effective —
> created when it should be, retrieved when needed, relevant when
> retrieved, and does it change future outcomes? Measured on the
> cold-start install with the round's probe lane; every figure cites its
> receipt.

- [Memory creation trends](#memory-creation-trends)
- [Retrieval accuracy](#retrieval-accuracy)
- [Reuse effectiveness](#reuse-effectiveness)
- [Impact on future outcomes](#impact-on-future-outcomes)
- [The failure story, measured](#the-failure-story-measured)

Related: [the learning system validation report](learning-system-validation-report.md) ·
[the retrieval probe lane](../benchmarks/validation-round/README.md) ·
[the failure ledger](../benchmarks/validation-round/validation-log.md)

## Memory creation trends

| Source | Created | Receipt |
|---|---|---|
| Carried over (tracked file) | 79 bullets / v12 | the baseline snapshot's `terminalMemory` |
| Legacy import into the platform (first project dream) | 66 platform memories | the v1 project-dream row; the render footer |
| Note extraction (dreams) | 8 new memories across 12 dreams | the `dreams` table (entries_added per row) |
| Corrective note (operator) | 1 repaired fact, extracted + rendered | the v2 project dream; the file's Facts section |
| Manual-notes lane (operator) | 1 pinned fact | the `## Manual notes` section (survives re-renders) |

The creation trend across snapshots: engine project tier v3 → v9 → v10;
platform store 0 → 66 → (purge) → 67; tracked file v12 → v3 → v4. The
tracked file's *version* number restarted because the fresh engine DB
allocates its own version rows — the file's *content* is the continuity
artifact, and its bullet count (79 → 72 → 73) reflects the reconcile
passes plus the restoration.

## Retrieval accuracy

The probe lane's pinned query set (6 queries, each targeting a fact the
tracked memory carries) measured the semantic recall surface at three
points:

| Probe run | Surface state | hit@5 |
|---|---|---|
| `smoke` (pre-dream) | platform empty for the project scope | **0/6** |
| `post-dream` (post first project dream) | engine-scope-only query | **0/6** (query bug — see below) |
| `recovered` (post-recovery, cross-scope) | clean platform + `across=1` | **6/6** |

Two measured findings inside those numbers:

1. **The cold-start recall gap**: the tracked memory injects into sessions
   (the recall probes answer from it) but is invisible to the *search*
   surface until the first project dream runs the swap-boundary import.
   Between clone and first dream, `/api/memories?q=` cannot find facts the
   agent demonstrably knows. The import closes the gap the moment notes
   exist to dream.
2. **The scope default**: `/api/memories` without `across=1` searches the
   engine scope only — the probe's own first version missed project facts
   for that reason (fixed in the lane; the receipt pair
   `post-dream.json` → `recovered.json` is the before/after).

Session-level retrieval (the injected path, not the search path) was
measured by the recall probes: V1 and V2 answered from injected memory
without exploration (1–2 turns, 2–5 s), where a memory-less session would
need file reads first — the V3 cold session's 30 turns on unfamiliar
ground is the control shape.

## Reuse effectiveness

- **V1 (decision reuse):** a memory entry written on a previous install
  ("Failed cycles auto-recover — do NOT restart engine") produced the
  correct operational decision on the fresh install, verbatim-cited, 2
  turns. The reuse crossed a machine boundary — the strongest form of the
  mission's cross-session continuity requirement.
- **V4 (workflow reuse):** the warm repeat session reused the probe-lane
  knowledge V3's notes had taught the memory — 9 turns vs V3's
  turn-capped 30 on the same codebase area. See the
  [UX report](end-user-experience-report.md) for the full deltas.
- **Engine reuse:** every dream's canary re-ran previously-passing tasks
  under the new memory (the memory-as-input regression check) — 27/29
  runs passed; the two failures were the canary's claim-mismatch catch
  (the defense) and a mint self-check crash (the gate), not memory
  regressions.

## Impact on future outcomes

- A memory entry measurably changed a later session's *answer* (V2b's
  verified, cited scrypt fact — the F1 fix validated).
- A memory entry measurably changed a later session's *cost* (V4's −70%
  turns / −66% output tokens vs V3).
- A memory entry measurably changed a later session's *decision* (V1's
  no-restart call).
- The corrective-note lane measurably *repaired* memory in one cycle (the
  scrypt fact restored, three-deep, search hit@5 recovered 0/6 → 6/6).

## The failure story, measured

The round's most important memory finding is a full failure chain with
numbers at every hop (F1+F2 in
[the failure ledger](../benchmarks/validation-round/validation-log.md)):

1. A correct memory fact (scrypt N=16384, tracked, injected) was answered
   **wrong** (bcrypt + an invented env var) — 1 turn, unverified.
2. The wrong answer rode the session note into the platform (1 poisoned
   memory, search score 0.566 — ranked FIRST for the canonical query).
3. The recency-first reconcile **pruned the correct entry** — ground
   truth erased from platform AND rendered file (git diff: 49+/49−).
4. The same erosion had already happened upstream pre-round (the pulled
   commit's 79→66 render) — two independent instances.
5. Post-fix re-measurement: the same question answered correctly with a
   citation (V2b); a live poisoned note produced ZERO extracted poison;
   the search surface recovered 6/6.

The chain is the mission's cautionary exhibit and its validation in one:
memory systems do not merely fail to help — unverified self-generated
content can actively destroy verified knowledge through the learning
loop's own trust mechanics. The round's fixes (recall discipline +
extraction trust) close the two ends of the chain; the reconcile's
recency preference remains a recorded open gap (the research's #3
recommendation: recall-time citations with source verification is the
next hardening target).
