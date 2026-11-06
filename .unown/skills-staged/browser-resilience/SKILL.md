---
name: browser-resilience
description: Use when a browser-lane fill or select targets a field inside an iframe and fails, lands partially, or reads back empty — the iframe race window (issue #43 class, receipted in benchmarks/rondo-round/receipts/a2h8.md). Encodes the four recover-pattern ingredients the #43 probe validated. Does NOT apply to top-page fields, timer-settle pages, or already-classified timeout errors.
staged: true
---

# Browser resilience — the iframe fill recover pattern

The loud-failure window: `navigate` returns BEFORE the frame's refs are
ready, and a fill fired into that window fails or lands partially — the
a2h8 finding (5/5 runs fail loudly on v0.0.56; the silent-loss path is
closed, the race window is not). This skill is the recover pattern for
that window and nothing else.

**SHOULD fire** when a browser lane fills/selects into a same-origin
iframe AND any of:
- the tool returned `no element for <selector>` or
  `selector matched no visible element` right after a navigate (the
  post-navigate immediate-fill window);
- a fill reported success but the read-back is empty (the pre-F3
  silent-loss signature — treat as a regression signal, not a flake);
- a later read shows SOME fields landed and others did not
  (non-atomic partial application — `city` lands, `name`/`gift` lost).

**SHOULD NOT fire** when:
- the target is a top-page field (no iframe boundary — a CSS descendant
  selector cannot cross the document boundary; on a flat page the
  selector works and there is nothing to recover);
- the page is a timer-settle class (a `#ready`-at-2000ms shape — that
  is the capped-wait class, not a race; jitter would mask a
  deterministic timing defect);
- the failure is already classified (`selector-not-found` / `timeout`
  taxonomy errors — the step's own error contract handles them).

## The recover pattern (the four ingredients, in order)

1. **Re-snapshot for fresh refs.** After any iframe-fill failure, take
   a NEW snapshot before retrying — the refs from before the navigate
   are stale in the race window; the retry must aim at fresh refs.
2. **The eval-into-contentDocument fallback.** If the frame's ref still
   does not resolve, address the field through
   `frame.contentDocument.querySelector(...)` (an eval into the frame's
   own document) instead of the cross-boundary selector — the #43
   secondary finding: a CSS descendant selector is NOT valid across the
   document boundary, the contentDocument lane is.
3. **Verify-value-landed after EVERY fill.** Never trust the fill's
   success report inside the window — read the field back
   (`inputValue()` / the equivalent) and treat an empty read-back as a
   failure, even when the tool said success.
4. **Resolve ALL fields before applying any.** The partial-application
   hazard: a multi-field form applied field-by-field can land the
   select while the input fails (a2h8 run 3). Resolve every field's
   value first, then apply the batch — an all-or-nothing application
   order.

## Boundaries

- This skill recovers the RACE WINDOW only. A defect that reproduces
  deterministically (same step, same failure, no timing variance) is a
  product defect — file it, do not paper over it with retries.
- LOCAL fixtures only in the round's lanes (the house law: no external
  URL in a spec).
