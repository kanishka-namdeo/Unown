/**
 * POST /nocturne/api/rotations/[id]/overrides — create an override
 * (plan §3.4, the `rotation.override` lane). 400 on a bad window,
 * or when `forUserId` is not a seat of the rotation; 201 the row.
 *
 * The responder carve-out applies on the DELETE lane (a responder
 * may delete only their own overrides — `resource = forUserId`
 * must equal the caller's user id, plan §1 "edit their own
 * overrides").
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { crossTenant } from "@/lib/nocturne/tenancy";
import { validateCreateOverride } from "@/lib/nocturne/validation";
import { now as nowClock } from "@/lib/nocturne/clock";
import type { NocturneOverride } from "@/lib/nocturne/types";
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
    return NextResponse.json(rateLimitedBody("override creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id } = await params;
  const s = getNocturne();
  const rotation = s.rotations.find((x) => x.id === id);
  // Cross-tenant rung FIRST (404, never a 403 that confirms existence).
  if (!rotation || crossTenant(rotation, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as {
    forUserId?: string;
    userId?: string;
    startsAt?: string;
    endsAt?: string;
    reason?: string;
  };
  const { errors } = validateCreateOverride({
    forUserId: String(input.forUserId ?? ""),
    userId: String(input.userId ?? ""),
    startsAt: String(input.startsAt ?? ""),
    endsAt: String(input.endsAt ?? ""),
    reason: String(input.reason ?? ""),
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  // `forUserId` must be a SEAT of this rotation (the plan's 400
  // rung for an out-of-rotation user); the cover `userId` must be a
  // tenant member.
  const seatUserIds = new Set(rotation.seats.map((seat) => seat.userId));
  if (!seatUserIds.has(String(input.forUserId))) {
    return NextResponse.json(
      {
        error: "validation failed",
        errors: [`forUserId "${String(input.forUserId)}" is not a seat of this rotation.`],
      },
      { status: 400 },
    );
  }
  const memberUserIds = new Set(
    s.memberships.filter((m) => m.tenantId === rotation.tenantId).map((m) => m.userId),
  );
  if (!memberUserIds.has(String(input.userId))) {
    return NextResponse.json(
      { error: "validation failed", errors: ["userId must be a member of this tenant."] },
      { status: 400 },
    );
  }

  // The RBAC lane: the responder carve-out gates a responder to
  // their OWN seat (forUserId === their user id).
  const denied = requirePermission(
    session.role,
    "rotation.override",
    String(input.forUserId),
    session.user.id,
  );
  if (denied) return NextResponse.json(denied, { status: 403 });

  const now = nowClock();
  const overrideId = nextId("ovr");
  const override: NocturneOverride = {
    id: overrideId,
    tenantId: rotation.tenantId,
    rotationId: rotation.id,
    forUserId: String(input.forUserId),
    userId: String(input.userId),
    startsAt: String(input.startsAt),
    endsAt: String(input.endsAt),
    reason: String(input.reason).trim(),
    createdAt: now,
  };
  nocturneTransaction((state) => ({ ...state, overrides: [...state.overrides, override] }));
  return NextResponse.json(override, { status: 201 });
}
