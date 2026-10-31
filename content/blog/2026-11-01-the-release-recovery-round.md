---
title: "The release that never was: re-cutting v0.0.53 from a red tag"
description: "The tag shipped while CI was red on all three OSes, so the release never published. The story of the one-way latch that caused it — and the fix."
date: 2026-11-01
lastmod: 2026-11-01
tags: [release, verification, testing]
type: release
media: [/blog/2026-10-31-the-todo-unification-round/04-plan-executing-one-list.png, /blog/2026-10-31-the-todo-unification-round/06-settled.png]
---

The changelog said v0.0.53 was out. The GitHub releases page said otherwise:
**latest was still v0.0.52.** No assets, no feed entry, no installs — the tag
existed, pointed at the release commit, and nothing had shipped. This is the
story of how a release can silently fail, what the red CI was actually saying,
and the one-line architectural assumption that connected a flaky test to a
real production defect.

## What the release workflow did right

The repo's release pipeline has a rule we wrote ourselves: **a tag on a red
SHA can never release.** The `ci-green` job resolves the CI run for the
tagged commit and polls it; if CI did not conclude `success`, every
downstream job — the 3-OS verify matrix, the artifact build, the SBOM, the
binary smoke legs, publish, feed verification, installer smoke — is skipped.

That gate fired. The tag went up while CI on the same SHA was failing, and
the gate quietly refused to ship a broken release. The failure mode we
designed for on paper worked exactly as intended; what we had missed was on
the human side — nobody watched the workflow after pushing the tag, so the
release sat unpublished for a day. The lesson that landed: **the cut is not
`git tag && git push`. The cut is watching the workflow finish.**

## The red CI, decoded

The failing job was `Build + test` — the same failure on ubuntu, macOS and
Windows, which is always a hint: not a platform flake, but something
deterministic that only shows up in the full-suite file order.

The failing test was one we had just written: the todo unification round's
own M1 fallback pin —

> *with the todo addon disabled, the legacy plan-steps widget is the
> execution surface* — `expect(legacy.length).toBeGreaterThanOrEqual(1)`
> → **Received: 0.**

Ten of the file's eleven tests passed. The file, run alone, passed 11/11. Run
after `goal.test.ts`, it failed. That is the whole diagnosis in one sentence:

**`bun test` runs every file in one process, and module state survives
between files.** `goal.test.ts` (earlier in the enumeration) calls
`registerTodoAddon`, which sets module-level bridges — functions in module
scope that nothing ever resets. By the time the unification file's fallback
test ran, `isTodoOverlayAvailable()` answered `true` for an addon that test
never registered. The legacy widget — the exact thing under test — never
mounted.

The round's local verification had passed the same suite because bun's file
order varies by platform and runner (a fact our own `test/_env.ts` documents
after three prior CI incidents). The local order was friendly. CI's was not,
on any of the three OSes. A test that passes alone and fails in the suite is
not a flaky test; it is an **order-dependent test**, and order-dependence is
always a shared-state leak wearing a disguise.

## The same bug, in production

Here is why the failing test deserved to fail. The one-way latch it tripped
over is not just a test-infrastructure annoyance — the same mechanism had a
production shape:

- `/reload` re-runs every extension factory **in the same process**.
- The `/addons` toggle for the todo addon says *"disable (until /reload)"*.
- Disable it, reload, and the module-level bridges set by the previous
  factory cycle are still there. `isTodoOverlayAvailable()` still answers
  `true` — for an overlay that can never mount again, because the addon that
  owns it is no longer registered.
- tools.ts, believing the overlay is live, keeps the legacy plan-steps
  fallback retired.

Result: **no progress surface at all** until a full process restart. The
test was asserting the right contract (the fallback must exist when the
addon is off) through the wrong lens (it assumed a pristine process). The
one-way latch was correct only under an assumption the architecture doesn't
make: *a process registers exactly once.*

## The fix: a contract, not a latch

The repair is small because the diagnosis was exact — the best trades are
always like that:

- **`resetTodoAddonBridges()`** restores the five todo-owned module bridges
  to their unregistered defaults. The tools-owned pair (the plan-sync reader
  and the completed listener) is deliberately untouched: the tools extension
  registers before the addons extension in every cycle and re-arms its own.
- The addons extension's factory calls the reset **at the top of every
  (re)registration cycle**. Boot and `/reload` both converge to the same
  invariant: *bridge state mirrors the current `addons.json`.* Enabled
  cycles re-register immediately, so the reset is invisible to them.
- The unification test file now starts every test from the unregistered
  state — order-proof by construction — and a new **RELOAD pin** drives two
  real factory cycles (enabled → disabled) through the actual addons
  extension, then approves a plan and asserts the legacy widget returns. Run
  against the unfixed source, that pin fails; against the fixed source, both
  file orders pass.

![The seeded Todos overlay at execution — the one checklist above the editor](/blog/2026-10-31-the-todo-unification-round/04-plan-executing-one-list.png)

## Verified like a real user, again

Because the fix touches the boot-time wiring, the round re-ran the whole
verification matrix, not just the unit that changed:

- the full self-learning suite **5326/0** in the exact local order that had
  reproduced the failure (a stricter order than any CI leg);
- integration 13/0, bridge 248/0, e2e 15/15, the landing gates, the
  production build, the artifact-builder suites;
- the **real-user PTY lanes against the live model**: the todo unification
  lane's 14 checks (planning suspension, single checklist at approval, the
  session-file lockstep — one seed entry, ids restarting at 1, final
  todo/plan agreement) and the footer lane's 9 — both green on the repaired
  tree.

![Settled: one list, every step accounted for](/blog/2026-10-31-the-todo-unification-round/06-settled.png)

## The re-cut

With main green, the tag moved. Moving a tag is normally taboo — but this
one had never been a release: no release object, no assets, no feed entry,
no install ever referenced it. The alternative was cutting v0.0.54 and
leaving the changelog documenting a v0.0.53 that never existed. The honest
option was the tag move, a corrected release date in the changelog, and this
record.

The 0.0.54 queue is already written down — the settings ledger's spend
meter and memory-health card, each with a benchmark waiting to flip. But
that is the next round's story. This one ends the way every release should:
watched, green, and actually published.
