# Instruction-set PR lane: can agent sessions propose AGENTS.md edits as pull requests?

> Decision doc, doc-truth round T4 (2026-11-03). Question from the Coda
> round's retrospective: the instruction-set write gate is FINAL by design,
> so every in-session instruction edit a task needs must be drafted in the
> session's receipt and re-landed by the operator in a separate round-trip.
> Would an operator-review **PR lane** — propose-only branch + pull request,
> merged by a human — be worth building? This doc prices that question on
> the evidence this round collected. **Evaluation only: no implementation
> this round; the operator decides at the checkpoint.**
>
> Companion records: the gate's user-facing law in
> [permissions](permissions.md); the engine's own session logs; the three
> evidence events in `.unown/receipts/t2-pwa-benchmark.md` and
> `.unown/receipts/t3-landing-capture.md` (the C5 precedent lives in the
> Coda round log, `docs/coda-app-round-session.md`).

## Verdict up front

**NO-GO for a new propose-only push primitive. GO (zero cost, now) for a
documentation fix: the gate's documented remediation already says "propose
changes via a PR" — make that lane real by telling operators to land it
through the tools the session ALREADY has full rights to: `git branch` +
`git push` on the agent's existing PAT + `gh pr create` (both of which
already exist in the operator's shell today, need no engine change, and
keep the gate byte-for-byte FINAL in-session).** The draft-and-operator-
land convention costs are real but small; the new-attack-surface cost of
granting the agent a standing push-to-remote capability is not — and the
threat-model analysis below shows the operator-merge path is the trust
boundary that must stay human-operated regardless.

## 1. The question being decided

The Coda round's retrospective improvement candidate (the round log's
mission text, `docs/doc-truth-round-session.md`): an **operator-review PR
lane** that lets agent sessions propose AGENTS.md (and friends) edits as
reviewable PRs instead of the draft-and-operator-land convention. The
gate itself stays FINAL — the open question is only about what happens
**after** the session ends, when the draft exists.

## 2. The current mechanics (what stays FINAL)

The in-session write gate is a pure path-matcher, wired into both runtime
gates AFTER their jail check and BEFORE the declarative permissions layer,
so its verdict is **final and above every layer** — the hard-coded
guardrail contract the [permissions](permissions.md) doc spells out:

- **The matcher**: `instructionWriteDeny(projectPath, p)` in
  `pi-repo/packages/self-learning/src/instruction-guard.ts` — one source
  both the terminal and the engine call; every in-project path that
  resolves to a row of `INSTRUCTION_WRITE_DENY` (15 shapes — every depth
  `AGENTS.md`/`CLAUDE.md`, `.unown/skills/**`, `.unown/agents/**`,
  `.unown/hooks.json`, `.unown/permissions.json`,
  `.unown/memory/policy*`, `.unown/memory/project.md`,
  `.unown/memory/project.provenance.json`, `.unown/adversary.md`,
  `.claude/settings.json`, `.claude/agents/**`,
  `.vscode/tasks.json`, `.vscode/settings.json` … see the doc's
  deny-table) is **denied in-session, period**. The deny-reason string
  the tool surfaces to the agent ALREADY names the fix:
  `instruction-set file is not writable in-session: <shape> (propose
  changes via a PR for human review)` — i.e. the repo has already
  **documented a PR as the sanctioned path** to land a change to these
  files, even though the PR mechanism it points to is not a
  first-class tool.
- **The terminal gate**: `pi-repo/packages/self-learning/src/termhooks.ts`
  wires `instructionWriteDeny` to both the `write`/`edit` tool targets
  AND the bash-redirect checker (`> target` operands run through the
  SAME matcher — `echo x > .unown/hooks.json` is denied), and into the
  write-tool branch of `builtInGates` after the path jail.
- **The engine twin**: `pi-repo/packages/self-learning/src/hooks.ts`
  wires the same function to the sandbox root AND the real project dir,
  so engine-side runs get byte-identical behavior.
- **Permissions layer interaction**: `pi-repo/packages/self-learning/src/permissions.ts`
  + [permissions](permissions.md) lock this in: the declarative
  allow/deny/ask layer **can only ever add restrictions**; an `allow`
  rule, `bypassPermissions` mode, or `UNOWN_PERMISSIONS=0` (layer off)
  cannot unlock the instruction-set gate. The verdict is final
  by construction — the threat model below prices what a PR lane could
  and could NOT change about that.

