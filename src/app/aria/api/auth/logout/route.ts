/**
 * POST /aria/api/auth/logout — destroy the session row + clear the
 * cookie. 204 on success; 401 when the cookie is absent/invalid
 * (the cookie is still cleared — idempotent).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { destroySession } from "@/lib/aria/aria-store";
import { SESSION_COOKIE, sessionFromRequest, unauthorizedResponse } from "@/app/aria/api/_auth";

export async function POST(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) {
    const res = NextResponse.json(unauthorizedResponse(), { status: 401 });
    res.headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return res;
  }
  destroySession(session.sessionId);
  const res = new NextResponse(null, { status: 204 });
  res.headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}
