/**
 * POST /aria/api/enrollments — enroll a contact in a sequence
 * (`enrollment.create`: the matrix's ✗ for viewer). 201 the
 * enrollment in state `enrolled` with its deterministic traitMult.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  createEnrollment,
  NotFoundError,
} from "@/lib/aria/aria-store";
import { validateCreateEnrollment } from "@/lib/aria/validation";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("enrollment creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "enrollment.create");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", errors: ["body must be valid JSON"] },
      { status: 400 },
    );
  }

  const input = (body ?? {}) as { contactId?: string; sequenceId?: string };
  const { errors } = validateCreateEnrollment({
    contactId: String(input.contactId ?? ""),
    sequenceId: String(input.sequenceId ?? ""),
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const row = createEnrollment(session.ctx, {
      contactId: String(input.contactId),
      sequenceId: String(input.sequenceId),
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json(notFoundResponse(), { status: 404 });
    }
    throw e;
  }
}
