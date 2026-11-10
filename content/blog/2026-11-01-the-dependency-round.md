---
title: Six updates, one pixel diff: shipping a dependency round you can trust
description: How Unown updates packages without regressions: staged gates, an A/B pixel diff of the landing page, and the word budget the changelog almost broke.
date: 2026-11-01
lastmod: 2026-11-01
tags: [release, dependencies, verification]
type: release
media: []
---

v0.0.54 is a maintenance release: six package updates, nothing new on the
screen. That is exactly why it deserves a post — "safely update everything,
prove nothing regressed" is the kind of task that sounds boring and quietly
isn't, because the two honest ways to fail it are *not updating anything*
(drift) and *updating everything at once* (an unattributable breakage). This
round did neither. Here is the shape of it.

## The policy did the first half of the work

Unown's update rules were already written down, so the round started from
constraints instead of vibes: **no semver-major bumps** (humans opt into
majors), **exact pins move as deliberate exact bumps**, **the playwright
trio moves in lockstep**, and the vendored `pi-repo/` workspace is an
upstream-sync decision — frozen, not a routine bump surface.

A sweep of all 28 root packages against the registry found the truth
Dependabot-style updates hide: **only six updates existed within policy.**
next 16.4.2 → 16.4.3 and eslint-config-next → 16.4.3 (LTS backports),
marked 18.1.1 → 18.1.2 (CommonMark fixes), then three exact-pin bumps —
eslint 10.13.0 → 10.14.0, lucide-react 1.61.0 → 1.66.0, framer-motion
14.6.0 → 14.9.0. Everything else is at latest. The only major available
anywhere is TypeScript 7, the native port — parked, by policy, for a human
with a spare afternoon.

## Every stage got its own gate

The updates landed in four stages, and after *each* one: typecheck, lint,
the 2063-test unit suite, a production build, the 15-test e2e lane, and a
`bun audit --prod` pass. A regression that appears after stage four is a
regression you can name. The engine suite (5326 tests) and the bridge suite
(243) never re-ran against the updates — not out of laziness, but because
the round touches no `pi-repo/` manifest or lockfile: their dependency
graph *cannot* move. Knowing what a change cannot affect is half of
verification.

Mark got the sharpest gate: it renders every blog post, so the blog data was
regenerated under it — **byte-identical**, all 37 posts and the feed.

## The part you can't unit test: motion

framer-motion 14.6 → 14.9 is the one update that changes what the page
*does*, not just what it links against — 14.7 moved background-color
animations to the main thread and touched `AnimatePresence` positioning, and
the landing page's reveals ride exactly those APIs. No unit test sees that.
So the round took the only measurement that can:

1. The landing page's own screenshot lane shot all 22 sections — both colour
   schemes, plus the `prefers-reduced-motion` lane — against the production
   build. Twice on the new tree (a noise floor), once on the old tree
   (rebuilt from the pre-round lockfile).
2. A per-pixel diff compared the passes.

The result: **the reduced-motion lane is pixel-identical between the old and
new dependency trees — three shots, zero differing pixels.** 21 of 25 full
shots identical; the four differing frames differ only in the live
star-count and animated-terminal regions that a same-build double-pass had
already shown to be dynamic content. Settled rendering did not move.

One honesty note worth keeping: a VLM design reviewer — our own Agnes lane —
had been briefed to hunt for motion regressions and confidently reported
several, including "half-finished reveals" *in the reduced-motion frames,
where nothing animates at all*. Pixels beat opinions. Brief your reviewers
neutrally, then measure.

## The catch that never left the machine

The round's one real regression almost shipped — and it wasn't a dependency.
Folding the changelog for release regenerated the landing rail, and the new
release stop's chrome pushed the page to 3,930 words against a 3,920-word
scroll budget. The e2e budget gate caught it locally, before the release
commit left the machine. The fix followed the landing contract's precedent
— and taught it something new: the sanctioned first move (compressing the
round's own listed changelog title) turned out to be a page-level no-op,
because the rail only prints titles for Added and Behavior entries, and
this round's entries were all Changed and Fixed. The stop costs its chrome
and nothing else — so the twelfth ceiling amendment (3,920 → 3,950) carries
exactly that, plus one stop of headroom, documented in all three places the
budget lives. The breach never reached CI, let alone the deploy.

## Receipts

The full record — what moved, what stayed and why, every gate, the A/B
numbers — lives in [the research
record](https://github.com/kanishka-namdeo/Unown/blob/main/docs/dependency-round-research.md)
and [the session
log](https://github.com/kanishka-namdeo/Unown/blob/main/docs/dependency-round-session.md);
the release stop is in the [changelog](https://github.com/kanishka-namdeo/Unown/blob/main/CHANGELOG.md).
The next round is already queued — the settings ledger's spend meter and
memory-health card, each with a waiting benchmark to flip. But this one ends
the way a maintenance release should: nothing on the screen changed, and we
can prove it to the pixel.
