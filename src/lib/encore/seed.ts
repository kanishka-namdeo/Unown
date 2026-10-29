/**
 * Encore seed constants — every value is receipt-derived (plan §1.3).
 *
 * Each constant carries a `/** @provenance <file> *​/` comment naming the
 * receipt or ledger it derives from. `seed.test.ts` (THE DRIFT GATE) reads
 * the ACTUAL committed JSONs at test time and asserts every constant equals
 * its source field-by-field — a receipt edited under the seed fails the
 * suite, not the honesty.
 *
 * **Append cleanly** (plan risk #10): `ENCORE_ITERATIONS` is an explicit
 * chronological array. A new receipt = one appended constant + one appended
 * test. No re-sort, no re-count of the baseline.
 *
 * No wall-clock reads, no RNG — static constants only (the fugue pin,
 * enforced by `invariant.test.ts`).
 */

import type {
  EncoreAxisMap,
  EncoreGate,
  EncoreGateMap,
  FailureEntry,
  Iteration,
  TimelineEvent,
  ToolCard,
} from "./types";

/* ── helper: build an EncoreGate from parts ─────────────────────── */

function gate(
  value: number | EncoreAxisMap,
  pass: boolean,
  extra?: { max?: number; floor?: number; failures?: string[] },
): EncoreGate {
  return { value, pass, ...extra };
}

/* ── the two receipts' gate maps (typed) ─────────────────────────── */

/**
 * @provenance benchmarks/website-excellence-round/critiques/20261029-145746-baseline-root.json
 */
const BASELINE_AXES: EncoreAxisMap = {
  hierarchy: 6.5,
  typography: 6.79,
  spacing: 6.08,
  color: 7.25,
  alignment: 7.19,
  density: 6.71,
  overall: 6.4,
};

/**
 * @provenance benchmarks/website-excellence-round/critiques/20261029-145746-baseline-root.json
 */
const BASELINE_GATES: EncoreGateMap = {
  contrastViolations: gate(0, true, { max: 0 }),
  fontSizes: gate(23, false, { max: 8 }),
  offGridPct: gate(32.7, false, { max: 15 }),
  headingSkips: gate(0, true, { max: 0 }),
  missingAlts: gate(0, true, { max: 0 }),
  mobileOverflow: gate(0, true, { max: 0 }),
  fcpMs: gate(276, true, { max: 1800 }),
  lcpMs: gate(276, true, { max: 2500 }),
  cls: gate(0, true, { max: 0.1 }),
  tbtMs: gate(61, true, { max: 200 }),
  vlmAxes: gate(BASELINE_AXES, false, {
    floor: 7,
    failures: [
      "hierarchy 6.5<7",
      "typography 6.79<7",
      "spacing 6.08<7",
      "density 6.71<7",
      "overall 6.4<7",
    ],
  }),
};

/**
 * @provenance benchmarks/website-excellence-round/critiques/20261029-145834-calib-bad-root.json
 */
const CALIB_BAD_AXES: EncoreAxisMap = {
  hierarchy: 1.5,
  typography: 2,
  spacing: 2,
  color: 1,
  alignment: 2.5,
  density: 2.5,
  overall: 1.5,
};

/**
 * @provenance benchmarks/website-excellence-round/critiques/20261029-145834-calib-bad-root.json
 */
const CALIB_BAD_GATES: EncoreGateMap = {
  contrastViolations: gate(26, false, { max: 0 }),
  fontSizes: gate(10, false, { max: 8 }),
  offGridPct: gate(100, false, { max: 15 }),
  headingSkips: gate(1, false, { max: 0 }),
  missingAlts: gate(2, false, { max: 0 }),
  mobileOverflow: gate(0, true, { max: 0 }),
  fcpMs: gate(0, true, { max: 1800 }),
  lcpMs: gate(68, true, { max: 2500 }),
  cls: gate(0, true, { max: 0.1 }),
  tbtMs: gate(0, true, { max: 200 }),
  vlmAxes: gate(CALIB_BAD_AXES, false, {
    floor: 7,
    failures: [
      "hierarchy 1.5<7",
      "typography 2<7",
      "spacing 2<7",
      "color 1<7",
      "alignment 2.5<7",
      "density 2.5<7",
      "overall 1.5<7",
    ],
  }),
};

