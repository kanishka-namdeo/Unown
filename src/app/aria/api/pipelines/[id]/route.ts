/**
 * GET /aria/api/pipelines/[id] — 200 the pipeline + its deals; 404
 * when absent or cross-tenant.
 *
 * PATCH /aria/api/pipelines/[id] — `pipeline.update` (the matrix's
 * ✗ for manager/rep/viewer).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  getAria,
  getPipeline,
  updatePipeline,
} from "@/lib/aria/aria-store";
import { visibleDeals } from "@/lib/aria/visibility";
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

  const denied = requirePermission(session.role, "pipeline.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const pipeline = getPipeline(session.ctx, id);
  if (!pipeline) return NextResponse.json(notFoundResponse(), { status: 404 });

  // The visibility layer: a rep's list shows only their deals in
  // this pipeline.
  const deals = visibleDeals(getAria(), session.ctx).filter(
    (d) => d.pipelineId === pipeline.id,
  );

  return NextResponse.json({ pipeline, deals });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("pipeline updates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "pipeline.update");
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

  const input = (body ?? {}) as {
    name?: string;
    stages?: Array<{ id: string; name: string; probability: number; state: string }>;
  };

  const updated = updatePipeline(session.ctx, id, {
    name: input.name,
    stages: input.stages as Parameters<typeof updatePipeline>[2]["stages"],
  });
  if (!updated) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }
  return NextResponse.json(updated);
}
