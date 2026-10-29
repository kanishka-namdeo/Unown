/**
 * Encore display formatters — pure: no wall-clock reads, no RNG, no DOM.
 * Every function takes an explicit value.
 *
 * Plan §2 (format.ts):
 *  - `pct(x)`    → "32.7%"
 *  - `score(x)`  → "6.40" (2-decimal)
 *  - `delta(x)`  → "−3.90" (Unicode minus for negatives, "+1.20" for positives, "0.00" for zero)
 *  - `gateStatus(g)` → "PASS" | "FAIL" | "UNDER" (UNDER = floor not met, i.e. the vlmAxes gate)
 *  - `axisLabel(a)` → human caps form, e.g. "HIERARCHY"
 */

import type { EncoreAxis, EncoreGate } from "./types";

/* ── pct ──────────────────────────────────────────────────────────── */

/** Format a percentage number: `pct(32.7)` → `"32.7%"`. Trailing `.0` trimmed. */
export function pct(x: number): string {
  // Avoid float noise: round to 1 decimal, trim the trailing zero.
  const n = Math.round(x * 10) / 10;
  const s = n % 1 === 0 ? String(n) : n.toFixed(1);
  return `${s}%`;
}

/* ── score ────────────────────────────────────────────────────────── */

/** Format a VLM score to 2 decimals: `score(6.4)` → `"6.40"`. */
export function score(x: number): string {
  return x.toFixed(2);
}

/* ── delta ────────────────────────────────────────────────────────── */

/**
 * Format an axis delta with a leading sign:
 * `delta(-3.9)` → `"−3.90"`, `delta(1.2)` → `"+1.20"`, `delta(0)` → `"0.00"`.
 * Uses the Unicode minus (U+2212) for negatives.
 */
export function delta(x: number): string {
  if (x > 0) return `+${x.toFixed(2)}`;
  if (x < 0) return `\u2212${Math.abs(x).toFixed(2)}`;
  return "0.00";
}

/* ── gateStatus ───────────────────────────────────────────────────── */

/**
 * Human status for a gate:
 *  - `"PASS"` — `g.pass === true`
 *  - `"FAIL"` — objective gate, `g.pass === false` (value exceeds max)
 *  - `"UNDER"` — the vlmAxes floor gate (value map, floor not met)
 */
export function gateStatus(g: EncoreGate): "PASS" | "FAIL" | "UNDER" {
  if (g.pass) return "PASS";
  if (g.floor !== undefined) return "UNDER";
  return "FAIL";
}

/* ── axisLabel ────────────────────────────────────────────────────── */

const AXIS_LABELS: Record<EncoreAxis, string> = {
  hierarchy: "HIERARCHY",
  typography: "TYPOGRAPHY",
  spacing: "SPACING",
  color: "COLOR",
  alignment: "ALIGNMENT",
  density: "DENSITY",
  overall: "OVERALL",
};

/** Human-caps label for an axis key: `axisLabel("hierarchy")` → `"HIERARCHY"`. */
export function axisLabel(axis: EncoreAxis): string {
  return AXIS_LABELS[axis];
}