/* ── BASELINE_ITERATION ────────────────────────────────────────────── */

/**
 * @provenance benchmarks/website-excellence-round/critiques/20261029-145746-baseline-root.json
 *
 * The landing page at commit 89535c6. Overall 6.40, verdict FAIL.
 * Gates: fontSizes (23 > 8) and offGridPct (32.7 > 15) fail; the other
 * nine gates pass (including vlmAxes, which fails at floor 7 — 5 of 7
 * axes are under the floor).
 */
export const BASELINE_ITERATION: Iteration = {
  label: "baseline",
  timestamp: "2026-10-29T14:57:46.173Z",
  receiptPath: "benchmarks/website-excellence-round/critiques/20261029-145746-baseline-root.json",
  overall: 6.4,
  axes: BASELINE_AXES,
  gates: BASELINE_GATES,
  passed: false,
};

/* ── CALIB_BAD_ITERATION ───────────────────────────────────────────── */

/**
 * @provenance benchmarks/website-excellence-round/critiques/20261029-145834-calib-bad-root.json
 *
 * The critic's calibration fixture (a deliberately broken page).
 * Overall 1.5 — the critic discriminates: it does not rubber-stamp.
 */
export const CALIB_BAD_ITERATION: Iteration = {
  label: "calib-bad",
  timestamp: "2026-10-29T14:58:34.725Z",
  receiptPath: "benchmarks/website-excellence-round/critiques/20261029-145834-calib-bad-root.json",
  overall: 1.5,
  axes: CALIB_BAD_AXES,
  gates: CALIB_BAD_GATES,
  passed: false,
};

/* ── DISCRIMINATION ────────────────────────────────────────────────── */

/**
 * @provenance derived from both receipts above.
 * The critic scores the known-bad fixture 1.5 vs the real page 6.4 —
 * a 4.9-point separation proves it discriminates, it does not rubber-stamp.
 */
export const DISCRIMINATION: {
  calibBad: number;
  baseline: number;
  separation: number;
} = {
  calibBad: 1.5,
  baseline: 6.4,
  separation: 4.9,
};

/* ── ENCORE_ITERATIONS (chronological — iterations APPEND) ───────── */

/**
 * @provenance both receipts above.
 *
 * Chronological array — a new receipt = one appended entry here + one
 * appended seed.test.ts test. No re-sort, no re-count of the baseline.
 * The calibration fixture is NOT a landing-page iteration (different url,
 * different purpose); it lives in DISCRIMINATION, not in this array.
 */
export const ENCORE_ITERATIONS: Iteration[] = [
  BASELINE_ITERATION, // iteration 0 — the baseline
  // future receipts append here:
  // ITER1, ITER2, …
];

/* ── F_LEDGER ──────────────────────────────────────────────────────── */

/**
 * @provenance benchmarks/nocturne-round/validation-log.md — entries F10, F11.
 *
 * F10: page.tsx + route.ts at the same segment → build broken, deploy stale.
 *      Fixed at 3c4cf87. Pre-push checklist adopted.
 * F11: four lint errors shipped (the closeout skipped `bun run lint`).
 *      Fixed at 89535c6. Lint now in the checklist.
 *
 * This round's later failures APPEND to the array (the UI renders it;
 * a new entry is a data add, not a code change).
 */
export const F_LEDGER: FailureEntry[] = [
  {
    code: "F10",
    what: "Landing page.tsx + route.ts shipped at the same segment — main un-buildable, CI red, Vercel deploy failed, production stale.",
    outcome:
      "JSON twin moved to /nocturne/api/public-status/[slug]/route.ts; build green; pre-push checklist (typecheck + lint + test:unit + build) adopted.",
    fixRef: "docs/website-excellence-session.md CP0 — commit 3c4cf87",
  },
  {
    code: "F11",
    what: "Four lint errors shipped to main — the nocturne round's closeout skipped `bun run lint` before pushing.",
    outcome:
      "openIncident hoisted above reopen; two require() calls lifted to top-level import; lint gate added to the pre-push checklist.",
    fixRef: "docs/website-excellence-session.md CP0 — commit 89535c6",
  },
  // future round failures append here
];

