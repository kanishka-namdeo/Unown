/**
 * GET /parley/api/members — the tenant's memberships joined with
 * their users. Session + `member.list` (all 4 roles pass — the
 * matrix's all-✓ row). 200 the list.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { listMembers } from "@/lib/parley/store";
import {
  sessionFromRequest,
  unauthorizedResponse,
  requirePermission,
} from "@/app/parley/api/_auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "member.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  return NextResponse.json(listMembers(session.ctx));
}
