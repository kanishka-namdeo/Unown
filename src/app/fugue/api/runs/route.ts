import { NextResponse } from "next/server";
import { guardAuth } from "@/app/fugue/api/_helpers";
import { getRuns } from "@/lib/fugue/resources";

export const dynamic = "force-dynamic";

/**
 * GET /fugue/api/runs — ?workspaceId=&flowId? → { runs } (latest 50 per ws).
 * 401 unauthenticated; 404 unknown workspace.
 */
export function GET(req: Request): NextResponse {
  const auth = guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
  const flowId = url.searchParams.get("flowId") ?? undefined;

  const result = getRuns(workspaceId, flowId);
  if ("status" in result) {
    return NextResponse.json({ error: `workspace '${workspaceId}' not found` }, { status: 404 });
  }
  return NextResponse.json({ runs: result.runs });
}
