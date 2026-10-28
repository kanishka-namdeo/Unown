/**
 * The "Built & Improved With Unown" band's receipts — the improvement
 * evidence layer over the live-demo gallery. Authored data (the
 * addons-data pattern), drift-pinned by `__tests__/built-improved.test.tsx`:
 * every number cites a committed receipt, and the test re-pins the counts
 * against them. A figure with no receipt prints "not measured" — never a
 * guess (the page's honesty rule).
 *
 * Sources (2026-10-28/29, the parley + sota rounds):
 * - benchmarks/parley-round/snapshots/midpoint-2026-10-28184614.json —
 *   the shipped improvement record (R1), the cycle/dream/note counts,
 *   the memory-version trajectory, the token cost columns
 * - benchmarks/sota-round/results/snapshot-midpoint.json — the build's
 *   agent metrics (568 tool calls, 99.46% success, 1 intervention) and
 *   the learning-lane volumes (50 dreams, 140 notes, 58 memory versions)
 * - benchmarks/parley-round/validation-log.md — F3 (the envelope fix, R2)
 * - pi-repo/packages/self-learning/test/print-exit-envelope.test.ts —
 *   the 4 pinning tests behind R2's "pinned" claim
 * - The app cards derive from live-demo-data.ts (never duplicated here) —
 *   the gallery is the single source for what was built.
 */

/** A before/after improvement receipt — the band's core exhibit. */
export interface ImprovementReceipt {
  id: string;
  title: string;
  /** The measured baseline behaviour. */
  before: string;
  /** The measured improved behaviour. */
  after: string;
  /** What the loop did between them (one line, mechanism-named). */
  loop: string;
  /** The receipt that proves both ends (repo path or URL). */
  receipt: string;
}

export const IMPROVEMENT_RECEIPTS: ImprovementReceipt[] = [
  {
    id: "first-patch",
    title: "The first shipped memory patch",
    before: "baseline run failed",
    after: "passed twice, shipped",
    loop:
      "a measured edit-bench failure became the minted task swap-if-else-messages; the harness mined a 4-rule patch, verified it twice, shipped it to project memory v11",
    receipt:
      "https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/parley-round/snapshots/midpoint-2026-10-28184614.json",
  },
  {
    id: "envelope",
    title: "The unattended-caller contract",
    before: "0-byte result envelopes",
    after: "every exit writes it",
    loop:
      "two lost build sessions became the F3 root cause; the forced-exit paths now write the full envelope (subtype forced_exit) before process.exit — pinned by 4 tests",
    receipt:
      "https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/parley-round/validation-log.md",
  },
];

/** The learning-lane counters (the SOTA-round build lineage, midpoint
 *  snapshot) — the volumes the five mechanisms moved while the apps were
 *  built. Counted from committed snapshot receipts, never live state. */
export const LEARNING_COUNTERS: { label: string; value: string; note: string }[] = [
  { label: "dreams", value: "50", note: "AutoDream consolidations" },
  { label: "notes", value: "140", note: "session notes delivered" },
  { label: "memory versions", value: "58", note: "across the build" },
  { label: "minted tasks", value: "3", note: "from measured failures" },
  { label: "skills staged", value: "2", note: "one verified + promoted" },
  { label: "tool success", value: "99.5%", note: "568 calls, 1 intervention" },
];

/** The Mission Control stills the band frames (existing captures, reused —
 *  the asset lane never regenerates for a new consumer). */
export const MISSION_CONTROL_STILLS: { src: string; alt: string; caption: string }[] = [
  {
    src: "/landing/tui/dashboard/stills/03-dreams.png",
    alt: "unown dashboard — the Dreams screen listing AutoDream sessions with their memory deltas",
    caption: "Dreams: every consolidation, its deltas.",
  },
  {
    src: "/landing/tui/dashboard/stills/05-skills.png",
    alt: "unown dashboard — the Skills screen listing the procedures the agent minted for itself",
    caption: "Skills: the procedures it distilled.",
  },
  {
    src: "/landing/tui/dashboard/stills/06-learning-lab.png",
    alt: "unown dashboard — the Learning Lab screen with harness cycles and the improvement ledger",
    caption: "Learning Lab: the cycles, the patches.",
  },
];

/** The mission's three reports — the longhand lanes this band exits to. */
export const REPORT_LINKS: { label: string; href: string }[] = [
  { label: "The learning report", href: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/unown-learning-report.md" },
  { label: "The benchmark report", href: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/benchmark-improvement-report.md" },
  { label: "The competitor report", href: "https://github.com/kanishka-namdeo/Unown/blob/main/docs/competitor-comparison-report.md" },
];
