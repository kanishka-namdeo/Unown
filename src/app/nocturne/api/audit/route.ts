/**
 * GET /nocturne/api/audit — the immutable audit feed (the
 * copy-on-write events, newest-first), filtered by `?action=` /
 * `?entityType=` (plan §3.9). `audit.read` is owner-only in the
 * matrix (the 403 rung for admin/responder/viewer).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { auditQuery } from "@/lib/nocturne/audit";
import { getNocturne } from "@/app/nocturne/api/_state";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/nocturne/api/_auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "audit.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getNocturne();
  const search = new URL(req.url).searchParams;
  const action = search.get("action") ?? undefined;
  const entityType = search.get("entityType") ?? undefined;

  const out = auditQuery(s.audit, {
    tenantId: session.ctx.tenantId,
    action,
    entityType,
  });
  return NextResponse.json(out);
}
