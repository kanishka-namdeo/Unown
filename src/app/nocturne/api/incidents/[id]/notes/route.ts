/**
 * POST /nocturne/api/incidents/[id]/notes — add an incident note
 * (plan §3.5, the `incident.note` lane). 201 the note row (the
 * `note` timeline event is appended by the lib engine — the note
 * row is mutable, the timeline event is immutable evidence); 400
 * on an empty body or an unknown/cross-tenant incident; 404 when
 * the incident is not the caller's.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { addNote } from "@/lib/nocturne/incident";
import { validateNote } from "@/lib/nocturne/validation";
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
    return NextResponse.json(rateLimitedBody("incident notes"), { status: 429 });
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

  const denied = requirePermission(session.role, "incident.note");
  if (denied) return NextResponse.json(denied, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(invalidJsonResponse(), { status: 400 });
  }

  const input = (body ?? {}) as { body?: string };
  const { errors } = validateNote({ body: String(input.body ?? "") });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const ctx = { now: nowClock, nextId };
  let noteId: string | null = null;
  nocturneTransaction((st) => {
    const { state, note } = addNote(st, id, session.user.id, String(input.body).trim(), ctx);
    noteId = note.id;
    return state;
  });
  const note = getNocturne().notes.find((n) => n.id === noteId)!;
  return NextResponse.json(note, { status: 201 });
}
