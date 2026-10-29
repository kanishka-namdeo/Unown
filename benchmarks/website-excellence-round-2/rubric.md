# The rubric — thresholds and why each is what it is

> The Website Excellence program's scoring contract: every threshold, its
> citation, and its failure mode. The machine-readable twin lives in
> `scripts/design_critic.mjs` (`RUBRIC`) — the two must move in the same
> change (the four-place-contract house rule, applied at the scale of one
> script and one doc). The round-2 extension (the craft axes) is cited from
> [`../../docs/website-excellence-research-2.md`](../../docs/website-excellence-research-2.md).

Related: [`../website-excellence-round/README.md`](../website-excellence-round/README.md)
(the round-1 method) ·
[`../../docs/website-excellence-research.md`](../../docs/website-excellence-research.md) ·
[`../../docs/website-excellence-research-2.md`](../../docs/website-excellence-research-2.md)
(the two evidence bases) · [`../../docs/landing-effects-research.md`](../../docs/landing-effects-research.md)
(the page's own motion contracts).

## The law (zero-tolerance gates)

| Gate | Threshold | Citation | Failure mode it prevents |
|---|---|---|---|
| WCAG contrast violations | 0 | WCAG 2.2 SC 1.4.3 (4.5:1 text, 3:1 large text ≥24px / ≥18.66px bold) + SC 1.4.11 (3:1 non-text) | `faint` shipped at 3.16:1 for a while — measured, not eyeballed |
| Heading skips | 0 | WCAG 2.4.10 + the document-order contract | an h3 that appears without its h2 breaks the outline screen readers walk |
| Missing image alts | 0 | WCAG 1.1.1 | decorative ≠ silent; the audit counts visible images with no alt attribute |
| Mobile horizontal overflow | 0px | the 390px covenant (the landing's own mobile contract) | one 401px element breaks every scroll gesture on the page |

## The budgets (research-calibrated gates)

| Gate | Threshold | Citation | Rationale |
|---|---|---|---|
| Distinct font sizes | ≤ 8 | Linear's production CSS ships ~7 text steps (tiny 10 / micro 12 / mini 13 / small 14 / regular 15 / large 17) + the title ramp as display sizes; Geist's label ramp is 12–20 | beyond ~8 resolved sizes the page stops having a scale and starts having leftovers; the fixture's deliberate chaos used 10 |
| Spacing off the 4px grid | ≤ 15% | Carbon 2× grid (2/4/8/12/16/24/32/40/48/64/96/160) | the baseline measures 32.7% — the 15% floor is tight enough to force a system, loose enough to admit optical corrections (icon nudges, line-height crops) which are legitimate craft |
| FCP | ≤ 1800ms | Core Web Vitals "good" is ≤1.8s (lab proxy) | localhost-cold-load gate against regressions, not field truth |
| LCP | ≤ 2500ms | CWV "good" ≤2.5s | the research doc's perf-gate table |
| CLS | ≤ 0.1 | CWV "good" ≤0.1 | next/font's automatic fallback adjustment exists to keep this at 0 |
| TBT | ≤ 200ms | CWV "good" ≤200ms | marketing pages ship near-zero client JS; the gate catches a stray client component |

## The floor (the VLM gates)

| Gate | Threshold | Rationale |
|---|---|---|
| VLM axis means — hierarchy, typography, spacing, color, alignment, density, overall | ≥ 7.0 each | 7/10 is "a senior designer signs off without rework"; the baseline page sits at 6.08–7.25 across axes. The floor is calibrated: a known-bad fixture scores 1.0–2.5 (see [`README.md`](README.md#the-critic-calibration)) — the axis has 8+ points of discriminating range, and 7 sits where elite-craft pages land |

## The craft budgets (round 2 — the nine-site sweep's enforceable rules)

| Gate | Threshold | Citation | Rationale |
|---|---|---|---|
| Max font weight | ≤ 600 | Attio's rendered census: 313 medium vs 1 bold; Apple (400/500/600 despite 9 served weights), Framer (400/500), Airbnb (400/500/600) | bold is the amateur's emphasis; elite emphasis is size + weight 600 |
| Distinct weights | ≤ 4 | Apple 3, Framer 2, Airbnb 3, Notion 4 | a closed set is a system; an open set is leftovers |
| Off-curve tracking combos | ≤ 3 (distinct size+tracking pairs) | Apple's per-size optical tuning (−.005em@56px, 0@32-40px, +.012em@19-28px); Notion's fluid clamp (−.048em@96px) | display tightens as it grows; body sits near zero; labels may track wide (Raycast +.1-.3px, the GBA pixel labels .14-.18em) — the census counts DESIGN DECISIONS, not text nodes |
| Tinted-neutral hue spread | ≤ 30° circular stddev | Anthropic's ivory ramp (every gray shares the paper's hue, 2.7° measured on Unown's own landing); Airbnb's beige ramp | grays pulled toward two hues read as two designs stitched together |
| Accent hue clusters | ≤ 2 (interactive elements) | Apple #0071e3, Raycast #ff6363, Framer #0099FF, Anthropic clay — one accent + one interactive variant everywhere | color is clickable; a third accent family is a committee |
| Animated layout properties | 0 | Vercel's Web Interface Guidelines ("Never transition: all"), web.dev compositing law | transform/opacity/paint only; `translate`/`scale`/`rotate` are Tailwind v4 compositing, `display`/`overlay`/`pointer-events` are discrete steps, `height` is the radix-accordion exception |
| Breakpoint census | ≤ 8 | Framer 2, Apple 3, Airbnb 5, Notion 6 (+ framework overhead) | every breakpoint is a layout to test and maintain |
| Reduced-motion guard | required wherever keyframes exist | WCAG 2.3.3 + Stripe's opt-in pattern | motion without an escape hatch excludes vestibular users |

A page passes the rubric only when every gate passes. The receipt records
per-gate values and failures; `--enforce` turns a fail into exit 1 so the
loop can gate CI or a session's checkpoint.

## Scoring protocol notes

- Axis means are computed across ALL shots (both devices, full-page + bands)
  — a page that photographs well full-page but breaks per-band cannot average
  its way out.
- The VLM prompt pins the persona (senior product designer, elite-studio
  standards), the brand context (Unown: hand-drawn glyphs, warm paper/ink/gold,
  Game-Boy-inspired, dark-first), and the output grammar (strict JSON, defects
  visually grounded with a where, improvements ≤15 words). Output that fails
  JSON parse gets exactly one sterner retry — then the shot records an error,
  never a fabricated score.
- Defects are tallied per-run (the four-pass loop's defect-tally step) and the
  recurring themes traced to source files — the tally is in the receipt, the
  trace in the session log.
