/**
 * POST /nocturne/api/incidents/[id]/escalate — manually advance the
 * escalation tier (plan §3.5, the `incident.escalate` lane). 200
 * the incident row (`activeTierIndex` advanced); 400 when the
 * incident is resolved (the terminal is final) or when there is no
 * escalation policy to advance through; 404 when unknown or
 * cross-tenant.
 *
 * The tick runs the lib's `tickEscalation` when its wait window has
 * elapsed; when it has NOT elapsed the manual lane still advances
 * the tier (a responder's explicit escalation overrides the timer —
 * the plan's "tier advanced manually"). The engine is the single
 * source of truth for the tier-invariant guard (a resolved or
 * non-triggered incident refuses to advance).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { tickEscalation } from "@/lib/nocturne/escalation";
import { now as nowClock } from "@/lib/nocturne/clock";
import { crossTenant } from "@/lib/nocturne/tenancy";
import type { NocturneIncident } from "@/lib/nocturne/types";
import { getNocturne, nocturneTransaction, nextId } from "@/app/nocturne/api/_state";import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("incident escalations"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id } = await params;
  const s0 = getNocturne();
  const incident = s0.incidents.find((i) => i.id === id);
  // Cross-tenant rung FIRST (404, never a 403 that confirms existence).
  if (!incident || crossTenant(incident, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const denied = requirePermission(session.role, "incident.escalate");
  if (denied) return NextResponse.json(denied, { status: 403 });

  // The terminal is final: a resolved incident never escalates
  // (plan §4.3 invariant — 400, not a silent no-op).
  if (incident.status === "resolved") {
    return NextResponse.json(
      {
        error: "validation failed",
        errors: ["cannot escalate a resolved incident — the terminal state is final."],
      },
      { status: 400 },
    );
  }

  // No policy to advance through → 400 (the plan's "no policy" rung).
  const service = s0.services.find((x) => x.id === incident.serviceId);
  const tiers = service?.escalationPolicy?.tiers ?? [];
  if (tiers.length === 0) {
    return NextResponse.json(
      {
        error: "validation failed",
        errors: ["the incident's service has no escalation policy to advance."],
      },
      { status: 400 },
    );
  }
  const currentTier = incident.activeTierIndex ?? 0;
  if (currentTier >= tiers.length - 1) {
    return NextResponse.json(
      {
        error: "validation failed",
        errors: ["the incident is already at its final escalation tier."],
      },
      { status: 400 },
    );
  }

  const ctx = { now: nowClock, nextId };
  // The engine's guard only fires when the window has elapsed; the
  // manual lane advances regardless of the wait — so run the engine
  // tick and, when it declined (window not elapsed), apply the
  // manual advance through the same shape (the plan's "manual"
  // semantics: an explicit paged action, not a timer expiry).
  let fired = false;
  nocturneTransaction((st) => {
    const tick = tickEscalation(st, id, ctx);
    fired = tick.result.fired;
    return tick.state;
  });
  if (!fired) {
    // The window has not elapsed: the manual advance is the
    // responder's explicit call. Advance the tier + append the
    // `escalated` evidence through the store's atomic lane.
    nocturneTransaction((st) => {
      const fresh = st.incidents.find((i) => i.id === id)!;
      const newTier = (fresh.activeTierIndex ?? 0) + 1;
      const advanced: NocturneIncident = {
        ...fresh,
        activeTierIndex: newTier,
        lastEscalatedAt: nowClock(),
      };
      return {
        ...st,
        incidents: st.incidents.map((i) => (i.id === id ? advanced : i)),
        timeline: [
          ...st.timeline,
          {
            id: nextId("evt"),
            tenantId: fresh.tenantId,
            incidentId: fresh.id,
            kind: "escalated" as const,
            actorId: session.user.id,
            meta: { tier: newTier, manual: true },
            at: nowClock(),
          },
        ],
      };
    });
  }

  const updated = getNocturne().incidents.find((i) => i.id === id)!;
  return NextResponse.json(updated);
}
