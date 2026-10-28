/**
 * POST /parley/api/members/[id]/remove — remove a membership.
 * Session + `invite.role_change` (the brief groups removal under the
 * same gate; the owner + not-yourself guards). 204 + audit.
 * Cross-tenant → 404.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { removeMember, getParley } from "@/lib/parley/store";
import {
  sessionFromRequest,
  unauthorizedResponse,
  requirePermission,
} from "@/app/parley/api/_auth";
import { writeLaneRateLimited, rateLimitedBody } from "@/app/parley/api/_rate";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("member removals"), { status: 429 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id } = await params;
  const s = getParley();
  const target = s.memberships.find((m) => m.id === id && m.tenantId === session.ctx.tenantId);
  if (!target) return NextResponse.json({ error: "not found", status: 404 }, { status: 404 });

  // Guard: not the owner.
  if (target.role === "owner") {
    return NextResponse.json(
      { error: "forbidden", permission: "the owner may not be removed" },
      { status: 403 },
    );
  }
  // Guard: not yourself.
  if (target.userId === session.user.id) {
    return NextResponse.json(
      { error: "forbidden", permission: "you may not remove yourself" },
      { status: 403 },
    );
  }

  const denied = requirePermission(
    session.role,
    "invite.role_change",
    target.id,
    session.membership.id,
  );
  if (denied) return NextResponse.json(denied, { status: 403 });

  const removed = removeMember(session.ctx, id);
  if (!removed) return NextResponse.json({ error: "not found", status: 404 }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
