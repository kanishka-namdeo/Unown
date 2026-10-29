"use client";

import * as React from "react";
import { ENCORE_ITERATIONS, ITER3 } from "@/lib/encore/seed";
import { axisDelta, gatePasses } from "@/lib/encore/stats";
import { delta, pct, score } from "@/lib/encore/format";
import { ENCORE_AXES, ENCORE_GATE_KEYS } from "@/lib/encore/types";
import type { EncoreAxisMap, Iteration } from "@/lib/encore/types";
import { ReceiptRef, receiptShortRef } from "../primitives";
/**
 * Band 4 — The Iterations (plan §5.4, THE FLAGSHIP band).
 *
 * Two sub-blocks:
 *  1. The BEFORE/AFTER comparison — a native `range` input (0–100)
 *     driving a CSS `clip-path` that reveals the AFTER pane over the
 *     BEFORE shot. The input is keyboard-operable by construction
 *     (arrow keys step 10), screen-reader accessible (aria-label),
 *     and the spring thumb is the ONE interactive spring (plan §4.4).
 *
 *     VIEWPORT-SCALE hero shots (iter0 work order 2 — the full-page
 *     shots were the "massive empty blue canvas"): the BEFORE pane
 *     is the STAGED landing hero capture
 *     (`baseline-hero.png`, 1440×900); the AFTER hero shot is NOT
 *     staged yet — it lands when iter1 ships. The AFTER pane is a
 *     HONEST DESIGNED PLACEHOLDER (a bordered panel reading
 *     "iteration 1 — in flight" + the receipt short-ref) — never a
 *     broken-image icon, never an empty void. When the shot lands,
 *     the pane swaps to the `<img>` with zero structural change
 *     (the `hasAfter` branch).
 *
 *  2. The score-delta table — a real `<table>` (th scope="col")
 *     showing `stats.axisDelta(latest.axes, baseline.axes)` per axis.
 *     With the current seed (baseline only), the delta is 0.00 for
 *     every axis; when the critique loop appends iter1, the delta
 *     updates with zero code change (the append-clean invariant,
 *     plan risk #10).
 *
 * A11y contract (plan §5.4):
 *  - `input[type="range"]` with `aria-label="Reveal after"` — the
 *    NATIVE SEMANTICS ARE UNCHANGED (risk #1): same min/max/step,
 *    same aria-label, same clip-path math.
 *  - Honest `alt`s: before = baseline receipt description, after =
 *    latest receipt description (the numbers come from the seed)
 *  - Reduced motion: the slider still works (user-initiated, not a
 *    reveal animation); no loop without status meaning.
 *
 * Iter0 critique fixes: the BEFORE/AFTER chips no longer collide with
 * the heading (they sit INSIDE the container corners on opaque
 * panel-2 chips — the "semi-transparent panels" improvement); the
 * "Drag to reveal" caption is DIM on the canvas at 12px (the
 * nearly-invisible caption defect, work order 7); the receipt lines
 * are the short-ref pattern with the full path in `title` (work
 * order 1) and SANS — the mono JSON paths are gone from the footer;
 * the container is `aspect-ratio`-bounded so the empty-canvas
 * defect is structurally impossible.
 *
 * Iter1 critique fixes: the delta table is the REAL mobile overflow
 * culprit (the iter1 receipt's audit found tr/td extending 42px past
 * the 390px viewport — the receipt short-refs in the header were
 * NOT it). At <480px the axis table restyles as STACKED rows — one
 * card per axis: the axis name, the before → after values, the delta
 * chip (the Linear/Stripe mobile pattern; never a
 * horizontally-scrolling table) — and the document carries ZERO
 * horizontal overflow at 390px. Desktop (≥480px) keeps the table.
 */

/* The two viewport-scale hero shots, staged under
   `public/landing/encore/iterations/` by the critique loop's media
   lane. The BEFORE hero is STAGED (the landing baseline hero,
   1440×900). The AFTER hero is NOT staged yet — it lands after the
   iter0 fixes ship; `hasAfter` below renders the honest designed
   placeholder until then (work order 2's contract: never a
   broken-image icon, never an empty void).

   Provenance (the receipts these shots stage from):
   - BEFORE: 20261029-145746-baseline-root.json — the landing hero
   - AFTER:   the first appended iteration receipt (Phase 4); the
     AFTER shot stages from that receipt's shotsDir.
*/

/** Provenance: benchmarks/website-excellence-round/critiques/20261029-145746-baseline-root.json */
const ITERATION_BEFORE_IMG = "/landing/encore/iterations/baseline-hero.png";
/** Provenance: benchmarks/website-excellence-round/critiques/20261029-170148-iter3-encore.json (the final build's band00 shot) */
const ITERATION_AFTER_IMG = "/landing/encore/iterations/final-hero.png";

