/**
 * GET /aria/api/pipelines — the tenant's pipelines. All-✓ in the
 * matrix.
 *
 * POST /aria/api/pipelines — create (`pipeline.create`: the matrix's
 * ✗ for manager/rep/viewer — owner + admin only). 402 at the plan's
 * pipeline cap.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  createPipeline,
  listPipelines,
  QuotaExceededError,
} from "@/lib/aria/aria-store";
import { validateCreatePipeline } from "@/lib/aria/validation";
import type { AriaPipeline } from "@/lib/aria/types";
import {
  quotaExceededResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "pipeline.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  return NextResponse.json(listPipelines(session.ctx));
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("pipeline creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "pipeline.create");
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

  const input = (body ?? {}) as {
    name?: string;
    stages?: Array<{ name: string; probability: number; state: string }>;
  };
  const { errors } = validateCreatePipeline({
    name: String(input.name ?? ""),
    stages: input.stages ?? [],
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const row = createPipeline(session.ctx, {
      name: String(input.name),
      stages: input.stages!.map((s) => ({
        name: s.name,
        probability: s.probability,
        state: s.state as AriaPipeline["stages"][number]["state"],
      })),
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return NextResponse.json(quotaExceededResponse(), { status: 402 });
    }
    throw e;
  }
}
