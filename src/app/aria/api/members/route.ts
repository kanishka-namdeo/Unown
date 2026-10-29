/**
 * GET /aria/api/members — the tenant's memberships joined with
 * their users. `member.list` is all-✓ in the matrix.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { listMembers } from "@/lib/aria/aria-store";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "member.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  return NextResponse.json(listMembers(session.ctx));
}
