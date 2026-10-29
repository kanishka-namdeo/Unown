/**
 * GET /nocturne/api/postmortems/[id] — 200 the postmortem row +
 * its action items; 404 when unknown or cross-tenant (never a 403
 * — plan §7/1). The `postmortem.action` lane lives in its own
 * route file: `postmortems/[id]/actions/[actionId]/route.ts`.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { crossTenant } from "@/lib/nocturne/tenancy";
import type { NocturnePostmortem, NocturneState } from "@/lib/nocturne/types";
import { getNocturne } from "@/app/nocturne/api/_state";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/nocturne/api/_auth";

function findPostmortem(s: NocturneState, id: string): NocturnePostmortem | undefined {
  return s.postmortems.find((x) => x.id === id);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "postmortem.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const s = getNocturne();
  const postmortem = findPostmortem(s, id);
  if (!postmortem || crossTenant(postmortem, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }
  return NextResponse.json(postmortem);
}
