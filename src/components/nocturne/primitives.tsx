"use client";

/**
 * Shared presentational pieces for the Nocturne views. Pure: props
 * in, markup out — no store, no DOM side effects. Follows the cadence
 * chart + primitives conventions (accessible SVG, `role="img"` +
 * `aria-label`) and the parley disabled-with-reason pattern.
 */
import type { NocturneComponentStatus, NocturneRole, Severity } from "@/lib/nocturne/types";
import { MATRIX, type Action } from "@/lib/nocturne/rbac";

/* ── chips ─────────────────────────────────────────────────────────── */

const SEVERITY_CLS: Record<Severity, string> = {
  sev1: "bg-danger/15 text-danger",
  sev2: "bg-warn/15 text-warn",
  sev3: "bg-accent/15 text-accent",
  sev4: "bg-surface-2 text-muted",
};

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span
      className={"inline-block rounded-full px-2 py-0.5 text-xs font-medium " + SEVERITY_CLS[severity]}
      role="img"
      aria-label={"severity " + severity}
    >
      {severity}
    </span>
  );
}

const STATUS_CLS: Record<NocturneComponentStatus, string> = {
  operational: "bg-ok/15 text-ok",
  degraded: "bg-warn/15 text-warn",
  down: "bg-danger/15 text-danger",
  maintenance: "bg-accent/15 text-accent",
  unknown: "bg-surface-2 text-muted",
};

export function ComponentStatusChip({ status }: { status: NocturneComponentStatus }) {
  return (
    <span
      className={"inline-block rounded-full px-2 py-0.5 text-xs font-medium " + STATUS_CLS[status]}
      role="img"
      aria-label={"component " + status}
    >
      {status}
    </span>
  );
}

const SLA_CLS: Record<string, string> = {
  met: "bg-ok/15 text-ok",
  ok: "bg-ok/15 text-ok",
  at_risk: "bg-warn/15 text-warn",
  breached: "bg-danger/15 text-danger",
};

/** The SLA-state chip (met / ok / at_risk / breached). */
export function SlaChip({ state, label }: { state: string; label?: string }) {
  return (
    <span
      className={"inline-block rounded-full px-2 py-0.5 text-xs font-medium " + (SLA_CLS[state] ?? "bg-surface-2 text-muted")}
      role="img"
      aria-label={"sla " + state}
    >
      {label ?? state}
    </span>
  );
}

const INCIDENT_STATUS_CLS: Record<string, string> = {
  triggered: "bg-danger/15 text-danger",
  acknowledged: "bg-warn/15 text-warn",
  snoozed: "bg-accent/15 text-accent",
  resolved: "bg-surface-2 text-muted",
};

export function IncidentStatusChip({ status }: { status: string }) {
  return (
    <span
      className={"inline-block rounded-full px-2 py-0.5 text-xs font-medium " + (INCIDENT_STATUS_CLS[status] ?? "bg-surface-2 text-muted")}
      role="img"
      aria-label={"incident " + status}
    >
      {status}
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
 * `aria-disabled` pair (the parley `ReasonGate` pattern). The
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
      data-nocturne-deny-reason={reason}
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

/* ── format helpers (the lib's pure helpers, re-exported for views) */

/** A short "MMM D" date for an ISO timestamp (display only). */
export function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The static RBAC matrix cell for a view (what each role CAN do —
 * the plan's "the RBAC matrix visibility" surface). */
export function grantOf(action: Action, role: NocturneRole): boolean {
  return MATRIX[action]?.[role] ?? false;
}

export function pct(ratio: number): string {
  return Math.round(ratio * 100) + "%";
}
