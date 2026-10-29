/**
 * GET /nocturne/api/rotations — the tenant's rotations + the
 * computed `currentSeat` + `nextSeat` per rotation (plan §3.4, the
 * schedule-aware surface through the lib's rotation engine).
 *
 * POST /nocturne/api/rotations — create (`rotation.create`: the
 * matrix's ✗ for responder/viewer). 400 on a bad shape or a
 * contiguity violation (the P1 tiling gate — the seats MUST tile
 * the timeline, plan §7/6); 402 at the rotation cap; 201 the row.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { currentSeat, whoIsOnCall, nextHandoff, onCallDisplay } from "@/lib/nocturne/rotation";
import { crossTenant } from "@/lib/nocturne/tenancy";
import { canCreateRotation } from "@/lib/nocturne/metering";
import { validateCreateRotation } from "@/lib/nocturne/validation";
import { now as nowClock } from "@/lib/nocturne/clock";
import type { NocturneOverride, NocturneRotation, NocturneState } from "@/lib/nocturne/types";
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

function findRotation(s: NocturneState, id: string): NocturneRotation | undefined {
  return s.rotations.find((x) => x.id === id);
}

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "rotation.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getNocturne();
  const now = nowClock();
  const users = s.users;
  const rotations = s.rotations
    .filter((r) => r.tenantId === session.ctx.tenantId)
    .map((rotation) => {
      const seat = currentSeat(rotation, now);
      const overrides = s.overrides.filter((o) => o.tenantId === rotation.tenantId);
      const current = onCallDisplay(whoIsOnCall(rotation, overrides, now), users);
      const next = onCallDisplay(seat ? rawNextSeatUser(rotation, now) : null, users);
      return {
        ...rotation,
        currentSeat: seat ? { userId: seat.userId, name: users.find((u) => u.id === seat.userId)?.name ?? seat.userId } : null,
        current,
        nextSeat: next,
        handoffAt: nextHandoff(rotation, now),
      };
    });
  return NextResponse.json(rotations);
}

/** The raw seat after the current one in the cycle (by seatIndex, wrapping). */
function rawNextSeatUser(rotation: NocturneRotation, at: string): string | null {
  const seat = currentSeat(rotation, at);
  if (!seat) return null;
  const sorted = [...rotation.seats].sort((a, b) => a.seatIndex - b.seatIndex);
  const idx = sorted.findIndex((x) => x.seatIndex === seat.seatIndex);
  if (idx === -1) return null;
  return sorted[(idx + 1) % sorted.length]?.userId ?? null;
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("rotation creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "rotation.create");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as {
    name?: string;
    seats?: Array<{ userId: string; start: string }>;
    shiftLengthMs?: number;
    boundaryDow?: number;
  };
  const { errors } = validateCreateRotation({
    name: String(input.name ?? ""),
    seats: (input.seats ?? []) as Array<{ userId: string; start: string }>,
    shiftLengthMs: input.shiftLengthMs ?? 0,
    boundaryDow: input.boundaryDow ?? 0,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const s = getNocturne();
  // Every seat must be the tenant's own user (fail-closed tenancy).
  const userIds = new Set(
    s.memberships.filter((m) => m.tenantId === session.ctx.tenantId).map((m) => m.userId),
  );
  for (const seat of input.seats!) {
    if (!userIds.has(String(seat.userId))) {
      return NextResponse.json(notFoundResponse(), { status: 404 });
    }
  }

  if (!canCreateRotation(s, session.ctx.tenantId)) {
    return NextResponse.json(quotaExceededResponse(), { status: 402 });
  }

  const now = nowClock();
  const id = nextId("rot");
  const rotation: NocturneRotation = {
    id,
    tenantId: session.ctx.tenantId,
    name: String(input.name ?? "").trim(),
    seats: input.seats!.map((seat, i) => ({
      seatIndex: i,
      userId: String(seat.userId),
      start: String(seat.start),
    })),
    shiftLengthMs: input.shiftLengthMs!,
    boundaryDow: input.boundaryDow!,
    createdAt: now,
  };
  nocturneTransaction((state) => ({ ...state, rotations: [...state.rotations, rotation] }));
  return NextResponse.json(rotation, { status: 201 });
}
