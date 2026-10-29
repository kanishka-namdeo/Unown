/**
 * GET /aria/api/reports/drilldown — the "open the number" route:
 * `?metric=weighted|commit|stage&value=<id>` → the raw deal rows
 * the number was computed from (the `drillDown` math).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getAria } from "@/lib/aria/aria-store";
import { drillDown } from "@/lib/aria/reporting";
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
  const metric = search.get("metric");
  const value = search.get("value");
  if (!metric || !value || !["weighted", "commit", "stage"].includes(metric)) {
    return NextResponse.json(
      {
        error: "validation failed",
        errors: ["metric must be weighted|commit|stage and value is required"],
      },
      { status: 400 },
    );
  }

  const out = drillDown(
    getAria(),
    session.ctx.tenantId,
    metric as "weighted" | "commit" | "stage",
    value,
  );
  return NextResponse.json(out);
}
