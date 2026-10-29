/**
 * POST /nocturne/api/invites/accept — NO session (the token is the
 * credential, the parley lane — plan §3.2). The ladder: 404 unknown
 * / 410 used / 410 expired / 402 at the seat cap / 400 weak
 * password or missing name / 201 the new user + membership with the
 * invited role.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  acceptInvite,
  InviteError,
  NotFoundError,
  QuotaExceededError,
} from "@/app/nocturne/api/_state";
import { validateAcceptInvite, passwordFloorErrors } from "@/lib/nocturne/validation";
import {
  notFoundResponse,
  quotaExceededResponse,
  invalidJsonResponse,
} from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("invite accepts"), { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as { token?: string; name?: string; password?: string };
  const token = String(input.token ?? "");
  if (!token) {
    return NextResponse.json(
      { error: "validation failed", errors: ["token is required"] },
      { status: 400 },
    );
  }

  // The credential shape is settled BEFORE touching the invite row —
  // a weak password 400s even for a valid token (the parley lane).
  const { errors } = validateAcceptInvite({
    name: String(input.name ?? ""),
    password: String(input.password ?? ""),
  });
  const floor = passwordFloorErrors(String(input.password ?? ""));
  if (errors.length > 0 || floor.length > 0) {
    return NextResponse.json(
      { error: "validation failed", errors: [...errors, ...floor] },
      { status: 400 },
    );
  }

  try {
    const out = acceptInvite(token, String(input.name), String(input.password));
    return NextResponse.json(out, { status: 201 });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json(notFoundResponse(), { status: 404 });
    }
    if (e instanceof QuotaExceededError) {
      return NextResponse.json(quotaExceededResponse(), { status: 402 });
    }
    if (e instanceof InviteError) {
      return NextResponse.json(
        { error: "invite gone", reason: e.reason, status: 410 },
        { status: 410 },
      );
    }
    throw e;
  }
}