export function Iterations({
  embed,
  sliderValue,
  onSliderChange,
}: {
  embed: boolean;
  /** The slider position (0–100) — reset-wiped state (plan §3.4). */
  sliderValue: number;
  onSliderChange: (v: number) => void;
}) {
  void embed;
  const iterations = ENCORE_ITERATIONS;
  const baseline = iterations[0];
  const latest = iterations[iterations.length - 1];
  const before = baseline;
  const after = latest;

  // The per-axis delta table (entry 0 → latest): baseline vs iter3.
  const deltas: EncoreAxisMap = React.useMemo(
    () => axisDelta(after.axes, before.axes),
    [after, before],
  );

  // The before/after alt text — honest descriptions from the seed:
  // the landing baseline (23 font sizes, 32.7% off-grid) vs the
  // encore final (6 font sizes, 0% off-grid, all objective gates
  // passing at iter3).
  const beforeAlt = `Landing baseline, 1440×900 — ${score(before.overall)} overall, ${before.gates.fontSizes.value} distinct font sizes, ${pct(before.gates.offGridPct.value as number)} off-grid; fontSizes and offGridPct gates FAIL (receipt: ${before.receiptPath})`;
  const afterAlt = `Encore final (${after.label}), 1440×900 — ${score(after.overall)} overall, ${after.gates.fontSizes.value} distinct font sizes, ${pct(after.gates.offGridPct.value as number)} off-grid, all objective gates passing (receipt: ${after.receiptPath})`;

  // The clip path: AFTER is revealed from the left up to `sliderValue%`.
  const clipPct = Math.max(0, Math.min(100, sliderValue));

  return (
    <section
      id="iterations"
      className="encore-section"
      aria-labelledby="iterations-heading"
    >
      <div className="mx-auto w-full max-w-3xl">
        <IterationsHeading />

        {/* ── the BEFORE/AFTER comparison ─────────────────────────── */}
        <div className="encore-reveal mb-8" data-testid="iterations-comparison">
          {/* The "Drag to reveal" caption — DIM on the canvas at the
              12px caption tier (the nearly-invisible caption was
              iter0's named contrast defect). */}
          <p className="encore-type-caption mb-4 text-dim">
            Drag to reveal the final build over the landing baseline.
            Keyboard: <kbd className="font-mono text-ink">←</kbd>/<kbd className="font-mono text-ink">→</kbd> step 10.
          </p>

          {/* The two stacked hero shots, aspect-ratio bounded (the
              empty-canvas defect, iter0 band03 — a 16/10 box that
              is always the size of its content). BEFORE fills the
              container; AFTER is clipped from the left by the range
              input's value. The range input sits absolutely over the
              comparison, full-width, its thumb styled with the spring
              — the native semantics are exactly as plan §5.4 pins
              them (risk #1 unchanged).

              Iter1 work order 5 — the framed presentation: a defined
              `border-line-bright` edge + a subtle ring (box-shadow) +
              a panel-2 backdrop under the shot so the shot's own
              pixels read against the dark section, never a raw
              "screenshot of a screenshot". The shot itself is
              image-rendering auto (crisp scaling, no blur-up), and
              the full container width means mobile gets a legible
              ~53%-scale rendering on the 768px-wide desktop
              container. */}
          <div
            className="encore-framed relative w-full overflow-hidden border border-line-bright bg-panel-2"
            style={{ aspectRatio: "16 / 10" }}
            data-testid="iterations-shots"
          >
            {/* BEFORE (bottom layer) — the staged landing baseline hero. */}
            <img
              src={ITERATION_BEFORE_IMG}
              alt={beforeAlt}
              width={1440}
              height={900}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover encore-crisp"
              data-testid="iterations-before"
            />

            {/* AFTER (top layer, clipped) — the staged final build's
                hero shot (the iter3 receipt's band00 capture). The
                shot EXISTS now: the comparison renders both real
                shots — no placeholder pane. */}
            <img
              src={ITERATION_AFTER_IMG}
              alt={afterAlt}
              width={1440}
              height={900}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover encore-crisp"
              style={{ clipPath: `inset(0 ${100 - clipPct}% 0 0)` }}
              data-testid="iterations-after"
            />

            {/* BEFORE / AFTER chips — inside the container corners on
                opaque panel-2 fills (the collision defect: they used
                to crash into the heading; the "semi-transparent
                panels behind the labels" improvement, now opaque). */}
            <div className="absolute left-3 top-3" aria-hidden="true">
              <span className="encore-type-eyebrow border border-line bg-panel-2 px-2 py-1 text-ink">
                BEFORE · baseline · {score(before.overall)}
              </span>
            </div>
            <div className="absolute right-3 top-3" aria-hidden="true">
              <span
                className="encore-type-eyebrow border border-gold/60 bg-panel-2 px-2 py-1 text-gold"
                style={{ opacity: clipPct > 10 ? 1 : 0.45 }}
              >
                AFTER · {after.label} · {score(after.overall)}
              </span>
            </div>

            {/* The native range input — the keyboard + SR path.
                It sits over the comparison; its value drives the
                AFTER pane's clip-path. The thumb is the ONE
                interactive spring (plan §4.4). Native semantics:
                unchanged (risk #1). */}
            <input
              type="range"
              min={0}
              max={100}
              value={clipPct}
              onChange={(e) => onSliderChange(Number(e.target.value))}
              step={10}
              aria-label="Reveal after"
              className="encore-slider absolute bottom-4 left-4 right-4"
              data-testid="iterations-slider"
            />
          </div>

          {/* The receipt refs for both shots — the short-ref pattern:
              SANS, dim, the full path in `title`, one compact line
              each, no mono path noise. */}
          <div className="mt-3 flex flex-col gap-1">
            <span className="encore-type-caption text-dim">
              before · landing baseline ·{" "}
              <ReceiptRef path={before.receiptPath} short="receipt · baseline" />
            </span>
            <span className="encore-type-caption text-dim">
              after · final build ·{" "}
              <ReceiptRef
                path={after.receiptPath}
                short={`receipt · ${after.label}`}
              />
            </span>
          </div>
        </div>

        {/* ── the trajectory: one row per ENCORE_ITERATIONS entry ── */}
        <Trajectory iterations={iterations} />

        {/* ── the score-delta table ──────────────────────────────── */}
        <DeltaTable
          before={before}
          after={after}
          deltas={deltas}
          data-testid="iterations-delta"
        />
      </div>
    </section>
  );
}

