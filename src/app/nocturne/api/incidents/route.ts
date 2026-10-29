/**
 * GET /nocturne/api/incidents — the tenant's incidents, filtered by
 * `?serviceId=` / `?status=` / `?severity=` (plan §3.5). Each row
 * carries the computed `slaState` (the lib's `slaState` engine) +
 * `primaryOnCall` (the current tier's page target, or the ack owner
 * once acknowledged). `incident.list` is all-✓.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { slaState, remainingMs } from "@/lib/nocturne/sla";
import { resolvePageTarget } from "@/lib/nocturne/escalation";
import { now as nowClock } from "@/lib/nocturne/clock";
import type { NocturneIncident, NocturneState } from "@/lib/nocturne/types";
import { getNocturne } from "@/app/nocturne/api/_state";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/nocturne/api/_auth";

/** The paged user id for an open incident (the plan's schedule-aware surface). */
function primaryOnCallOf(
  s: NocturneState,
  incident: NocturneIncident,
  services: NocturneState["services"],
  now: string,
): string | null {
  if (incident.status === "resolved") return null;
  if (incident.status === "triggered") {
    const service = services.find((x) => x.id === incident.serviceId);
    if (!service?.escalationPolicy || service.escalationPolicy.tiers.length === 0) {
      return null;
    }
    const tier = service.escalationPolicy.tiers[incident.activeTierIndex ?? 0];
    if (!tier) return null;
    return resolvePageTarget(tier, service, s, now);
  }
  // acknowledged / snoozed: the ack owner is the paged user.
  return incident.acknowledgedBy;
}

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "incident.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getNocturne();
  const tenant = s.tenants.find((t) => t.id === session.ctx.tenantId)!;
  const services = s.services.filter((x) => x.tenantId === tenant.id);
  const now = nowClock();

  const search = new URL(req.url).searchParams;
  const serviceId = search.get("serviceId") ?? undefined;
  const status = search.get("status") ?? undefined;
  const severity = search.get("severity") ?? undefined;

  const out = s.incidents
    .filter((i) => i.tenantId === tenant.id)
    .filter((i) => (serviceId ? i.serviceId === serviceId : true))
    .filter((i) => (status ? i.status === status : true))
    .filter((i) => (severity ? i.severity === severity : true))
    .map((i) => {
      const svc = services.find((x) => x.id === i.serviceId);
      return {
        ...i,
        slaState: slaState(i, tenant, now, svc),
        remainingMs: remainingMs(i, tenant, now, svc),
        primaryOnCall: primaryOnCallOf(s, i, services, now),
      };
    });
  return NextResponse.json(out);
}
