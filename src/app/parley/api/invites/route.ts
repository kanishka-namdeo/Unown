/**
 * POST /parley/api/invites — create an invite (the demo mailbox's
 * "sent" list reads `GET invites`). Session + `invite.create` with
 * the owner-seat carve-out (the admin's "✓ (not owner seat)" cell
 * is a resource check).
 *
 * GET /parley/api/invites — the mailbox read-gate: only the ones
 * who can create can see the mailbox. 200 the tenant's invites
 * (pending + used, each with its accept link's token + expiry).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  createInvite,
  getParley,
} from "@/lib/parley/store";
import { validateInvite } from "@/lib/parley/validation";
import type { Role } from "@/lib/parley/types";
import {
  sessionFromRequest,
  unauthorizedResponse,
  requirePermission,
} from "@/app/parley/api/_auth";
import { writeLaneRateLimited, rateLimitedBody } from "@/app/parley/api/_rate";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "invite.create");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getParley();
  return NextResponse.json(
    s.invites.filter((i) => i.tenantId === session.ctx.tenantId),
  );
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("invites"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", errors: ["body must be valid JSON"] },
      { status: 400 },
    );
  }
  const input = (body ?? {}) as { email?: string; role?: Role };
  const { errors } = validateInvite({
    email: String(input.email ?? ""),
    role: input.role as Role,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  // The owner-seat carve-out: admin may invite only non-owner seats.
  const denied = requirePermission(
    session.role,
    "invite.create",
    undefined,
    session.membership.id,
  );
  if (denied) return NextResponse.json(denied, { status: 403 });

  const inv = createInvite(session.ctx, String(input.email), input.role!);
  return NextResponse.json(inv, { status: 201 });
}
