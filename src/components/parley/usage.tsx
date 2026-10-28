/**
 * The Usage view — the usage panel: the conversations-this-month vs
 * plan-cap progress bar + the overage warning (Northwind's seeded
 * 47/50 shows the near-cap state), the seats-used vs cap, the per-
 * agent load, and the 402 `quota_exceeded` upgrade prompt.
 */
import { useParley } from "@/app/parley/client-store";
import { Kpi, ProgressBar, EmptyState } from "./primitives";

export function UsageView() {
  const parley = useParley();
  const usage = parley.usage;

  if (!usage) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState kind="no-conversations" />
        <p className="mt-3 text-center text-xs text-muted">
          You don't have usage.read permission, or the data is still loading.
        </p>
      </div>
    );
  }

  const nearCap = !usage.overage.convos.over && usage.overage.convos.used / usage.overage.convos.cap >= 0.9;
  const upgrade = nearCap || usage.overage.convos.over;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-xl font-bold">Usage</h1>

      <div className="grid grid-cols-2 gap-4">
        <Kpi
          label={"Conversations this month (" + usage.plan + " plan)"}
          value={String(usage.conversationsThisMonth)}
          delta={"of " + usage.overage.convos.cap + " / month"}
        />
        <Kpi
          label="Seats used"
          value={String(usage.seatsUsed)}
          delta={"of " + usage.overage.seats.cap + " seats"}
        />
      </div>

      <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
        <ProgressBar
          used={usage.overage.convos.used}
          cap={usage.overage.convos.cap}
          label="Conversations this month"
        />
        <ProgressBar
          used={usage.overage.seats.used}
          cap={usage.overage.seats.cap}
          label="Seats"
        />
      </div>

      {upgrade && (
        <div
          role="alert"
          className={
            "rounded-xl border p-4 text-sm " +
            (usage.overage.convos.over
              ? "border-danger bg-danger/10 text-danger"
              : "border-warn bg-warn/10 text-warn")
          }
        >
          {usage.overage.convos.over
            ? "You're over your plan's conversation cap — new conversations will be blocked until you upgrade."
            : "You're near your plan's conversation cap. Upgrade to keep creating conversations this month."}
          <div className="mt-2 text-xs opacity-80">
            This is the 402 <code className="font-mono">quota_exceeded</code> upgrade prompt — the
            plan cap is the billing boundary, not a rate limit.
          </div>
        </div>
      )}

      {/* Per-agent load (open conversations per assignee) */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">Per-agent load</h2>
        <p className="mb-2 text-xs text-muted">Open conversations per assignee</p>
        {Object.keys(usage.perAgentLoad).length === 0 ? (
          <p className="text-xs text-muted">No open conversations.</p>
        ) : (
          <ul className="space-y-1.5">
            {Object.entries(usage.perAgentLoad)
              .sort((a, b) => b[1] - a[1])
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
                            (count / Math.max(1, ...Object.values(usage.perAgentLoad))) * 100,
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
