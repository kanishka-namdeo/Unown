/**
 * GET /aria/api/reports/cohorts — deal cohorts by creation month
 * (the last `?months=6` months ending at the pinned clock), the
 * `cohorts` math: created / won / winRate per month.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { listDeals } from "@/lib/aria/aria-store";
import { cohorts } from "@/lib/aria/reporting";
import { now as clockNow } from "@/lib/aria/clock";
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

  const search = new URL(req.url).searchParams;
  const months = Number(search.get("months") ?? 6);

  const deals = listDeals(session.ctx, {});
  const out = cohorts(deals, Number.isFinite(months) ? months : 6, clockNow());
  return NextResponse.json({ cohorts: out });
}
