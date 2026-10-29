/**
 * GET /aria/api/contacts — the tenant's contacts, filtered by
 * `?q=` / `?accountId=` / `?ownerId=`. `contact.list` is all-✓ in
 * the matrix.
 *
 * POST /aria/api/contacts — create (`contact.create`: the matrix's
 * ✗ for viewer only). 400 on a bad shape; 404 when the accountId is
 * unknown; 409 when the email already exists in the tenant (the P0
 * uniqueness pin).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  ConflictError,
  createContact,
  getAria,
  listContacts,
  NotFoundError,
} from "@/lib/aria/aria-store";
import { validateCreateContact } from "@/lib/aria/validation";
import { visibleContacts } from "@/lib/aria/visibility";
import {
  conflictResponse,
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "contact.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const search = new URL(req.url).searchParams;
  const q = search.get("q") ?? undefined;
  const accountId = search.get("accountId") ?? undefined;
  const ownerId = search.get("ownerId") ?? undefined;

  const visibleIds = new Set(visibleContacts(getAria(), session.ctx).map((c) => c.id));
  const out = listContacts(session.ctx, q, accountId, ownerId).filter((c) =>
    visibleIds.has(c.id),
  );

  return NextResponse.json(out);
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("contact creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "contact.create");
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
  const { errors } = validateCreateContact({
    accountId: String(input.accountId ?? ""),
    name: String(input.name ?? ""),
    email: String(input.email ?? ""),
    title: String(input.title ?? ""),
    ownerId: String(input.ownerId ?? ""),
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
    const row = createContact(session.ctx, {
      accountId: String(input.accountId),
      name: String(input.name),
      email: String(input.email),
      title: String(input.title),
      ownerId: String(input.ownerId),
      traits: input.traits as {
        replyRate: number;
        openRate: number;
        busySignal: boolean;
      } | undefined,
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (e instanceof ConflictError) {
      return NextResponse.json(conflictResponse(e.message), { status: 409 });
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json(notFoundResponse(), { status: 404 });
    }
    throw e;
  }
}
