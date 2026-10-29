/**
 * POST /aria/api/leads/[id]/convert — the atomic lead conversion
 * (plan §3.3): find-or-create the account + contact, optionally
 * create a deal, and move the lead to `converted` — all in one
 * store commit. `lead.convert` (the matrix's ✗ for viewer).
 *
 * 404 when the lead is unknown / cross-tenant; 400 when the lead
 * is already converted (terminal).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { convertLead, NotFoundError, StageError } from "@/lib/aria/aria-store";
import {
  notFoundResponse,
  requirePermission,
  sessionFromRequest,
  unauthorizedResponse,
} from "@/app/aria/api/_auth";
import { rateLimitedBody, writeLaneRateLimited } from "@/app/aria/api/_rate";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("lead converts"), { status: 429 });
  }

  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const denied = requirePermission(session.role, "lead.convert");
  if (denied) return NextResponse.json(denied, { status: 403 });

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const input = (body ?? {}) as {
    accountId?: string;
    contactId?: string;
    dealId?: string;
    amount?: number;
  };

  try {
    const out = convertLead(session.ctx, id, {
      accountId: input.accountId,
      contactId: input.contactId,
      dealId: input.dealId,
      amount: input.amount,
    });
    return NextResponse.json({
      lead: out.lead,
      account: out.account,
      contact: out.contact,
      deal: out.deal,
    });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json(notFoundResponse(), { status: 404 });
    }
    if (e instanceof StageError) {
      return NextResponse.json(
        {
          error: "validation failed",
          errors: [e.message],
          status: 400,
        },
        { status: 400 },
      );
    }
    throw e;
  }
}
