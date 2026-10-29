/**
 * GET /aria/api/reports/pipeline — `?pipelineId=` (default: every
 * open pipeline of the tenant). 200 `{ weightedByStage, openCount,
 * openWeighted }` (the forecast math over the open deals, the
 * plan's §3.8 body). `report.read` is all-✓ in the matrix.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getAria } from "@/lib/aria/aria-store";
import { openDealsFor, snapshotMath } from "@/lib/aria/forecast";
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
  const pipelineId = search.get("pipelineId") ?? undefined;

  const s = getAria();
  const pipelines = s.pipelines.filter(
    (p) =>
      p.tenantId === session.ctx.tenantId &&
      (pipelineId ? p.id === pipelineId : true),
  );

  const weightedByStage: Record<string, number> = {};
  let openCount = 0;
  let openWeighted = 0;
  for (const pipeline of pipelines) {
    const open = openDealsFor(s, session.ctx.tenantId, pipeline.id);
    const m = snapshotMath(open, pipeline);
    openCount += m.dealIds.length;
    openWeighted += m.weightedTotal;
    for (const [stageId, w] of Object.entries(m.byStage)) {
      weightedByStage[stageId] = (weightedByStage[stageId] ?? 0) + w;
    }
  }

  return NextResponse.json({ weightedByStage, openCount, openWeighted });
}
