/**
 * Encore — the Website Excellence showcase: every entity of the build
 * contract (benchmarks/website-excellence-round/plan.md §1.2).
 *
 * Two layers:
 *  1. The typed receipt subset (`EncoreReceipt` and friends) — the fields of
 *     the `website-excellence/critique/1` schema Encore consumes (plan §1.1);
 *     the rest of the receipt JSON is pass-through and stays untyped.
 *  2. The seed entities (`Iteration`, `ToolCard`, `FailureEntry`,
 *     `TimelineEvent`) — the receipt-derived constants live in `seed.ts`.
 *
 * Pure type surface: no values here except the two axis/gate key arrays
 * (`ENCORE_AXES`, `ENCORE_GATE_KEYS`), which are data the UI and the stats
 * math both iterate over. No I/O, no wall-clock reads, no RNG —
 * deterministic by construction (the fugue pin, enforced by
 * `invariant.test.ts`).
 */

/* ── §1.1 the receipt subset (typed) ─────────────────────────────── */

/** The seven VLM axes, the plan's fixed order. */
export type EncoreAxis =
  | "hierarchy"
  | "typography"
  | "spacing"
  | "color"
  | "alignment"
  | "density"
  | "overall";

/** The seven-axis mean map (2-decimal floats in [0,10]). */
export type EncoreAxisMap = Record<EncoreAxis, number>;

/** The eleven gate keys, the plan's fixed order. */
export type EncoreGateKey =
  | "contrastViolations"
  | "fontSizes"
  | "offGridPct"
  | "headingSkips"
  | "missingAlts"
  | "mobileOverflow"
  | "fcpMs"
  | "lcpMs"
  | "cls"
  | "tbtMs"
  | "vlmAxes";

export type EncoreGate = {
  value: number | EncoreAxisMap;
  max?: number;
  floor?: number;
  pass: boolean;
  /** the vlmAxes gate only — the named per-axis misses, e.g. `"hierarchy 6.5<7"` */
  failures?: string[];
};

export type EncoreGateMap = Record<EncoreGateKey, EncoreGate>;

/** `critiques[]` item — on the error path `scores` is replaced by `error`. */
export type EncoreCritique = {
  shot: string;
  device: "desktop" | "mobile";
  kind: "full" | "band";
  label: string | null;
  scores?: EncoreAxisMap;
  error?: string;
  defects: string[];
  improvements: string[];
};

export type EncoreTypeSize = { size: string; uses: number };
export type EncoreHeadingSkip = { from: string; to: string };
export type EncoreContrastViolation = {
  text: string;
  ratio: number;
  need: number;
  size: string;
  weight: string;
  selector: string;
};

export type EncoreAudit = {
  contrast: { min: number; mean: number; violations: EncoreContrastViolation[] };
  type: { distinctSizes: number; sizes: EncoreTypeSize[] };
  spacing: { samples: number; offGrid: number; offGridPct: number };
  headings: { order: number[]; skips: EncoreHeadingSkip[] };
  images: { total: number; missingAlts: number };
  overflowX: number;
};

export type EncoreVitals = { fcp: number; lcp: number; cls: number; tbt: number };

/** A parsed receipt — the §1.1 subset Encore consumes (rest is pass-through). */
export type EncoreReceipt = {
  schema: string;
  route: string;
  url: string;
  label: string;
  generatedAt: string;
  audit: { desktop: EncoreAudit; mobile: EncoreAudit };
  vitals: { desktop: EncoreVitals; mobile: EncoreVitals };
  critiques: EncoreCritique[];
  axisMeans: EncoreAxisMap;
  gates: EncoreGateMap;
  passed: boolean;
};

/* ── §1.2 the seed entities ───────────────────────────────────────── */

/** One critique-loop run, distilled to the numbers the showcase renders. */
export type Iteration = {
  label: string;
  /** the receipt's `generatedAt` (ISO-8601) */
  timestamp: string;
  /** repo-relative path of the receipt JSON this iteration derives from */
  receiptPath: string;
  overall: number;
  axes: EncoreAxisMap;
  gates: EncoreGateMap;
  passed: boolean;
};

export type ToolCard = {
  id: "design-critic" | "calibration-fixture";
  name: string;
  /** the one-line role */
  role: string;
  /** the receipt or doc that proves the tool */
  receipt: string;
  /** the number the card leads with */
  headline: string;
  /** the calibration card's chart data: labeled before/after pairs */
  evidence: { label: string; before: number; after: number }[];
};

/** An F-ledger row (the round's failure→learning entries). */
export type FailureEntry = {
  /** the ledger code — this round's entries: "F10" | "F11" (later rounds append) */
  code: string;
  what: string;
  outcome: string;
  /** the commit or doc that closed the failure */
  fixRef: string;
};

/** A story beat (from `docs/website-excellence-session.md`). */
export type TimelineEvent = {
  /** explicit order — the array is NOT sorted at runtime */
  seq: number;
  beat: string;
  title: string;
  detail: string;
  /** receipt-backed beats carry the path */
  receipt?: string;
};

export type EncoreStats = {
  /** chronological */
  iterations: Iteration[];
  latest: Iteration;
  /** latest − baseline, per axis (2-decimal) */
  axisDelta: EncoreAxisMap;
  /** `gatePasses(latest)` — count of the 11 gates that pass */
  gatePasses: number;
  /** `gatePasses(baseline)` */
  gatePassesBaseline: number;
  /** the baseline − calib-bad overall separation (4.9) */
  calibrationSeparation: number;
  failures: FailureEntry[];
  tools: ToolCard[];
};

/* ── key arrays (the single source for UI + stats iteration) ─────── */

export const ENCORE_AXES: EncoreAxis[] = [
  "hierarchy",
  "typography",
  "spacing",
  "color",
  "alignment",
  "density",
  "overall",
];

export const ENCORE_GATE_KEYS: EncoreGateKey[] = [
  "contrastViolations",
  "fontSizes",
  "offGridPct",
  "headingSkips",
  "missingAlts",
  "mobileOverflow",
  "fcpMs",
  "lcpMs",
  "cls",
  "tbtMs",
  "vlmAxes",
];