/* ── the trajectory: one row per ENCORE_ITERATIONS entry ───────── */

/**
 * The honest trajectory (plan risk #10: entries append, rows wire
 * from the seed). One row per receipt, in order: the label, the
 * short timestamp, the VLM overall, which objective gates failed,
 * and the gate-pass count. The story it tells, read top to bottom:
 *  - baseline: 23 font sizes + 32.7% off-grid — the two objective
 *    gate failures that defined the landing page
 *  - iter0 → iter1: the flagship's own build; the objective gates
 *    held from the first run, the 42px mobile overflow survived
 *  - iter2: the overflow fixed, but the dark-scheme contrast fix
 *    introduced 27 light-scheme violations — caught by the
 *    both-scheme audit the loop added after F14
 *  - iter3: every objective gate passes
 *
 * The VLM overall runs 6.40 → 6.27 → 6.00 → 6.00 → 6.22 across
 * the five receipts — that spread on an improving page is the
 * single-judge variance band (the round README's limitations), so
 * no row here is a verdict; only the objective gates are.
 */
function Trajectory({ iterations }: { iterations: Iteration[] }) {
  const objectiveGates = ENCORE_GATE_KEYS.filter((k) => k !== "vlmAxes");
  return (
    <div className="encore-trajectory mb-8" data-testid="iterations-trajectory">
      <h3 className="encore-type-body-lg mb-4 font-semibold text-ink">
        The trajectory — one receipt per run
      </h3>
      <ul className="flex flex-col gap-2" aria-label="The five receipts, in order">
        {iterations.map((iter) => {
          const failed = objectiveGates.filter((k) => !iter.gates[k].pass);
          return (
            <li
              key={iter.label}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-line bg-panel px-4 py-3"
              data-testid={`trajectory-${iter.label}`}
            >
              <span className="encore-type-eyebrow text-gold">{iter.label}</span>
              <span className="encore-type-caption tabular-nums text-dim">
                {iter.timestamp.slice(11, 19)} UTC
              </span>
              <span className="encore-type-caption tabular-nums text-ink">
                VLM {score(iter.overall)}
              </span>
              {failed.length === 0 ? (
                <span className="encore-type-eyebrow border border-gold/40 text-gold">
                  all objective gates PASS
                </span>
              ) : (
                <span className="encore-type-eyebrow border border-poke/40 text-poke">
                  FAIL: {failed.join(", ")}
                </span>
              )}
              <span className="encore-type-caption tabular-nums text-dim">
                {gatePasses(iter)}/{ENCORE_GATE_KEYS.length} gates
              </span>
              <ReceiptRef path={iter.receiptPath} short={`receipt · ${iter.label}`} />
            </li>
          );
        })}
      </ul>
      <p className="encore-type-caption mt-4 text-dim">
        Honest read: the objective discipline gates transformed —{" "}
        {iterations[0].gates.fontSizes.value as number} font sizes → {ITER3.gates.fontSizes.value as number}, {pct(iterations[0].gates.offGridPct.value as number)} → {pct(ITER3.gates.offGridPct.value as number)} off-grid — while the VLM overall
        ({score(iterations[0].overall)} → {score(ITER3.overall)}) sits within a
        single judge&apos;s variance band. The receipts, not this band,
        are the evidence.
      </p>
    </div>
  );
}

