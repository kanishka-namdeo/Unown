/**
 * GET /nocturne/api/members — the tenant's seat list (plan §3.2):
 * `[{ membership, user }]`, one row per seat. `member.list` is
 * all-✓ in the matrix.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getNocturne } from "@/app/nocturne/api/_state";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/nocturne/api/_auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "member.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getNocturne();
  const out = s.memberships
    .filter((m) => m.tenantId === session.ctx.tenantId)
    .map((m) => ({
      membership: m,
      user: s.users.find((u) => u.id === m.userId) ?? null,
    }));
  return NextResponse.json(out);
}
