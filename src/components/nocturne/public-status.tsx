"use client";

/**
 * The PUBLIC status page (plan §3.7's tenancy exception) — the one
 * surface that reads WITHOUT authentication. A client that mounts
 * this component with no session fetches the public
 * `/nocturne/status/[slug]` route (the lean view: components +
 * active incidents, never users or schedules). It is NOT mounted
 * inside the shell (the shell is the authenticated app); it is the
 * standalone public route's client body.
 */
import { useEffect, useState } from "react";
import { useNocturne } from "@/components/nocturne/nocturne-provider";
import { ComponentStatusChip, IncidentStatusChip, SeverityChip, SlaChip } from "./primitives";

/**
 * The public status page for the tenant identified by `slug`
 * (the default is the demo tenant's slug "lumen"). It fetches the
 * public route — no session, no RBAC — and renders the lean view.
 */
export function PublicStatusPage({ slug = "lumen" }: { slug?: string }) {
  const nocturne = useNocturne();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void nocturne.loadPublicStatus(slug).then(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const s = nocturne.publicStatus;

  if (!loaded || !s) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <p className="text-sm text-muted">Loading the status page…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-lg font-bold">
        {s.tenant.name} — system status
        {s.lastUpdated && (
          <span className="ml-2 text-xs font-normal text-muted">
            updated {nocturne.fmtTimestamp(s.lastUpdated)}
          </span>
        )}
      </h1>

      {/* the component grid */}
      <section className="mt-4 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">Components</h2>
        {s.components.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No components configured.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {s.components.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <span className="font-medium">{c.name}</span>
                <div className="flex items-center gap-2">
                  {c.note && <span className="text-xs text-muted">{c.note}</span>}
                  <ComponentStatusChip status={c.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* the active incidents (the lean public view — no user ids) */}
      <section className="mt-3 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">Active incidents</h2>
        {s.activeIncidents.length === 0 ? (
          <p className="mt-2 text-xs text-ok">All systems nominal — no active incidents.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {s.activeIncidents.map((i) => (
              <li key={i.id} className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <SeverityChip severity={i.severity} />
                    <span className="truncate">{i.title}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    <IncidentStatusChip status={i.status} />
                    <span className="text-muted">{i.serviceName}</span>
                  </div>
                </div>
                {i.acknowledgedAt && (
                  <div className="mt-1 text-xs text-muted">
                    acknowledged {nocturne.fmtTimestamp(i.acknowledgedAt)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
