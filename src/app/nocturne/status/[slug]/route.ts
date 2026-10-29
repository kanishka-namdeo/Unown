/**
 * GET /nocturne/status/[slug] — the PUBLIC status page (plan §3.7
 * + §1's tenancy exception). NO session: the one route that reads
 * without authentication. Returns ONLY the tenant's components +
 * active incidents (the trigger/ack/resolve fields — no user ids,
 * no schedule detail — the risk list's P1 "Status page leak"
 * mitigation, plan §7/11). 404 on an unknown slug.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { statusForSlug, tenantBySlug } from "@/lib/nocturne/status";
import { getNocturne } from "@/app/nocturne/api/_state";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const s = getNocturne();
  if (!tenantBySlug(s, slug)) {
    return NextResponse.json({ error: "not found", status: 404 }, { status: 404 });
  }
  const out = statusForSlug(s, slug);
  if (!out) {
    return NextResponse.json({ error: "not found", status: 404 }, { status: 404 });
  }
  return NextResponse.json(out);
}
