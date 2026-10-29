/**
 * GET /nocturne/api/tenants/[id] — 200 the tenant; 404 when the id
 * is not the session's tenant (cross-tenant → 404, never a 403 that
 * confirms existence — the plan's tenancy floor, §7/1).
 *
 * PATCH /nocturne/api/tenants/[id] — the `tenant.settings` lane
 * (owner-only in the matrix; a non-owner role → 403 naming the
 * permission). 400 on a bad `slaMinutes` shape, 200 the updated
 * tenant.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { patchTenant } from "@/app/nocturne/api/_state";
import { validateTenantPatch } from "@/lib/nocturne/validation";
import type { NocturneTenant, Severity } from "@/lib/nocturne/types";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
  invalidJsonResponse,
} from "@/app/nocturne/api/_auth";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "tenant.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  // Cross-tenant rung FIRST (404, never a 403 that confirms existence).
  if (id !== session.tenant.id) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }
  return NextResponse.json(session.tenant);
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

  // The owner-only lane: `tenant.settings` (a non-owner role → 403
  // naming the permission).
  const denied = requirePermission(session.role, "tenant.settings");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as {
    name?: string;
    slaMinutes?: Record<Severity, { ack: number; resolve: number }>;
  };
  const { errors } = validateTenantPatch(input);
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const updated = patchTenant(id, session.user.id, input as {
    name?: string;
    slaMinutes?: NocturneTenant["slaMinutes"];
  });
  if (!updated) {
    // The id vanished between the cross-tenant check and the write
    // (or is not the caller's tenant) → 404.
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  return NextResponse.json(updated);
}
