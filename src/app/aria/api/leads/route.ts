/**
 * GET /aria/api/leads — the tenant's leads, each with its computed
 * `slaState` (ok / at_risk / breached / met), filtered by
 * `?status=` / `?source=` / `?slaState=`.
 *
 * POST /aria/api/leads — create (`lead.create`: the matrix's ✗ for
 * viewer). The store's find-or-create contact + account lane runs
 * inside `createLead`'s sibling call from the convert route; this
 * lane just records the lead row.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  createLead,
  listLeads,
  NotFoundError,
} from "@/lib/aria/aria-store";
import { visibleLeads } from "@/lib/aria/visibility";
import { getAria } from "@/lib/aria/aria-store";
import { validateCreateLead } from "@/lib/aria/validation";
import type { LeadPriority } from "@/lib/aria/types";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "lead.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const search = new URL(req.url).searchParams;
  const status = search.get("status") ?? undefined;
  const source = search.get("source") ?? undefined;
  const slaState = search.get("slaState") ?? undefined;

  let out = listLeads(session.ctx, status, source);
  const visibleIds = new Set(visibleLeads(getAria(), session.ctx).map((l) => l.id));
  const filtered = out.filter((l) => visibleIds.has(l.id));
  const rows =
    slaState === undefined
      ? filtered
      : filtered.filter((l) => l.slaState === slaState);

  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("lead creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "lead.create");
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
  const { errors } = validateCreateLead({
    name: String(input.name ?? ""),
    email: String(input.email ?? ""),
    source: String(input.source ?? ""),
    priority: input.priority as LeadPriority,
    ownerId: String(input.ownerId ?? ""),
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const row = createLead(session.ctx, {
      name: String(input.name),
      email: String(input.email),
      source: String(input.source),
      priority: input.priority as LeadPriority,
      ownerId: String(input.ownerId),
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json(notFoundResponse(), { status: 404 });
    }
    throw e;
  }
}
