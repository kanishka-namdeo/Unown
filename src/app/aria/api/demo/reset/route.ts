/**
 * POST /aria/api/demo/reset — the embed handshake's server side
 * (the `aria-reset` postMessage's target). NO session: it reseeds
 * the instance's store deterministically + rotates the demo
 * session for `mira@lumen.test` (a REAL login — the cookie is a
 * real HMAC-signed one, never faked auth state). 200 the plan's
 * body `{ reset: true, demoSessionId, demoCookie }` + Set-Cookie.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { ariaReset } from "@/app/aria/api/_state";
import { makeSignedCookie, SESSION_TTL_MS } from "@/lib/aria/sessions";
import { SESSION_COOKIE } from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("resets"), { status: 429 });
  }

  const { demoSession } = ariaReset();
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
