/**
 * GET /nocturne/api/auth/session — the "am I logged in" probe + the
 * embed auto-login's check (plan §3.1). 200 the session's public
 * shape, or 401 when the cookie is absent/invalid/expired.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { getNocturne, findStoredSession } from "@/app/nocturne/api/_state";
import {
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/nocturne/api/_auth";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 });
  }
  const s = getNocturne();
  const row = findStoredSession(s, session.sessionId);
  return NextResponse.json({
    session: { id: session.sessionId, expiresAt: row?.expiresAt },
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
    tenant: { id: session.tenant.id, slug: session.tenant.slug },
    role: session.role,
  });
}
