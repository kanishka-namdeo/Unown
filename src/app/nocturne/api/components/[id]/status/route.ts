/**
 * POST /nocturne/api/components/[id]/status — the manual status
 * override for a status-page component (plan §3.7, the
 * `component.update` lane: owner + admin). 200 the updated row
 * (`lastChangedAt` stamped); 400 on a bad status/note; 404 when
 * unknown or cross-tenant.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { updateComponentStatus } from "@/lib/nocturne/status";
import { validateComponentStatus } from "@/lib/nocturne/validation";
import { now as nowClock } from "@/lib/nocturne/clock";
import type { NocturneComponentStatus } from "@/lib/nocturne/types";
import { getNocturne, nocturneTransaction } from "@/app/nocturne/api/_state";
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
    return NextResponse.json(rateLimitedBody("component status updates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id } = await params;
  const s0 = getNocturne();
  const component = s0.components.find((c) => c.id === id);
  // Cross-tenant rung FIRST (404, never a 403 that confirms existence).
  if (!component || component.tenantId !== session.ctx.tenantId) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const denied = requirePermission(session.role, "component.update");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as { status?: NocturneComponentStatus; note?: string | null };
  const { errors } = validateComponentStatus({
    status: input.status as NocturneComponentStatus,
    note: input.note,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const ctx = { now: nowClock };
  const out = nocturneTransaction((st) => {
    const res = updateComponentStatus(
      st,
      id,
      input.status as NocturneComponentStatus,
      input.note === undefined ? null : input.note,
      session.ctx.tenantId,
      ctx,
    );
    if ("error" in res) throw new Error(res.error);
    return res.state;
  });
  const updated = out.components.find((c) => c.id === id)!;
  return NextResponse.json(updated);
}
