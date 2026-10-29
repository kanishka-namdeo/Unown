/**
 * GET /nocturne/api/incidents/[id] — 200 the incident + its
 * timeline (sorted by `at` then `id` — the pinned render order,
 * plan §5.4/6) + notes + postmortem; 404 when unknown or
 * cross-tenant (never a 403 — plan §7/1).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { slaState, remainingMs } from "@/lib/nocturne/sla";
import { crossTenant } from "@/lib/nocturne/tenancy";
import { now as nowClock } from "@/lib/nocturne/clock";
import { getNocturne } from "@/app/nocturne/api/_state";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/nocturne/api/_auth";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "incident.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const s = getNocturne();
  const incident = s.incidents.find((i) => i.id === id);
  if (!incident || crossTenant(incident, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const tenant = s.tenants.find((t) => t.id === incident.tenantId)!;
  const service = s.services.find((x) => x.id === incident.serviceId);
  const now = nowClock();

  const timeline = s.timeline
    .filter((e) => e.incidentId === incident.id)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

  const postmortem =
    incident.postmortemId !== null
      ? s.postmortems.find((p) => p.id === incident.postmortemId) ?? null
      : null;

  return NextResponse.json({
    ...incident,
    slaState: slaState(incident, tenant, now, service),
    remainingMs: remainingMs(incident, tenant, now, service),
    timeline,
    notes: s.notes.filter((n) => n.incidentId === incident.id),
    postmortem,
  });
}
