/**
 * POST /nocturne/api/incidents/[id]/resolve — resolve an incident
 * (plan §3.5, the `incident.resolve` lane). 200 the incident row
 * (status → `resolved`, `resolvedAt` set, the timeline event
 * appended; a postmortem is created when `postmortemBody` is given
 * — the plan's resolve-with-writeup path); 400 when the incident
 * has NOT been acknowledged (the ack-before-resolve invariant,
 * plan §4.6 + §5.4/1); 404 when unknown or cross-tenant.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { resolveIncident } from "@/lib/nocturne/incident";
import { createPostmortem, type ActionItemInput } from "@/lib/nocturne/postmortem";
import { validateResolve } from "@/lib/nocturne/validation";
import { now as nowClock } from "@/lib/nocturne/clock";
import { crossTenant } from "@/lib/nocturne/tenancy";
import { getNocturne, nocturneTransaction, nextId } from "@/app/nocturne/api/_state";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
  invalidJsonResponse,
} from "@/app/nocturne/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/nocturne/api/_rate";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("incident resolves"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id } = await params;
  const s0 = getNocturne();
  const incident = s0.incidents.find((i) => i.id === id);
  // Cross-tenant rung FIRST (404, never a 403 that confirms existence).
  if (!incident || crossTenant(incident, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const denied = requirePermission(session.role, "incident.resolve");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as {
    postmortemBody?: string;
    actionItems?: ActionItemInput[];
  };
  const { errors } = validateResolve({
    postmortemBody: input.postmortemBody,
    actionItems: input.actionItems,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  // The ack-before-resolve invariant (plan §4.6 + PBT §5.4/1): a
  // resolve is valid ONLY from `acknowledged`.
  if (incident.status !== "acknowledged") {
    return NextResponse.json(
      {
        error: "validation failed",
        errors: [
          `cannot resolve a "${incident.status}" incident — acknowledge it first (ack-before-resolve).`,
        ],
      },
      { status: 400 },
    );
  }

  const ctx = { now: nowClock, nextId };
  nocturneTransaction((st) => {
    let state = st;
    const { state: afterResolve, result } = resolveIncident(state, id, session.user.id, ctx);
    if ("ok" in result && result.ok === false) {
      // The engine's own guard (defense in depth — the status check
      // above is the primary gate).
      throw new Error(result.error);
    }
    state = afterResolve;
    // The writeup path: a postmortem on a resolved incident
    // (the plan's `postmortemBody` lane — risk §7/12's
    // "postmortem only on resolved" is enforced by the engine's
    // own resolved-status check, which now always holds).
    if (input.postmortemBody !== undefined && String(input.postmortemBody).trim() !== "") {
      const pm = createPostmortem(state, id, session.user.id, {
        body: String(input.postmortemBody),
        actionItems: input.actionItems,
      }, ctx);
      if ("error" in pm) throw new Error(pm.error);
      state = pm.state;
    }
    return state;
  });

  const fresh = getNocturne();
  const updated = fresh.incidents.find((i) => i.id === id)!;
  const postmortem =
    updated.postmortemId !== null
      ? fresh.postmortems.find((p) => p.id === updated.postmortemId) ?? null
      : null;
  return NextResponse.json({ ...updated, postmortem });
}
