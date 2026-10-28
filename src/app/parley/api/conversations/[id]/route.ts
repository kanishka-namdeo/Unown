/**
 * GET /parley/api/conversations/[id] — the full thread (the
 * conversation + its messages + its system events, newest message
 * last, the thread view's data source, plus the customer card's
 * `Customer` row).
 *
 * Session + `conversation.read`. Cross-tenant → 404 (never a 403
 * that confirms existence).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  getConvo,
  getCustomer,
  getEvents,
  getThread,
} from "@/lib/parley/store";
import { sessionFromRequest, unauthorizedResponse, requirePermission } from "@/app/parley/api/_auth";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "conversation.read");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  const convo = getConvo(session.ctx, id);
  if (!convo) return NextResponse.json({ error: "not found", status: 404 }, { status: 404 });

  const messages = getThread(session.ctx, convo.id);
  const events = getEvents(session.ctx, convo.id);
  const customer = getCustomer(session.ctx, convo.customerId);

  return NextResponse.json({ conversation: convo, messages, events, customer });
}
