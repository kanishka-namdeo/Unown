/**
 * GET /aria/api/forecast/snapshots — the tenant's forecast
 * snapshots (IMMUTABLE — no PATCH/DELETE route, the plan's §3.10
 * pin). `report.read` (all-✓ in the matrix).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { listForecastSnapshots } from "@/lib/aria/aria-store";
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

  return NextResponse.json(listForecastSnapshots(session.ctx));
}
