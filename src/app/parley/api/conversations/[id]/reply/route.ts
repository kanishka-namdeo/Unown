/**
 * POST /parley/api/conversations/[id]/reply — append the agent
 * message; if it's the conversation's first reply, ALSO append the
 * system event "replied" + set `firstRespondedAt`. Audit event.
 *
 * Session + `conversation.reply` (the viewer's 403 rung lands here).
 * Cross-tenant → 404. 201 the message.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { appendMessage, getConvo } from "@/lib/parley/store";
import { validateReply } from "@/lib/parley/validation";
import {
  sessionFromRequest,
  unauthorizedResponse,
  requirePermission,
} from "@/app/parley/api/_auth";
import { writeLaneRateLimited, rateLimitedBody } from "@/app/parley/api/_rate";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("replies"), { status: 429 });
  }
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "conversation.reply");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const convo = getConvo(session.ctx, id);
  if (!convo) return NextResponse.json({ error: "not found", status: 404 }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", errors: ["body must be valid JSON"] },
      { status: 400 },
    );
  }

  const input = (body ?? {}) as { body?: string };
  const { errors } = validateReply({ body: String(input.body ?? "") });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  const msg = appendMessage(session.ctx, id, String(input.body));
  if (!msg) {
    // The convo vanished between the getConvo and the append (rare —
    // a concurrent delete). Re-map to 404.
    return NextResponse.json({ error: "not found", status: 404 }, { status: 404 });
  }
  return NextResponse.json(msg, { status: 201 });
}
