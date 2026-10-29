/**
 * GET /nocturne/api/runbooks — the tenant's runbooks, filtered by
 * `?serviceId=` (plan §3.6). `runbook.list` is all-✓.
 *
 * POST /nocturne/api/runbooks — create (`runbook.create`: the
 * matrix's ✗ for responder/viewer). 400 on a bad shape / an unknown
 * service / empty steps; 402 at the runbook cap; 201 the row.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { canCreateRunbook } from "@/lib/nocturne/metering";
import { validateCreateRunbook } from "@/lib/nocturne/validation";
import { now as nowClock } from "@/lib/nocturne/clock";
import { crossTenant } from "@/lib/nocturne/tenancy";
import type { NocturneRunbook, Severity } from "@/lib/nocturne/types";
import { getNocturne, nocturneTransaction, nextId } from "@/app/nocturne/api/_state";
import {
  notFoundResponse,
  quotaExceededResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
  invalidJsonResponse,
} from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "runbook.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getNocturne();
  const search = new URL(req.url).searchParams;
  const serviceId = search.get("serviceId") ?? undefined;
  const out = s.runbooks
    .filter((r) => r.tenantId === session.ctx.tenantId)
    .filter((r) => (serviceId ? r.serviceId === serviceId : true));
  return NextResponse.json(out);
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("runbook creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "runbook.create");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as {
    serviceId?: string;
    name?: string;
    steps?: Array<{ title: string; command?: string }>;
    forSeverities?: Severity[];
  };
  const { errors } = validateCreateRunbook({
    serviceId: String(input.serviceId ?? ""),
    name: String(input.name ?? ""),
    steps: input.steps ?? [],
    forSeverities: input.forSeverities,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const s = getNocturne();
  // The service must be the caller's (cross-tenant → 404, never a
  // 403 — plan §7/1).
  const service = s.services.find((x) => x.id === String(input.serviceId));
  if (!service || crossTenant(service, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  if (!canCreateRunbook(s, session.ctx.tenantId)) {
    return NextResponse.json(quotaExceededResponse(), { status: 402 });
  }

  const now = nowClock();
  const id = nextId("rb");
  const runbook: NocturneRunbook = {
    id,
    tenantId: session.ctx.tenantId,
    serviceId: service.id,
    name: String(input.name ?? "").trim(),
    steps: input.steps!.map((step, i) => ({
      id: `s${i + 1}`,
      title: String(step.title ?? "").trim(),
      ...(step.command !== undefined ? { command: String(step.command) } : {}),
    })),
    forSeverities: input.forSeverities ?? [],
    createdAt: now,
  };
  nocturneTransaction((state) => ({ ...state, runbooks: [...state.runbooks, runbook] }));
  return NextResponse.json(runbook, { status: 201 });
}
