"use client";

/**
 * Shared presentational pieces for the Parley views. Pure: props in,
 * markup out — no store, no DOM side effects.
 */
import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/parley/sla";
import type { Priority, Status } from "@/lib/parley/types";

/* ── the live clock hook (the SLA chip ticks every 30s) ──────────── */

export function useNow(intervalMs = 30_000): string {
  const [now, setNow] = useState<string>(() => new Date().toISOString());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/* ── chips ─────────────────────────────────────────────────────────── */

const STATUS_CLS: Record<Status, string> = {
  open: "bg-accent/15 text-accent",
  pending: "bg-warn/15 text-warn",
  closed: "bg-surface-2 text-muted",
};

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className={"inline-block rounded-full px-2.5 py-0.5 text-xs font-medium " + STATUS_CLS[status]}>
      {status}
    </span>
  );
}

const PRIORITY_CLS: Record<Priority, string> = {
  urgent: "bg-danger/15 text-danger",
  high: "bg-warn/15 text-warn",
  normal: "bg-surface-2 text-muted",
  low: "bg-surface-2 text-muted/70",
};

export function PriorityChip({ priority }: { priority: Priority }) {
  return (
    <span className={"inline-block rounded-full px-2.5 py-0.5 text-xs font-medium " + PRIORITY_CLS[priority]}>
      {priority}
    </span>
  );
}

/**
 * The SLA state chip — the live ticking countdown. `ok`/`at_risk`
 * show the `useNow`-driven countdown; `breached` shows "breached";
 * `met` shows "met".
 */
export function SlaChip({
  state,
  label,
}: {
  state: "met" | "ok" | "at_risk" | "breached";
  label: string;
}) {
  const cls =
    state === "breached" ? "bg-danger/15 text-danger" :
    state === "at_risk" ? "bg-warn/15 text-warn" :
    state === "met" ? "bg-ok/15 text-ok" :
    "bg-surface-2 text-muted";
  const text = state === "breached" ? "breached" : state === "met" ? "met" : label;
  return (
    <span
      className={"inline-block rounded-full px-2.5 py-0.5 text-xs font-medium " + cls}
      role="img"
      aria-label={"SLA " + state}
    >
      {text}
    </span>
  );
}

/**
 * The UI-gate "disabled with a reason tooltip" — a `<span title=…>`
 * + a `disabled`/`aria-disabled` pair. The brief's "buttons/panels
 * hidden or disabled with a reason tooltip" — the reason is visible
 * (the more useful of the two options the brief allows).
 */
export function ReasonTooltip({
  reason,
  children,
  disabled,
}: {
  reason?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  if (!reason) return <>{children}</>;
  return (
    <span
      title={reason}
      aria-disabled={disabled || undefined}
      className={"inline-block " + (disabled ? "opacity-60" : "")}
    >
      {children}
    </span>
  );
}

/** A progress bar (the usage panel's quota bar). */
export function ProgressBar({
  used,
  cap,
  label,
}: {
  used: number;
  cap: number;
  label: string;
}) {
  const pct = cap === 0 ? 0 : Math.min(100, Math.round((used / cap) * 100));
  const over = used > cap;
  return (
    <div
      role="img"
      aria-label={`${label}: ${used} of ${cap}${over ? " (over)" : ""}`}
      className="w-full"
    >
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className={over ? "font-bold text-danger" : "text-muted"}>
          {used} / {cap}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={"h-full " + (over ? "bg-danger" : "bg-accent-strong")}
          style={{ width: pct + "%" }}
        />
      </div>
      {over && (
        <div className="mt-1 text-xs font-semibold text-danger">
          Over cap — upgrade your plan
        </div>
      )}
    </div>
  );
}

/** A labelled KPI tile (the cadence Kpi twin). */
export function Kpi({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
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

/**
 * Empty state — three variants (the brief's "empty states
 * everywhere"): no conversations, no selection, no filter results.
 */
export function EmptyState({
  kind = "no-conversations",
  actionLabel,
  onAction,
}: {
  kind?: "no-conversations" | "no-selection" | "no-results";
  actionLabel?: string;
  onAction?: () => void;
}) {
  const copy: Record<string, { glyph: string; title: string; body: string }> = {
    "no-conversations": {
      glyph: "📭",
      title: "No conversations",
      body: "Nothing here yet. A new conversation will appear in this list.",
    },
    "no-selection": {
      glyph: "◍",
      title: "Select a conversation",
      body: "Pick a conversation from the list to see its thread.",
    },
    "no-results": {
      glyph: "⌕",
      title: "No results",
      body: "No conversations match this filter. Try a different one.",
    },
  };
  const c = copy[kind];
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center">
      <div className="text-3xl" aria-hidden="true">{c.glyph}</div>
      <h2 className="mt-2 font-bold">{c.title}</h2>
      <p className="mt-1 text-sm text-muted">{c.body}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-4 rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
