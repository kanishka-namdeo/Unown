/**
 * DELETE /nocturne/api/overrides/[id] — delete an override
 * (plan §3.4, the `rotation.override` lane). 204 on success; 404
 * cross-tenant (never a 403 — plan §7/1).
 *
 * The responder carve-out: a responder may delete only their own
 * overrides (`forUserId === caller's user id` → 403 otherwise;
 * owner/admin are ungated).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { crossTenant } from "@/lib/nocturne/tenancy";
import { getNocturne, nocturneTransaction } from "@/app/nocturne/api/_state";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("override deletes"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id } = await params;
  const s = getNocturne();
  const override = s.overrides.find((o) => o.id === id);
  // Cross-tenant rung FIRST (404, never a 403 that confirms existence).
  if (!override || crossTenant(override, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  // The carve-out: a responder may delete an override they COVER
  // (userId === self) OR one covering THEM (forUserId === self) —
  // both are "their own overrides" (plan §1). Owner/admin are
  // ungated; VIEWER is denied by the matrix (viewer has no
  // rotation.override grant at all).
  const matrixGate = requirePermission(
    session.role,
    "rotation.override",
  );
  if (matrixGate) return NextResponse.json(matrixGate, { status: 403 });
  const isOwnerOrAdmin = session.role === "owner" || session.role === "admin";
  if (!isOwnerOrAdmin) {
    const carveOutOk =
      override.forUserId === session.user.id ||
      override.userId === session.user.id;
    if (!carveOutOk) {
      const denied = requirePermission(
        session.role,
        "rotation.override",
        override.forUserId,
        session.user.id,
      );
      if (denied) return NextResponse.json(denied, { status: 403 });
    }
  }

  nocturneTransaction((state) => ({
    ...state,
    overrides: state.overrides.filter((o) => o.id !== id),
  }));
  return new NextResponse(null, { status: 204 });
}
