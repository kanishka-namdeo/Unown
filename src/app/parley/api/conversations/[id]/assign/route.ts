/**
 * POST /parley/api/conversations/[id]/assign — set the assignee
 * (or `null` to unassign). Session + `conversation.assign` (viewer →
 * 403). Appends the "assigned" system event + audit. Cross-tenant →
 * 404. 200 the updated conversation.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { assign, getConvo } from "@/lib/parley/store";
import { validateAssign } from "@/lib/parley/validation";
import {
  sessionFromRequest,
  unauthorizedResponse,
  requirePermission,
} from "@/app/parley/api/_auth";
import { writeLaneRateLimited, rateLimitedBody } from "@/app/parley/api/_rate";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("assignments"), { status: 429 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "conversation.assign");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const convo = getConvo(session.ctx, id);
  if (!convo) return NextResponse.json({ error: "not found", status: 404 }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", errors: ["body must be valid JSON"] },
      { status: 400 },
    );
  }
  const input = (body ?? {}) as { userId?: string | null };
  const { errors } = validateAssign({ userId: input.userId ?? null });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const updated = assign(session.ctx, id, input.userId ?? null);
  if (!updated) return NextResponse.json({ error: "not found", status: 404 }, { status: 404 });
  return NextResponse.json(updated);
}
