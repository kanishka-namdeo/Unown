/**
 * GET /parley/api/usage — the usage panel's data. Session +
 * `usage.read` (owner/admin + viewer — the matrix's unusual row).
 * 200 the `metering.overage` + seats + `perAgentLoad`.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getParley } from "@/lib/parley/store";
import { conversationsThisMonth, seatsUsed, overage, perAgentLoad } from "@/lib/parley/metering";
import { now as clockNow } from "@/lib/parley/clock";
import {
  sessionFromRequest,
  unauthorizedResponse,
  requirePermission,
} from "@/app/parley/api/_auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "usage.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getParley();
  const now = clockNow();
  const tenantId = session.ctx.tenantId;
  return NextResponse.json({
    overage: overage(s, tenantId, now),
    conversationsThisMonth: conversationsThisMonth(s, tenantId, now),
    seatsUsed: seatsUsed(s, tenantId),
    perAgentLoad: perAgentLoad(s, tenantId),
    plan: s.tenants.find((t) => t.id === tenantId)!.plan,
  });
}