/* ── sub-components ───────────────────────────────────────────────── */

function IterationsHeading() {
  return (
    <header className="mb-8">
      <p className="encore-type-eyebrow encore-face-accent text-gold">
        The Iterations
      </p>
      <h2
        id="iterations-heading"
        className="encore-type-display-4 mt-4 font-semibold text-ink"
      >
        Before and after, receipted
      </h2>
      <p className="encore-type-body-lg mt-4 max-w-xl text-dim">
        The landing baseline versus the final build — five receipts,
        one per run. Drag to compare the two hero shots; every
        number on this band is computed from the seed, and every
        seed constant carries its receipt. The append-clean
        invariant means a new iteration receipt changes this band
        with zero code edits.
      </p>
    </header>
  );
}

/**
 * The axis-by-axis delta table (plan §5.4).
 *
 * A real `<table>` with `th scope="col"` — no div-table. The delta
 * is `stats.axisDelta(after.axes, before.axes)` (2-decimal, signed
 * with Unicode minus for negatives). Currently the latest iteration
 * IS the baseline (ENCORE_ITERATIONS has one entry), so every
 * delta is 0.00 — the table still renders honestly.
 *
 * The 11-gate pass-count row (gatePasses) is a summary figure:
 * it tells the reader how many gates the two iterations each pass.
 *
 * Iter0 mobile fix: cells read DIM on the canvas (the faint-on-dark
 * sub-contrast) and the header column labels are the short receipt
 * refs, never the full mono paths.
 *
 * Iter1 mobile fix (the REAL overflow culprit — the iter1 receipt's
 * audit found the table's tr/td extending to right:432 on the 390px
 * viewport, 42px over): at <480px the table RESTYLES as stacked
 * cards (one card per axis: name, before → after values, delta chip
 * — the Linear/Stripe mobile pattern; never a horizontally
 * scrolling table). Desktop ≥480px keeps the table. The short
 * receipt refs still stay ≤28 chars (the break-proof fix, iter0
 * work order 1) so the stacked rows never wrap off the edge.
 */
