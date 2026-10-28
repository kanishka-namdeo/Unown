/**
 * POST /parley/api/demo/reset — the embed handshake's server side.
 * NO session (the reset channel is origin-checked on the client).
 * Wipes the store, reseeds deterministically, rotates the demo
 * session for `mira@lumen.test` (a REAL login: the session is
 * created through the same `createSession` path; the cookie the
 * client sets on the next page load is a real HMAC-signed one —
 * never faked auth state).
 *
 * 200 `{ reset: true, demoSessionId, demoCookie }`.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { resetParley } from "@/lib/parley/store";
import { makeSignedCookie, SESSION_TTL_MS } from "@/lib/parley/sessions";
import { SESSION_COOKIE } from "@/app/parley/api/_auth";
import { writeLaneRateLimited, rateLimitedBody } from "@/app/parley/api/_rate";

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("resets"), { status: 429 });
  }

  const { demoSession } = resetParley();
  const cookieValue = makeSignedCookie(demoSession.id);

  const res = NextResponse.json({
    reset: true,
    demoSessionId: demoSession.id,
    demoCookie: cookieValue,
  });
  res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Expires=${new Date(Date.now() + SESSION_TTL_MS).toUTCString()}`,
  );
  return res;
}
