# The recycle test — the retained-improvement re-verification on a FRESH lineage (35th lineage, 2026-11-07/08)

> The PROVE-SNAPSHOT's named owed item: *"the retained-improvement
> re-verification on a FRESH lineage (the recycle test: the pins, the
> holdout, the guard all fire without the authoring lineage's
> context)."* The 35th lineage IS that fresh lineage — its sandbox was
> fully recycled (the 34th's tree survived at `1d1d46f6`; the stack
> survived running; nothing else did), the toolchain was rebuilt
> blind, and every verification below ran without any authoring
> lineage's session, notes, or context.

## The environment (the recycle, honestly)

- Fresh session over a recycled container; the 34th's tree + the
  bridge/engine processes (19:34 boot, dream jobs through 20:52)
  survived; pi-repo node_modules/dist/hydrate-data did NOT —
  reinstalled, re-hydrated, `build:offline` re-run, all green.
- Tree fast-forwarded `1d1d46f6` → `a1fe730a` → (the V-5 stand-down)
  → `ea9ee707`, the governing head at this receipt's close.
- Doctor: **ready-to-chat**, v0.0.57 @ `a1fe730a`, model-specs
  verified 524,288/4,096 (the V-38 pin present in BOTH homes,
  re-checked).
- Canaries (the frozen vivace rig, stamp `20261107T205950Z`):
  **C1 PASS · C2 PASS · C3 the known V-3 class** — the frozen triple,
  envelopes committed. The root unit battery on the governing tree:
  **2840 pass / 0 fail / 4 errors** (18382 expects, 226 files,
  178.7 s, `--parallel=1` per the V-1 law) — the 4 errors are the
  framer-motion AbortError teardown-noise class between landing tests
  (happy-dom unmount cancels animations; motion-dom's rejection leaks
  as "unhandled error between tests"; pass/fail counts unaffected,
  exit code 1 is the error line's — a named, benign, PRE-EXISTING
  class, quoted here because a fresh lineage quotes what it sees).

## The retained improvements — each one fired

| Improvement (its ticket) | The fresh-lineage verification | Verdict |
|---|---|---|
| **The boundary pin** (L-1, the import-graph scanner) | Deliberate drift injected (`document.write` appended to `src/domain/ids.ts`) → the boundary test **REDDENED** (1 fail, "references a DOM/Node global"); restored → green (197 expects). The enforcement lane catches drift it has never seen, with no author present. | **FIRES** |
| **The B-16 holdout freeze** (L-3) | All 5 frozen fixture SHA-256s recomputed on the fresh tree — **byte-identical** to the manifest (clean/wrong-charset/paywall/huge/empty-article). The L-11 regression gate's ground truth survived the recycle intact. | **INTACT 5/5** |
| **The taxonomy pins** (L-3, the 7 ClipError rows) | Green in both lanes on the governing tree — lane A **142/0/567**, lane B **169/0/718**, matching the L-6 close receipt exactly. | **GREEN** |
| **The queue transition table + ConflictError** (L-6, Q-1) | Green in the same lane runs (the L-6 tests inside the 142/169). The typed contract holds on a lineage that never saw it written. | **GREEN** |
| **The H-22 memory-guard** (the #46 class) | Real deletion injected (the "Failed cycles auto-recover" durable bullet removed) → **exit 1, FLAGGED**, the #46-class message, the diff ring-buffered; restored → exit 0 clean. One honest edge found: the move-heuristic is substring-based, so an append-only rename (`## Environment` → `## EnvironmentX`) reads as a "move" and evades the flag — a minor blind spot, named here for the record (the render-prune threat model deletes whole lines, which IS caught). | **FIRES** (one named edge) |
| **The H-26 claim gate** (the pre-dispatch refusal) | Live-fired: an L-7-naming brief while L-7's claim was 28 min old → **exit 7 CLAIM-CONFLICT**, correct. But an L-6-naming brief (CLOSED 40 min prior) → **also exit 7 — FALSE REFUSAL**. Root-caused, fixed, paired A/B receipted — **V-6** (below). The recycle test's headline catch: the fresh lineage reddened a CANARY the authoring lineage's own verification had passed vacuously. | **FIRES, then caught a bug in itself** |

## The V-6 catch (the H-26 closed-ticket false refusal)

The gate's newest-first scan could never mark a close in the normal
claim→close order (the CLOSE line is met BEFORE any claim is
recorded, so `last_claim_ts is None` skips it) — every CLOSED ticket
with its claim inside the -80-commit window read as ACTIVE. The
authoring receipt's "closed path (L-2) proceeds" check was green only
because L-2's claim sat outside the -80 window — a fiction pin of
exactly the class the H-24 refresh catches on the live wire.

**Fixed in place** (the scan is now a true state machine: the FIRST
log event naming the ticket decides), with the deterministic hermetic
suite `scripts/a1/test-a1-dispatch-claim-gate.py` — 7 fixture-repo
cases, controlled committer dates, zero network/engine spend:

- **BEFORE (the pre-fix gate): 4 pass / 3 fail** — the closed ticket
  refused; the re-claim-after-close treated as closed; the fresh
  claim over an old close treated as closed. Three facets, one broken
  machine.
- **AFTER (the fixed gate): 7 pass / 0 fail** — the state machine
  holds.
- Live re-verified on the real repo: L-6 / L-7 / L-2 (all CLOSED by
  then) → exit 0 each; the live-claim refusal had been re-confirmed
  at exit 7 minutes earlier. The registry row carries the correction;
  stage stays CANARY (a correctness landing, not new surface).

**The law filed (V-6):** a guard's own verification must exercise the
guarded path POSITIVELY — a green that arrives via an unrelated code
path is a fiction pin.

## The round-level reading (honest)

The recycle test's own thesis is CONFIRMED by its execution: the
retained improvements are structural (5 of 6 fired or held green with
zero authoring context), and the one that carried a latent defect was
caught precisely because a fresh lineage exercised it without the
author's assumptions. The prove track's "retained improvements"
category now has its sharpest possible receipt: **the recycle test
pays for itself by finding the bug only a stranger could see.**

**State: the owed item DELIVERED. The 35th lane continues
non-overlapping (augment/prove); the sibling drives L-8.**
