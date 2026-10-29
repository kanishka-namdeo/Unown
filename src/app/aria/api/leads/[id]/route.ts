/**
 * GET /aria/api/leads/[id] — 200 the lead + its activities; 404
 * when absent or cross-tenant (out-of-scope → 404 too, the
 * visibility rung).
 *
 * PATCH /aria/api/leads/[id] — `lead.update` (the matrix's ✗ for
 * viewer). A converted lead is terminal (400 on update attempts).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  getAria,
  getLead,
  listActivities,
  updateLead,
} from "@/lib/aria/aria-store";
import { isRecordVisible } from "@/lib/aria/visibility";
import { validateUpdateLead } from "@/lib/aria/validation";
import type { LeadPriority } from "@/lib/aria/types";
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

  const denied = requirePermission(session.role, "lead.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const lead = getLead(session.ctx, id);
  if (!lead) return NextResponse.json(notFoundResponse(), { status: 404 });
  if (
    !isRecordVisible(
      getAria(),
      session.ctx,
      "lead",
      lead.ownerId ?? null,
      lead,
    )
  ) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const activities = listActivities(session.ctx, "lead", lead.id);
  return NextResponse.json({ lead, activities });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("lead updates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "lead.update");
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
  const { errors } = validateUpdateLead({
    status: input.status !== undefined ? String(input.status) : undefined,
    source: input.source !== undefined ? String(input.source) : undefined,
    priority: input.priority as LeadPriority | undefined,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const existing = getLead(session.ctx, id);
  if (!existing) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }
  // A converted lead is terminal — the plan's invariant.
  if (existing.converted !== null) {
    return NextResponse.json(
      {
        error: "validation failed",
        errors: ["the lead is already converted (terminal)"],
      },
      { status: 400 },
    );
  }

  const updated = updateLead(
    session.ctx,
    id,
    input as Parameters<typeof updateLead>[2],
  );
  if (!updated) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }
  return NextResponse.json(updated);
}
