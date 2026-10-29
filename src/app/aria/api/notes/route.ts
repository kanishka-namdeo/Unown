/**
 * GET /aria/api/notes — the tenant's notes (newest-first),
 * filtered by `?entityType=` / `?entityId=`.
 *
 * POST /aria/api/notes — append (`note.create`: the matrix's ✗ for
 * viewer).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  createNote,
  listNotes,
} from "@/lib/aria/aria-store";
import { validateCreateNote } from "@/lib/aria/validation";
import type { EntityState } from "@/lib/aria/types";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "note.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const search = new URL(req.url).searchParams;
  const entityType = search.get("entityType") ?? undefined;
  const entityId = search.get("entityId") ?? undefined;

  return NextResponse.json(listNotes(session.ctx, entityType, entityId));
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("note creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "note.create");
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

  const input = (body ?? {}) as Record<string, unknown>;
  const { errors } = validateCreateNote({
    entityType: input.entityType as EntityState,
    entityId: String(input.entityId ?? ""),
    body: String(input.body ?? ""),
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const row = createNote(session.ctx, {
    entityType: input.entityType as EntityState,
    entityId: String(input.entityId),
    body: String(input.body),
  });
  return NextResponse.json(row, { status: 201 });
}
