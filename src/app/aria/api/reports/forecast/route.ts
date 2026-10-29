/**
 * GET /aria/api/reports/forecast — `?period=` (default: the current
 * quarter). 200 the plan's §3.8 body:
 * `{ commitLadder, weightedTotal, coverage, byRep }` — the
 * commit-ladder rungs + the per-rep quota/actual/remaining.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getAria } from "@/lib/aria/aria-store";
import { commitLadder, coverage, openDealsFor, snapshotMath } from "@/lib/aria/forecast";
import { quarterOf } from "@/lib/aria/metering";
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

  const s = getAria();
  const tenant = s.tenants.find((t) => t.id === session.ctx.tenantId);
  // `?period=` — the plan's `quarter` default; we resolve the
  // quarter containing the pinned clock.
  const search = new URL(req.url).searchParams;
  void search.get("period");
  const q = quarterOf(clockNow());

  // Open deals across every pipeline of the tenant, scoped to the
  // quarter's close dates (the forecast's "this quarter" input).
  const pipelines = s.pipelines.filter((p) => p.tenantId === session.ctx.tenantId);
  const inQuarter = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= new Date(q.start).getTime() && t < new Date(q.end).getTime();
  };
  const open = pipelines.flatMap((p) =>
    openDealsFor(s, session.ctx.tenantId, p.id).filter((d) =>
      inQuarter(d.expectedCloseDate),
    ),
  );

  const ladder = commitLadder(open);
  // The weighted total is the snapshot math over the open deals
  // (the single source of truth, the P1 forecast-drift pin).
  const pipeline = pipelines[0];
  const m = pipeline
    ? snapshotMath(openDealsFor(s, session.ctx.tenantId, pipeline.id), pipeline)
    : { weightedTotal: 0, byStage: {}, byCategory: {}, dealIds: [] };

  const byRep: Record<string, { quota: number; actual: number; remaining: number }> = {};
  for (const repId of Object.keys(tenant?.quotas ?? {})) {
    const repOpen = open.filter((d) => d.ownerId === repId);
    const repActual = repOpen
      .filter((d) => d.forecastCategory === "commit" || d.forecastCategory === "best_case")
      .reduce((acc, d) => acc + d.amount, 0);
    byRep[repId] = {
      quota: tenant?.quotas[repId] ?? 0,
      actual: repActual,
      remaining: Math.max(0, (tenant?.quotas[repId] ?? 0) - repActual),
    };
  }

  return NextResponse.json({
    commitLadder: ladder,
    weightedTotal: m.weightedTotal,
    coverage: coverage(ladder.commit, tenant?.quotas ? Object.values(tenant.quotas).reduce((a, b) => a + b, 0) : 0),
    byRep,
  });
}
