/**
 * The "Built & Improved With Unown" band's receipts — the SOTA round's
 * showcase layer over the live-demo gallery. Authored data (the addons-data
 * pattern), drift-pinned by `__tests__/built-improved.test.tsx`: every
 * number cites a committed receipt, and the test re-extracts every number
 * from these strings against its own literal set, so a figure cannot drift
 * without the pin going red. A figure with no receipt prints "not measured"
 * — never a guess (the page's honesty rule).
 *
 * Sources (the SOTA round, 2026-10-28/29 — the Fugue build + the loop that
 * watched it):
 * - benchmarks/sota-round/results/snapshot-midpoint.json — the learning-lane
 *   volumes (50 dreams: 24 merged / 108 added / 112 pruned; 58 memory
 *   versions; 3 tasks minted from the 9-task ladder's mined half) and the
 *   engine's project tier at v46 with the injection budget line
 * - benchmarks/sota-round/validation-log.md — F1, the memory-lift campaign's
 *   honest null (−32% mean task duration, pass rate unchanged at 103/106
 *   both sides) and the Set-Cookie filtering diagnosis behind the round's
 *   one operator intervention
 * - docs/fugue-demo-session.md + the build repo's own receipts — the build
 *   lineage (26 sessions, ~640 tool calls, 99.5% tool success, 8 agent
 *   commits, 174 tests green)
 * - .unown/skills/test-cadence-domain/SKILL.md — the dream-minted,
 *   operator-promoted skill verified exactly (62 tests / 2,343 expects);
 *   run-fugue-verification + verify-fugue-tests were minted from the Fugue
 *   build's own session notes
 * - docs/unown-learning-report.md + docs/benchmark-improvement-report.md —
 *   the two longhand lanes the receipt links exit to
 * - The gallery's app count derives from live-demo-data.ts (never
 *   duplicated here) — the gallery is the single source for what was built.
 */

/** One loop receipt: the key line (the figure) and the body that proves it. */
export interface LoopReceipt {
  id: string;
  /** The headline figure — receipt-backed, never rounded. */
  figure: string;
  /** The one-line body naming the mechanism and its receipt context. */
  body: string;
}

export const LOOP_RECEIPTS: LoopReceipt[] = [
  {
    id: "skills",
    figure: "3 skills minted → verified → promoted",
    body: "test-cadence-domain (62 tests / 2,343 expects verified exactly), run-fugue-verification and verify-fugue-tests (minted from the Fugue build's own session notes, claims operator-verified, promoted through the staged-skills human gate)",
  },
  {
    id: "memory",
    figure: "Project memory v46",
    body: "58 memory versions this round; the build repo carries its own project tier from 8 session notes",
  },
  {
    id: "dreams",
    figure: "50 dreams consolidated",
    body: "24 entries merged, 108 added, 112 pruned — AutoDream ran while the agent worked",
  },
  {
    id: "tasks",
    figure: "3 tasks minted, 3 discarded by the solvability gate",
    body: "the gate held against unsolvable mined patterns — a discarded mint is the gate working",
  },
  {
    id: "nulls",
    figure: "Honest nulls kept",
    body: "the memory-lift campaign measured prompt-discipline rules buying −32% task duration and ZERO pass-rate lift (103/106 both sides); the null is published, not buried",
  },
  {
    id: "build",
    figure: "26 sessions · ~640 tool calls · 99.5% tool success",
    body: "the Fugue build itself (8 agent commits, 174 tests green, 1 operator intervention — a Set-Cookie filtering diagnosis)",
  },
];

/** The SOTA round's Mission Control stills (public/landing/tui/sota-round/
 *  stills/ — the round's own captures; the media lane never regenerates
 *  for a new consumer). Declared dims are the PNGs' real IHDR (1792×1042). */
export const MISSION_CONTROL_STILLS: { src: string; alt: string; caption: string }[] = [
  {
    src: "/landing/tui/sota-round/stills/01-skills.png",
    alt: "unown dashboard — Skills: the round's three minted skills shipped, test-cadence-domain promoted alongside the two minted from the Fugue build's own notes",
    caption: "Mission Control — Skills",
  },
  {
    src: "/landing/tui/sota-round/stills/02-memory.png",
    alt: "unown dashboard — Memory: the tier stack at project v46 with the injection budget line",
    caption: "Mission Control — Memory",
  },
  {
    src: "/landing/tui/sota-round/stills/03-dreams.png",
    alt: "unown dashboard — Dreams: the AutoDream screen mid-round with pending notes",
    caption: "Mission Control — Dreams",
  },
  {
    src: "/landing/tui/sota-round/stills/04-overview.png",
    alt: "unown dashboard — Overview: the loop state with the suite saturated at 6/6 and the cumulative pass chart",
    caption: "Mission Control — Overview",
  },
];

/** The round's three receipt exits — committed docs, absolute links. */
export const RECEIPT_LINKS: { label: string; href: string }[] = [
  { label: "the learning report", href: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/unown-learning-report.md" },
  { label: "the benchmark report", href: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/benchmark-improvement-report.md" },
  { label: "the validation log", href: "https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/sota-round/validation-log.md" },
];
