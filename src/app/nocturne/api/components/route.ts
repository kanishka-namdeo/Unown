/**
 * GET /nocturne/api/components — the tenant's status-page
 * components, filtered by `?serviceId=` (plan §3.7).
 * `component.list` is all-✓.
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

  const denied = requirePermission(session.role, "component.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getNocturne();
  const search = new URL(req.url).searchParams;
  const serviceId = search.get("serviceId") ?? undefined;
  const out = s.components
    .filter((c) => c.tenantId === session.ctx.tenantId)
    .filter((c) => (serviceId ? c.serviceId === serviceId : true));
  return NextResponse.json(out);
}
