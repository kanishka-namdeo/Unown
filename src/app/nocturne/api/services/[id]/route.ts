/**
 * GET /nocturne/api/services/[id] — 200 the service + its incidents
 * + its runbooks; 404 when the id is unknown or belongs to another
 * tenant (cross-tenant → 404, never a 403 — plan §7/1).
 *
 * PATCH /nocturne/api/services/[id] — the `service.update` lane
 * (owner + admin). 400 on a bad shape, 200 the updated row.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { crossTenant } from "@/lib/nocturne/tenancy";
import { validateService } from "@/lib/nocturne/validation";
import type { NocturneService, NocturneState, Severity } from "@/lib/nocturne/types";
import { getNocturne, nocturneTransaction } from "@/app/nocturne/api/_state";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
  invalidJsonResponse,
} from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

function findService(s: NocturneState, id: string): NocturneService | undefined {
  return s.services.find((x) => x.id === id);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "service.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const s = getNocturne();
  const service = findService(s, id);
  if (!service || crossTenant(service, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }
  const tenantId = service.tenantId;
  return NextResponse.json({
    ...service,
    incidents: s.incidents.filter(
      (i) => i.tenantId === tenantId && i.serviceId === service.id,
    ),
    runbooks: s.runbooks.filter(
      (r) => r.tenantId === tenantId && r.serviceId === service.id,
    ),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("service updates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id } = await params;
  const s = getNocturne();
  const service = findService(s, id);
  // Cross-tenant rung FIRST (404, never a 403 that confirms existence).
  if (!service || crossTenant(service, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const denied = requirePermission(session.role, "service.update");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as {
    name?: string;
    description?: string;
    rotationId?: string | null;
    escalationPolicy?: NocturneService["escalationPolicy"];
    slaOverride?: Record<Severity, number> | null;
  };
  const { errors } = validateService({
    name: input.name ?? service.name,
    description: input.description ?? service.description,
    rotationId: input.rotationId !== undefined ? input.rotationId : service.rotationId,
    escalationPolicy: input.escalationPolicy ?? service.escalationPolicy,
    slaOverride: input.slaOverride !== undefined ? input.slaOverride : service.slaOverride,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  // A rotation change is tenancy-checked the same way as create.
  if (input.rotationId !== undefined && input.rotationId !== null && input.rotationId !== "") {
    const rotation = s.rotations.find((r) => r.id === input.rotationId);
    if (!rotation || rotation.tenantId !== service.tenantId) {
      return NextResponse.json(notFoundResponse(), { status: 404 });
    }
  }

  const updated: NocturneService = {
    ...service,
    ...(input.name !== undefined ? { name: String(input.name).trim() } : {}),
    ...(input.description !== undefined ? { description: String(input.description) } : {}),
    ...(input.rotationId !== undefined ? { rotationId: input.rotationId } : {}),
    ...(input.escalationPolicy !== undefined ? { escalationPolicy: input.escalationPolicy } : {}),
    ...(input.slaOverride !== undefined ? { slaOverride: input.slaOverride } : {}),
  };
  nocturneTransaction((state) => ({
    ...state,
    services: state.services.map((x) => (x.id === service.id ? updated : x)),
  }));
  return NextResponse.json(updated);
}
