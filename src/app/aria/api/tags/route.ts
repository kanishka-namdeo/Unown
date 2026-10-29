/**
 * GET /aria/api/tags — the tenant's tag vocabulary. All-✓ in the
 * matrix.
 *
 * POST /aria/api/tags — create (`tag.create`: the matrix's ✗ for
 * manager/rep/viewer — owner + admin only). 409 on a duplicate
 * label in the tenant (case-insensitive).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  ConflictError,
  createTag,
  listTags,
} from "@/lib/aria/aria-store";
import { validateCreateTag } from "@/lib/aria/validation";
import {
  conflictResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "tag.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  return NextResponse.json(listTags(session.ctx));
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("tag creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "tag.create");
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

  const input = (body ?? {}) as { label?: string };
  const { errors } = validateCreateTag({ label: String(input.label ?? "") });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const row = createTag(session.ctx, String(input.label));
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (e instanceof ConflictError) {
      return NextResponse.json(conflictResponse(e.message), { status: 409 });
    }
    throw e;
  }
}
