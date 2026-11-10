---
title: The doc-truth round: the maintenance pass that made every documented number true
description: The doc-truth round re-derived and corrected every drifted count, measured the Coda PWA null with a receipt, and priced the instruction-surface PR lane.
date: 2026-11-03
tags: [benchmark, verification, hardening]
type: feature
media: [/landing/coda/01-fresh-boot.png, /landing/coda/02-in-use.png]
---

A maintenance round does not ship new capabilities. It makes the old
claims true. The doc-truth round is exactly that: eight doc-drift flags
from the A1 ground truth's §7.4, the Coda round's honest "not measured"
PWA null, the landing page's first user-product band, and the
instruction-surface PR lane priced on its own three live guard events.
No new engine code — the round's output is receipts, corrected numbers,
one measured figure, and one documented lane.

## What got corrected

**Eight doc-drift flags, all retired in one sweep (T1).** Every
documented count in `docs/usage.md`, `docs/skills.md`,
`docs/subagents.md` and the dashboard screens re-derived from its live
source on the day of the fix — not just the flags observed the day
before, but re-grepped against the registry, since a flag's number can
drift further between observation and correction. The sweep found
more than the eight: the dashboard screens count (12 vs 15 in
`SCREEN_SPECS`), the built-in agent table (12 rows with a duplicate
`browser` row vs 20 builtins), the project skill count (7 vs 13 on
disk), the project agent count (4 vs 6), the session tools count
(seventeen vs twenty), and the split-view commands count (eleven vs
twelve). Every corrected figure carries a source:line derivation in
the receipt; the pin decision is receipt-only per surface (the
repo's own registered-content surfaces legitimately grow, so a count
assertion would false-positive on every legitimate add). No pin tests
landed — the four surfaces all use the repo's
receipt-only derivation pattern for the reason it applies: a
registered-content count is not a drift-pin candidate, it is a
drift-record.

## What got measured

**The Coda PWA null, flipped with a real receipted measurement (T2).**
The PT-5 plan's own contract said "benchmark: when real, receipt a PWA
installable/offline-load measurement under `benchmarks/`; otherwise
the figure stays 'not measured'." This round built the measurement
lane (`benchmarks/coda-pwa/`, a zero-model-traffic Playwright runner
that boots the app's own dev server), recorded installability as
data (manifest 200, all 4 required fields, 3/3 icons, SW controller
active via `waitForFunction`), and measured offline boot-from-cache
timing across N=5 runs: **91 ms median offline vs 175 ms median
online** — the 84 ms delta (~48% faster) is the precache's measured
effect. The figure is receipted under
`benchmarks/coda-pwa/receipts/run-2026-11-03T06-14-57-955Z/`,
re-runnable on demand via
`bun benchmarks/coda-pwa/run-pwa-bench.mjs [--runs N]`. `docs/coda.md`
and `benchmarks/RESULTS.md` now link the lane instead of stopping at
the e2e proof; the six-track landing feed contract stands — no
`TRACKS` entry, no landing figure, `check:benchmarks` green by not
needing a change. The PT-5 plan's historical "not measured" phrasing
stays as the pre-measure record; the round log's T5 closeout retires
it against the receipt.

## What got shipped

**The landing page's first user-product band (T3).** Coda is `apps/coda/`,
a self-contained static PWA, not a landing route — so the live-demo
gallery was the DISHONEST home (every gallery app iframes a landing
route; Coda can't be routed). The band is a new `CodaSection`
(`src/components/landing/coda.tsx`, aqua, `#coda`, after
`LiveDemoSection`) with its own authored data module, drift-pinned by
`__tests__/coda.test.tsx`. The media are the two stills from the
committed in-repo capture lane
(`apps/coda/scripts/capture-usage.mjs` → `public/landing/coda/`) —
the same interactions the e2e spec drives (New note → Save; Add task
via the pre-armed dialog), shot through the real UI at 1280×800
@2×, with a `PROVENANCE.md` sidecar so the capture is re-runnable and
auditable. The thirteenth scroll-budget amendment (15.5 → 16.5vh,
3,950 → 4,060 words) paid for the band's footprint; compressed first
(16.4 → 16.3vh, only visible copy — the FAQ-collapsed / dex-hidden
lessons applied), the canonical e2e twin measured 16.3vh / 4,033w,
both gate files moved together, the OG shots regenerated (canvas
assert held).

## What got priced

**The instruction-surface PR lane, on its own three live guard
events (T4).** The gate's own deny reason says "propose changes via a
PR for human review" — the PR path is the documented remediation
today, even though the mechanism it points to is not a first-class
tool. The round's three guard-class events (T2's `benchmarks/AGENTS.md`
ownership-list edit refused and operator-landed; T3's landing
AGENTS.md amendment-ledger entry refused and operator-landed; the
Coda round's `apps/coda/AGENTS.md` child DOX operator-landed) are
the evidence set. The decision doc
(`docs/instruction-pr-lane-research.md`) prices the candidates:
**NO-GO** on a new standing `git push` / `gh pr create` session
primitive (the new trust surface is not worth the small round-trip
cost the convention already carries); **GO, zero-cost and now**, on
documenting the propose-via-PR path through tools that already exist
operator-side — the operator (or a future sanctioned lane) lands the
draft from the receipt via `git branch` + `git push` + `gh pr create`
in their own shell. The gate stays FINAL in-session, byte-for-byte;
the lane is external to the session, and the operator's merge click
is the final act in both the convention and the documented lane.

The round's receipts: `.unown/receipts/t1-doc-drift.md`,
`t2-pwa-benchmark.md`, `t3-landing-capture.md`,
`t4-pr-lane.md`, and the closeout's `t5-closeout.md` — one per
ticket, mirrored operator-side at the gate.

![Coda on a fresh boot — the empty board, ready](/landing/coda/01-fresh-boot.png)
*Fresh boot: the empty board, search, and the install affordance —
captured through the real UI by the committed lane.*

![One note and one task in Coda, after the e2e interactions](/landing/coda/02-in-use.png)
*One note and one task, created through the real UI — the same
interactions the e2e spec drives.*