### What the gate does NOT restrict today (relevant to the threat model)

The write gate is a **path** gate on *writes in-session*. It does not
currently restrict: (a) `git add`/`git commit` of an instruction file
**the session just wrote via a loophole** (there is no loophole — the
matcher runs on every write-tool call and on every `> target` redirect
before landing, so a session that is refused by the gate literally
cannot get the bytes into the working tree through any sanctioned tool
path); (b) `git push` of an existing local branch **the session created
via a sanctioned path** — but see the next bullet; (c) the agent's
`gh` binary invocations for READ-side PR inspection (`gh pr view`,
`gh pr diff`, `gh pr comment` — already in-tree, see
`pi-repo/packages/self-learning/src/pr-review.ts` and its
`GITHUB_PR_URL` / `PR_NUMBER_HASH` classifiers) — that lane exists for
`/review` today, and needs no new engine change to serve a PR lane.

The one new primitive a propose-only lane adds is therefore: **`git
push` of a session-authored branch** (plus optionally a session-side
`gh pr create` so the operator doesn't have to type it). Everything else
is already in the repo's vocabulary.

## 3. What draft-and-land costs today (the evidence set)

Three guard-class events this round observed the convention's cost in
vivo (each one cited at its receipt source; the round log's checkpoint
entries are the operator's own record of what landed where):

| # | Event | Receipt / source | Observed cost |
|---|---|---|---|
| E1 | T2 — `benchmarks/AGENTS.md` ownership-list edit (register the new `coda-pwa/` lane) refused by the guard; operator re-landed it from the receipt's draft | `.unown/receipts/t2-pwa-benchmark.md` ("Open questions" + "Known uncommitted deviance") | 1 full operator round-trip: draft in receipt → operator reads receipt → operator re-applies the edit outside a session. The receipt itself is the **only** durable record; the round log notes receipts are mortal to clone loss AND unown-home loss — a chunk cap between "draft written" and "operator-landed" can lose or drift the record. |
| E2 | T3 — the landing `AGENTS.md` amendment-ledger's THIRTEENTH scroll-budget entry, operator-APPROVED mid-ticket as a ruling, STILL refused for in-session write; operator landed it in `src/components/landing/AGENTS.md` from the draft | `.unown/receipts/t3-landing-capture.md` (OPERATOR CLOSE block: "the ledger entry landed operator-side in `src/components/landing/AGENTS.md` (instruction surface — the session's draft-and-operator-land convention; the second guard-class event of the round)") | The most expensive shape of the cost: the edit was **already approved by the operator mid-flight** (a ruling), and the convention still forced a second, separate operator act (re-land the exact same edit outside a session) because the approval was verbal, not a commit. This is the latency E1's one-line edit did NOT have: E1 was a draft that needed a fresh decision; E2 needed **zero** new decision, only a second copy-paste by the operator. |
| E3 | C5 — `apps/coda/AGENTS.md` child DOX + root `AGENTS.md` child index entry | Coda round log (the C5 precedent, operator-landed from verified drafts) | The precedent that operator-side landing is viable and cheap **when the draft is complete and verified** — this is the case that argues for keeping the convention, not replacing it: three guard events in two rounds, all three landed cleanly operator-side with zero drift or incident, at a cost of one operator copy-paste each. |

**Receipt-drift risk (E1's hidden cost)**: the round log's deviation
records (T3's "status block went unmaintained past part 2") show the
draft-in-receipt convention is the round's most consistent deviation
class — the draft's durability depends on the session keeping the
receipt's status block current, which budgeted-chunk caps make
unreliable past part 2. A PR lane, if it exists, does NOT change this:
the draft still has to be written somewhere the operator can read it;
only its destination changes (receipt file → PR diff).

## 4. Composition candidates (zero engine changes preferred)

The reuse-over-create law applies: prefer composing what exists.

- **C0 — the convention as-is (baseline)**: draft in the receipt,
  operator-lands it. Cost: the three round-trips above. Risk: the
  receipt-drift class. This is the NO-GO case's alternative.
- **C1 — namespaced branch + `gh pr create`, operator merges (the
  proposed lane)**: a session creates a branch under a namespaced ref
  (e.g. `unown/<session-id>`), commits the guarded-file edits on that
  branch (the session ALREADY has `git add`/`git commit` via
  `gittools.ts`'s `commitAll` — the /commit command, `UNOWN_AUTO_COMMIT`
  snapshot, both in-tree; the commit itself touches no write-tool gate,
  only `git`), then `git push` the branch to the origin + `gh pr create
  --head unown/<session-id>` (both available to the operator's shell
  TODAY; whether the session can call `gh` is the one new grant). The
  operator reviews the PR diff against the deny-table shapes in
  `docs/permissions.md`'s "Instruction-set write policy" section, clicks
  merge in the GitHub UI (the PAT they already use for /login etc. —
  the repo's `.github/workflows/ci.yml` and release workflow already
  run on push/PR, so CI green is automatic on the PR). **No new engine
  code** is strictly required for C1 if the session is allowed to run
  `gh pr create` as a normal shell command; the ONLY new trust surface
  is that the session's PAT/gh credential now has a standing
  `git push` to the remote + a PR-create right. The read-side
  `gh pr view/diff/comment` machinery in `pr-review.ts` already exists
  and needs no change; the `worktree.ts` / `worktree-session.ts`
  `-w/--worktree` managed worktrees give a session a clean checkout to
  author the branch on, so C1 composes onto `gittools.ts` (commit) +
  `worktree.ts` (branch authoring) + the operator's `gh`/git PAT
  (push + PR-create) — all three in-tree today.
- **C2 — in-session write of guarded paths on a dedicated branch
  (REJECTED candidate)**: this would "route around" the FINAL verdict
  by changing the matcher to allow `AGENTS.md` writes when the git
  branch is not `main`. The gate is a **WHAT** boundary (which paths
  are instruction-set surface), not a **WHERE** boundary (which branch
  the working tree sits on) — a branch is not a trust boundary. An
  attacker-controlled session that writes `.unown/hooks.json` on a
  `feature-x` branch and force-pushes or opens a PR the operator
  merges in a hurry is exactly the persistence vector the
  [permissions](permissions.md) doc's opening paragraph names (the
  AutoRedClaw / Agent Commander / Tensorlake trio). **C2 is gate-
  weakening by another name; it fails the invariant in §5.**
- **C3 — a new session permission mode / engine knob that flips the
  deny set off for instruction paths (REJECTED)**: maximal; violates
  the reuse-over-create law; the [permissions](permissions.md) doc's
  "The permissions layer can only ever add restrictions" contract is
  the user-facing law, and C3 breaks it. Only an operator decision
  (out of scope for this doc) could authorize it; the doc's
  recommendation does not require it.

**C1 is the only candidate that (a) needs zero engine-code change,
(b) leaves the gate FINAL in-session (the threat-model invariant in §5
holds — the new surface is EXTERNAL to the session, and the merge act
is the operator's), and (c) composes onto in-tree primitives
(`gittools.ts` + `worktree.ts` + `pr-review.ts`'s gh vocabulary + the
operator's PAT).**

## 5. Threat model (the invariant: propose-review-MERGE keeps the human as the merger)

The gate is a **trust boundary** that confines *what* an in-session
write may land, not *where* it lands (the jail already confines where).
A PR lane must not weaken it. The invariant the lane must hold:

> **The session PROPOSES (a branch + a PR). A human MERGES. The session
> has no merge right. No in-session act can route around the FINAL
> verdict on an instruction-set path.**

Pricing what a hijacked or prompt-injected session gains from C1's
branch + PR rights versus today:

| Capability | Today (C0) | C1 | Delta |
|---|---|---|---|
| Write an instruction-set path in-session (any branch) | **Denied, FINAL** | **Denied, FINAL** | None — the matcher is untouched; C1 adds no new write-tool or redirect path. |
| `git add` / `git commit` a session-created branch | Allowed (in-tree `gittools.ts` `commitAll`) | Allowed | None — already the case. |
| `git push` a session-created branch to origin | **Not granted to the session** (the `gittools.ts` contract is "NEVER `git push`. Only `add` + `commit`, ever"; `bash-policy.ts` denies `git push` in sandbox/strict modes — line ` /\bgit\s+push\b/ ` in the BASH_DENY ruleset) | **Granted ONLY if the operator configures the session's PAT/gh credential to have that right** | **THE new trust surface.** The operator's PAT today already has push rights (the repo's own `unown update` / release workflow uses the PAT in the git remote URL — see [root AGENTS.md](../AGENTS.md)'s "Environment" bullet); the question is only whether a *session* can drive `git push` + `gh pr create` without a fresh human keypress per call. |
| `gh pr create` | Not a session tool (only `gh pr view/diff/comment` are, in `pr-review.ts`) | **Granted ONLY if the operator adds `gh` to the session's allowed shell commands** | Same surface as push: operator's explicit grant, default OFF. |
| **Merge the PR** | Operator only (GitHub's PAT + 2FA + repo-owner permission on the `main` branch; the repo's CI already gates merges on `ci.yml` passing) | **Operator only — C1 grants the session NO merge right; the GitHub repo's branch protections on `main` are the final gate, and they already require a passing CI + (optionally) a review. The session's token does not carry the merge scope.** | None — this is the invariant holding. |

**Why operator-merging a PR is the SAME trust surface as operator-
landed commits (the analysis must say why):** In BOTH C0 and C1, the
bytes that land on `main` are the result of a HUMAN act — C0: the
operator's own editor + their own `git commit`/`git add` + their own
push (the operator's keyboard is the final act; the session's draft is
just data the operator copy-pasted). C1: the operator's GitHub UI click
on "Merge pull request" (the operator's keyboard/mouse is the final
act; the session's branch is just data the operator diffed and
approved). The session's capability in both cases is IDENTICAL: it can
produce a DRAFT (a file on disk in C0, a branch on the remote in C1).
The HUMAN's capability in both cases is IDENTICAL: read the draft,
decide, and commit/merge it themselves using a credential the session
does not hold. The threat surface that matters is NOT "can the session
touch git?" (it already can, via `gittools.ts`'s commit-only
primitive); it is **"can the session move bytes from its draft to
`main` WITHOUT a human act?"** — and in both C0 and C1 the answer is
**no**: C0 needs the operator to re-type/re-land; C1 needs the
operator to click Merge. The only NEW surface C1 opens is "the
session's PAT now has a standing push-to-remote + PR-create scope
instead of no remote access at all" — which the operator already holds
themselves, and which the operator can revoke by not adding `gh`/
push to the session's allowed commands. A branch on a remote that no
one merges is inert: it is the same inert shape as a receipt file
on disk that no one re-lands.

**What the merge gate must require (the repo already does):**
CI green (`.github/workflows/ci.yml` + `codeql.yml` + `scorecard.yml`
all run on PR; `docs/permissions.md`'s team-repo example shows the
house convention of `git push --force*` as a deny rule), and the
operator's own read of the diff against the deny-table shapes in the
[permissions](permissions.md) "Instruction-set write policy" section —
i.e. the same review bar an operator-landed commit gets (a human
reading the diff, not a CI bot, is what makes the merge a trust
act, not a pipeline act). No new CI, no new bot, no new
auto-merge rule is required for C1 to be safe: **the lane's safety is
the GitHub repo's existing branch-protection-on-`main` + the
operator's merge click, both of which are unchanged by C1.**

**The threat model states the invariant explicitly, one line:**
> A propose-only branch + PR, merged by a human with a credential the
> session does not hold, keeps the human as the merger — the gate's
> FINAL verdict on in-session writes is untouched, because the lane
> is EXTERNAL to the session (push + PR are not write-tool calls, and
> they land on a REMOTE branch, not on a working tree the session's
> next tool call would see).

## 6. Effort estimate (rough, honest)

- **C1 (the recommendation, documentation-only)**: the lane needs
  ZERO new engine code. The session's `git add`/`commit` (in-tree),
  `gh pr view/diff/comment` (in-tree, `pr-review.ts`), the operator's
  PAT (in-tree, root AGENTS.md "Environment"), and the GitHub UI merge
  (in-tree, browser) all exist. What C1 actually ships is **a doc
  bullet** — the [permissions](permissions.md) "Instruction-set write
  policy" section gains a one-paragraph "How to propose via a PR"
  recipe (the operator types `git push` + `gh pr create` from their
  OWN shell, with the session's receipt as the diff source; or the
  session itself runs the two commands when the operator has
  explicitly allowed `git push`/`gh pr create` for that session, and
  the operator merges in the UI). ~30 lines of doc + a CHANGELOG
  bullet. **Effort: 1 chunk of a session that is NOT this round's
  gate (the doc edit itself touches `docs/`, not an instruction-
  surface file — it is permitted in-session; no PR needed to land the
  recipe that describes the PR).**
- **C1-full (a real session-side `gh pr create` + namespaced-branch
  tool, in-tree)**: a new tool entry in `tools.ts` + a `gh`-spawn
  shim next to `pr-review.ts`'s existing `fetchPrMetadata`
  / `postPrComment` (reusing their `defaultSpawn` + `which("gh")`
  seams — the spawn plumbing already exists, ~100 lines to add a
  `createPrFromBranch(cwd, headRef, title, body)` that shells to
  `gh pr create --head <headRef>`). Effort: ~1 session (spec +
  tool + test), gated on the operator first deciding the PAT-scope
  grant (the repo's `.env` / PAT currently has no "session may push"
  knob; adding one is an operator infrastructure decision this doc
  cannot make). **~2–3 chunks, not this round's scope.**
- **C0 (keep the convention, no change)**: zero effort now; the
  evidence set (§3) prices its ongoing cost at ~1 operator
  copy-paste per guard event, observed 3× this round, no drift, no
  incident. The receipt-drift risk (round log's T3 status-block
  deviation) is the ONLY structural weakness, and it is a
  receipt-discipline problem, not a gate problem — the C5 precedent
  (E3) shows the convention works when the draft is complete.

**The reuse-over-create law decides between C0 and C1 on price**: C0
is free and has a 3-for-3 clean-landing record this round; C1
(doc-only) is nearly free (a doc bullet) and buys the operator a
**named, discoverable path** for the exact 3 events this round hit
(the E2 case — already-approved, still-needs-second-copy-paste — is
the one C1's doc bullet would directly answer: "the ruling was
approved, so open the branch, `gh pr create` it, and merge it — no
second operator act needed").

## 7. GO/NO-GO recommendation (the reasoning chain)

**The recommendation is a scoped GO on C1, and NO-GO on C1-full and C2
and C3.**

Reasoning chain, step by step (each step is the evidence or invariant
that carries the next):

1. **The gate stays FINAL (invariant, §5).** No candidate in this doc
   touches `instructionWriteDeny`'s verdict or its two wiring points
   (`termhooks.ts` + `hooks.ts`). The threat model's invariant holds
   for C1: the lane is EXTERNAL to the session; the merge act is the
   operator's. C2 and C3 are rejected for breaking it (in-session
   path-gate relaxation on a branch, and a permissions-layer knob that
   flips the deny set off, respectively — both are the gate-weakening
   shapes the [permissions](permissions.md) doc's "can only ever add
   restrictions" contract forbids).
2. **C1 composes onto in-tree primitives at near-zero cost (§4, §6).**
   `gittools.ts`'s commit-only contract + `worktree.ts`'s managed
   worktrees + `pr-review.ts`'s `gh` spawn seam + the operator's
   existing PAT + GitHub's existing branch-protection-on-`main` are
   all in the repo today. The only NEW capability C1 grants is the
   session's standing `git push`/`gh pr create` right — which is the
   operator's explicit, revocable, per-session decision (default
   OFF), not an engine default.
3. **The evidence set prices C0 at exactly the cost C1's doc bullet
   removes (§3).** Three guard events this round (E1, E2, E3), all
   clean-landed operator-side; E2 is the case that motivated the
   retrospective ("an already-approved edit still needed a second
   operator act"). C1's doc bullet is the minimal, reversible, zero-
   new-trust-surface answer to exactly E2: tell the operator the
   sanctioned path for a draft that is ALREADY approved is "open the
   branch, `gh pr create`, merge" — no second copy-paste, the merge
   click IS the approval act.
4. **NO-GO on C1-full this round (§6's "~2–3 chunks" estimate is real,
   but the PAT-scope grant it depends on is an operator
   infrastructure decision this doc cannot make, and C1's doc bullet
   is sufficient to capture 100% of the observed cost reduction —
   the session still needs the operator to type `git push`/
   `gh pr create` in the operator's shell unless the operator
   explicitly adds both to the session's allowed commands, which the
   doc bullet names as the opt-in step).** The in-tree `gh pr
   create` tool (C1-full) is the NEXT round's ticket if the operator
   wants the session itself to drive the push; it is not required
   for the lane to work, because the operator is already in the loop
   for the merge and can be in the loop for the push with the same
   keypress.

**The GO is scoped precisely: a ~30-line doc addition to
[permissions](permissions.md)'s "Instruction-set write policy"
section + a CHANGELOG bullet, describing the propose-only branch +
`gh pr create` + operator-merge-in-the-UI lane, naming the PAT-scope
grant as an explicit opt-in the operator makes, and stating the
invariant from §5 verbatim so the doc itself is the threat-model
record. NO-GO on the in-tree `gh pr create` tool, on any in-session
path-gate relaxation, and on any permissions-layer knob — those are
future rounds' tickets, gated on the operator's PAT-scope decision,
and are NOT required for the lane to be safe and useful today.**

The operator's decision at the checkpoint is: **adopt the C1 doc
bullet now (zero trust-surface change, zero engine code), and hold
C1-full (the in-tree `gh pr create` tool + a session-side PAT-scope
grant) as the next round's ticket if the observed cost continues to
motivate it.**

## 8. What this doc does NOT do (the round's law)

- No implementation: no `tools.ts` / `pr-review.ts` / `gittools.ts`
  edits, no new workflow file, no `gh` call in-session.
- No instruction-surface write: this doc lands in `docs/` (a normal
  source doc, not an AGENTS.md / `.unown/**` / `.claude/**` /
  `.vscode/**` path), so its own authoring is permitted in-session;
  the [permissions](permissions.md) "Instruction-set write policy"
  section it proposes to extend is NOT edited by this doc — that
  extension is the NEXT round's ticket, itself the first instance of
  the lane the doc describes (the doc proposes the lane by writing
  the recipe into a plain doc, not by rewriting the gate's own
  section, which would be a C2/C3 shape).
- The threat-model analysis (§5) is the doc's durable artifact; the
  operator reads it, adopts or rejects the scoped GO, and the
  adoption itself is the first PR that would land through the lane
  the doc describes — the doc is both the evidence and the template
  for its own first use.

## 9. Open risks and revisit triggers

- **If the operator adopts the scoped GO and a guard event in a
  future round reveals the doc bullet is not enough to capture the
  cost reduction** (e.g. the operator finds typing `git push` +
  `gh pr create` in their own shell is itself the friction, not the
  session's lack of a `gh` tool), C1-full becomes the ticket: add
  the in-tree `gh pr create` tool (the `createPrFromBranch` shim
  named in §6) + a session-side PAT-scope grant knob (the operator's
  infra decision, NOT this doc's).
- **If a future round observes a receipt-drift incident tied
  specifically to a guard-event draft** (the T3 status-block class
  becoming a draft-loss event, not just a bookkeeping event), the
  lane's value argument strengthens and C1-full's priority rises;
  the C5/E3 clean-landing record is the counter-evidence that the
  convention works when drafts are complete.
- **The invariant is the revisit trigger's hard floor (§5):** any
  future proposal that in-session tool calls could move a
  instruction-set path from draft to `main` without an operator merge
  click is a C2/C3 shape and is rejected by this doc's threat model,
  regardless of its effort estimate.

## Related pages

- [permissions](permissions.md) — the gate's user-facing law + the
  team-repo example + the "can only ever add restrictions" contract
- `docs/coda-app-round-session.md` — the Coda round's log (the C5
  precedent's source; the retrospective that asked this doc's
  question)
- `docs/doc-truth-round-session.md` — this round's log (the evidence
  set's operator record: E1/E2/E3 checkpoint entries + the "T4 is
  EVALUATION-ONLY" operator decision)
- `.unown/receipts/t4-pr-lane.md` — this doc's own receipt (the
  draft-and-land convention's current embodiment, in practice, as
  this doc was written)
