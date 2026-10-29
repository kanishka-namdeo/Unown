/**
 * POST /nocturne/api/auth/login — credential login (plan §3.1).
 *
 * The 401 rung (wrong password / unknown email — the "no user-
 * exists leak" shape: both fail identically). Creates a REAL
 * session row (8h TTL from the pinned clock) + sets the HMAC-signed
 * `nocturne_ses` cookie (`httpOnly, sameSite=lax, path=/,
 * maxAge=8h`).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { validateLogin } from "@/lib/nocturne/validation";
import {
  getNocturne,
  loginSession,
  userByEmail,
  userPasswordOk,
} from "@/app/nocturne/api/_state";
import { makeSignedCookie } from "@/lib/nocturne/sessions";
import { SESSION_TTL_MS } from "@/lib/nocturne/types";
import {
  SESSION_COOKIE,
  unauthorizedResponse,
  invalidJsonResponse,
} from "@/app/nocturne/api/_auth";
import { writeLaneRateLimited, rateLimitedBody } from "@/app/nocturne/api/_rate";

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("logins"), { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as { email?: string; password?: string };
  const { errors } = validateLogin({
    email: String(input.email ?? ""),
    password: String(input.password ?? ""),
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const user = userByEmail(String(input.email));
  // Unknown email AND wrong password both → the same 401 (never a
  // "user exists" leak — the no-leak ladder).
  if (!user || !userPasswordOk(user, String(input.password))) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 });
  }

  // A user with memberships in two tenants picks the FIRST one
  // (the role comes from the membership, not the user row).
  const s = getNocturne();
  const membership = s.memberships.find((m) => m.userId === user.id)!;
  const session = loginSession(user.id, membership.tenantId);
  const cookieValue = makeSignedCookie(session.id);

  const res = NextResponse.json({
    session: { id: session.id, expiresAt: session.expiresAt },
    user: { id: user.id, email: user.email, name: user.name },
    tenant: {
      id: membership.tenantId,
      slug: s.tenants.find((t) => t.id === membership.tenantId)!.slug,
    },
    role: membership.role,
  });
  res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Expires=${new Date(Date.now() + SESSION_TTL_MS).toUTCString()}`,
  );
  return res;
}
