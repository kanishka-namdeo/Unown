/**
 * GET /parley/api/canned — the tenant's canned replies (the
 * composer's `/`-prefix source). Session + `canned.read` (owner/
 * admin/agent, viewer ✗ — the matrix's row). 200 the list.
 *
 * POST /parley/api/canned — create (session + `canned.manage`,
 * owner/admin only). 201.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  listCanned,
  upsertCanned,
} from "@/lib/parley/store";
import { validateCanned } from "@/lib/parley/validation";
import {
  sessionFromRequest,
  unauthorizedResponse,
  requirePermission,
} from "@/app/parley/api/_auth";
import { writeLaneRateLimited, rateLimitedBody } from "@/app/parley/api/_rate";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "canned.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  return NextResponse.json(listCanned(session.ctx));
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("canned creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "canned.manage");
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
  const input = (body ?? {}) as { title?: string; body?: string };
  const { errors } = validateCanned({
    title: String(input.title ?? ""),
    body: String(input.body ?? ""),
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const created = upsertCanned(session.ctx, {
    title: String(input.title),
    body: String(input.body),
  });
  return NextResponse.json(created, { status: 201 });
}
