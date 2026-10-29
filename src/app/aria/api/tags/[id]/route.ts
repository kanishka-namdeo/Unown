/**
 * PATCH /aria/api/tags/[id] — rename (`tag.update`: owner + admin
 * only). 409 on a duplicate label, 404 cross-tenant / unknown.
 *
 * DELETE /aria/api/tags/[id] — remove the row + strip the label
 * from every entity row's tag list (`tag.delete`). 404 on the
 * not-found rung, 204 on success.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  ConflictError,
  deleteTag,
  updateTag,
} from "@/lib/aria/aria-store";
import { validateCreateTag } from "@/lib/aria/validation";
import {
  conflictResponse,
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("tag updates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "tag.update");
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

  const input = (body ?? {}) as { label?: string };
  const { errors } = validateCreateTag({ label: String(input.label ?? "") });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const updated = updateTag(session.ctx, id, String(input.label));
    if (!updated) {
      return NextResponse.json(notFoundResponse(), { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof ConflictError) {
      return NextResponse.json(conflictResponse(e.message), { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("tag deletes"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "tag.delete");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const removed = deleteTag(session.ctx, id);
  if (!removed) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
