/**
 * PATCH /nocturne/api/postmortems/[id]/actions/[actionId] — the
 * `postmortem.action` lane: flip a single action item's `done` /
 * `doneAt` (the lib's `setActionItemState` engine). 404 when the
 * postmortem, the action item, or the tenant scope is unknown
 * (never a 403 — plan §7/1); 400 on a bad shape; 200 the updated
 * postmortem row.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { setActionItemState } from "@/lib/nocturne/postmortem";
import { validatePostmortemAction } from "@/lib/nocturne/validation";
import { now as nowClock } from "@/lib/nocturne/clock";
import { crossTenant } from "@/lib/nocturne/tenancy";
import {
  getNocturne,
  nocturneTransaction,
  nextId,
} from "@/app/nocturne/api/_state";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
  invalidJsonResponse,
} from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

export async function PATCH(
  req: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; actionId: string }>;
  },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("postmortem actions"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id, actionId } = await params;
  const s0 = getNocturne();
  const postmortem = s0.postmortems.find((p) => p.id === id);
  // Cross-tenant rung FIRST (404, never a 403 that confirms existence).
  if (!postmortem || crossTenant(postmortem, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }
  // The 404 rung (plan §3.8): the action item must exist in this
  // postmortem.
  if (!postmortem.actionItems.some((a) => a.id === actionId)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const denied = requirePermission(session.role, "postmortem.action");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as { done?: boolean; doneAt?: string | null };
  const { errors } = validatePostmortemAction({
    done: input.done as boolean,
    doneAt: input.doneAt,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const ctx = { now: nowClock, nextId };
  nocturneTransaction((st) => {
    const { state, result } = setActionItemState(
      st,
      id,
      actionId,
      input.done as boolean,
      input.doneAt ?? null,
      ctx,
    );
    if (!result.ok) throw new Error(result.error);
    return state;
  });

  const updated = getNocturne().postmortems.find((p) => p.id === id)!;
  return NextResponse.json(updated);
}
