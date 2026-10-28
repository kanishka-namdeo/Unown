/**
 * POST /parley/api/invites/accept — NO session (the token is the
 * credential). 404 unknown / 410 used (`reason: "used"`) / 410
 * expired (`reason: "expired"`) / 400 invalid name+password / 201
 * the new user + membership.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { acceptInvite, InviteUsedError, NotFoundError } from "@/lib/parley/store";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", errors: ["body must be valid JSON"] },
      { status: 400 },
    );
  }
  const input = (body ?? {}) as { token?: string; name?: string; password?: string };
  const token = String(input.token ?? "");
  if (!token) {
    return NextResponse.json(
      { error: "validation failed", errors: ["token is required"] },
      { status: 400 },
    );
  }

  try {
    const out = acceptInvite(token, String(input.name ?? ""), String(input.password ?? ""));
    return NextResponse.json(out, { status: 201 });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: "unknown token", reason: "unknown", status: 404 }, { status: 404 });
    }
    if (e instanceof InviteUsedError) {
      return NextResponse.json(
        { error: `invite ${e.reason}`, reason: e.reason, status: 410 },
        { status: 410 },
      );
    }
    // validation failures (the password floor) → 400
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "validation failed", errors: [msg] },
      { status: 400 },
    );
  }
}
