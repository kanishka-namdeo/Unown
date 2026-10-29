/**
 * GET /aria/api/accounts — the tenant's accounts, filtered by the
 * session's visibility scope (rep → own; manager → team;
 * owner/admin/viewer → whole tenant) + `?q=` / `?ownerId=` /
 * `?status=`.
 *
 * POST /aria/api/accounts — create (`account.create`: the matrix's
 * ✗ for rep/viewer). 400 on a bad shape; 404 when the ownerId is
 * not a tenant member.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { createAccount, getAria, listAccounts, NotFoundError, ValidationError } from "@/lib/aria/aria-store";
import { validateCreateAccount } from "@/lib/aria/validation";
import { visibleAccounts } from "@/lib/aria/visibility";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "account.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const search = new URL(req.url).searchParams;
  const q = search.get("q") ?? undefined;
  const ownerId = search.get("ownerId") ?? undefined;
  const status = search.get("status") ?? undefined;

  // The visibility layer narrows the list for ownership-scoped
  // roles (rep → own records; manager → team records; whole-
  // tenant roles see everything).
  const visible = new Set(visibleAccounts(getAria(), session.ctx).map((a) => a.id));
  const out = listAccounts(session.ctx, q, ownerId, status).filter((a) =>
    visible.has(a.id),
  );

  return NextResponse.json(out);
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("account creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "account.create");
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
  const { errors } = validateCreateAccount({
    name: String(input.name ?? ""),
    domain: String(input.domain ?? ""),
    industry: String(input.industry ?? ""),
    size: Number(input.size ?? 0),
    ownerId: String(input.ownerId ?? ""),
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const row = createAccount(session.ctx, {
      name: String(input.name),
      domain: String(input.domain),
      industry: String(input.industry),
      size: Number(input.size),
      ownerId: String(input.ownerId),
      status: input.status as "active" | "inactive" | undefined,
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json(notFoundResponse(), { status: 404 });
    }
    if (e instanceof ValidationError) {
      return NextResponse.json(
        { error: "validation failed", errors: e.errors },
        { status: 400 },
      );
    }
    throw e;
  }
}
