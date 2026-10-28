"use client";

/**
 * Small shared presentational pieces for the Cadence views. Pure: props in,
 * markup out — no store, no DOM side effects.
 */

/**
 * A flame glyph + a number: the current streak badge for a habit.
 * `aria-label` reads it out to screen readers ("N-day streak").
 */
export function StreakChip({ days }: { days: number }) {
  return (
    <span
      role="img"
      aria-label={days + "-day streak"}
      className={
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold " +
        (days > 0 ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted")
      }
    >
      <span aria-hidden="true">{days > 0 ? "🔥" : "·"}</span>
      {days}
    </span>
  );
}

/** A labelled KPI tile: the value is the hero, the label stays muted. */
export function Kpi({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  /** optional trailing context, e.g. "of 30 days" */
  delta?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-foreground">{value}</div>
      {delta && <div className="mt-0.5 text-xs text-muted">{delta}</div>}
    </div>
  );
}

/** Five swatches, level 0–4, for the heatmap's intensity scale. */
const LEVEL_CLASSES = [
  "bg-surface-2",
  "bg-accent/30",
  "bg-accent/55",
  "bg-accent/80",
  "bg-accent-strong",
];

export function IntensityLegend() {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted" role="img" aria-label="Heatmap intensity legend, level 0 to 4">
      <span>less</span>
      {LEVEL_CLASSES.map((cls, i) => (
        <span key={i} aria-hidden="true" className={"h-3 w-3 rounded-sm " + cls} />
      ))}
      <span>more</span>
    </div>
  );
}

/** The class for one heatmap cell, given an intensity level 0–4. */
export function levelClass(level: number): string {
  return LEVEL_CLASSES[Math.max(0, Math.min(4, Math.round(level)))];
}

/**
 * SVG donut: a percent ring, 0–100. `role="img"` with an `aria-label` so the
 * value is announced without needing the shape.
 */
export function CompletionRing({
  percent,
  size = 72,
  label,
}: {
  /** 0–100 */
  percent: number;
  size?: number;
  label: string;
}) {
  const p = Math.max(0, Math.min(100, percent));
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - p / 100);
  return (
    <div
      role="img"
      aria-label={label}
      className="relative inline-block shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-xs font-bold text-foreground"
        aria-hidden="true"
      >
        {Math.round(p)}%
      </span>
    </div>
  );
}
