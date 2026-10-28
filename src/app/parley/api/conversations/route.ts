/**
 * GET /parley/api/conversations — the filtered inbox.
 *
 * Session + `conversation.list`. Filter via `?filter=all|open|pending|
 * closed|unassigned|sla_risk` + `?q=` free-text. Each row carries its
 * computed `slaState` + `slaLabel` for the list's chips (the server
 * is the source of truth).
 *
 * POST /parley/api/conversations — the customer-side create (the
 * portal view's "new conversation" flow). NO session required for the
 * customer side; it takes a `tenantSlug` + the customer's email/name,
 * is quota-gated (402 `quota_exceeded` at the plan cap), unknown
 * tenantSlug → 404.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import {
  createConvo,
  getParley,
  listConvos,
  type ConvoFilter,
  QuotaExceededError,
} from "@/lib/parley/store";
import { slaState, formatCountdown, remainingMs } from "@/lib/parley/sla";
import { validateCreateConvo } from "@/lib/parley/validation";
import { quotaExceededResponse, sessionFromRequest, unauthorizedResponse } from "@/app/parley/api/_auth";
import { writeLaneRateLimited, rateLimitedBody } from "@/app/parley/api/_rate";
import { now as clockNow } from "@/lib/parley/clock";

const VALID_FILTERS: ConvoFilter[] = ["all", "open", "pending", "closed", "unassigned", "sla_risk"];

export async function GET(req: Request) {
  const session = sessionFromRequest(req);
  if (!session) return NextResponse.json(unauthorizedResponse(), { status: 401 });

  const search = new URL(req.url).searchParams;
  const filterParam = (search.get("filter") ?? "all") as ConvoFilter;
  const filter = VALID_FILTERS.includes(filterParam) ? filterParam : "all";
  const q = search.get("q") ?? undefined;

  const out = listConvos(session.ctx, { filter, q });
  const state = getParley();
  const now = clockNow();
  const rows = out.map((c) => {
    const tenant = state.tenants.find((t) => t.id === c.tenantId)!;
    const st = slaState(c, tenant, now);
    const ms = remainingMs(c, tenant, now);
    const slaLabel =
      st === "met" ? "met" :
      st === "breached" ? "breached" :
      st === "at_risk" ? `at risk · ${formatCountdown(ms)}` :
      formatCountdown(ms);
    return { ...c, slaState: st, slaLabel };
  });

  // Per-filter counts (the chips' numbers) — computed on the same scope.
  const counts: Record<ConvoFilter, number> = {
    all: out.length,
    open: 0,
    pending: 0,
    closed: 0,
    unassigned: 0,
    sla_risk: 0,
  };
  for (const c of out) {
    counts[c.status as "open" | "pending" | "closed"] += 1;
    if (c.assigneeId === null) counts.unassigned += 1;
  }
  const tenantId = session.tenant.id;
  const state2 = getParley();
  const tenant = state2.tenants.find((t) => t.id === tenantId)!;
  for (const c of out) {
    const st = slaState(c, tenant, now);
    if (st === "at_risk" || st === "breached") counts.sla_risk += 1;
  }

  return NextResponse.json({ conversations: rows, counts });
}

export async function POST(req: Request) {
  if (writeLaneRateLimited(req)) {
    return NextResponse.json(rateLimitedBody("conversation creates"), { status: 429 });
  }
  // The customer-side create — NO session required (the brief: "the
  // portal view's new-conversation flow — quota-gated").
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", errors: ["body must be valid JSON"] },
      { status: 400 },
    );
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const { errors } = validateCreateConvo({
    subject: String(input.subject ?? ""),
    customerName: String(input.customerName ?? ""),
    customerEmail: String(input.customerEmail ?? ""),
    priority: input.priority as never,
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "validation failed", errors }, { status: 400 });
  }

  // Resolve the tenant from the slug (path/switcher tenancy).
  const slug = String(input.tenantSlug ?? "");
  const state = getParley();
  const tenant = state.tenants.find((t) => t.slug === slug);
  if (!tenant) return NextResponse.json({ error: "unknown tenant", status: 404 }, { status: 404 });

  // Build a context for the tenant (customer-side create uses the
  // tenant's owner as the actor for audit purposes).
  const ownerMem = state.memberships.find(
    (m) => m.tenantId === tenant.id && m.role === "owner",
  );
  if (!ownerMem) return NextResponse.json({ error: "no tenant owner" }, { status: 404 });
  const { makeCtx } = await import("@/lib/parley/tenancy");
  const ctx = makeCtx(tenant.id, ownerMem.userId, ownerMem.role);

  try {
    const convo = createConvo(ctx, {
      subject: String(input.subject),
      customerName: String(input.customerName),
      customerEmail: String(input.customerEmail),
      priority: input.priority as never,
    });
    return NextResponse.json(convo, { status: 201 });
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return NextResponse.json(quotaExceededResponse(), { status: 402 });
    }
    throw e;
  }
}
