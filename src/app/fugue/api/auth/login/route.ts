import { NextResponse } from "next/server";
import { loginResponse } from "@/app/fugue/api/_helpers";

export const dynamic = "force-dynamic";

/** POST /fugue/api/auth/login — {email, password} → 200 {user} + session cookie; 401 invalid. */
export async function POST(req: Request): Promise<NextResponse> {
  return loginResponse(req);
}
