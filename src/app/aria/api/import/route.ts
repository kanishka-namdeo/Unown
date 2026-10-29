/**
 * POST /aria/api/import — the CSV import (`import.run`: the
 * matrix's ✗ for rep/viewer — owner/admin/manager only). The
 * `dryRun` flag: true returns per-row errors + duplicate
 * detection WITHOUT committing; false commits. 200 the plan's
 * body `{ imported, errors, duplicates }`.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { runImport, ValidationError } from "@/lib/aria/aria-store";
import { validateImport } from "@/lib/aria/validation";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("imports"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "import.run");
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

  const input = (body ?? {}) as { type?: string; csv?: string; dryRun?: boolean };
  const { errors } = validateImport({
    type: String(input.type ?? ""),
    csv: String(input.csv ?? ""),
    dryRun: input.dryRun === true,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const out = runImport(session.ctx, {
      type: input.type as "contacts" | "deals",
      csv: String(input.csv),
      dryRun: input.dryRun === true,
    });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json(
        { error: "validation failed", errors: e.errors },
        { status: 400 },
      );
    }
    throw e;
  }
}
