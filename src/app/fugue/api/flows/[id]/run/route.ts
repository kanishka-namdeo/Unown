import { NextResponse } from "next/server";
import { guardAuth, notFound, parseBody } from "@/app/fugue/api/_helpers";
import { executeFlow } from "@/lib/fugue/resources";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /fugue/api/flows/[id]/run — body is the input payload → 201 { run }.
 * 404 unknown flow; 400 when the flow is disabled or body is not valid JSON.
 * Engine failures (e.g. missing text field) are recorded on the run itself
 * (run.status === "failed") — the HTTP response is still 201 with evidence.
 */
export async function POST(req: Request, { params }: Params): Promise<NextResponse> {
  const auth = guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const raw = await parseBody(req);
  if (raw === null) {
    return NextResponse.json(
      { errors: [{ path: "body", message: "request body must be valid JSON" }] },
      { status: 400 },
    );
  }

  const result = executeFlow(id, raw);
  if ("run" in result) {
    return NextResponse.json({ run: result.run }, { status: 201 });
  }
  if (result.status === 404) return notFound(id, "flow");
  return NextResponse.json({ errors: result.errors }, { status: 400 });
}
