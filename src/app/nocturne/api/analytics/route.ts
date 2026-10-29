/**
 * GET /nocturne/api/analytics — the tenant's incident-ops KPIs
 * (plan §3.9): MTTA/MTTR (resolved-only — the PBT invariant
 * §5.4/4), incident counts by severity + service, the SLA breach
 * rate, and the on-call load per paged user. `?from=&to=` is the
 * pinned clock's window (default: the last 30 days at the pinned
 * clock); the engine's input filter is the window ∩ resolved-only.
 * `analytics.read` is all-✓ in the matrix.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { analytics } from "@/lib/nocturne/analytics";
import { meanTimeToAck, meanTimeToResolve, breachRate, onCallLoad } from "@/lib/nocturne/sla";
import { resolvePageTarget } from "@/lib/nocturne/escalation";
import { now as nowClock } from "@/lib/nocturne/clock";
import type { NocturneIncident, NocturneService, NocturneState, NocturneTenant, Severity } from "@/lib/nocturne/types";
import { getNocturne } from "@/app/nocturne/api/_state";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/nocturne/api/_auth";

/** The window's default: 30 days back from the pinned clock. */
const DEFAULT_WINDOW_DAYS = 30;

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "analytics.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getNocturne();
  const tenant = s.tenants.find((t) => t.id === session.ctx.tenantId)!;
  const now = nowClock();
  const search = new URL(req.url).searchParams;

  // The window: explicit `from`/`to` ISO bounds, or the last 30
  // days at the pinned clock (plan §3.9's default).
  const fromMs = search.get("from")
    ? new Date(search.get("from")!).getTime()
    : new Date(now).getTime() - DEFAULT_WINDOW_DAYS * 86_400_000;
  const toMs = search.get("to")
    ? new Date(search.get("to")!).getTime()
    : new Date(now).getTime();

  const incidents = s.incidents.filter((i) => {
    if (i.tenantId !== tenant.id) return false;
    const t = new Date(i.triggeredAt).getTime();
    return t >= fromMs && t <= toMs;
  });
  const services = s.services.filter((x) => x.tenantId === tenant.id);
  const users = s.users.filter((u) =>
    s.memberships.some((m) => m.tenantId === tenant.id && m.userId === u.id),
  );
  const serviceOf = new Map(services.map((x) => [x.id, x]));

  // MTTA / MTTR over the window's RESOLVED incidents (the PBT
  // invariant "MTTA/MTTR over resolved only", §5.4/4).
  const resolvedInWindow = incidents.filter((i) => i.status === "resolved" && i.resolvedAt !== null);
  const mttaMs = meanTimeToAck(resolvedInWindow);
  const mttrMs = meanTimeToResolve(resolvedInWindow);

  // The breach rate over the window's resolved incidents.
  const breachRateVal = breachRate(incidents, tenant, now, services);

  // Counts by severity + service (all incidents in the window).
  const bySeverity: Record<Severity, number> = { sev1: 0, sev2: 0, sev3: 0, sev4: 0 };
  for (const i of incidents) bySeverity[i.severity]! += 1;
  const byService: Record<string, number> = {};
  for (const i of incidents) {
    byService[i.serviceId] = (byService[i.serviceId] ?? 0) + 1;
  }

  // On-call load: open incidents per paged user (the engine's
  // `pageTargetOf` shape, plan §3.9).
  const pageTargetOf = (incident: NocturneIncident): string | null => {
    if (incident.status === "resolved") return null;
    if (incident.status === "triggered") {
      const service = serviceOf.get(incident.serviceId);
      if (!service?.escalationPolicy || service.escalationPolicy.tiers.length === 0) {
        return null;
      }
      const tier = service.escalationPolicy.tiers[incident.activeTierIndex ?? 0];
      if (!tier) return null;
      return resolvePageTarget(tier, service, s, now);
    }
    return incident.acknowledgedBy;
  };
  const onCallLoadMap = onCallLoad(incidents, pageTargetOf, users);

  return NextResponse.json({
    mttaMs,
    mttrMs,
    incidentsBySeverity: bySeverity,
    incidentsByService: byService,
    breachRate: breachRateVal,
    onCallLoad: onCallLoadMap,
  });
}

export type { NocturneIncident, NocturneService, NocturneState, NocturneTenant };
