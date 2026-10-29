/**
 * GET /aria/api/reports/salescycle — median days-to-close per
 * owner + overall (the `salesCycle` math over closed deals).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { listDeals } from "@/lib/aria/aria-store";
import { salesCycle } from "@/lib/aria/reporting";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "report.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const deals = listDeals(session.ctx, {});
  return NextResponse.json(salesCycle(deals));
}
