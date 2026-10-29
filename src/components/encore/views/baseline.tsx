"use client";

import * as React from "react";
import { ENCORE_AXES, ENCORE_GATE_KEYS } from "@/lib/encore/types";
import type { EncoreAxis, EncoreAxisMap, EncoreGate, Iteration } from "@/lib/encore/types";
import { pct, score, gateStatus, axisLabel } from "@/lib/encore/format";
import {
  AxisBar,
  GateChip,
  Kpi,
  ProvenanceLine,
  ReceiptCard,
  type GateChipData,
} from "../primitives";

/**
 * Band 2 — the Baseline receipt card (plan §5.2).
 *
 * `BASELINE_ITERATION` rendered as a receipt-shaped card: overall
 * 6.40, 23 distinct font sizes, 32.7% off-grid, 0 contrast
 * violations, the seven axis means, and the verdict — FAIL (the two
 * failing gates: `fontSizes` and `offGridPct`). Every number carries
 * the receipt provenance (the "no number without a receipt" contract,
 * plan §1.3 risk #5).
 *
 * Iter0 critique fixes: the repeated inline "receipt: benchmarks/…"
 * sub-label under every metric is GONE — one short provenance line
 * per band (work order 3), full path in `title`; the KPI values keep
 * their seeded numbers but the footnotes are short refs; the H2 sits
 * on the display-4 (32px) tier against an 18px lead — the heading
 * separation the critique asked for (work order 4); the failing
 * gate chips carry the softened `border-poke/30` (work order 6).
 *
 * A11y: an `article` with an `aria-label` naming the receipt; the
 * gate chips are `li` in a `ul`; the axis bars carry `role="img"` +
 * `aria-label` (the `AxisBar` primitive) and an sr-only table mirrors
 * the bars.
 */
export function Baseline({
  iteration,
  embed,
}: {
  iteration: Iteration;
  embed: boolean;
}) {
  void embed;
  const fontSizes = iteration.gates.fontSizes;
  const offGrid = iteration.gates.offGridPct;
  const contrast = iteration.gates.contrastViolations;

  const gateChips: GateChipData[] = ENCORE_GATE_KEYS.map((key) => {
    const g = iteration.gates[key];
    const status = gateStatus(g);
    const valueStr = describeGateValue(key, g);
    const boundStr = describeGateBound(key, g);
    return {
      key,
      status,
      value: valueStr,
      bound: boundStr,
      isFail: status !== "PASS",
    };
  });

  return (
    <section
      id="baseline"
      className="encore-section"
      aria-labelledby="baseline-heading"
    >
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8">
          <p className="encore-type-eyebrow encore-face-accent text-gold">
            The Baseline
          </p>
          <h2
            id="baseline-heading"
            className="encore-type-display-4 mt-4 font-semibold text-ink"
          >
            The receipt before the fix
          </h2>
          <p className="encore-type-body-lg mt-4 max-w-xl text-dim">
            The critic&apos;s first look at the landing page — the
            baseline it measures against, and the two gates it misses.
          </p>
        </header>

        <ReceiptCard
          receiptPath={iteration.receiptPath}
          label={iteration.label}
          overall={score(iteration.overall)}
          verdict="FAIL"
          ariaLabel={`Receipt: ${iteration.receiptPath}`}
        >
          {/* The KPI row: the four headline numbers, every one
              sourced to the receipt (the footnote is the short ref;
              the full path is in `title`). */}
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Kpi
              value={score(iteration.overall)}
              label="Overall"
              receiptPath={iteration.receiptPath}
              tone="gold"
            />
            <Kpi
              value={String(fontSizes.value)}
              label="Distinct font sizes"
              receiptPath={iteration.receiptPath}
              tone="poke"
            />
            <Kpi
              value={pct(offGrid.value as number)}
              label="Off-grid spacing"
              receiptPath={iteration.receiptPath}
              tone="poke"
            />
            <Kpi
              value={String(contrast.value)}
              label="Contrast violations"
              receiptPath={iteration.receiptPath}
            />
          </div>

          {/* The 11 gate chips (plan §5.2): `li` in a `ul`, the two
              failing ones in `poke`. */}
          <div className="mb-8">
            <h3 className="encore-type-body-lg mb-4 font-semibold text-ink">
              11 gates
            </h3>
            <ul
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              aria-label="The 11 objective + VLM gates"
            >
              {gateChips.map((g) => (
                <GateChip key={g.key} gate={g} />
              ))}
            </ul>
          </div>

          {/* The seven VLM axis means (plan §5.2): each bar carries
              `role="img"` + `aria-label`; the sr-only table mirrors
              them so a screen reader gets the numbers even without
              the bars. */}
          <div className="flex flex-col gap-4">
            <h3 className="encore-type-body-lg font-semibold text-ink">
              7 VLM axis means
            </h3>
            <div className="flex flex-col gap-2" data-testid="baseline-axis-strip">
              {ENCORE_AXES.map((axis) => (
                <AxisBar
                  key={axis}
                  axis={axis}
                  value={iteration.axes[axis]}
                  floor={7}
                  label={axisLabel(axis)}
                />
              ))}
            </div>
            <div className="sr-only">
              <table>
                <caption>The seven VLM axis means from the baseline receipt</caption>
                <thead>
                  <tr>
                    <th scope="col">Axis</th>
                    <th scope="col">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {ENCORE_AXES.map((axis) => (
                    <tr key={axis}>
                      <th scope="row">{axisLabel(axis)}</th>
                      <td>{iteration.axes[axis].toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </ReceiptCard>

        {/* The ONE provenance line for the band (iter0 work order 3):
            the full path is in `title`, never inline. */}
        <div className="mt-4">
          <ProvenanceLine path={iteration.receiptPath} />
        </div>
      </div>
    </section>
  );
}

/* ── gate value / bound string helpers ───────────────────────────── */

function describeGateValue(key: (typeof ENCORE_GATE_KEYS)[number], g: EncoreGate): string {
  if (key === "offGridPct") return pct(g.value as number);
  if (key === "vlmAxes") {
    if (typeof g.value === "object") {
      const misses = (ENCORE_AXES as EncoreAxis[]).filter((a) => g.value[ a] < 7);
      return `${misses.length} under`;
    }
    return "—";
  }
  return String(g.value);
}

function describeGateBound(
  key: (typeof ENCORE_GATE_KEYS)[number],
  g: EncoreGate,
): string | undefined {
  if (key === "offGridPct") return "≤ 15%";
  if (key === "vlmAxes") return "floor 7";
  if (key === "contrastViolations") return "0";
  if (g.max !== undefined) return `≤ ${g.max}`;
  return undefined;
}
