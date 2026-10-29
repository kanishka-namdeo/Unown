"use client";

/**
 * The postmortems view — the tenant's postmortems (the root-cause
 * writeups on resolved incidents) + the postmortem detail (the
 * summary deltas + the action items with the `postmortem.action`
 * lane).
 */
import { useNocturne } from "@/components/nocturne/nocturne-provider";
import { postmortemDeltas } from "@/lib/nocturne/postmortem";
import { ReasonGate, IncidentStatusChip } from "./primitives";

export function PostmortemsView() {
  const nocturne = useNocturne();
  const detail = nocturne.postmortemDetail;

  if (detail) {
    return <PostmortemDetail onBack={() => void nocturne.openPostmortem(null)} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{nocturne.postmortems.length} postmortems</span>
      </div>
      {nocturne.postmortems.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          No postmortems written yet.
        </div>
      ) : (
        <ul className="space-y-1.5" aria-label="Postmortems">
          {nocturne.postmortems.map((pm) => {
            const incident = nocturne.incidents.find((i) => i.id === pm.incidentId);
            return (
              <li key={pm.id}>
                <button
                  type="button"
                  onClick={() => void nocturne.openPostmortem(pm.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left hover:border-accent"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {incident?.title ?? pm.incidentId}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {pm.actionItems.length} action items · written {nocturne.fmtTimestamp(pm.createdAt)}
                    </div>
                  </div>
                  {incident && <IncidentStatusChip status={incident.status} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The postmortem detail: the writeup + the summary deltas + the
 * action items (the `postmortem.action` lane). */
function PostmortemDetail({ onBack }: { onBack: () => void }) {
  const nocturne = useNocturne();
  const pm = nocturne.postmortemDetail!;
  const incident = nocturne.incidents.find((i) => i.id === pm.incidentId);
  const deltas = postmortemDeltas(pm);

  const denyAction = nocturne.denyReason("postmortem.action");

  const summary = [
    deltas.triggerToAckMs !== null ? "ack " + nocturne.fmt.duration(deltas.triggerToAckMs) : null,
    "total " + nocturne.fmt.duration(deltas.triggerToResolveMs),
    deltas.ackToResolveMs !== null ? "resolve " + nocturne.fmt.duration(deltas.ackToResolveMs) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg border border-line bg-surface-2 px-3 py-1 text-sm text-muted hover:text-foreground"
      >
        ← All postmortems
      </button>

      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{incident?.title ?? pm.incidentId}</h2>
          <span className="text-xs text-muted">{summary}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm">{pm.body}</p>
      </section>

      {pm.actionItems.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4">
          <h3 className="text-sm font-bold">Action items</h3>
          {denyAction && <p className="mt-1 text-xs text-muted">{denyAction}</p>}
          <ul className="mt-2 space-y-1.5">
            {pm.actionItems.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <ReasonGate reason={denyAction}>
                  <input
                    type="checkbox"
                    aria-label={"action " + a.title}
                    checked={a.done}
                    disabled={!!denyAction}
                    onChange={(e) => void nocturne.setPostmortemAction(pm.id, a.id, e.target.checked)}
                  />
                </ReasonGate>
                <span className={a.done ? "line-through text-muted" : ""}>{a.title}</span>
                <span className="ml-auto text-xs text-muted">
                  {a.assigneeId !== null ? nocturne.userName(a.assigneeId) : "unassigned"}
                  {a.due !== null ? " · due " + nocturne.fmtTimestamp(a.due) : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
