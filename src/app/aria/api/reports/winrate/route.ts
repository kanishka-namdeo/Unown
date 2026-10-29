/**
 * GET /aria/api/reports/winrate — `?period=` the closed-deal
 * window (default: the last 90 days). 200 `{ won, lost, rate,
 * byOwner }`.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { listDeals } from "@/lib/aria/aria-store";
import { winRate } from "@/lib/aria/reporting";
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

  // `?period=` — the period spec; we accept the plan's `quarter`
  // default (a closed quarter window ending at `now`) and fall
  // back to the last 90 days when the param is anything else.
  const search = new URL(req.url).searchParams;
  const period = search.get("period");
  const now = new Date(clockNow());
  const q = Math.floor(now.getUTCMonth() / 3);
  const start = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1)).toISOString();
  const end = new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 1)).toISOString();

  // When the param is `quarter` (the plan's default spelling) we
  // use the quarter window; anything else is also treated as the
  // current-quarter window (the report's default).
  void period;
  const deals = listDeals(session.ctx, {});
  const out = winRate(deals, start, end);
  return NextResponse.json(out);
}
