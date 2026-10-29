/**
 * GET /nocturne/api/postmortems — the tenant's postmortems
 * (newest-first), filtered by `?incidentId=` (plan §3.8).
 * `postmortem.list` is all-✓.
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

  const denied = requirePermission(session.role, "postmortem.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getNocturne();
  const search = new URL(req.url).searchParams;
  const incidentId = search.get("incidentId") ?? undefined;
  const out = s.postmortems
    .filter((p) => p.tenantId === session.ctx.tenantId)
    .filter((p) => (incidentId ? p.incidentId === incidentId : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return NextResponse.json(out);
}
