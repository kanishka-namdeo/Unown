/**
 * GET /parley/api/audit — the admin-only audit feed. Session +
 * `audit.read` (owner/admin only — the matrix's ✗ for agent/viewer).
 * Newest first, `?action=` filter. 200 the events.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { auditFeed } from "@/lib/parley/store";
import {
  sessionFromRequest,
  unauthorizedResponse,
  requirePermission,
} from "@/app/parley/api/_auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "audit.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const search = new URL(req.url).searchParams;
  const action = search.get("action") ?? undefined;
  return NextResponse.json(auditFeed(session.ctx, action));
}
