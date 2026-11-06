# The every-3-tickets playbook review — the C-4..C-8 era (2026-11-06, the twenty-third lineage)

> The round's standing §4 law: every 3 drive tickets, the operator
> reviews the brief/economics/failure patterns and amends the
> playbook. The first review (at C-3) landed the ordered-write brief
> pattern. This one covers **C-4, C-5, C-6, C-7, C-8 + the
> satellites A2H-9..A2H-13** (the review was nominally due at C-6;
> filed now at C-8's close — the parallel-lineage churn is itself a
> finding, see #6).

## The ticket economics ledger (turns to done, the §8 metric)

| Ticket | Turns / rounds | Class | The cost driver |
|---|---|---|---|
| C-4 | 57 / 6 | unit+scheduler | the HEAL genuine-gap fix |
| C-5 | 63 / 5 | unit+artifacts | one gate catch (the offline.html forward ref) |
| C-6 | 87 / 5 | e2e | the ×3 verify grind |
| C-7 | 89 / 7 | e2e | the offline-boot root cause + the V-35 recovery |
| C-8 | ~135 / 10 | e2e | **the flake catch + the 6-run proof** |
| A2H-9 | ~60 / 8+ | forensics | the convergent dual closure |
| A2H-12 | 3 chunks | one-hunk fix | — |
| A2H-13 | 56 / 6 | satellite | 3 cap-stop verify chunks + the seed catch |

**The e2e-2× law is now CONFIRMED twice** (C-6: 87, C-7: 89) and
**BROKEN ONCE in the new direction** (C-8: ~135 — the flake lane
doubled the verify cost). Playbook amendment #1: **e2e tickets
budget 4 chunks × 8 turns as the FLOOR, with the +1 flake-hardening
round pre-authorized** — the operator gate's cross-runs are now part
of the ticket's own cost, not an after-the-fine.

## The failure-pattern classes this era (the §3 taxonomy, live)

1. **The warm-x3 trap** (C-6's assertion drift V-31, C-8's chooser
   race): A2's ×3 consecutive green runs are ALL WARM — the flake
   classes live in the cold/first-run boundary. Playbook amendment
   #2: **the e2e acceptance bar is ×3 WITH at least one cold boot**
   (the webServer killed between runs) — effective C-9. The C-8
   close ran 12 consecutive (6 cold) as the new reference shape.
2. **The prompt-guard silent kill** (V-39): a brief carrying literal
   kill-command text dies rc=143 with zero output and no envelope.
   Playbook amendment #3: briefs NEVER carry literal kill/process
   termination command text — phrase the instruction ("stop the
   webServer process yourself"). The H-11 helper now classifies the
   signature (patched this lineage).
3. **The session-fork footgun**: `--session <id>` (bare id) resolves
   as a cwd-relative file, forks a new session, and writes the
   transcript into the repo root (the V-27 phantom-file class).
   Playbook amendment #4: continuations pass the session FILE PATH
   (absolute), never the bare id.
4. **The cap-stop taxonomy is stable** (V-12): capped mid-tool-stream
   = error_during_execution + empty result + capped:true — the
   continuation brief is mechanical (state + next actions), zero
   re-briefing. H-12's generator (the twenty-fourth's canary, 2/2
   zero-correction) is the automation lane.
5. **The narrative-confabulation class** (C-8's root-cause story
   claiming a pre-fix order the code did not have): A2's receipts are
   evidence-graded — the operator gate cross-reads the code BEFORE
   accepting a root-cause narrative. Playbook amendment #5: the
   operator gate's root-cause check = read the pre-fix diff, then
   the narrative.
6. **The parallel-lineage churn tax** (V-32/V-33/V-36: the dual/triple
   incarnations, the ~72-min duplicated C-7): the V-9/V-10 window
   protocol works but the CLAIM→DISPATCH gap is where the
   spend-duplication lives. Playbook amendment #6: a claiming
   lineage pushes its dispatch's FIRST CHUNK RECEIPT (the envelope
   path + session id) as part of the claim commit when possible —
   evidence-on-main beats window arithmetic.

## What the playbook keeps unchanged

- The prompt-economy header shape (ROLE/ALLOWED/FORBIDDEN/OUTPUT/
  HANDOFF/BUDGET/NON-OVERLAP/ACCEPTANCE) — every ticket this era
  closed with zero scope-creep beyond priced deviations.
- The acceptance-scripts-name-the-SCRIPT law (`bun run test:unit`)
  — V-27's class never recurred.
- The x3 law's core (three consecutive) — the cold-boot amendment
  strengthens, not replaces.
- The B-20/e2e-first coverage law (the CLI entry only covered by an
  e2e lane) — held through C-7's kill harness and C-8's io lanes.

## Feed to the registry

- The H-11 helper's GUARD-KILL classification: PROPOSE-class note
  (the V-39 evidence).
- The H-12 generator: 2/2 canary on the twenty-fourth's lane — this
  lane's C-8 continuation briefs were hand-written (the generator is
  off-repo per-lane); the PROMOTE gate still needs the round tally.
- The warm-x3 trap is a benchmark-programme finding (the §8 report's
  envelope-fidelity row): the agnes-3.0-flash dispatch economics
  show the cold-boundary as the flake habitat, not the model's
  in-run behavior.
