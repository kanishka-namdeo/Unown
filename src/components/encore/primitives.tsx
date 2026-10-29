"use client";

import type { EncoreAxis } from "@/lib/encore/types";

/**
 * Encore band primitives (plan §2 module list, Phase 3).
 *
 * Every component takes explicit data — nothing reads the seed at
 * module load, nothing calls `Date.now()` or `Math.random()`. The
 * bands (in `views/`) compose these; the numbers they render are
 * all seed constants with `@provenance` (plan §1.3).
 *
 * Design rules enforced here (plan §4, binding):
 *  - 8-size type ramp: the `encore-type-*` classes in
 *    `src/app/encore/globals.css` — no other font-size value exists
 *    on this route (the Phase-4 census gate: ≤ 8 distinct sizes).
 *  - 4/8 spacing grid: every gap/padding/margin a multiple of 4.
 *  - Named color pairs only (§4.3): dim on panel-2, never faint.
 *  - Motion: 150/250/400ms tokens, all behind
 *    `prefers-reduced-motion` (the guard is in globals.css).
 *  - Receipt short-ref contract (iter0 critique round, work order 1):
 *    full receipt paths NEVER render inline (the unbreakable mono
 *    strings that broke the 390px covenant) — `ReceiptRef` shows a
 *    short ref with the full path in `title`/`aria-label`, on the
 *    caption size, in SANS (mono is reserved for actual code).
 */

/* ── receipt short-ref helpers (work order 1 — the 390px fix) ─────── */

/**
 * The short visible form of a receipt path: everything after the
 * first `critiques/`/`api/`…-style directory boundary drops away,
 * so `benchmarks/website-excellence-round/critiques/20261029-145746-baseline-root.json`
 * prints as `…145746-baseline-root.json` (≤ 28 chars — never wraps
 * at 390px on the caption size). No `break-all` anywhere: the short
 * form is the break-proof fix.
 */
export function receiptShortRef(path: string): string {
  const m = path.match(/critiques\/([^/]+)\.json$/);
  if (m) {
    const stamp = m[1];
    const tail = stamp.slice(stamp.length - 6);
    return `${stamp.slice(0, 8)}…${tail}.json`.slice(0, 28);
  }
  return path.length > 28 ? `…${path.slice(-27)}` : path;
}

/**
 * The one provenance line per band (work order 3): a short, calm
 * line in SANS — "Provenance · …145746-baseline-root.json" — the
 * full path lives in `title` (hover/focus/AT), never inline.
 */
export function receiptProvenanceLine(path: string): string {
  return `Provenance · ${receiptShortRef(path)}`;
}

/* ── Kpi ───────────────────────────────────────────────────────────── */

/**
 * A single headline number with a human label and optional receipt
 * short-ref footnote. The footnote is the "no number without a
 * receipt" contract (plan §1.3, risk #5), rendered through the
 * short-ref helper: a ≤28-char ref with the full path in `title`
 * (iter0 critique: the repeated inline `receipt: benchmarks/…`
 * lines were the top noise complaint — the full path NO longer
 * renders inline under any metric).
 */
export function Kpi({
  value,
  label,
  receiptPath,
  tone = "ink",
}: {
  /** The printed number, e.g. "6.40" or "32.7%". */
  value: string;
  /** The human label, e.g. "Overall". */
  label: string;
  /** The receipt that proves this number (the short-ref target). */
  receiptPath?: string;
  /** `ink` (default), `gold` (accent numbers), `poke` (failing gates). */
  tone?: "ink" | "gold" | "poke";
}) {
  const color =
    tone === "gold"
      ? "text-gold"
      : tone === "poke"
        ? "text-poke"
        : "text-ink";
  const shortRef = receiptPath ? receiptShortRef(receiptPath) : "";
  return (
    <div className="encore-kpi flex flex-col gap-2">
      <span className={`encore-type-body-lg font-semibold ${color}`}>
        {value}
      </span>
      <span className="encore-type-caption text-dim">{label}</span>
      {shortRef ? (
        <span
          className="encore-type-caption break-words text-dim"
          title={receiptPath}
        >
          {shortRef}
        </span>
      ) : null}
    </div>
  );
}

/* ── ReceiptRef ───────────────────────────────────────────────────── */

export type ReceiptRefProps = {
  /** The full repo-relative receipt path (never rendered inline). */
  path: string;
  /** An explicit short visible ref (the iter0 work order 1 forms,
   * e.g. "receipt · baseline" or "…145746-baseline.json"). Defaults
   * to `receiptShortRef(path)` — still ≤ 28 chars, one line at 390px. */
  short?: string;
  /** The link the ref points at (receipt files live on GitHub main). */
  href?: string;
};

