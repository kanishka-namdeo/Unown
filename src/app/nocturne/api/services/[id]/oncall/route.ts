/**
 * GET /nocturne/api/services/[id]/oncall — the on-call window for a
 * service at `?at=` (ISO, default the pinned clock) (plan §3.3).
 *
 * 200: `{ primary, secondary, handoffAt }` where
 *  - `primary` = the override-resolved whoIsOnCall seat (null when
 *    the service has no rotation yet);
 *  - `secondary` = the RAW next seat (the handoff's user) when a
 *    rotation exists, else null;
 *  - `handoffAt` = the next handoff's ISO instant.
 * 404 when the service is unknown or cross-tenant.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { seatUser, whoIsOnCall, onCallDisplay } from "@/lib/nocturne/rotation";
import { crossTenant } from "@/lib/nocturne/tenancy";
import { now as nowClock } from "@/lib/nocturne/clock";
import { getNocturne } from "@/app/nocturne/api/_state";
import { nextHandoff } from "@/lib/nocturne/rotation";
import type { NocturneRotation } from "@/lib/nocturne/types";
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

  const denied = requirePermission(session.role, "service.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const s = getNocturne();
  const service = s.services.find((x) => x.id === id);
  if (!service || crossTenant(service, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const atParam = new URL(req.url).searchParams.get("at")?.trim() ?? "";
  let at = atParam;
  if (at && Number.isNaN(new Date(at).getTime())) {
    return NextResponse.json(
      { error: "validation failed", errors: ["at must be a valid ISO timestamp."] },
      { status: 400 },
    );
  }
  if (!at) at = nowClock();

  if (!service.rotationId) {
    // No rotation yet: the computed surface is all-null (the plan's
    // "null = no rotation yet" shape — the UI shows a "no rotation"
    // state, not an error).
    return NextResponse.json({ primary: null, secondary: null, handoffAt: null });
  }

  const rotation = s.rotations.find((r) => r.id === service.rotationId);
  if (!rotation || crossTenant(rotation, session.ctx)) {
    // The rotation row is gone or belongs to another tenant (a
    // dangling id, never a leak) → the surface is all-null.
    return NextResponse.json({ primary: null, secondary: null, handoffAt: null });
  }

  const overrides = s.overrides.filter((o) => o.tenantId === rotation.tenantId);
  const users = s.users;
  const primary = onCallDisplay(whoIsOnCall(rotation, overrides, at), users);
  const secondary = onCallDisplay(nextSeatAfterCurrent(rotation, at), users);
  const handoffAt = nextHandoff(rotation, at);

  return NextResponse.json({ primary, secondary, handoffAt });
}

/** The raw next seat's user (the handoff target, no overrides applied). */
function nextSeatAfterCurrent(rotation: NocturneRotation, at: string): string | null {
  const current = seatUser(rotation, at);
  if (current === null) return null;
  // The seat after the current one in the cycle (by seatIndex, wrapping).
  const sorted = [...rotation.seats].sort((a, b) => a.seatIndex - b.seatIndex);
  const idx = sorted.findIndex((x) => x.userId === current);
  if (idx === -1) return null;
  const nextSeat = sorted[(idx + 1) % sorted.length];
  return nextSeat?.userId ?? null;
}

