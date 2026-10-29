/**
 * POST /aria/api/enrollments/[id]/advance — run the deterministic
 * cadence engine over the enrollment (`enrollment.advance`: the
 * matrix's ✗ for viewer). 200 the engine's output:
 *
 *   `{ enrollment, newEvents, mailboxMsgs, newTasks }`
 *
 * Terminal enrollments are no-ops (the engine's P1 pin).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { advanceEnrollment, NotFoundError } from "@/lib/aria/aria-store";
import type { AriaEngagement } from "@/lib/aria/types";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("enrollment advances"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "enrollment.advance");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const input = (body ?? {}) as { events?: AriaEngagement[] };
  const events = Array.isArray(input.events)
    ? input.events.filter((e): e is AriaEngagement =>
        ["sent", "open", "reply", "meeting_booked"].includes(e),
      )
    : [];

  try {
    const out = advanceEnrollment(session.ctx, id, events);
    return NextResponse.json({
      enrollment: out.enrollment,
      newEvents: out.newEvents,
      mailboxMsgs: out.mailboxMsgs,
      newTasks: out.newTasks,
    });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json(notFoundResponse(), { status: 404 });
    }
    throw e;
  }
}
