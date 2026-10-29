/**
 * GET /aria/api/triage/deals — deal health (the deterministic
 * A-D rules + signals + next-best-action). Worst-first, top-N.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getAria } from "@/lib/aria/aria-store";
import { worstDeals } from "@/lib/aria/triage";
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

  const out = worstDeals(
    getAria(),
    session.ctx.tenantId,
    Number.isFinite(top) && top > 0 ? top : 10,
    clockNow(),
  );
  return NextResponse.json(out);
}
