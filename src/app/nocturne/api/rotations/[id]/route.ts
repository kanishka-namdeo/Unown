/**
 * GET /nocturne/api/rotations/[id] — 200 the rotation + its
 * overrides; 404 when unknown or cross-tenant (never a 403 —
 * plan §7/1).
 *
 * PATCH /nocturne/api/rotations/[id] — the `rotation.update` lane
 * (owner + admin). 400 on a bad shape, 200 the updated row.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { crossTenant } from "@/lib/nocturne/tenancy";
import { validateUpdateRotation } from "@/lib/nocturne/validation";
import type { NocturneRotation, NocturneState } from "@/lib/nocturne/types";
import { getNocturne, nocturneTransaction } from "@/app/nocturne/api/_state";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
  invalidJsonResponse,
} from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

function findRotation(s: NocturneState, id: string): NocturneRotation | undefined {
  return s.rotations.find((x) => x.id === id);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "rotation.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const s = getNocturne();
  const rotation = findRotation(s, id);
  if (!rotation || crossTenant(rotation, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }
  return NextResponse.json({
    ...rotation,
    overrides: s.overrides.filter(
      (o) => o.tenantId === rotation.tenantId && o.rotationId === rotation.id,
    ),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("rotation updates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id } = await params;
  const s = getNocturne();
  const rotation = findRotation(s, id);
  // Cross-tenant rung FIRST (404, never a 403 that confirms existence).
  if (!rotation || crossTenant(rotation, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const denied = requirePermission(session.role, "rotation.update");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as {
    name?: string;
    shiftLengthMs?: number;
    boundaryDow?: number;
  };
  const { errors } = validateUpdateRotation(input);
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const updated: NocturneRotation = {
    ...rotation,
    ...(input.name !== undefined ? { name: String(input.name).trim() } : {}),
    ...(input.shiftLengthMs !== undefined ? { shiftLengthMs: input.shiftLengthMs } : {}),
    ...(input.boundaryDow !== undefined ? { boundaryDow: input.boundaryDow } : {}),
  };
  nocturneTransaction((state) => ({
    ...state,
    rotations: state.rotations.map((x) => (x.id === rotation.id ? updated : x)),
  }));
  return NextResponse.json(updated);
}