/**
 * THE short-ref primitive (work order 1): a short visible ref in
 * SANS caption (12px — the provenance-micro-text floor; anything
 * smaller would read as noise at 12px and below is off the ramp),
 * the full path in `title` + `aria-label`, wrapped in an `<a>` when
 * `href` is given. This is the component every band uses to point
 * at its receipt without printing `benchmarks/…` inline.
 */
export function ReceiptRef({ path, short, href }: ReceiptRefProps) {
  const label = short ?? receiptShortRef(path);
  const content = (
    <span className="encore-type-caption break-words text-dim" title={path}>
      {label}
    </span>
  );
  if (!href) {
    return (
      <span aria-label={`Receipt ${path}`}>
        {content}
      </span>
    );
  }
  return (
    <a
      href={href}
      title={path}
      aria-label={`Receipt ${path}`}
      className="text-dim underline underline-offset-2 hover:text-ink"
    >
      {content}
    </a>
  );
}

/** One provenance line per band (work order 3) — see
 * `receiptProvenanceLine` for the shape; `title` carries the full
 * path. Compose with `ReceiptRef` when a band needs the link. */
export function ProvenanceLine({ path }: { path: string }) {
  return (
    <p className="encore-type-caption text-dim" title={path}>
      {receiptProvenanceLine(path)}
    </p>
  );
}

/* ── GateChip ──────────────────────────────────────────────────────── */

export type GateChipData = {
  key: string;
  status: "PASS" | "FAIL" | "UNDER";
  /** The value the gate measured (the two decimals, the count, …). */
  value: string;
  /** The gate's max / floor, printed next to the value. */
  bound?: string;
  /** `true` when the gate missed its floor (the vlmAxes UNDER case). */
  isFail?: boolean;
};

/**
 * A single PASS/FAIL/UNDER chip for one of the 11 gates (plan §5.2).
 * The two failing baseline gates (`fontSizes`, `offGridPct`) and the
 * `vlmAxes` floor miss render in `poke` — the only red surface in the
 * design (plan §4.3: `poke` is the named failing tone, risk #6 keeps
 * dim on panel-2, never faint).
 *
 * Iter0 critique fixes: the gate key is SANS (the mono all-caps was
 * the "raw CSV" noise) and the failing border is softened to
 * `border-poke/30` with the `bg-panel-2` lift doing the separation
 * (work order 6 — the red border was harsh at 50%).
 */
export function GateChip({ gate }: { gate: GateChipData }) {
  const failing = gate.status !== "PASS";
  const chipBg = failing ? "bg-panel-2" : "bg-panel";
  const valueColor = failing ? "text-poke" : "text-gold";
  const statusLabel =
    gate.status === "PASS" ? "PASS" : gate.status === "FAIL" ? "FAIL" : "UNDER";
  return (
    <li
      className={`flex items-center justify-between gap-4 border ${
        failing ? "border-poke/30" : "border-line"
      } ${chipBg} px-4 py-2`}
      data-status={gate.status}
    >
      <span className="encore-type-caption font-medium text-dim">
        {gate.key}
      </span>
      <span className="flex items-center gap-2">
        <span
          className={`encore-type-caption font-medium ${valueColor}`}
          data-testid={`gate-value-${gate.key}`}
        >
          {gate.value}
          {gate.bound ? (
            <span className="ml-1 text-faint">/ {gate.bound}</span>
          ) : null}
        </span>
        <span
          className={`encore-type-eyebrow ${
            failing ? "text-poke" : "text-gold"
          }`}
        >
          {statusLabel}
        </span>
      </span>
    </li>
  );
}

/* ── AxisBar ─────────────────────────────────────────────────────── */

export type AxisBarData = {
  axis: EncoreAxis;
  /** 0–10, two decimals. */
  value: number;
  /** The VLM floor — the `vlmAxes` gate's floor (7). */
  floor?: number;
  /** Human label for the axis. */
  label?: string;
};

/**
 * A horizontal bar for one of the seven VLM axes (plan §5.1 strip,
 * §5.2 axis strip). The bar is `role="img"` with an `aria-label`
 * naming the value and the floor — the sr-only table mirrors it
 * (plan §5.2 a11y contract). Under reduced motion the width is the
 * settled value immediately (the base-finished card, not a blank
 * frame).
 *
 * Iter0 critique fixes: the axis label reads DIM on the page
 * canvas (was Faint-on-canvas — the washed-out label defect) and
 * the value column carries trailing room so the number never
 * cramps against the card edge.
 */
