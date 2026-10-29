/**
 * POST /nocturne/api/demo/reset — the embed handshake's server
 * side (the `nocturne-reset` postMessage's target, plan §8.2). NO
 * session: it reseeds the instance's store deterministically +
 * rotates the demo session for `mira@lumen.test` (a REAL login —
 * the cookie is a real HMAC-signed one, never faked auth state).
 * 200 the plan's body `{ reset: true, demoSession, demoCookie }` +
 * Set-Cookie.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { demoLogin } from "@/app/nocturne/api/_state";
import { SESSION_TTL_MS } from "@/lib/nocturne/types";
import { SESSION_COOKIE } from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("resets"), { status: 429 });
  }

  const { row, cookie } = demoLogin();

  const res = NextResponse.json({
    reset: true,
    demoSession: { id: row.id, expiresAt: row.expiresAt },
    demoCookie: cookie,
  });
  res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(cookie)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Expires=${new Date(Date.now() + SESSION_TTL_MS).toUTCString()}`,
  );
  return res;
}
