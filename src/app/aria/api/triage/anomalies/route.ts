/**
 * GET /aria/api/triage/anomalies — the three deterministic anomaly
 * detectors: amount outlier (2σ over closed deals), forecast
 * drift (vs the latest snapshot), quarter-end bunching. 200 the
 * combined report body.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getAria } from "@/lib/aria/aria-store";
import { anomalies } from "@/lib/aria/triage";
import { now as clockNow } from "@/lib/aria/clock";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "triage.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const out = anomalies(getAria(), session.ctx.tenantId, clockNow());
  return NextResponse.json(out);
}
