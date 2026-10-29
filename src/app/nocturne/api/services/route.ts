/**
 * GET /nocturne/api/services — the tenant's services + the computed
 * `primaryOnCall` per service (plan §3.3, the schedule-aware surface
 * through the lib's `servicesWithOnCall`). `service.list` is all-✓.
 *
 * POST /nocturne/api/services — create (`service.create`: the
 * matrix's ✗ for responder/viewer). 400 on a bad shape or a
 * rotation id that is not the tenant's; 402 at the service cap;
 * 201 the row.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { servicesWithOnCall } from "@/lib/nocturne/analytics";
import { canCreateService } from "@/lib/nocturne/metering";
import { validateService } from "@/lib/nocturne/validation";
import { now as nowClock } from "@/lib/nocturne/clock";
import type { NocturneService, Severity } from "@/lib/nocturne/types";
import {
  getNocturne,
  nocturneTransaction,
  nextId,
} from "@/app/nocturne/api/_state";
import {
  quotaExceededResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
  invalidJsonResponse,
  notFoundResponse,
} from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "service.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getNocturne();
  return NextResponse.json(servicesWithOnCall(s, session.ctx.tenantId, nowClock()));
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("service creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "service.create");
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
    name: String(input.name ?? ""),
    description: String(input.description ?? ""),
    rotationId: input.rotationId ?? null,
    escalationPolicy: input.escalationPolicy,
    slaOverride: input.slaOverride ?? null,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const s = getNocturne();
  // Fail-closed tenancy: the rotation must be the CALLER's rotation
  // (a cross-tenant rotation id → 404, never a 403 that confirms
  // existence — plan §7/1).
  if (input.rotationId !== null && input.rotationId !== undefined && input.rotationId !== "") {
    const rotation = s.rotations.find((r) => r.id === input.rotationId);
    if (!rotation || rotation.tenantId !== session.ctx.tenantId) {
      return NextResponse.json(notFoundResponse(), { status: 404 });
    }
  }

  if (!canCreateService(s, session.ctx.tenantId)) {
    return NextResponse.json(quotaExceededResponse(), { status: 402 });
  }

  const now = nowClock();
  const id = nextId("svc");
  const service: NocturneService = {
    id,
    tenantId: session.ctx.tenantId,
    name: String(input.name ?? "").trim(),
    description: String(input.description ?? ""),
    rotationId: input.rotationId ?? null,
    escalationPolicy: input.escalationPolicy ?? {
      tiers: [{ id: "e1", kind: "manager", waitMinutes: 30, toTierIndex: null }],
    },
    slaOverride: input.slaOverride ?? null,
    createdAt: now,
  };
  nocturneTransaction((state) => ({ ...state, services: [...state.services, service] }));
  return NextResponse.json(service, { status: 201 });
}
