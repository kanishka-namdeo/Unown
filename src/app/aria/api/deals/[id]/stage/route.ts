/**
 * POST /aria/api/deals/[id]/stage — the explicit stage transition
 * (`deal.stage`: the matrix's ✗ for viewer). The lost-reason gate
 * + the closed-deal invariant live in the store's `stageDeal`
 * (both 400-shaped), 404 cross-tenant / unknown stage.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { NotFoundError, stageDeal, StageError } from "@/lib/aria/aria-store";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("deal stages"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "deal.stage");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const input = (body ?? {}) as { stageId?: string; lostReason?: string };
  if (!input.stageId) {
    return NextResponse.json(
      { error: "validation failed", errors: ["stageId is required"], status: 400 },
      { status: 400 },
    );
  }

  try {
    const updated = stageDeal(session.ctx, id, input.stageId, input.lostReason);
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json(notFoundResponse(), { status: 404 });
    }
    if (e instanceof StageError) {
      return NextResponse.json(
        {
          error: "validation failed",
          errors: [e.message],
          status: 400,
        },
        { status: 400 },
      );
    }
    throw e;
  }
}
