/**
 * GET /aria/api/deals/[id] — 200 the deal + its activities + its
 * tasks; 404 when absent, cross-tenant, or out of the caller's
 * visibility scope.
 *
 * PATCH /aria/api/deals/[id] — `deal.update` (the matrix's ✗ for
 * viewer). 400 when moving to a lost stage without a `lostReason`;
 * the closed-deal invariant (no reopening) holds through both the
 * `stageId` patch and the explicit `/stage` lane.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  getAria,
  getDeal,
  listActivities,
  listTasks,
  NotFoundError,
  StageError,
  updateDeal,
} from "@/lib/aria/aria-store";
import { isRecordVisible } from "@/lib/aria/visibility";
import { validateUpdateDeal } from "@/lib/aria/validation";
import type { ForecastCategory } from "@/lib/aria/types";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "deal.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const deal = getDeal(session.ctx, id);
  if (!deal) return NextResponse.json(notFoundResponse(), { status: 404 });
  if (!isRecordVisible(getAria(), session.ctx, "deal", deal.ownerId, deal)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const activities = listActivities(session.ctx, "deal", deal.id);
  const tasks = listTasks(session.ctx, deal.id, undefined, undefined, undefined);

  return NextResponse.json({ deal, activities, tasks });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("deal updates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "deal.update");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", errors: ["body must be valid JSON"] },
      { status: 400 },
    );
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const { errors } = validateUpdateDeal({
    amount: input.amount !== undefined ? Number(input.amount) : undefined,
    stageId: input.stageId !== undefined ? String(input.stageId) : undefined,
    forecastCategory: input.forecastCategory as ForecastCategory | undefined,
    expectedCloseDate: input.expectedCloseDate !== undefined ? String(input.expectedCloseDate) : undefined,
    ownerId: input.ownerId !== undefined ? String(input.ownerId) : undefined,
    lostReason: input.lostReason as string | null | undefined,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const updated = updateDeal(
      session.ctx,
      id,
      input as Parameters<typeof updateDeal>[2],
    );
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
