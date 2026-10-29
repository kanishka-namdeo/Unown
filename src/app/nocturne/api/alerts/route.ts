/**
 * GET /nocturne/api/alerts — the tenant's alerts, filtered by
 * `?serviceId=` / `?severity=` / `?incidentId=` (plan §3.5).
 * Newest-first (by `lastSeenAt`), carrying the dedup `count` chip
 * data. `alert.list` is all-✓ in the matrix.
 *
 * POST /nocturne/api/alerts — the atomic ingest lane
 * (plan §3.5 + §4.1/§4.2 + Phase 2 acceptance: dedup + correlation
 * in ONE atomic call, under the store lock — the P1 dedup-race
 * mitigation, plan §7/4).
 *
 * 201 `{ alert, incident, deduped, correlated }`:
 *  - dedup: same `(serviceId, dedupKey)` within the 60s window
 *    merges into the existing logical alert (`count++`);
 *  - correlate: a standalone alert joins the single open incident on
 *    the same service + severity (within 5 min of the trigger);
 *  - otherwise a NEW incident is born from the alert (the plan's
 *    §4.2 step 3 — the caller's decision).
 *
 * 400 on a bad shape; 404 when the service is unknown or belongs to
 * another tenant (never a 403 — plan §7/1).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { mergeDedup } from "@/lib/nocturne/dedup";
import { correlate } from "@/lib/nocturne/correlate";
import { validateIngestAlert } from "@/lib/nocturne/validation";
import { now as nowClock } from "@/lib/nocturne/clock";
import { crossTenant } from "@/lib/nocturne/tenancy";
import type {
  NocturneAlert,
  NocturneIncident,
  NocturneState,
  NocturneTimelineEvent,
  Severity,
} from "@/lib/nocturne/types";
import {
  getNocturne,
  nocturneTransaction,
  nextId,
} from "@/app/nocturne/api/_state";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
  invalidJsonResponse,
} from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

/** The atomic ingest's output (the 201 body, plan §3.5). */
interface IngestResult {
  alert: NocturneAlert;
  incident: NocturneIncident | null;
  deduped: boolean;
  correlated: boolean;
}

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "alert.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getNocturne();
  const search = new URL(req.url).searchParams;
  const serviceId = search.get("serviceId") ?? undefined;
  const severity = search.get("severity") ?? undefined;
  const incidentId = search.get("incidentId") ?? undefined;

  const out = s.alerts
    .filter((a) => a.tenantId === session.ctx.tenantId)
    .filter((a) => (serviceId ? a.serviceId === serviceId : true))
    .filter((a) => (severity ? a.severity === severity : true))
    .filter((a) => (incidentId ? a.incidentId === incidentId : true))
    .sort(
      (a, b) =>
        new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime() ||
        a.id.localeCompare(b.id),
    );
  return NextResponse.json(out);
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("alert ingests"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "alert.ingest");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as {
    serviceId?: string;
    dedupKey?: string;
    title?: string;
    body?: string;
    severity?: Severity;
    firedAt?: string;
  };
  const { errors } = validateIngestAlert({
    serviceId: String(input.serviceId ?? ""),
    dedupKey: String(input.dedupKey ?? ""),
    title: String(input.title ?? ""),
    body: String(input.body ?? ""),
    severity: input.severity as Severity,
    firedAt: input.firedAt,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const s0 = getNocturne();
  // The service must exist AND belong to the caller's tenant
  // (cross-tenant → 404, never a 403 — plan §7/1).
  const service = s0.services.find((x) => x.id === String(input.serviceId));
  if (!service || crossTenant(service, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const tenantId = session.ctx.tenantId;
  const dedupKey = String(input.dedupKey ?? "").trim();
  const firedAt =
    input.firedAt !== undefined && String(input.firedAt).trim() !== ""
      ? String(input.firedAt)
      : nowClock();

  // Everything the result depends on is computed INSIDE the one
  // atomic transaction: dedup → correlate → spawn (when standalone)
  // → the response row. No second read of the store is needed.
  let result: IngestResult | null = null;
  nocturneTransaction((st) => {
    const ctx = { now: nowClock, nextId };

    const merged = mergeDedup(
      st,
      tenantId,
      service.id,
      dedupKey,
      {
        title: String(input.title ?? "").trim(),
        body: String(input.body ?? ""),
        severity: input.severity!,
        firedAt,
      },
      ctx,
    );

    if (merged.result.deduped) {
      // The merge path: `count` advanced on the existing row; the
      // incident (if any) is untouched. The ×N chip is the row's
      // `count` field; the timeline's `alert_deduped` trail rows are
      // the seed's narrative evidence (the engine itself is
      // evidence-neutral — plan §4.1 step 2).
      result = {
        alert: merged.result.alert,
        incident: merged.result.incident,
        deduped: true,
        correlated: false,
      };
      return merged.state;
    }

    const linked = correlate(merged.state, merged.result.alert.id, ctx);

    if (linked.result.correlated) {
      result = {
        alert: linked.result.alert,
        incident: linked.result.incident,
        deduped: false,
        correlated: true,
      };
      return linked.state;
    }

    if (linked.result.alert.incidentId !== null) {
      // Defensive: a fresh standalone row's incidentId is null; this
      // branch keeps the shape honest without mutating the store.
      result = {
        alert: linked.result.alert,
        incident: linked.result.incident,
        deduped: false,
        correlated: false,
      };
      return linked.state;
    }

    // Plan §4.2 step 3: no open incident matched → a NEW incident is
    // born from the alert (the `alert.ingest` decision the
    // correlation engine leaves to the caller).
    const state = spawnIncident(linked.state, linked.result.alert, ctx);
    const incident = state.incidents.find((i) => i.id === linked.result.alert.incidentId)!;
    result = {
      alert: state.alerts.find((a) => a.id === linked.result.alert.id)!,
      incident,
      deduped: false,
      correlated: false,
    };
    return state;
  });

  // Defensive: the transaction always ran.
  if (result === null) throw new Error("ingest transaction produced no result");
  return NextResponse.json(result, { status: 201 });
}

/** Spawn a new incident from a standalone alert (plan §4.2 step 3). */
function spawnIncident(
  state: NocturneState,
  alert: NocturneAlert,
  ctx: { now(): string; nextId(p: string): string },
): NocturneState {
  const incident: NocturneIncident = {
    id: ctx.nextId("inc"),
    tenantId: alert.tenantId,
    serviceId: alert.serviceId,
    title: alert.title,
    severity: alert.severity,
    status: "triggered",
    triggeredAt: alert.firedAt,
    acknowledgedAt: null,
    acknowledgedBy: null,
    snoozedUntil: null,
    resolvedAt: null,
    resolvedBy: null,
    postmortemId: null,
    activeTierIndex: 0,
    lastEscalatedAt: null,
    createdAt: ctx.now(),
  };
  const linkedAlert = { ...alert, incidentId: incident.id };
  let s: NocturneState = {
    ...state,
    incidents: [...state.incidents, incident],
    alerts: state.alerts.map((a) => (a.id === alert.id ? linkedAlert : a)),
  };
  // The two timeline events: the alert's receipt + the incident's
  // birth (the at-then-id ordering keeps the UI's render order).
  const events: NocturneTimelineEvent[] = [
    {
      id: ctx.nextId("evt"),
      tenantId: alert.tenantId,
      incidentId: incident.id,
      kind: "alert_received",
      actorId: null,
      meta: { alertId: alert.id },
      at: incident.triggeredAt,
    },
    {
      id: ctx.nextId("evt"),
      tenantId: alert.tenantId,
      incidentId: incident.id,
      kind: "incident_created",
      actorId: null,
      meta: { severity: incident.severity, title: incident.title },
      at: incident.triggeredAt,
    },
  ];
  s = { ...s, timeline: [...s.timeline, ...events] };
  return s;
}
