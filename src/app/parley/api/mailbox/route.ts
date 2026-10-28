/**
 * GET /parley/api/mailbox — the in-app Demo Mailbox read. 200 the
 * tenant's "sent" invites WITH their accept links (the envelope
 * drawer's data source). The read gate = `invite.create` so only
 * the ones who can invite see it. No SMTP.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getParley } from "@/lib/parley/store";
import {
  sessionFromRequest,
  unauthorizedResponse,
  requirePermission,
} from "@/app/parley/api/_auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "invite.create");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const s = getParley();
  const invites = s.invites.filter((i) => i.tenantId === session.ctx.tenantId);
  // Each row's accept link = the in-app "accept as this invited
  // user" flow (the token is the link — no mailto).
  return NextResponse.json(
    invites.map((i) => ({
      ...i,
      acceptLink: `/parley/api/invites/accept?token=${encodeURIComponent(i.token)}`,
    })),
  );
}
