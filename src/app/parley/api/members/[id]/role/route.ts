/**
 * POST /parley/api/members/[id]/role — change a membership's role.
 * Session + `invite.role_change` (owner/admin, the owner-seat
 * guard: changing a membership TO owner, or the owner's own seat,
 * is 403 even for an admin). 200 the updated membership + audit.
 * Cross-tenant → 404.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { changeRole, getParley } from "@/lib/parley/store";
import type { Role } from "@/lib/parley/types";
import {
  sessionFromRequest,
  unauthorizedResponse,
  requirePermission,
} from "@/app/parley/api/_auth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id } = await params;

  // The owner-seat guard (server-side — the brief's "not the owner
  // seat" + "not yourself"): changing the owner's seat's role, or
  // your own membership, is forbidden even for an admin/owner.
  const s = getParley();
  const target = s.memberships.find((m) => m.id === id && m.tenantId === session.ctx.tenantId);
  if (!target) return NextResponse.json({ error: "not found", status: 404 }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", errors: ["body must be valid JSON"] },
      { status: 400 },
    );
  }
  const newRole = String(((body ?? {}) as { role?: Role }).role ?? "");
  if (!["owner", "admin", "agent", "viewer"].includes(newRole)) {
    return NextResponse.json(
      { error: "validation failed", errors: ["role must be one of: owner, admin, agent, viewer"] },
      { status: 400 },
    );
  }

  // Guard 1: the owner's seat (the membership whose role is "owner")
  // may not have its role changed.
  if (target.role === "owner") {
    return NextResponse.json(
      { error: "forbidden", permission: "the owner seat may not have its role changed" },
      { status: 403 },
    );
  }
  // Guard 2: not yourself.
  if (target.userId === session.user.id) {
    return NextResponse.json(
      { error: "forbidden", permission: "you may not change your own role" },
      { status: 403 },
    );
  }
  // Guard 3: the rbac action gate.
  const denied = requirePermission(
    session.role,
    "invite.role_change",
    target.id,
    session.membership.id,
  );
  if (denied) return NextResponse.json(denied, { status: 403 });

  const updated = changeRole(session.ctx, id, newRole as Role);
  if (!updated) return NextResponse.json({ error: "not found", status: 404 }, { status: 404 });
  return NextResponse.json(updated);
}
