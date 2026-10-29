/**
 * GET /aria/api/reports/funnel — the stage funnel for `?pipelineId=`
 * (or the tenant's first pipeline): deal counts + the conversion
 * ratio against the first stage (the `funnel` math).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getAria, listPipelines } from "@/lib/aria/aria-store";
import { funnel } from "@/lib/aria/reporting";
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
  const pipelineId =
    search.get("pipelineId") ??
    listPipelines(session.ctx)[0]?.id ??
    getAria().pipelines.find((p) => p.tenantId === session.ctx.tenantId)?.id;

  if (!pipelineId) {
    return NextResponse.json({ stages: [] });
  }
  const stages = funnel(getAria(), session.ctx.tenantId, pipelineId);
  return NextResponse.json({ stages });
}