/* ── TOOL_CARDS ────────────────────────────────────────────────────── */

/**
 * @provenance benchmarks/website-excellence-round/README.md (The method + The critic calibration)
 *
 * Two tools built this round: the design critic (scripts/design_critic.mjs)
 * and the calibration fixture (scripts/design_critic_calibration.html).
 */
export const TOOL_CARDS: ToolCard[] = [
  {
    id: "design-critic",
    name: "design_critic.mjs",
    role: "The critique loop: build → capture → audit → VLM critique → receipt. Every number on this page traces to a run of this script.",
    receipt: "benchmarks/website-excellence-round/README.md",
    headline: "6.40 baseline, verdict FAIL — 23 font sizes > 8, 32.7% off-grid > 15",
    evidence: [],
  },
  {
    id: "calibration-fixture",
    name: "design_critic_calibration.html",
    role: "Known-bad fixture proving the critic discriminates: 11 ad-hoc type sizes, arbitrary odd spacing, sub-AA greys, an h1→h4 skip, an alt-less image.",
    receipt: "benchmarks/website-excellence-round/critiques/20261029-145834-calib-bad-root.json",
    headline: "1.5 vs 6.4 = 4.9-pt discrimination",
    evidence: [
      { label: "overall", before: 1.5, after: 6.4 },
      { label: "hierarchy", before: 1.5, after: 6.5 },
      { label: "typography", before: 2, after: 6.79 },
      { label: "spacing", before: 2, after: 6.08 },
      { label: "color", before: 1, after: 7.25 },
      { label: "alignment", before: 2.5, after: 7.19 },
      { label: "density", before: 2.5, after: 6.71 },
    ],
  },
];

/* ── TIMELINE ──────────────────────────────────────────────────────── */

/**
 * @provenance docs/website-excellence-session.md (the six checkpoints CP0–CP5)
 *
 * Explicit seq — the array is NOT sorted at runtime.
 */
export const TIMELINE: TimelineEvent[] = [
  {
    seq: 0,
    beat: "CP0",
    title: "Setup, the baseline, and two P0s",
    detail:
      "Clone at 6d043c5; engine v0.0.40 at 89535c6; F10 (route/page conflict) and F11 (four lint errors) found and fixed; pre-push checklist adopted.",
    receipt: "benchmarks/website-excellence-round/critiques/20261029-145746-baseline-root.json",
  },
  {
    seq: 1,
    beat: "CP1",
    title: "The research knowledge base",
    detail:
      "Competition CSS/markup extracted from Linear, Vercel/Geist, Stripe + the 2025–26 meta-studies (Evil Martians, NN/g, WCAG 2.2 AA, Carbon 2× grid). Every token table cites its source URL.",
    receipt: "docs/website-excellence-research.md",
  },
  {
    seq: 2,
    beat: "CP2",
    title: "The critique loop",
    detail:
      "scripts/design_critic.mjs: build → screenshot → objective audit → VLM critique → receipt. A run without a receipt never counts.",
    receipt: "benchmarks/website-excellence-round/README.md",
  },
  {
    seq: 3,
    beat: "CP3",
    title: "The flagship showcase — this app",
    detail:
      "Encore: the round's own measured story as an elite-grade interactive experience. Built by Unown sessions phase by phase (plan → lib → UI → embed/landing), zero human edits.",
  },
  {
    seq: 4,
    beat: "CP4",
    title: "Failures → learning ledger; critic calibrated",
    detail:
      "The F-ledger entries land; the calibration fixture proves the critic discriminates (4.9-pt separation), it does not rubber-stamp.",
    receipt: "benchmarks/website-excellence-round/critiques/20261029-145834-calib-bad-root.json",
  },
  {
    seq: 5,
    beat: "CP5",
    title: "Landing entry #8, DOX pass, scroll-budget reconciliation",
    detail:
      "The eighth gallery entry, the Built & Improved refresh, the blog post, the CHANGELOG entry, the release.",
  },
];

/* ── types re-export (convenience for seed consumers) ───────────── */

export type { EncoreGate, EncoreGateMap };
export { ENCORE_GATE_KEYS } from "./types";
