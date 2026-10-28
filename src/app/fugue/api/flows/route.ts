import { NextResponse } from "next/server";
import { guardAuth, parseBody } from "@/app/fugue/api/_helpers";
import { getFlows, createFlow } from "@/lib/fugue/resources";
import type { FieldError } from "@/lib/fugue/types";

export const dynamic = "force-dynamic";

/**
 * GET /fugue/api/flows — ?workspaceId= → { flows }
 * 401 unauthenticated; 404 unknown workspace.
 */
export function GET(req: Request): NextResponse {
  const auth = guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? undefined;

  const result = getFlows(workspaceId);
  if ("status" in result) {
    return NextResponse.json({ error: `workspace '${workspaceId}' not found` }, { status: 404 });
  }
  return NextResponse.json({ flows: result.flows });
}

/**
 * POST /fugue/api/flows — { workspaceId, name, description?, steps[] } → 201 { flow }
 * 400 field errors (validation.ts); 404 unknown workspace.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const auth = guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const raw = await parseBody(req);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return NextResponse.json(
      { errors: [{ path: "body", message: "request body must be an object" }] },
      { status: 400 },
    );
  }

  const b = raw as Record<string, unknown>;

  // Field-level validation before calling the domain.
  const errors: FieldError[] = [];
  if (typeof b.workspaceId !== "string" || b.workspaceId.length === 0) {
    errors.push({ path: "workspaceId", message: "workspaceId is required" });
  }
  if (typeof b.name !== "string" || b.name.trim().length === 0) {
    errors.push({ path: "name", message: "name must be a non-empty string" });
  }
  if (b.description !== undefined && typeof b.description !== "string") {
    errors.push({ path: "description", message: "description must be a string" });
  }
  if (!Array.isArray(b.steps)) {
    errors.push({ path: "steps", message: "steps must be an array" });
  }
  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  const result = createFlow({
    workspaceId: b.workspaceId as string,
    name: b.name as string,
    description: b.description as string | undefined,
    steps: b.steps as never,
  });

  if (result.status === 404) {
    return NextResponse.json({ error: `workspace '${b.workspaceId}' not found` }, { status: 404 });
  }
  if (result.status === 400) {
    return NextResponse.json({ errors: result.errors }, { status: 400 });
  }
  return NextResponse.json({ flow: result.flow }, { status: 201 });
}
