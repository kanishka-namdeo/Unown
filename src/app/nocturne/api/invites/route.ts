/**
 * POST /nocturne/api/invites — create a single-use invite
 * (plan §3.2, the `invite.create` lane: owner + admin only). 400 on
 * a bad email/role, 402 at the seat cap, 201 the invite row
 * (token + 24h expiry).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { createInvite, QuotaExceededError } from "@/app/nocturne/api/_state";
import { validateInvite } from "@/lib/nocturne/validation";
import type { NocturneRole } from "@/lib/nocturne/types";
import {
  quotaExceededResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
  invalidJsonResponse,
} from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("invites"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "invite.create");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as { email?: string; role?: NocturneRole };
  const { errors } = validateInvite({
    email: String(input.email ?? ""),
    role: input.role as NocturneRole,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const invite = createInvite(
      { tenantId: session.ctx.tenantId, actorUserId: session.user.id },
      String(input.email),
      input.role!,
    );
    return NextResponse.json(invite, { status: 201 });
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return NextResponse.json(quotaExceededResponse(), { status: 402 });
    }
    throw e;
  }
}
