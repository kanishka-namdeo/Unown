/**
 * GET /aria/api/contacts/[id] — 200 the contact + its deals + its
 * activities; 404 when absent or cross-tenant.
 *
 * PATCH /aria/api/contacts/[id] — `contact.update` (the matrix's
 * ✗ for viewer). 409 when the new email clashes (the P0
 * uniqueness gate on updates too), 404 cross-tenant.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  ConflictError,
  getAria,
  getContact,
  listActivities,
  updateContact,
} from "@/lib/aria/aria-store";
import { visibleDeals } from "@/lib/aria/visibility";
import { validateUpdateContact } from "@/lib/aria/validation";
import {
  conflictResponse,
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

  const denied = requirePermission(session.role, "contact.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const contact = getContact(session.ctx, id);
  if (!contact) return NextResponse.json(notFoundResponse(), { status: 404 });

  const deals = visibleDeals(getAria(), session.ctx).filter(
    (d) => d.contactId === contact.id,
  );
  const activities = listActivities(session.ctx, "contact", contact.id);

  return NextResponse.json({ contact, deals, activities });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("contact updates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "contact.update");
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
  const { errors } = validateUpdateContact({
    name: input.name !== undefined ? String(input.name) : undefined,
    title: input.title !== undefined ? String(input.title) : undefined,
    email: input.email !== undefined ? String(input.email) : undefined,
    traits: input.traits as {
      replyRate?: number;
      openRate?: number;
      busySignal?: boolean;
    } | undefined,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const updated = updateContact(
      session.ctx,
      id,
      input as Parameters<typeof updateContact>[2],
    );
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
