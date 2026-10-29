/**
 * POST /aria/api/invites/accept — NO session (the token is the
 * credential, the parley lane). The ladder: 404 unknown / 410 used
 * / 410 expired / 402 at the seat cap / 400 weak password / 201
 * the new user + membership with the invited role.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  acceptInvite,
  InviteError,
  NotFoundError,
  QuotaExceededError,
} from "@/lib/aria/aria-store";
import { passwordFloorErrors } from "@/lib/aria/validation";
import {
  conflictResponse,
  notFoundResponse,
  quotaExceededResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("invite accepts"), { status: 429 });
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

  const input = (body ?? {}) as { token?: string; name?: string; password?: string };
  const token = String(input.token ?? "");
  if (!token) {
    return NextResponse.json(
      { error: "validation failed", errors: ["token is required"] },
      { status: 400 },
    );
  }

  // The password floor is checked BEFORE touching the invite row —
  // a weak password 400s even for a valid token (the credential
  // shape is settled first).
  const floor = passwordFloorErrors(input.password);
  if (floor.length > 0 || !String(input.name ?? "").trim()) {
    return NextResponse.json(
      {
        error: "validation failed",
        errors: [
          ...(!String(input.name ?? "").trim() ? ["Name is required."] : []),
          ...floor,
        ],
      },
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
      return NextResponse.json(conflictResponse(`invite ${e.reason}`), {
        status: 410,
      });
    }
    throw e;
  }
}
