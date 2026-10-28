import { NextResponse } from "next/server";
import { signupResponse } from "@/app/fugue/api/_helpers";

export const dynamic = "force-dynamic";

/** POST /fugue/api/auth/signup — {email, password} → 201 {user} + session cookie. */
export async function POST(req: Request): Promise<NextResponse> {
  return signupResponse(req);
}
