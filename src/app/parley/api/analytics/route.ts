/**
 * GET /parley/api/analytics — the read-only dashboard's data.
 * Session + `analytics.read` (owner/admin + viewer). 200
 * `analytics.compute` (Step 26's output).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getParley } from "@/lib/parley/store";
import { computeAnalytics, formatDurationMs } from "@/lib/parley/analytics";
import { now as clockNow } from "@/lib/parley/clock";
import {
  sessionFromRequest,
  unauthorizedResponse,
  requirePermission,
} from "@/app/parley/api/_auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "analytics.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getParley();
  const now = clockNow();
  const tenantId = session.ctx.tenantId;
  const a = computeAnalytics(s, tenantId, now);
  return NextResponse.json({
    ...a,
    medianFirstResponseLabel: formatDurationMs(a.medianFirstResponseMs),
    resolutionRatePercent: Math.round(a.resolutionRate * 1000) / 10,
  });
}
