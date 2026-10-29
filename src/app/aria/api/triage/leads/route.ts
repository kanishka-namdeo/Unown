/**
 * GET /aria/api/triage/leads — the deterministic lead triage:
 * top-N leads by 0-100 score, each with its `components` (the
 * weighted breakdown that always sums to 100 — the P2 pin).
 * `triage.read` is all-✓ in the matrix.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getAria } from "@/lib/aria/aria-store";
import { topLeads } from "@/lib/aria/triage";
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

  const search = new URL(req.url).searchParams;
  const top = Number(search.get("top") ?? 10);

  const out = topLeads(
    getAria(),
    session.ctx.tenantId,
    Number.isFinite(top) && top > 0 ? top : 10,
    clockNow(),
  );
  return NextResponse.json(out);
}
