/**
 * GET /aria/api/accounts/[id] — 200 the account + its contacts;
 * 404 when absent, cross-tenant, or outside the caller's
 * visibility scope (never a 403).
 *
 * PATCH /aria/api/accounts/[id] — `account.update` (the matrix's
 * ✗ for rep/viewer). 400 on a bad patch; 404 cross-tenant.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getAccount, listContacts, updateAccount, NotFoundError } from "@/lib/aria/aria-store";
import { getAria } from "@/lib/aria/aria-store";
import { validateUpdateAccount } from "@/lib/aria/validation";
import { isRecordVisible } from "@/lib/aria/visibility";
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

  const denied = requirePermission(session.role, "account.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const account = getAccount(session.ctx, id);
  if (!account) return NextResponse.json(notFoundResponse(), { status: 404 });
  // The visibility scope: an out-of-scope account is invisible
  // (404, not 403).
  if (!isRecordVisible(getAria(), session.ctx, "account", account.ownerId, account)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const contacts = listContacts(session.ctx).filter((c) => c.accountId === account.id);
  return NextResponse.json({ account, contacts });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("account updates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "account.update");
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
  const { errors } = validateUpdateAccount({
    name: input.name !== undefined ? String(input.name) : undefined,
    industry: input.industry !== undefined ? String(input.industry) : undefined,
    size: input.size !== undefined ? Number(input.size) : undefined,
    status: input.status !== undefined ? String(input.status) : undefined,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const updated = updateAccount(
    session.ctx,
    id,
    input as Parameters<typeof updateAccount>[2],
  );
  if (!updated) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }
  void NotFoundError;
  return NextResponse.json(updated);
}
