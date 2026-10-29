/**
 * POST /aria/api/forecast/snapshot — capture the IMmuTAbLe forecast
 * snapshot (`forecast.capture`: owner + admin only in the matrix).
 * The plan's §3.10 body: 201 the `AriaForecastSnapshot` (the
 * weighted total + the per-stage / per-category breakdowns + the
 * raw record ids the drill-down lane recomputes against).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { captureForecastSnapshot, ValidationError } from "@/lib/aria/aria-store";
import { checkIso } from "@/lib/aria/validation";
import {
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("forecast captures"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "forecast.capture");
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

  const input = (body ?? {}) as { periodStart?: string; periodEnd?: string };
  const errors = [
    ...checkIso(input.periodStart, "periodStart"),
    ...checkIso(input.periodEnd, "periodEnd"),
  ];
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  try {
    const row = captureForecastSnapshot(session.ctx, {
      periodStart: String(input.periodStart),
      periodEnd: String(input.periodEnd),
    });
    return NextResponse.json(row, { status: 201 });
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
