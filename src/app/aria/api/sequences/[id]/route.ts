/**
 * GET /aria/api/sequences/[id] — 200 the sequence + its
 * enrollments; 404 when absent or cross-tenant.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  getSequence,
  listEnrollments,
} from "@/lib/aria/aria-store";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "sequence.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const sequence = getSequence(session.ctx, id);
  if (!sequence) return NextResponse.json(notFoundResponse(), { status: 404 });

  const enrollments = listEnrollments(session.ctx, sequence.id);
  return NextResponse.json({ sequence, enrollments });
}
