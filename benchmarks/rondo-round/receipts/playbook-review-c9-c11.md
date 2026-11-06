# The every-3-tickets playbook review — the C-9..C-11 era (2026-11-06, the twenty-fifth lineage)

> The round's standing §4 law: every 3 drive tickets, the operator
> reviews the brief/economics/failure patterns and amends the playbook.
> The prior review covered C-4..C-8 (its six amendments stand). This one
> covers **C-9, C-10, C-11 + the satellite A2H-14 + the H-10 paired
> runs** — the era the round closed its DRIVE track in, and the era the
> PROVIDER changed under us.

## The ticket economics ledger (turns to done, the §8 metric)

| Ticket | Turns / shape | Class | The cost driver |
|---|---|---|---|
| C-9 | ~74 / 2 sessions + 2 tolled closes | e2e-a11y | the V-32(b) cap overspend ×2 + the V-38 provider window |
| C-10 | ~92 / dual-spend (46 close + 40 stood-down) | docs+landing | the V-40 ceiling + the convergent dual (V-42) |
| C-11 | **165 / ONE dispatch** | ci+runbook | the chunk budget blown 20× — the era's missing-law finding |
| A2H-14 | 40 / 5 dispatches | satellite-fix | the V-40-era cap continuations (the ceiling tax) |

**The e2e-2× law held** (C-9's battery verified ×3+cold); the era's cost
driver moved OFF the verify grind and onto **the environment**: the
provider flip (V-38), its output-side ceiling (V-40), and the
concurrent-lineage churn (V-42). The round's last three tickets paid
more turns to the STACK than to the spec.

## The failure-pattern classes this era (the §3 taxonomy, live)

1. **The provider capability flip** (V-38): the upstream changed
   max_tokens 65536→4096 mid-round; every dispatch 400'd at 0 input
   tokens while the smoke log showed degenerate-200s. Amendment #1:
   **an upstream capability flip is receipted as a spec pin with
   provenance, never silently absorbed — and a fresh UNOWN_HOME is
   pre-pinned BEFORE the first dispatch** (the KNOWN_MODEL_SPECS table
   seeds the stale 65536; writeModelsJson never clobblers, so the
   pre-write wins). The twenty-fifth's bring-up is the reference shape.
2. **The output-side ceiling** (V-40): the pin caps every turn's OUTPUT
   — a ~200-line single `write` is truncated and refused, EVERY time,
   and the model re-issues the same oversized write until the chunk
   burns. Amendment #2: **the split-write law** — first `write` ~60-80
   lines, `edit`-appends for the rest, every turn under ~3000 emitted
   tokens. The continuation shape became the DEFAULT dispatch mode at
   4096 output tokens; multi-chunk is no longer the exception.
3. **The latent-landing defect** (V-41 — the era's genuine find): a
   CLOSED ticket's landing (A2H-13) carried a call-site defect
   invisible to THREE gate shapes (the runner-side pin, the
   extract-value-satisfiable assertion, no real-record bridge). It
   surfaced only when the C-10 capture lane bridged the REAL runner
   record into the PWA. Amendment #3: **every cross-host seam's
   acceptance lane bridges REAL producer output into the consumer —
   seeds pin the schema, real data exercises the seam.** The §5 reflex
   converted the find into A2H-14 (40 turns, closed + cross-checked).
4. **The convergent-dual price** (V-42): the twenty-second's C-10
   chunks 2-4 landed mid-flight on the twenty-fifth's legal takeover
   lane — ~40 duplicated turns, the round's second such spend. The
   rebase theirs/ours inversion (the stood-down lane accidentally
   promoted over the governing one) was caught pre-push ONLY by the
   tree-verify law. Amendment #4: **the window is the floor, not the
   ceiling** — when the claimant's lane is demonstrably active (recent
   landings), an extended-grace observation (the twenty-fifth's 60-min
   ruling) beats the letter-of-the-law takeover; and after any convergent
   dual, **the MERGED tree owes its own verification** (neither lane's
   gates cover the other's landing — the twenty-fifth's joint
   verification is the reference shape).
5. **The advisory-budget blowout** (C-11): 165 turns in ONE dispatch —
   the 8-turn EFFORT_BUDGET blown 20×, the cap gate firing post-hoc,
   every gate green. The ticket-level total is comparable (C-8 ~135),
   but the SPEND SHAPE is unauditable mid-flight. Amendment #5 (the
   era's missing law, filed as an augment candidate): **a mid-run
   turn-budget hook** — the stop-at-N-turns review-check lane, so the
   operator sees the blowout at turn 16, not turn 165.
6. **The brief-adaptation lane matured** (§3.7): twice this era the
   operator's derivation rode the continuation brief — the Tab-count
   fix (C-10's compose form) and the A2H-14 root-cause handoff. Both
   closed in one continuation each. The lane is now the standard cure
   for the model's local-debugging spirals: **derive at the operator,
   hand the derivation, never re-brief the whole ticket.**

## What the playbook keeps unchanged

- The prompt-economy header shape — zero scope-creep beyond priced
  deviations across the era (C-11's 165 turns stayed IN scope).
- The x3+cold-boot law (amended last era) — C-9's 20/20 ×3 incl. the
  CI=1 cold boot is the reference shape.
- The acceptance-scripts-name-the-SCRIPT law — no recurrence.
- The claim-push-before-dispatch law — both claimants honored it; the
  gap is the claim→evidence lag (below).

## Feed to the registry

- **The mid-run turn-budget hook**: PROPOSE (the C-11 receipt is the
  spawning evidence; the H-11 helper's envelope parsing is the natural
  host).
- **The H-12 pattern tally: 10/10 continuations, 0 corrections** (the
  twenty-fifth's 8 hand-authored under the V-40 ceiling + the
  twenty-fourth's 2 generator emissions) — the PROMOTE gate's tally
  bar is met; the promotion decision is the closeout's.
- **The spec-pin pre-seed** enters the bring-up checklist (the V-2
  cure's newest member — the next recycle's one-pass includes the pin).
- The claim-evidence gap (the V-42(b) finding): the claiming lineage
  pushes its first-chunk receipt with the claim when possible —
  formalized for the closeout's protocol amendment.

## The honest close of the DRIVE track

C-1..C-11 closed through A2, every ticket operator-gated, most
cross-machine verified, the vehicle shipped with its landing surface,
its CI gate, its runbook, and its honest scope statement. The round's
PROVE receipts live in [RESULTS.md](../RESULTS.md): the gate table
(2258/1-fail → 2366/0), the economics ledger above, the AUGMENT deltas
(H-8/H-9 promoted + retained, H-10's honest null, H-11/H-12 canaries),
eight independent trees, and six genuine-gap classes converted into
standing seams.
