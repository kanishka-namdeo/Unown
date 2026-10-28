---
title: "The SOTA round: Fugue, and the loop that watched it build"
description: "The fifth gallery app, built by unown while the loop minted skills, dreamed, and published an honest null — the receipts behind the showcase band."
date: 2026-10-29
lastmod: 2026-10-29
tags: [landing, learning]
type: feature
media: [/landing/fugue/poster.png, /landing/tui/sota-round/stills/01-skills.png, /landing/tui/sota-round/stills/02-memory.png]
---

The mission was blunt: use one ambitious real build to prove the learning
loop works — not that the model is smart, but that the *agent got better at
working* while doing meaningful work. The round picked an AI
workflow-automation platform, named it Fugue (a fugue: independent voices
interwoven into one composition — the shape of a flow of steps, and of a
build watched by a loop), and pointed unown at it headless through the
Agnes endpoint.

## What was built

Fugue is the [live-demo gallery](https://unown-nine.vercel.app/#live-demo)'s
fifth app: workspaces hold **flows**, flows compose **steps** — transform,
classify, enrich, branch, notify, each a deterministic simulated-inference
processor — and running a flow produces a **run** with a per-attempt
timeline (bounded snapshots, durations, branch redirects). Scrypt session
auth with httpOnly cookies, a fourteen-route JSON API with field-addressed
validation, the flows/runs/stats dashboard, and the production review's
eight must-fixes — a corrupt-digest scrypt guard, store shape validation,
read-path retention — all landed. **26 agent sessions, ~640 tool calls,
99.5% tool success, 174 tests green, eight build-repo commits, zero human
edits to the app's code.** The full receipt is
[the Fugue session record](https://github.com/kanishka-namdeo/Unown/blob/main/docs/fugue-demo-session.md).

## What the loop did while the agent worked

This is the part the round exists for, and every figure has a receipt:

- **Skills, minted → verified → promoted.** A smoke session's
  `run:finished` fired dream-check; the dream minted
  `test-cadence-domain` (how to verify the cadence domain). We checked its
  claims — 62 tests, 2,343 expects, exactly as the skill said — and promoted
  it through the staged-skills human gate. Then, unprompted, the loop
  minted two more from the Fugue build's *own session notes*
  (`run-fugue-verification`, `verify-fugue-tests`): the agent's actual
  verify-then-typecheck procedure, distilled for its future sessions.
- **Memory and dreams.** The build repo carries its own project tier; the
  engine consolidated 50 dreams this round (108 entries added, 112 pruned)
  while project memory climbed to v46.
- **Task minting, honestly gated.** Three tasks minted from live runs —
  and three discarded by the solvability gate. A discarded mint is the
  gate working: unsolvable patterns never burn agent runs.
- **A null, published.** The round's matched-model experiment — four
  editing-discipline rules appended to the edit-bench system prompt,
  authored from the baseline's three measured structural-swap failures —
  **did not lift the pass rate**. 103/106 both sides. What moved: mean
  task duration fell 32% (verify-then-stop early-exits), tokens rose 50%.
  The same conclusion the self-improve round published from a different
  axis: *memory buys efficiency, not correctness*. The receipts are
  committed, and the null is the finding.

## The failures ledger

The round kept a validation log with a rule borrowed from the Claude Code
postmortem loop: never patch around a failure — root-cause it, decide where
the defect lives, fix it there, rerun, keep the evidence. Four entries
closed the round: the print-mode "hang" that was never ours (the caller's
harness pipe, proven by process genealogy); the teardown kills that taught
the intermediate-exit launch pattern; the null above; and the best one —
**the embed contract that was silently dead in production**, caught because
two responses came back byte-identical, root-caused through three layers (a
sync `searchParams` read in a Promise world, a zombie next-server serving
a deleted build behind every false test, and a prerender analysis that
needed `force-dynamic`), fixed, and verified live on a verified-fresh
server. "Verify the server process, not just the port" is now written down
where the next session will find it.

## The showcase

The landing's **"Built & Improved With Unown"** band carries all of this —
the loop tally, four live Mission Control stills, and the two before/after
improvement receipts (the first shipped memory patch: a measured edit-bench
failure → a minted task → a harness patch verified twice → shipped to
project memory; and the forced-exit envelope contract, pinned by four
tests). The gallery shows what the agent built, running live. The band
shows what changed *while it built*. The three longhand reports —
[the learning report](https://github.com/kanishka-namdeo/Unown/blob/main/docs/unown-learning-report.md),
[the benchmark report](https://github.com/kanishka-namdeo/Unown/blob/main/docs/benchmark-improvement-report.md),
and [the competitor comparison](https://github.com/kanishka-namdeo/Unown/blob/main/docs/competitor-comparison-report.md)
— hold the full accounting.

## What ships next

The honest gaps: the harness still ships zero memory patches *of its own*
this round (every cycle answered already-passing against the seeded suite —
the loop only earns its keep where the model struggles), and the fugue
app's run-to-run variance at n=1 is unmeasured where the honest read needs
n≥2. The next round inherits both, plus a benchmark framework that makes
"prove it" the default posture: snapshots before you build, receipts
before you claim, nulls before you celebrate.
