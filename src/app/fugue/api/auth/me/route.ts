import { NextResponse } from "next/server";
import { meResponse } from "@/app/fugue/api/_helpers";

export const dynamic = "force-dynamic";

/** GET /fugue/api/auth/me — 200 {user} when authenticated, 401 {user: null} otherwise. */
export function GET(req: Request): NextResponse {
  return meResponse(req);
}
