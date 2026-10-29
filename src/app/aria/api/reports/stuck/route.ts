/**
 * GET /aria/api/reports/stuck — deals stalled ≥ `?days=14` in
 * their current stage (open deals only, the `stuckDeals` math).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { listDeals } from "@/lib/aria/aria-store";
import { stuckDeals } from "@/lib/aria/reporting";
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
  const days = Number(search.get("days") ?? 14);

  const deals = listDeals(session.ctx, { status: "open" });
  const stuck = stuckDeals(deals, Number.isFinite(days) ? days : 14, clockNow());
  return NextResponse.json(stuck);
}
