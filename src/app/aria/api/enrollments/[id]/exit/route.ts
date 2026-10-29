/**
 * POST /aria/api/enrollments/[id]/exit — the manual exit lane
 * (`enrollment.exit`: the matrix's ✗ for viewer). The enrollment
 * moves to `exited_manually` (terminal).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { exitEnrollmentRoute, NotFoundError } from "@/lib/aria/aria-store";
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
    return NextResponse.json(rateLimitedBody("enrollment exits"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "enrollment.exit");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  try {
    const out = exitEnrollmentRoute(session.ctx, id);
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json(notFoundResponse(), { status: 404 });
    }
    throw e;
  }
}
