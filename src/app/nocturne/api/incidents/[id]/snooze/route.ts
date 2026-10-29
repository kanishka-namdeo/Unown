/**
 * POST /nocturne/api/incidents/[id]/snooze — snooze an incident
 * (plan §3.5, the `incident.snooze` lane). 200 the incident row
 * (status → `snoozed`, `snoozedUntil` set, the timeline event
 * appended; the SLA timer freezes while snoozed — plan §4.5);
 * 400 when the incident is resolved (the terminal is final) or when
 * `until` is malformed; 404 when unknown or cross-tenant.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { snoozeIncident } from "@/lib/nocturne/incident";
import { validateSnooze } from "@/lib/nocturne/validation";
import { now as nowClock } from "@/lib/nocturne/clock";
import { crossTenant } from "@/lib/nocturne/tenancy";
import { getNocturne, nocturneTransaction, nextId } from "@/app/nocturne/api/_state";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
  invalidJsonResponse,
} from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("incident snoozes"), { status: 429 });
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

  const denied = requirePermission(session.role, "incident.snooze");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as { until?: string };
  const { errors } = validateSnooze({ until: String(input.until ?? "") });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  // The terminal is final (plan §4.6): a resolved incident cannot
  // snooze.
  if (incident.status === "resolved") {
    return NextResponse.json(
      {
        error: "validation failed",
        errors: ["cannot snooze a resolved incident — the terminal state is final."],
      },
      { status: 400 },
    );
  }

  const ctx = { now: nowClock, nextId };
  nocturneTransaction((st) => {
    const { state, result } = snoozeIncident(
      st,
      id,
      session.user.id,
      String(input.until),
      ctx,
    );
    if ("ok" in result && result.ok === false) throw new Error(result.error);
    return state;
  });

  const fresh = getNocturne();
  const updated = fresh.incidents.find((i) => i.id === id)!;
  return NextResponse.json(updated);
}
