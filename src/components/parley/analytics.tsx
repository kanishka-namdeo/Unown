/**
 * The Analytics view — the read-only dashboard: the volume-by-
 * status donut (accessible SVG, `role="img"` + `aria-label`, the
 * cadence stats-chart pattern), the median first-response KPI, the
 * resolution-rate KPI, and the per-agent load.
 */
import { useParley } from "@/app/parley/client-store";
import { Kpi, EmptyState } from "./primitives";

const SEGMENTS = [
  { key: "open", color: "var(--accent)" },
  { key: "pending", color: "var(--warn)" },
  { key: "closed", color: "var(--muted)" },
] as const;

export function AnalyticsView() {
  const parley = useParley();
  const a = parley.analytics;

  if (!a) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState kind="no-conversations" />
        <p className="mt-3 text-center text-xs text-muted">
          You don't have analytics.read permission, or the data is still loading.
        </p>
      </div>
    );
  }

  const total = a.volumeByStatus.open + a.volumeByStatus.pending + a.volumeByStatus.closed;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-xl font-bold">Analytics</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Median first response" value={a.medianFirstResponseLabel} />
        <Kpi
          label="Resolution rate"
          value={a.resolutionRatePercent.toFixed(0) + "%"}
          delta="of conversations replied to"
        />
        <Kpi label="Open" value={String(a.volumeByStatus.open)} />
        <Kpi label="Total" value={String(total)} />
      </div>

      <div className="flex items-center gap-6 rounded-xl border border-line bg-surface p-4">
        <VolumeDonut
          data={a.volumeByStatus}
          label={"Conversations by status: " + a.volumeByStatus.open + " open, " + a.volumeByStatus.pending + " pending, " + a.volumeByStatus.closed + " closed"}
        />
        <ul className="flex-1 space-y-1.5 text-sm">
          {SEGMENTS.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
              <span className="text-muted" style={{ textTransform: "capitalize" }}>{s.key}</span>
              <span className="ml-auto font-semibold">{a.volumeByStatus[s.key]}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">Per-agent load</h2>
        <p className="mb-2 text-xs text-muted">Open conversations per assignee</p>
        {Object.keys(a.perAgentLoad).length === 0 ? (
          <p className="text-xs text-muted">No open conversations.</p>
        ) : (
          <ul className="space-y-1.5">
            {Object.entries(a.perAgentLoad)
              .sort((x, y) => y[1] - x[1])
              .map(([assignee, count]) => (
                <li key={assignee} className="flex items-center gap-2 text-sm">
                  <span className="w-32 truncate text-muted">
                    {assignee === "__unassigned" ? "Unassigned" : assignee}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full bg-accent-strong"
                      style={{
                        width:
                          Math.min(
                            100,
                            (count / Math.max(1, ...Object.values(a.perAgentLoad))) * 100,
                          ) + "%",
                      }}
                    />
                  </div>
                  <span className="w-6 text-right font-semibold">{count}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * A pure-SVG donut: three segments (open / pending / closed).
 * `role="img"` + an `aria-label` so the values are announced without
 * needing the shape (the cadence stats-chart pattern).
 */
export function VolumeDonut({
  data,
  label,
  size = 120,
}: {
  data: { open: number; pending: number; closed: number };
  label: string;
  size?: number;
}) {
  const total = data.open + data.pending + data.closed;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  let remaining = total;
  const arcs = SEGMENTS.map((s) => {
    const value = data[s.key];
    const frac = total === 0 ? 0 : value / total;
    const dash = frac * c;
    const offset = -remaining * (c / Math.max(total, 1));
    remaining -= value;
    return { ...s, dash, offset, value };
  });

  return (
    <div role="img" aria-label={label} className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={"0 0 " + size + " " + size}>
        <g transform={"rotate(-90 " + size / 2 + " " + size / 2 + ")"}>
          {arcs.map((a) =>
            a.value > 0 ? (
              <circle
                key={a.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={stroke}
                strokeDasharray={`${a.dash} ${c - a.dash}`}
                strokeDashoffset={a.offset}
              >
                <title>
                  {a.key}: {a.value}
                </title>
              </circle>
            ) : null,
          )}
        </g>
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="rounded-full bg-surface px-2 py-1 text-xs font-bold">{total}</span>
      </span>
    </div>
  );
}
