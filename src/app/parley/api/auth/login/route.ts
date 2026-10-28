/**
 * POST /parley/api/auth/login — credential login.
 *
 * The 401 rung (wrong password / unknown email). Creates a real
 * `SessionRow` (8h TTL) + sets the HMAC-signed `parley_ses` cookie
 * (`httpOnly, sameSite=lax, path=/, maxAge=8h`).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { validateLogin } from "@/lib/parley/validation";
import { verifyPassword } from "@/lib/parley/password";
import { userByEmail, loginSession, getParley } from "@/lib/parley/store";
import { makeSignedCookie, SESSION_TTL_MS } from "@/lib/parley/sessions";
import { SESSION_COOKIE, unauthorizedResponse } from "@/app/parley/api/_auth";
import { writeLaneRateLimited, rateLimitedBody } from "@/app/parley/api/_rate";

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("logins"), { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", errors: ["body must be valid JSON"] },
      { status: 400 },
    );
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
  // Unknown email AND wrong-password both → the same 401 (never a
  // "user exists" 403 — the brief's "no leak, no 403" ladder).
  if (!user || !verifyPassword(String(input.password), user.salt, user.passwordHash)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 });
  }

  // Find the user's membership (a user with memberships in two
  // tenants picks the first one; the role comes from the
  // membership, not the user row).
  const s = getParley();
  const membership = s.memberships.find((m) => m.userId === user.id)!;
  const session = loginSession(user.id, membership.tenantId);
  const cookieValue = makeSignedCookie(session.id);

  const res = NextResponse.json({
    id: session.id,
    user: { id: user.id, email: user.email, name: user.name },
    tenant: { id: membership.tenantId, slug: s.tenants.find((t) => t.id === membership.tenantId)!.slug },
    role: membership.role,
  });
  res.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Expires=${new Date(Date.now() + SESSION_TTL_MS).toUTCString()}`,
  );
  return res;
}
