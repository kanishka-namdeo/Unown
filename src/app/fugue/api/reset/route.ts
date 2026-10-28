import { NextResponse } from "next/server";
import { guardAuth } from "@/app/fugue/api/_helpers";
import { resetState } from "@/lib/fugue/store";

export const dynamic = "force-dynamic";

/**
 * POST /fugue/api/reset — auth-gated demo reset. Wipes the store's
 * on-disk + in-memory state and reseeds it (the cadence-round embedding
 * pattern, docs/cadence-demo-session.md adaptation 3); 204 on success,
 * 401 unauthenticated. Embed-channel only — not wired into the app's UI.
 */
export function POST(req: Request): NextResponse {
  const auth = guardAuth(req);
  if (auth instanceof NextResponse) return auth;
  resetState();
  return new NextResponse(null, { status: 204 });
}
