# B-18 — the fix-lane investigation receipt (operator recon, read-only)

Investigated: 2026-11-06, the twentieth lineage (operator-side, read-only —
no code touched). Question (the round log's B-18 entry): "Fix lane: the
dream's extraction prompt/output filter (engine-side — check whether it's
extension-surface or upstream before ticketing)."

## The ruling

**Engine-side, IN-REPO fixable.** Three facts decide it:

1. **The extraction prompt is upstream but NOT the right fix surface.**
   The stock extraction runs inside `mem0ai@3.3.1` (an npm dependency,
   `pi-repo/packages/self-learning/package.json` line 19) — its
   ~34k-char ADDITIVE_EXTRACTION_PROMPT is the package's own code, not
   patchable in-repo, and prompt-layer fixes are stochastic anyway (the
   repo's own 2026-10-23 finding: "models leak their decision rationale
   into the text field … even though the prompt sends why to its own
   reason field" — the prompt ALREADY says not to, and the leak happens
   regardless).
2. **The write boundary is the engine's own code.** Every extracted
   memory enters storage through `Mem0Platform.add()` /
   `mapAddResults()` / the reconcile UPDATE strip / the salvage trim in
   `pi-repo/packages/self-learning/src/memzero.ts` — the self-learning
   layer is Unown's own code in the shared tree (the F3 fix's lane, not
   the vendored pi-agent core), freely fixable in-repo.
3. **A partial precedent fix already exists — at ONE of the three
   boundaries.** The reconcile lane's UPDATE path strips a trailing
   `Reason:` clause (`memzero.ts:1322-1327`, the 2026-10-23 fix,
   regex `/\s*Reason:\s*[\s\S]*$/i`). The ADD lane and the salvage lane
   have NO filter, and the reconcile regex misses both B-18 shapes.

## The three leak boundaries (all in memzero.ts)

| Lane | Code path | Filter today | B-18 shapes that pass |
|---|---|---|---|
| ADD (stock extraction) | `Mem0Platform.add()` → `mapAddResults()` | none | all three shapes |
| Reconcile UPDATE | the `Reason:` strip at :1322 | trailing `Reason:` only | `[NOTE: …]` blobs, JSON fragments |
| Salvage | `salvageExtractMemories()` → trim 240 | trim only | all three shapes |

## The observed shapes (the defect receipts)

- **Shape 1 — the reasoning blob** (B-18 original, 2026-11-06 first render;
  RECURRED on a fresh engine DB at ~05:22 UTC — the third observation):
  `…clippad [note 1]. [NOTE: The original memory contained a markdown
  artifact '[note 1]' that has been cleaned up… I will keep the text as
  is… Let's look at similar memories… I will just keep the text…]"` —
  ~90-180 words of the dream LLM's meta-deliberation embedded IN the fact.
- **Shape 2 — the JSON fragment** (the twenty-first's second observation,
  05:12 UTC render): fact lines ending `", "reason": "Removed raw markdown
  note…"}, {` — the mem0 provenance object's fields rendered as fact text.
- **Shape 3 — the trailing Reason clause** (the 2026-10-23 original
  finding): already stripped at the reconcile boundary only.

## The proposed fix (the ticket's design, A2H-10)

A deterministic `sanitizeMemoryText()` at the engine's write boundary,
applied at ALL THREE lanes (ADD via mapAddResults or immediately after;
reconcile UPDATE — extend the existing strip; salvage — after the trim):

1. Strip embedded `[NOTE: …]` / `[note: …]` bracketed deliberation blobs
   (non-greedy, repeatable).
2. Strip JSON-fragment tails (`", "reason": … }, {` and kin).
3. Strip trailing `Reason:` clauses (the existing regex, generalized).
4. REJECT (drop, never store) any memory whose residual is empty or
   below a minimal floor after stripping — noise must not land as an
   empty/fragment row.
5. Clean facts pass through byte-identical (the filter is
   conservative: it only removes the three named shapes).

Verifier: the package's own test suite
(`cd pi-repo/packages/self-learning && bun test test/`) green with new
pins for all three shapes + the clean-fact pass-through + each lane's
application; tsc parity (zero new errors vs the vendor baseline); the
root battery holds (2258/0). The version bump + CHANGELOG entry are the
operator's closeout lane (the round's version policy — the first
Unown-code enhancement this round ships carries the bump).

## The repro (deterministic, for the ticket)

Run any dream consolidation over a note lineage containing the clippad
fact (observed three times across three independent engine instances
within one hour — two shapes); or directly: call the extraction path
with a note whose extraction the model accompanies with rationale. The
unit pins are deterministic and do not need the live LLM (the
`_fake-platform.ts` seam + the salvage test seam exist precisely for
this).
