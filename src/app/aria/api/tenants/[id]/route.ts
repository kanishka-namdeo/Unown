/**
 * GET /aria/api/tenants/[id] — 200 the tenant; 404 when the id is
 * not the session's tenant (cross-tenant → 404, never a 403 that
 * confirms existence).
 *
 * PATCH /aria/api/tenants/[id] — the `tenant.settings` lane:
 * owner-only in the matrix + the owner-seat carve-out (an owner may
 * manage only their own tenant). 400 on a bad plan/quota shape,
 * 200 the updated tenant.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getTenant, patchTenant } from "@/lib/aria/aria-store";
import { validateTenantPatch } from "@/lib/aria/validation";
import type { AriaPlan } from "@/lib/aria/types";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "tenant.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const tenant = getTenant(session.ctx, id);
  if (!tenant) return NextResponse.json(notFoundResponse(), { status: 404 });

  return NextResponse.json(tenant);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id } = await params;

  // The cross-tenant rung FIRST (404, never a 403 that confirms
  // existence) — the plan's tenancy floor:
  if (id !== session.tenant.id) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  // The owner-seat carve-out: `tenant.settings` is owner-gated (a
  // non-owner role → 403 naming the permission).
  const denied = requirePermission(
    session.role,
    "tenant.settings",
    id,
    session.tenant.id,
  );
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
    plan?: AriaPlan;
    quotas?: Record<string, number>;
  };
  const { errors } = validateTenantPatch(input);
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const updated = patchTenant(session.ctx, id, input);
  if (!updated) {
    // Cross-tenant id (or the carve-out's tenant mismatch) → 404.
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  return NextResponse.json(updated);
}
