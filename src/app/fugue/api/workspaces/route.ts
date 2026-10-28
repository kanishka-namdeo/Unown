import { NextResponse } from "next/server";
import { guardAuth, badRequest, parseBody } from "@/app/fugue/api/_helpers";
import { loadState } from "@/lib/fugue/store";
import { createWorkspace } from "@/lib/fugue/resources";

export const dynamic = "force-dynamic";

/** GET /fugue/api/workspaces — auth-gated list. */
export function GET(req: Request): NextResponse {
  const auth = guardAuth(req);
  if (auth instanceof NextResponse) return auth;
  const s = loadState();
  return NextResponse.json({ workspaces: s.workspaces });
}

/** POST /fugue/api/workspaces — { name, slug?, description? } → 201 { workspace }. */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await parseBody(req);
  if (typeof body !== "object" || body === null) {
    return badRequest([{ path: "body", message: "request body must be an object" }]);
  }
  const input = body as { name?: string; slug?: string; description?: string };
  const result = createWorkspace(input);
  if (result.status === 400) return badRequest(result.errors);
  return NextResponse.json({ workspace: result.workspace }, { status: 201 });
}
