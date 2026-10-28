# The validation round — failure ledger

Every Unown-side defect or learning-system weakness discovered during the
round, with the root cause, the fix, the regression pin, and the re-run
evidence. "No Unown defect" is a valid outcome for a stage — the ledger
stays honest either way. Numbered F1, F2, ... in discovery order.

---

## F1 — memory-recall drift: a correct memory fact answered wrong (found CP1)

**Description.** The V2 fact-recall probe (session
`01a18432-08df-7a1e-96e9-ec68c4dc8cfc`, 1 turn, 2 s, exit 0) asked two
questions answerable from the tracked project memory. Question 2 (where
per-project memory lives, what maintains it) was answered verbatim-correct
(`.unown/memory/project.md`, AutoDream, the Manual-notes lane, the
provenance sidecar). Question 1 (Parley's password hashing) was answered
**"bcrypt at cost 10, `PARLEY_BCRYPT_COST` env override"** — while the
tracked memory stated "Parley password hashing uses scrypt with N=16384 in
the password.ts module" and the source (`src/lib/parley/password.ts`)
confirms Node-crypto scrypt, N=16384, r=8, p=1. The answer was wrong
against both the memory and the source, and the `PARLEY_BCRYPT_COST`
override was invented — it exists nowhere in the repo.

**Root cause.** The injected memory carried the correct fact, but nothing
in the memory guide instructed the agent to treat memory as evidence
rather than authority, to verify consequential facts against source, or to
cite which memory entry informed an answer. Under an explicit "answer
without deep re-derivation" prompt the model free-completed over the
memory's topic area instead of quoting it — the exact failure class the
round's competitor research flags as the industry's newest hardening
target (Codex CLI memory v2's anti-drift doctrine and recall-time
citations; Claude Code 2.1.311's stale-memory-after-compaction class). The
recall path has no drift guard; the guard lane (`src/guard.ts`) scans
writes, not recalls.

**Memory gap identified.** Not a storage gap — the fact was stored
correctly. It was a **recall-time discipline gap**: the memory guide (the
agent-facing contract injected with the tiers) lacked a
verify-before-asserting clause and a cite-your-memory-source clause.

**Benchmark created.** The V2 probe itself (two-part factual recall, one
part designed to be verifiable against a single source file) is pinned as
the round's drift benchmark; deterministic contract pins live at
`pi-repo/packages/self-learning/test/memory-drift.test.ts` (11 tests).

**Improvement implemented.** `src/memory-guide.ts` gains the recall-time
verification contract: memory is evidence, not proof of current behavior;
consequential facts get a source check before they are asserted; answers
cite the memory entry they came from and mark unverified recalls as
unverified; memory/source disagreement is a repair note, not a silent
overwrite.

**Validation result.** **Fixed, receipted.** The V2b re-run (post-fix,
same question, same model) answered correctly — scryptSync N=16384 r=8
p=1, `timingSafeEqual` — WITH the citation discipline ("this fact is in
project memory, hand-verified against the source 2026-10-29") and an
explicit negation of the poison ("no bcrypt/`PARLEY_BCRYPT_COST` in the
repo"). 1 turn, 3 s, exit 0.

**Retention result.** The guide is injected on every session (both paths);
the deterministic pins assert the clauses survive any future edit.

**Regression status.** Pinned — `test/memory-drift.test.ts` (F1 describe
block, 5 tests + both-path injection asserts).

---

## F2 — extraction poisoning: the wrong answer became memory and erased the ground truth (found CP1/CP4)

**Description.** The V2 session's wrong answer rode the session's
auto-captured outcome note into AutoDream. The dream extracted it as a
"fact" (platform memory `c57745f3-2096-4025-b26e-c164afaac9bc`, kind
`terminal-note`, verbatim: "Parley's domain layer hashes passwords with
the `bcrypt` package at cost 10 (~120 ms per hash in Node); a
`PARLEY_BCRYPT_COST` environment variable overrides the default cost").
The recency-first reconcile then **pruned the correct legacy-imported
scrypt entry**, and the rendered `.unown/memory/project.md` shipped the
bcrypt line (git diff receipt: 49 insertions / 49 deletions, the scrypt
bullet gone, the bcrypt bullet in). A cross-scope search for "parley
password hashing" ranked the poisoned memory FIRST (score 0.566) over
every correct entry. Ground truth was erased from both the platform and
the file by the system's own learning loop.

**Amplifier (measured, pre-existing).** The same erosion had already
happened UPSTREAM before the round: the pulled commit `9ebe942` carried a
re-rendered project.md where an earlier reconcile pass had dropped the
scrypt fact entirely (79 → 66 memories, 13 pruned) — the round's fresh
dream then re-poisoned the empty slot. Two independent instances of the
same failure class: reconcile-tier ground-truth erosion is not a one-off.

**Root cause.** The extraction prompt (`MEM0_CUSTOM_INSTRUCTIONS`) made no
distinction between facts the session VERIFIED (a read, a run, a fix) and
the session's own UNVERIFIED assertions — an answer the agent GAVE is not
evidence, but it reads with full confidence. Recency-first contradiction
resolution then treats the newer wrong entry as the winner.

**Memory gap identified.** An extraction-trust gap: unverified
self-generated assertions enter memory with the same standing as verified
observations, and the reconciler's recency preference amplifies them into
replacements.

**Benchmark created.** The live poison test: a crafted note carrying a
wrong, explicitly-unverified assertion ("the bridge runs on port 9999 /
the engine on 8888 — answered from general knowledge, never verified") is
delivered through the real note lane and dreamed through the real
pipeline; the platform is then searched for the poison.

**Improvement implemented.** `src/memzero.ts` — `MEM0_CUSTOM_INSTRUCTIONS`
gains the verified-vs-asserted contract: extract facts the note VERIFIED,
never the session's own unverified answers; and "unverified recency must
not overwrite verified knowledge" — a conflicting unverified assertion is
linked as a candidate correction, not a replacement.

**Validation result.** **Fixed, receipted.** Post-fix, the poisoned-ports
note was dreamed through the live pipeline (dream `452150ec`, 3 notes,
+1/merged 1/pruned 2) and a cross-scope search for "9999"/"8888" returned
**zero poisoned memories** — the wrong assertion did not survive
extraction. The recovery lane is also receipted: the ground-truth scrypt
fact was restored (git checkout + a verified corrective note +
Manual-notes lane), the project scope purged and re-imported, and the
retrieval probe recovered from **0/6 hit@5 to 6/6 hit@5**
(`probes/recovered.json`).

**Retention result.** The restored fact now lives three-deep: the
platform store (imported + note-extracted), the rendered file (Facts
section), and the `## Manual notes` lane (survives every re-render;
provenance sidecar `manualEdited: false` — the lane's own seed sha
matches).

**Regression status.** Pinned — `test/memory-drift.test.ts` (F2 describe
block, 4 tests).

---

## F3 — the mint lane dead-ended blind at the size caps (found CP3)

**Description.** With the seed suite saturated (6/6 passing — the honest
state after the autonomous cycles), `POST /api/tasks/mint` minted a
curriculum variant whose draft was discarded with
`"authoring failed: name/description/prompt exceed size caps"` — the
authoring prompt never stated the caps `validateDraft` enforces
(name ≤ 80, description ≤ 300, prompt ≤ 2000), so a verbose model authored
past them blind, every attempt. On a saturated suite this dead-ends the
self-improvement loop's expansion path exactly when it needs one: no
failing task can enter the suite, so no cycle can ever mine an improvement.

**Root cause.** Prompt/validator asymmetry: the validator's caps were
invisible to the authoring LLM.

**Benchmark created.** `POST /api/tasks/mint` receipts (the discarded
outcome JSON) + the deterministic prompt-visibility pins in
`test/mint-caps.test.ts`.

**Improvement implemented.** `MINT_SYSTEM` states the caps explicitly
("the harness REJECTS drafts over these... the caps are part of the
exercise"), exported for the pins.

**Validation result.** **Fixed, receipted.** The first post-fix mint's
draft PASSED the size caps and shape validation and reached the
self-check layer (a deeper, legitimate gate: the authored test file
itself crashed on the seeded files — the pipeline's multi-layer
validation catching a broken draft honestly, not a harness defect).

**Regression status.** Pinned — `test/mint-caps.test.ts` (F3 describe
block, 3 tests).

---

## F3b — the mint lane's shape flakiness: one bounded repair pass (found CP3)

**Description.** The first post-F3 mint failed at a DIFFERENT seam:
`"id/name/description/prompt must be non-empty"` — the remote model's
draft JSON came back missing fields. Authoring under the metered model is
flaky at the JSON-shape level, not just the size level; each failed mint
burns the attempt with zero salvage.

**Root cause.** No repair lane on the default (non-cascade) path: an
invalid draft went straight to discard, wasting the authoring call.

**Improvement implemented.** `authorDraft`'s default path now makes
exactly ONE repair call when `validateDraft` fails — carrying the invalid
draft + the validator's exact error + the caps — then re-validates;
still-invalid keeps the discarded path with a repair-aware reason
("... (repair pass: ...)"). Bounded: never a third call. The cascade's
stage-3 shape, without its local-draft stage.

**Validation result.** **Receipted.** Unit pins prove the repair
semantics (over-cap → repaired; empty-fields → repaired;
both-invalid → repair-aware discard; valid-first-draft → exactly one
call, no repair spend). The live mint now travels the full pipeline depth
(caps → shape → self-check).

**Regression status.** Pinned — `test/mint-caps.test.ts` (F3b describe
block, 4 tests) + the two mint-cascade contract tests updated to the new
bounded-repair shape.

---

## Positive validations (defects the system caught itself — recorded so the loop's defenses are visible)

- **The canary rollback (autonomous, receipted):** dream `bc0af2bc`
  consolidated, then its canary FAILED with a claim mismatch ("the
  canary's final report claims verification via [bun] but it executed
  [python3]") — the engine rolled the memory back to v4 and reverted the
  platform events automatically (`memory_versions` row v6, changed_by
  `rollback`). Regression prevention working with zero operator input.
- **The already-passing discipline:** four autonomous harness cycles on
  passing tasks all reported `already-passing — no improvement needed`
  (no junk mining from green runs).
- **The outbox/delivery lanes:** every terminal session note reached the
  engine first-try; the corrective and poisoned test notes delivered
  through the real CLI lane.

---

## F4 — (pending)

Not yet discovered.
