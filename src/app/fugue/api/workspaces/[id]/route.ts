import { NextResponse } from "next/server";
import { guardAuth, badRequest, notFound, parseBody } from "@/app/fugue/api/_helpers";
import { patchWorkspace } from "@/lib/fugue/resources";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /fugue/api/workspaces/[id] — { name?, description? } → 200 { workspace }.
 * 404 for unknown workspace id; 400 for field errors.
 */
export async function PATCH(req: Request, { params }: Params): Promise<NextResponse> {
  const auth = guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await parseBody(req);
  if (typeof body !== "object" || body === null) {
    return badRequest([{ path: "body", message: "request body must be an object" }]);
  }
  const input = body as { name?: string; description?: string };
  const result = patchWorkspace(id, input);
  if ("status" in result) {
    if (result.status === 404) return notFound(id, "workspace");
    return badRequest(result.errors);
  }
  return NextResponse.json({ workspace: result.workspace });
}
