import { NextResponse } from "next/server";
import { logoutResponse } from "@/app/fugue/api/_helpers";

export const dynamic = "force-dynamic";

/** POST /fugue/api/auth/logout — clears session; 204 on success, 401 when unauthenticated. */
export function POST(req: Request): NextResponse {
  return logoutResponse(req);
}
