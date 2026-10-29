/**
 * GET /aria/api/deals — the tenant's deals, visibility-filtered
 * (rep → own; manager → team; owner/admin/viewer → all), with
 * `?pipelineId=` / `?stageId=` / `?ownerId=` / `?forecastCategory=`
 * / `?status=open|won|lost` filters.
 *
 * POST /aria/api/deals — create (`deal.create`: the matrix's ✗ for
 * viewer). 400 on a bad shape; 404 when the pipeline/stage/account/
 * contact is unknown in the tenant.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  createDeal,
  getAria,
  NotFoundError,
  StageError,
} from "@/lib/aria/aria-store";
import { visibleDeals } from "@/lib/aria/visibility";
import { validateCreateDeal } from "@/lib/aria/validation";
import type { DealStatus, ForecastCategory } from "@/lib/aria/types";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "deal.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const search = new URL(req.url).searchParams;
  const pipelineId = search.get("pipelineId") ?? undefined;
  const stageId = search.get("stageId") ?? undefined;
  const ownerId = search.get("ownerId") ?? undefined;
  const forecastCategory = search.get("forecastCategory") ?? undefined;
  const status = (search.get("status") as DealStatus | null) ?? undefined;

  let out = visibleDeals(getAria(), session.ctx).filter((d) =>
    pipelineId ? d.pipelineId === pipelineId : true,
  );
  out = out.filter((d) => (stageId ? d.stageId === stageId : true));
  out = out.filter((d) => (ownerId ? d.ownerId === ownerId : true));
  out = out.filter((d) =>
    forecastCategory ? d.forecastCategory === forecastCategory : true,
  );
  out = out.filter((d) => {
    if (!status) return true;
    if (status === "open") return d.closedAt === null;
    if (d.closedAt === null) return false;
    const pipeline = getAria().pipelines.find((p) => p.id === d.pipelineId);
    const stage = pipeline?.stages.find((s) => s.id === d.stageId);
    return stage?.state === (status === "won" ? "closed_won" : "closed_lost");
  });

  return NextResponse.json(out);
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("deal creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "deal.create");
  if (denied) return NextResponse.json(denied, { status: 403 });

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
  const { errors } = validateCreateDeal({
    pipelineId: String(input.pipelineId ?? ""),
    stageId: String(input.stageId ?? ""),
    accountId: String(input.accountId ?? ""),
    contactId: String(input.contactId ?? ""),
    amount: Number(input.amount ?? 0),
    forecastCategory: String(input.forecastCategory ?? ""),
    ownerId: String(input.ownerId ?? ""),
    expectedCloseDate: String(input.expectedCloseDate ?? ""),
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const row = createDeal(session.ctx, {
      pipelineId: String(input.pipelineId),
      stageId: String(input.stageId),
      accountId: String(input.accountId),
      contactId: String(input.contactId),
      amount: Number(input.amount),
      forecastCategory: input.forecastCategory as ForecastCategory,
      ownerId: String(input.ownerId),
      expectedCloseDate: String(input.expectedCloseDate),
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json(notFoundResponse(), { status: 404 });
    }
    if (e instanceof StageError) {
      return NextResponse.json(
        { error: "validation failed", errors: [e.message], status: 400 },
        { status: 400 },
      );
    }
    throw e;
  }
}
