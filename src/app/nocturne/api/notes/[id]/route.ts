/**
 * PATCH /nocturne/api/notes/[id] — edit an incident note in place
 * (plan §3.5, the `incident.note` lane). The note row is the
 * MUTABLE record; the timeline event that referenced it stays
 * immutable (plan §4.6). 200 the updated row; 403 when the caller
 * is neither the note's author nor an owner/admin; 404 when the
 * note is unknown or belongs to another tenant.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { updateNote } from "@/lib/nocturne/incident";
import { validateNote } from "@/lib/nocturne/validation";
import { now as nowClock } from "@/lib/nocturne/clock";
import { crossTenant } from "@/lib/nocturne/tenancy";
import { getNocturne, nocturneTransaction } from "@/app/nocturne/api/_state";
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
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("note updates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const { id } = await params;
  const s0 = getNocturne();
  const note = s0.notes.find((n) => n.id === id);
  // Cross-tenant rung FIRST (404, never a 403 that confirms existence).
  if (!note || crossTenant(note, session.ctx)) {
    return NextResponse.json(notFoundResponse(), { status: 404 });
  }

  const denied = requirePermission(session.role, "incident.note");
  if (denied) return NextResponse.json(denied, { status: 403 });

  // The author-only-or-admin gate (plan §3.5's "403 otherwise"):
  // an owner/admin may edit any note; a responder/viewer only
  // their own.
  const isOwnerOrAdmin = session.role === "owner" || session.role === "admin";
  if (!isOwnerOrAdmin && note.authorId !== session.user.id) {
    return NextResponse.json(
      {
        error: "forbidden",
        permission: "incident.note (author-only for the responder role)",
        status: 403,
      },
      { status: 403 },
    );
  }

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

  nocturneTransaction((st) =>
    updateNote(st, id, String(input.body).trim(), nowClock()),
  );
  const updated = getNocturne().notes.find((n) => n.id === id)!;
  return NextResponse.json(updated);
}
