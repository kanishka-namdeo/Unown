/**
 * GET /aria/api/sequences — the tenant's sequences. All-✓ in the
 * matrix.
 *
 * POST /aria/api/sequences — create (`sequence.create`: the
 * matrix's ✗ for rep/viewer). 402 at the plan's sequence cap.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  createSequence,
  listSequences,
  QuotaExceededError,
} from "@/lib/aria/aria-store";
import { validateCreateSequence } from "@/lib/aria/validation";
import type { SeqStep } from "@/lib/aria/types";
import {
  quotaExceededResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "sequence.list");
  if (denied) return NextResponse.json(denied, { status: 403 });

  return NextResponse.json(listSequences(session.ctx));
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("sequence creates"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "sequence.create");
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

  const input = (body ?? {}) as { name?: string; steps?: unknown[]; traitSeed?: number };
  const { errors } = validateCreateSequence({
    name: String(input.name ?? ""),
    steps: input.steps ?? [],
    traitSeed: Number(input.traitSeed ?? -1),
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const row = createSequence(session.ctx, {
      name: String(input.name),
      steps: input.steps as SeqStep[],
      traitSeed: Number(input.traitSeed),
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return NextResponse.json(quotaExceededResponse(), { status: 402 });
    }
    throw e;
  }
}
