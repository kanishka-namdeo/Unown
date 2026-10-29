/**
 * GET /aria/api/activities — the tenant's activity timeline
 * (newest-first), filtered by `?entityType=` / `?entityId=` /
 * `?kind=`.
 *
 * POST /aria/api/activities — append (`activity.create`: the
 * matrix's ✗ for viewer). 400 on a bad shape.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  createActivity,
  listActivities,
  ValidationError,
} from "@/lib/aria/aria-store";
import { validateCreateActivity } from "@/lib/aria/validation";
import type { AriaActivity } from "@/lib/aria/types";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "activity.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const search = new URL(req.url).searchParams;
  const entityType = search.get("entityType") ?? undefined;
  const entityId = search.get("entityId") ?? undefined;
  const kind = search.get("kind") ?? undefined;

  return NextResponse.json(listActivities(session.ctx, entityType, entityId, kind));
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("activity creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "activity.create");
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
  const { errors } = validateCreateActivity({
    kind: String(input.kind ?? ""),
    entityType: input.entityType as AriaActivity["entityType"],
    entityId: String(input.entityId ?? ""),
    body: String(input.body ?? ""),
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const row = createActivity(session.ctx, {
      kind: input.kind as AriaActivity["kind"],
      entityType: input.entityType as AriaActivity["entityType"],
      entityId: String(input.entityId),
      body: String(input.body),
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json(
        { error: "validation failed", errors: e.errors },
        { status: 400 },
      );
    }
    throw e;
  }
}
