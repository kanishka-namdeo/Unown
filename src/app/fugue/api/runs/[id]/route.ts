import { NextResponse } from "next/server";
import { guardAuth, notFound } from "@/app/fugue/api/_helpers";
import { getRun } from "@/lib/fugue/resources";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /fugue/api/runs/[id] — 200 { run } (with attempts + notifications) or 404. */
export async function GET(req: Request, { params }: Params): Promise<NextResponse> {
  const auth = guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const result = getRun(id);
  if ("status" in result) return notFound(id, "run");
  return NextResponse.json({ run: result.run });
}
