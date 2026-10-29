/**
 * POST /aria/api/invites — create a single-use invite (the
 * `invite.create` lane: owner + admin only — the matrix's ✗ for
 * manager/rep/viewer). 400 on a bad email/role, 402 at the seat
 * cap, 201 the invite row (token + 24h expiry).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { createInvite, QuotaExceededError } from "@/lib/aria/aria-store";
import { validateInvite } from "@/lib/aria/validation";
import type { AriaRole } from "@/lib/aria/types";
import {
  quotaExceededResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

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
    return NextResponse.json(
      { error: "invalid JSON body", errors: ["body must be valid JSON"] },
      { status: 400 },
    );
  }

  const input = (body ?? {}) as { email?: string; role?: AriaRole };
  const { errors } = validateInvite({
    email: String(input.email ?? ""),
    role: input.role as AriaRole,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const invite = createInvite(session.ctx, String(input.email), input.role!);
    return NextResponse.json(invite, { status: 201 });
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return NextResponse.json(quotaExceededResponse(), { status: 402 });
    }
    throw e;
  }
}