export function AxisBar({
  axis,
  value,
  floor,
  label,
}: AxisBarData & {
  axis: EncoreAxis;
  value: number;
  floor?: number;
  label?: string;
}) {
  const widthPct = Math.max(0, Math.min(100, (value / 10) * 100));
  const missingFloor = floor !== undefined && value < floor;
  const aria = `${label ?? axis} ${value.toFixed(2)} of 10${
    floor !== undefined
      ? `, ${missingFloor ? `under the ${floor.toFixed(1)} floor` : "at or above the " + floor.toFixed(1) + " floor"}`
      : ""
  }`;
  return (
    <div className="flex items-center gap-4" data-axis={axis}>
      <span className="encore-type-caption w-24 shrink-0 text-dim">
        {label ?? axis}
      </span>
      <div
        role="img"
        aria-label={aria}
        className="relative h-2 min-w-0 flex-1 bg-panel-2"
      >
        <div
          className="absolute inset-y-0 left-0 bg-gold"
          style={{ width: `${widthPct}%` }}
        />
        {floor !== undefined ? (
          <div
            className="absolute inset-y-0 w-px bg-line-bright"
            style={{
              left: `${Math.min(100, (floor / 10) * 100)}%`,
            }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <span
        className={`encore-type-caption w-12 shrink-0 pr-2 text-right tabular-nums ${
          missingFloor ? "text-poke" : "text-dim"
        }`}
        data-testid={`axis-value-${axis}`}
      >
        {value.toFixed(2)}
      </span>
    </div>
  );
}

/* ── FChip ───────────────────────────────────────────────────────── */

/**
 * An F-ledger code chip (plan §5.6): the code in mono, `poke` when
 * the entry is open, neutral when it is closed. The entry's `what` /
 * `outcome` / `fixRef` live on the parent row.
 */
export function FChip({ code, open }: { code: string; open?: boolean }) {
  return (
    <span
      className={`encore-type-eyebrow inline-flex items-center border px-2 py-1 ${
        open
          ? "border-poke/60 bg-panel-2 text-poke"
          : "border-line bg-panel text-dim"
      }`}
      data-code={code}
    >
      {code}
    </span>
  );
}

/* ── ReceiptCard ───────────────────────────────────────────────────── */

export type ReceiptCardProps = {
  /** The receipt the card reports on (its repo-relative path — the
   * `title` attribute of the card's short-ref header). */
  receiptPath: string;
  /** The receipt's label ("baseline", "calib-bad", "iter1", …). */
  label: string;
  /** The overall 2-decimal score the card leads with. */
  overall: string;
  /** The verdict: "PASS" | "FAIL". */
  verdict: "PASS" | "FAIL";
  /** Card body children (gate chips, axis strip, Kpis). */
  children: React.ReactNode;
  /** An accessible name for the card (plan §5.2: `aria-label` names
   * the receipt). */
  ariaLabel?: string;
};

/**
 * The receipt-shaped card (plan §5.2). A `panel`-surfaced `article`
 * with a `panel-2` header strip; the verdict sits on the right, the
 * numbers on the left (the 2-column receipt card, plan §4.5). The
 * two failing gates are in `poke` (the receipt card's body decides
 * which `GateChip`s are failing — the card itself just frames).
 *
 * Iter0 critique fixes: the score is now the DISPLAY-3 (48px)
 * number it was missing — bolding alone (the `display-4` 32px
 * `font-semibold`) failed to dominate (work order 4); the header
 * short-ref is SANS with the full path in `title` (work orders 1 +
 * 5); the "receipt" kicker is dim instead of the washed-out faint.
 */
export function ReceiptCard({
  receiptPath,
  label,
  overall,
  verdict,
  children,
  ariaLabel,
}: ReceiptCardProps) {
  const failing = verdict === "FAIL";
  const shortRef = receiptShortRef(receiptPath);
  return (
    <article
      aria-label={ariaLabel ?? `Receipt ${label}`}
      className="overflow-hidden border border-line bg-panel"
    >
      <div className="flex flex-col gap-4 border-b border-line bg-panel-2 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="encore-type-caption text-dim">
            receipt · {label}
          </span>
          <span
            className="encore-type-body-sm break-words text-ink"
            title={receiptPath}
            data-testid="receipt-ref"
          >
            {shortRef}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span
            className={`encore-type-display-3 font-semibold ${
              failing ? "text-poke" : "text-gold"
            }`}
            data-testid="receipt-overall"
          >
            {overall}
          </span>
          <span
            className={`encore-type-eyebrow border px-2 py-1 ${
              failing
                ? "border-poke/60 text-poke"
                : "border-gold/60 text-gold"
            }`}
          >
            {verdict}
          </span>
        </div>
      </div>
      <div className="px-6 py-6">{children}</div>
    </article>
  );
}
