import { NextResponse } from "next/server";
import { guardAuth, notFound, parseBody } from "@/app/fugue/api/_helpers";
import { loadState } from "@/lib/fugue/store";
import { patchFlow, deleteFlow } from "@/lib/fugue/resources";
import type { FieldError } from "@/lib/fugue/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /fugue/api/flows/[id] — 200 { flow } or 404. */
export async function GET(req: Request, { params }: Params): Promise<NextResponse> {
  const auth = guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const s = loadState();
  const flow = s.flows.find((f) => f.id === id);
  if (!flow) return notFound(id, "flow");
  return NextResponse.json({ flow });
}

/**
 * PATCH /fugue/api/flows/[id] — { name?, description?, enabled?, steps? } → 200 { flow }.
 * 404 unknown id; 400 field errors from validation.ts.
 */
export async function PATCH(req: Request, { params }: Params): Promise<NextResponse> {
  const auth = guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const raw = await parseBody(req);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return NextResponse.json(
      { errors: [{ path: "body", message: "request body must be an object" }] },
      { status: 400 },
    );
  }

  const b = raw as Record<string, unknown>;
  const result = patchFlow(id, {
    name: b.name as string | undefined,
    description: b.description as string | undefined,
    enabled: b.enabled as boolean | undefined,
    steps: b.steps as never,
  });

  if ("status" in result) {
    if (result.status === 404) return notFound(id, "flow");
    return NextResponse.json({ errors: result.errors }, { status: 400 });
  }
  return NextResponse.json({ flow: result.flow });
}

/** DELETE /fugue/api/flows/[id] — 204 on success, 404 unknown. */
export async function DELETE(req: Request, { params }: Params): Promise<NextResponse> {
  const auth = guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const result = deleteFlow(id);
  if (result.status === 404) return notFound(id, "flow");
  return new NextResponse(null, { status: 204 });
}
