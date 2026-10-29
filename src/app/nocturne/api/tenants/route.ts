/**
 * GET /nocturne/api/tenants — the session's tenant (plan §3.2).
 * `tenant.list` is all-✓ in the matrix; every row belongs to the
 * caller's tenant (the row-level tenancy floor).
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

  const denied = requirePermission(session.role, "tenant.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getNocturne();
  return NextResponse.json(s.tenants.filter((t) => t.id === session.ctx.tenantId));
}
