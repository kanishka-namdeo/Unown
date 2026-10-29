/**
 * GET /aria/api/audit — the immutable audit feed (the copy-on-
 * write events, newest-first), filtered by `?action=` /
 * `?entityType=`. `audit.read` is owner + manager only in the
 * matrix (the 403 rung for rep/viewer).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { auditFeed } from "@/lib/aria/aria-store";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "audit.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const search = new URL(req.url).searchParams;
  const action = search.get("action") ?? undefined;
  const entityType = search.get("entityType") ?? undefined;

  return NextResponse.json(auditFeed(session.ctx, action, entityType));
}