function DeltaTable({
  before,
  after,
  deltas,
}: {
  before: Iteration;
  after: Iteration;
  deltas: EncoreAxisMap;
  "data-testid"?: string;
}) {
  // Import gatePasses lazily — it is a pure function from stats.ts.
  const gatePassesBefore = ENCORE_GATE_KEYS.filter(
    (k) => before.gates[k].pass,
  ).length;
  const gatePassesAfter = ENCORE_GATE_KEYS.filter(
    (k) => after.gates[k].pass,
  ).length;

  const deltaTone = (d: number) =>
    d > 0 ? "text-gold" : d < 0 ? "text-poke" : "text-dim";

  return (
    <div data-testid="iterations-delta-table" className="encore-delta">
      <h3 className="encore-type-body-lg mb-4 font-semibold text-ink">
        Axis-by-axis delta ({after.label} − {before.label})
      </h3>

      {/* The desktop table — hidden below 480px, where the stacked
          cards take over (the 390px overflow fix, iter1 work order
          1). It never becomes a horizontally-scrolling surface:
          the `hidden sm:block` pair above makes the two
          presentations mutually exclusive. */}
      <div className="encore-delta-tablewrap hidden sm:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Score delta table between {before.label} ({score(before.overall)}) and
            {after.label} ({score(after.overall)}), axis by axis
          </caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="encore-type-caption px-3 py-2 text-dim">
                Axis
              </th>
              <th
                scope="col"
                className="encore-type-caption px-3 py-2 text-right text-dim"
                title={before.receiptPath}
              >
                {receiptShortRef(before.receiptPath)}
              </th>
              <th
                scope="col"
                className="encore-type-caption px-3 py-2 text-right text-dim"
                title={after.receiptPath}
              >
                {receiptShortRef(after.receiptPath)}
              </th>
              <th scope="col" className="encore-type-caption px-3 py-2 text-right text-dim">
                Δ
              </th>
            </tr>
          </thead>
          <tbody>
            {ENCORE_AXES.map((axis) => {
              const beforeVal = before.axes[axis];
              const afterVal = after.axes[axis];
              const d = deltas[axis];
              return (
                <tr key={axis} className="border-b border-line/50">
                  <th scope="row" className="encore-type-caption px-3 py-2 text-ink">
                    {axis.toUpperCase()}
                  </th>
                  <td className="encore-type-caption px-3 py-2 text-right tabular-nums text-dim">
                    {score(beforeVal)}
                  </td>
                  <td className="encore-type-caption px-3 py-2 text-right tabular-nums text-dim">
                    {score(afterVal)}
                  </td>
                  <td
                    className={`encore-type-caption px-3 py-2 text-right tabular-nums ${deltaTone(d)}`}
                    data-testid={`delta-${axis}`}
                  >
                    {delta(d)}
                  </td>
                </tr>
              );
            })}
            {/* The gate-pass summary row */}
            <tr className="border-b border-line bg-panel-2/40">
              <th scope="row" className="encore-type-caption px-3 py-2 text-ink">
                GATES PASSING
              </th>
              <td className="encore-type-caption px-3 py-2 text-right tabular-nums text-dim">
                {gatePassesBefore}/{ENCORE_GATE_KEYS.length}
              </td>
              <td className="encore-type-caption px-3 py-2 text-right tabular-nums text-dim">
                {gatePassesAfter}/{ENCORE_GATE_KEYS.length}
              </td>
              <td
                className="encore-type-caption px-3 py-2 text-right tabular-nums text-gold"
                data-testid="delta-gates"
              >
                {delta(gatePassesAfter - gatePassesBefore)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* The stacked mobile cards — visible below 480px, where the
          table would overflow 390px (the iter1 receipt's 42px
          overflow). One card per axis: the axis name on its own
          line, the before → after values side by side, and the
          delta chip. The gate-pass summary gets its own card so it
          keeps its distinct bg-panel-2/40 surface. */}
      <div className="encore-delta-cards sm:hidden">
        <p className="encore-type-caption mb-2 flex items-center justify-between gap-2 text-dim">
          <span title={before.receiptPath}>{receiptShortRef(before.receiptPath)}</span>
          <span>Δ</span>
          <span title={after.receiptPath}>{receiptShortRef(after.receiptPath)}</span>
        </p>
        <ul className="flex flex-col gap-2" aria-label="Axis deltas, stacked">
          {ENCORE_AXES.map((axis) => {
            const beforeVal = before.axes[axis];
            const afterVal = after.axes[axis];
            const d = deltas[axis];
            return (
              <li
                key={axis}
                className="flex items-center justify-between gap-2 border border-line bg-panel px-3 py-2"
              >
                <span className="encore-type-caption font-medium text-ink">
                  {axis.toUpperCase()}
                </span>
                <span className="encore-type-caption tabular-nums text-dim">
                  {score(beforeVal)}
                  <span aria-hidden="true"> → </span>
                  {score(afterVal)}
                </span>
                <span
                  className={`encore-type-eyebrow border px-2 py-1 tabular-nums ${
                    d > 0
                      ? "border-gold/40 text-gold"
                      : d < 0
                        ? "border-poke/40 text-poke"
                        : "border-line text-dim"
                  }`}
                  data-testid={`delta-${axis}`}
                >
                  {delta(d)}
                </span>
              </li>
            );
          })}
          {/* The gate-pass summary card */}
          <li className="flex items-center justify-between gap-2 border border-line bg-panel-2/40 px-3 py-2">
            <span className="encore-type-caption font-medium text-ink">
              GATES PASSING
            </span>
            <span className="encore-type-caption tabular-nums text-dim">
              {gatePassesBefore}/{ENCORE_GATE_KEYS.length}
              <span aria-hidden="true"> → </span>
              {gatePassesAfter}/{ENCORE_GATE_KEYS.length}
            </span>
            <span
              className="encore-type-eyebrow border border-gold/40 px-2 py-1 tabular-nums text-gold"
              data-testid="delta-gates"
            >
              {delta(gatePassesAfter - gatePassesBefore)}
            </span>
          </li>
        </ul>
      </div>

      {/* The table's provenance — the short-ref pattern, full path in
          `title` (work order 3). */}
      <p className="encore-type-caption mt-4 text-dim" title={after.receiptPath}>
        Provenance · {receiptShortRef(after.receiptPath)}
      </p>
    </div>
  );
}
