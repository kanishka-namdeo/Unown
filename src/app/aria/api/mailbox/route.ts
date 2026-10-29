/**
 * GET /aria/api/mailbox — the tenant's simulated outbound mailbox
 * (newest-first), filtered by `?contactId=` / `?outcome=`.
 * `mailbox.list` is all-✓ in the matrix.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { listMailbox } from "@/lib/aria/aria-store";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "mailbox.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const search = new URL(req.url).searchParams;
  const contactId = search.get("contactId") ?? undefined;
  const outcome = search.get("outcome") ?? undefined;

  return NextResponse.json(listMailbox(session.ctx, contactId, outcome));
}
