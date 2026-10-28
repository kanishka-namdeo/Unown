/**
 * PATCH /parley/api/canned/[id] — update a canned reply.
 * Session + `canned.manage` (owner/admin only, agent ✗). 200 the
 * updated reply. Cross-tenant → 404.
 *
 * DELETE /parley/api/canned/[id] — remove. 204. Cross-tenant → 404.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  upsertCanned,
  deleteCanned,
  getParley,
} from "@/lib/parley/store";
import { validateCanned } from "@/lib/parley/validation";
import {
  sessionFromRequest,
  unauthorizedResponse,
  requirePermission,
} from "@/app/parley/api/_auth";
import { writeLaneRateLimited, rateLimitedBody } from "@/app/parley/api/_rate";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("canned updates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "canned.manage");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  // Cross-tenant check: the canned reply must belong to the
  // caller's tenant (never a 403 that confirms existence → 404).
  const s = getParley();
  const existing = s.canned.find((c) => c.id === id && c.tenantId === session.ctx.tenantId);
  if (!existing) return NextResponse.json({ error: "not found", status: 404 }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", errors: ["body must be valid JSON"] },
      { status: 400 },
    );
  }
  const input = (body ?? {}) as { title?: string; body?: string };
  const { errors } = validateCanned({
    title: String(input.title ?? existing.title),
    body: String(input.body ?? existing.body),
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const updated = upsertCanned(session.ctx, {
    id,
    title: String(input.title ?? existing.title),
    body: String(input.body ?? existing.body),
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("canned deletes"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "canned.manage");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const s = getParley();
  const existing = s.canned.find((c) => c.id === id && c.tenantId === session.ctx.tenantId);
  if (!existing) return NextResponse.json({ error: "not found", status: 404 }, { status: 404 });

  const removed = deleteCanned(session.ctx, id);
  if (!removed) return NextResponse.json({ error: "not found", status: 404 }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
