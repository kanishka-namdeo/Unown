"use client";

/**
 * Shared presentational pieces for the Aria views. Pure: props in,
 * markup out — no store, no DOM side effects. Follows the cadence
 * chart + primitives conventions (accessible SVG, `role="img"` +
 * `aria-label`) and the parley disabled-with-reason pattern.
 */
import type { ForecastCategory, LeadPriority } from "@/lib/aria/types";

/* ── chips ─────────────────────────────────────────────────────────── */

const CATEGORY_CLS: Record<ForecastCategory, string> = {
  commit: "bg-ok/15 text-ok",
  best_case: "bg-warn/15 text-warn",
  pipeline: "bg-accent/15 text-accent",
  omitted: "bg-surface-2 text-muted",
  closed: "bg-surface-2 text-muted/70",
};

export function CategoryChip({ category }: { category: ForecastCategory }) {
  return (
    <span
      className={"inline-block rounded-full px-2 py-0.5 text-xs font-medium " + CATEGORY_CLS[category]}
      role="img"
      aria-label={"forecast " + category}
    >
      {category}
    </span>
  );
}

const PRIORITY_CLS: Record<LeadPriority, string> = {
  urgent: "bg-danger/15 text-danger",
  high: "bg-warn/15 text-warn",
  normal: "bg-surface-2 text-muted",
  low: "bg-surface-2 text-muted/70",
};

export function PriorityChip({ priority }: { priority: LeadPriority }) {
  return (
    <span className={"inline-block rounded-full px-2 py-0.5 text-xs font-medium " + PRIORITY_CLS[priority]}>
      {priority}
    </span>
  );
}

const GRADE_CLS: Record<string, string> = {
  A: "bg-ok/15 text-ok",
  B: "bg-accent/15 text-accent",
  C: "bg-warn/15 text-warn",
  D: "bg-danger/15 text-danger",
};

export function GradeChip({ grade }: { grade: string }) {
  return (
    <span
      className={"inline-block rounded-full px-2.5 py-0.5 text-xs font-bold " + (GRADE_CLS[grade] ?? "bg-surface-2 text-muted")}
      role="img"
      aria-label={"health grade " + grade}
    >
      {grade}
    </span>
  );
}

/** The owner avatar-initial (a single letter in a tinted circle). */
export function AvatarInitial({ name, sub }: { name: string; sub?: string }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <span
      title={sub ? `${name} (${sub})` : name}
      role="img"
      aria-label={sub ? `${name}, ${sub}` : name}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/25 text-xs font-bold text-accent"
    >
      {initial}
    </span>
  );
}

/**
 * The UI-gate "disabled with a reason" — a `<span title=…>` +
 * `aria-disabled` pair (the parley `ReasonTooltip` pattern). The
 * reason is the visible mirror of the API's 403.
 */
export function ReasonGate({
  reason,
  children,
}: {
  /** null when allowed — renders children normally. */
  reason?: string | null;
  children: React.ReactNode;
}) {
  if (!reason) return <>{children}</>;
  return (
    <span
      title={reason}
      aria-disabled="true"
      className="inline-block opacity-50"
      data-aria-deny-reason={reason}
    >
      {children}
    </span>
  );
}

/* ── a labelled KPI tile (the cadence Kpi twin) ──────────────────── */

export function Kpi({
  label,
  value,
  delta,
  onClick,
}: {
  label: string;
  value: string;
  delta?: string;
  /** present when the KPI is a drill-down ("open the number"). */
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-foreground">{value}</div>
      {delta && <div className="mt-0.5 text-xs text-muted">{delta}</div>}
    </>
  );
  if (!onClick) {
    return <div className="rounded-xl border border-line bg-surface p-4">{inner}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-line bg-surface p-4 text-left hover:border-accent"
    >
      {inner}
      <div className="mt-1 text-[10px] text-accent">open the number →</div>
    </button>
  );
}

/* ── the accessible SVG mini-chart (the cadence pattern) ──────────── */

/**
 * A tiny horizontal bar sparkline for a series of values. Pure SVG
 * with `role="img"` + `aria-label` so the value is announced without
 * needing the shape.
 */
export function SparkBar({
  label,
  series,
  width = 120,
  height = 32,
}: {
  label: string;
  /** value → 0..1 already normalized, or raw (auto-normalized) */
  series: number[];
  width?: number;
  height?: number;
}) {
  if (series.length === 0) {
    return (
      <div
        role="img"
        aria-label={label + " — no data"}
        className="flex h-8 items-center text-xs text-muted"
      >
        —
      </div>
    );
  }
  const max = Math.max(1, ...series);
  const n = series.length;
  const gap = 2;
  const bw = (width - (n - 1) * gap) / n;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className="w-full"
      width={width}
      height={height}
    >
      {series.map((v, i) => {
        const h = (v / max) * (height - 4);
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={height - h}
            width={bw}
            height={Math.max(1, h)}
            rx={1.5}
            fill="var(--accent)"
            opacity={0.5 + 0.5 * (v / max)}
          >
            <title>{`${i + 1}: ${v}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/** The format helpers the views share. */
export function money(n: number): string {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return "$" + (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "k";
  return "$" + v.toFixed(0);
}

export function pct(ratio: number): string {
  return Math.round(ratio * 100) + "%";
}

export function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A tiny "N-day" style label for `lastStageChangeAt` staleness. */
export function stalledDays(iso: string, now: string): number {
  const a = new Date(iso).getTime();
  const b = new Date(now).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}
