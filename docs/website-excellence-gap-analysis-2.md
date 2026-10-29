# The Website Excellence gap analysis, round 2 — what the platform could not do at the round's start, and what this round built

> The Phase 2 capability audit for the second programme round
> (conducted 2026-10-30 at `f5b3290f`): for every capability the
> mission's Website Excellence Framework requires, what the first
> round left open, what this round found and built, and what honestly
> remains. The unit of analysis is the platform a website-building
> session has access to — its tools, gates, skills, agents, memory.

Related: [website excellence gap analysis](website-excellence-gap-analysis.md) (the round-1 audit) · [website excellence research 2](website-excellence-research-2.md) (the evidence base) · [website excellence round 2 session](website-excellence-2-session.md) (the round log) · [ledger demo session](ledger-demo-session.md) (the validation app).

## The audit method

Walked the round-1 roadmap's six open items against the checkout at
`f5b3290f`, then the mission's phase list (tools, skills, agents,
workflows, benchmarks, memory, evaluation) — every claim below is
[V]-tier (verified against a file, a script, a test or a live run this
round) or explicitly marked open.

## The round-1 roadmap, closed or carried

| Round-1 open item | This round's verdict |
|---|---|
| Pixel-diff visual regression | **Carried** — still open; needs CI-runner time and a flakiness budget the round did not have |
| Motion critique lane (frame-sampling) | **Partially closed** — the critic's animated-property whitelist, reduced-motion guard and CLS gate now audit motion MECHANICALLY from the emitted CSS; per-frame scroll-capture VLM critique remains open |
| Lighthouse in CI | **Carried** — the critic's cold-load FCP/LCP/CLS/TBT (buffered PerformanceObservers, real cold loads) cover the lab-vitals lane; a Lighthouse-score budget policy remains open |
| `design-tokens.ts` | **Closed differently** — the `design-system-generator` skill encodes the token-generation procedure (stronger than a frozen module: it generates per-design-language); Ledger is its first output |
| Aesthetic-preference learning | **Carried** — the receipts accumulate; the Mem0 lane over passing critiques remains unbuilt |
| In-session critique wiring | **Closed** — the `design-reviewer` agent runs the lane from inside a session and returns the receipted verdict |

## The capability table — what round 2 added

| Capability | Before this round | After |
|---|---|---|
| Objective design measurement | Contrast, type-scale census, 4px grid, headings, alts, overflow, vitals | **+ the craft axes**: weight census (ceiling 600), tracking-vs-size curve, tinted-neutral hue spread, accent-cluster census, animated-property whitelist, breakpoint census, reduced-motion guard — each a research rule made mechanical (schema `critique/2`) |
| VLM critique | One persona, pinned to the landing's brand | **Brand-scoped personas** (`--brand`) — the judge follows the design language; the receipt records which persona scored it |
| Website skills | None (generic starter skills only) | **Six**: landing-page-architect, design-system-generator, ux-reviewer, accessibility-auditor, motion-designer, frontend-craftsman — each grounded in the research bases, each ending in its verification command |
| Specialist agents | None website-specific | **Four**: design-reviewer, ux-critic, a11y-auditor, performance-engineer — receipts-only reporting, composable with the skills |
| Release credibility | Releases could ship while CI red (F21) | **The ci-green gate**: every release job depends on CI's conclusion for the tagged SHA |
| Design knowledge | Linear/Geist/Stripe (round 1) | **+ nine sites** (Apple, Airbnb, Notion, Framer, Raycast, Resend, Anthropic, Mercury, Attio) + the 2026 motion matrix, with two honestly not-verified (Arc, OpenAI — Cloudflare-blocked) |
| Validation websites | 8 gallery apps | **+ Ledger** — the first app built UNDER the framework from its first line (PROJECT TYPE 2, the unexercised type), green through the full rubric `--enforce` on iteration three |

## What the validation app proved (the success question's evidence)

The mission's question: *"would a restart with the improved platform
produce a significantly better website?"* Ledger is the evidence:
every gate that failed its iteration 0 (132 contrast violations, 252px
overflow, a weight census tripped by sr-only `th` defaults, a chart
spike that flattened its series, a persona bug that dinged the design
language) was caught by tooling THIS ROUND BUILT — not by human review
— and fixed within two more iterations to a full-rubric `--enforce`
PASS. The receipts (v0 → iter3) are the measurable trajectory.

## The roadmap — what stays open

1. **Pixel-diff visual regression** (carried from round 1) — baselines, flakiness budget, refresh protocol; owner: a round with CI-runner time.
2. **Per-frame motion critique** — the whitelist audits motion mechanically; sampling scroll-capture frames into the VLM critique is the next lane.
3. **Lighthouse in CI** — a score budget policy on top of the vitals receipts.
4. **Aesthetic-preference memory** — a Mem0 lane seeded from passing critique receipts, so the judge learns the brand's accepted history.
5. **The agents' first in-session deployment at scale** — Ledger was built by the operator through the skills; a future round should drive a full build via the agents themselves and measure the delta.
6. **Arc and OpenAI research** — re-attempt through an unblocked fetch path; the synthesis holds a not-verified slot for each.
