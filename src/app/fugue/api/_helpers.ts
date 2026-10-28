/**
 * Shared handlers + helpers for Fugue API routes under /fugue/api.
 * Thin shells: parse → validate → auth guard → domain (lib/fugue) → JSON.
 * PLAN.md §6.
 */
import { NextResponse } from "next/server";
import type { FieldError, PublicUser } from "@/lib/fugue/types";
import {
  requireAuth,
  handleSignup,
  handleLogin,
  handleLogout,
  handleMe,
  createSession,
} from "@/lib/fugue/auth";
import { loadState } from "@/lib/fugue/store";
import { DEMO_USER_EMAIL } from "@/lib/fugue/seed";

const BASE = "http://fugue.local/fugue/api";

// ── body parsing ──

/** Parse a JSON request body. Returns null when the body is not valid JSON. */
export async function parseBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// ── auth guard + test helpers ──

/**
 * Auth guard for API routes: returns the PublicUser when a valid session
 * cookie is present, otherwise a 401 NextResponse the route can return early.
 */
export function guardAuth(req: Request, nowIso?: string): PublicUser | NextResponse {
  const user = requireAuth(req, nowIso ?? new Date().toISOString());
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return user;
}

/** Build a request carrying a valid demo-user session cookie. */
export function authReq(path: string, init?: RequestInit): Request {
  const token = sessionTokenFor(DEMO_USER_EMAIL);
  return new Request(`${BASE}${path}`, {
    ...init,
    headers: { Cookie: `fugue_session=${token}`, ...(init?.headers ?? {}) },
  });
}

/** A valid session token for the seeded demo user (for tests). */
export function sessionTokenFor(email: string): string {
  const s = loadState();
  const user = s.users.find((u) => u.email === email);
  if (!user) throw new Error(`no user '${email}'`);
  return createSession(user.id, new Date().toISOString());
}

// ── response builders ──

/** 400 with field-addressed errors. */
export function badRequest(errors: FieldError[]): NextResponse {
  return NextResponse.json({ errors }, { status: 400 });
}

/** 404 for an unknown id. */
export function notFound(id: string, kind: string = "resource"): NextResponse {
  return NextResponse.json({ error: `${kind} '${id}' not found` }, { status: 404 });
}

/** 204 No Content (headers preserved, e.g. Set-Cookie on logout). */
export function noContent(init?: ResponseInit): NextResponse {
  return new NextResponse(null, { status: 204, ...init });
}

// ── auth route handlers (return a NextResponse, one shape for all four) ──

type AuthShape = {
  status: number;
  body: unknown;
  setCookie?: string;
};

function authResponse(result: AuthShape, req: Request): NextResponse {
  const headers: HeadersInit = {};
  if (result.setCookie) headers["Set-Cookie"] = result.setCookie;
  if (result.status === 204) return new NextResponse(null, { status: 204, headers });
  return NextResponse.json(result.body, { status: result.status, headers });
}

export async function signupResponse(req: Request): Promise<NextResponse> {
  const body = await parseBody(req);
  return authResponse(handleSignup(body, req, new Date().toISOString()), req);
}

export async function loginResponse(req: Request): Promise<NextResponse> {
  const body = await parseBody(req);
  return authResponse(handleLogin(body, req, new Date().toISOString()), req);
}

export function logoutResponse(req: Request): NextResponse {
  void req;
  return authResponse(
    handleLogout(req, new Date().toISOString()),
    req,
  );
}

export function meResponse(req: Request): NextResponse {
  void req;
  return authResponse(handleMe(req, new Date().toISOString()), req);
}
