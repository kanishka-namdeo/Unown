/**
 * GET /aria/api/tenants — the session's tenant list. `tenant.list`
 * is all-✓ in the matrix; every row belongs to the caller's tenant
 * (the row-level tenancy floor).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { listTenants } from "@/lib/aria/aria-store";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "tenant.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  return NextResponse.json(listTenants(session.ctx));
}
