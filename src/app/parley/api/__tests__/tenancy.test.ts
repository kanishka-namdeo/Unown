/**
 * The cross-tenant isolation suite — the brief's tenancy floor item.
 * For EVERY read/mutate endpoint: tenant-A session × tenant-B entity
 * → 404 (never a 403 that confirms existence, never a 200 leak).
 *
 * The northwind-session cookie × lumen-entity ids on every endpoint.
 * The no-context repository call → throws (pinned at the store level
 * in store.test.ts; here we pin the ROUTE's 404 mapping).
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { apiReq, cookieFor, freshStore, convoIdFor } from "./helpers";
import { getParley } from "@/lib/parley/store";

import * as conversationsRoute from "@/app/parley/api/conversations/route";
import * as convoIdRoute from "@/app/parley/api/conversations/[id]/route";
import * as replyRoute from "@/app/parley/api/conversations/[id]/reply/route";
import * as assignRoute from "@/app/parley/api/conversations/[id]/assign/route";
import * as statusRoute from "@/app/parley/api/conversations/[id]/status/route";
import * as priorityRoute from "@/app/parley/api/conversations/[id]/priority/route";
import * as tagsRoute from "@/app/parley/api/conversations/[id]/tags/route";
import * as membersRoute from "@/app/parley/api/members/route";
import * as invitesRoute from "@/app/parley/api/invites/route";
import * as auditRoute from "@/app/parley/api/audit/route";
import * as usageRoute from "@/app/parley/api/usage/route";
import * as analyticsRoute from "@/app/parley/api/analytics/route";
import * as cannedRoute from "@/app/parley/api/canned/route";
import * as cannedIdRoute from "@/app/parley/api/canned/[id]/route";
import * as mailboxRoute from "@/app/parley/api/mailbox/route";
import * as sessionRoute from "@/app/parley/api/auth/session/route";

beforeAll(freshStore);

const LUMEN = "tn-lumen";
const NORTHWIND = "tn-northwind";

function idParam(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("cross-tenant isolation (northwind session × lumen entity → 404)", () => {
  test("GET conversations/[id] on a lumen convo → 404", async () => {
    freshStore();
    const northCookie = cookieFor("kai@northwind.test");
    const lumenConvo = convoIdFor(LUMEN, 0);
    const res = await convoIdRoute.GET(
      apiReq("GET", `/parley/api/conversations/${lumenConvo}`, { cookie: northCookie }),
      idParam(lumenConvo),
    );
    expect(res.status).toBe(404);
  });

  test("POST reply on a lumen convo → 404", async () => {
    freshStore();
    const northCookie = cookieFor("kai@northwind.test");
    const lumenConvo = convoIdFor(LUMEN, 0);
    const res = await replyRoute.POST(
      apiReq("POST", `/parley/api/conversations/${lumenConvo}/reply`, {
        cookie: northCookie,
        body: { body: "a reply" },
      }),
      idParam(lumenConvo),
    );
    expect(res.status).toBe(404);
  });

  test("POST assign/status/priority/tags on a lumen convo → 404", async () => {
    freshStore();
    const northCookie = cookieFor("ingrid@northwind.test");
    const lumenConvo = convoIdFor(LUMEN, 0);

    const a = await assignRoute.POST(
      apiReq("POST", `/parley/api/conversations/${lumenConvo}/assign`, { cookie: northCookie, body: { userId: "usr-ingrid" } }),
      idParam(lumenConvo),
    );
    expect(a.status).toBe(404);

    const st = await statusRoute.POST(
      apiReq("POST", `/parley/api/conversations/${lumenConvo}/status`, { cookie: northCookie, body: { status: "closed" } }),
      idParam(lumenConvo),
    );
    expect(st.status).toBe(404);

    const p = await priorityRoute.POST(
      apiReq("POST", `/parley/api/conversations/${lumenConvo}/priority`, { cookie: northCookie, body: { priority: "urgent" } }),
      idParam(lumenConvo),
    );
    expect(p.status).toBe(404);

    const t = await tagsRoute.POST(
      apiReq("POST", `/parley/api/conversations/${lumenConvo}/tags`, { cookie: northCookie, body: { tags: ["x"] } }),
      idParam(lumenConvo),
    );
    expect(t.status).toBe(404);
  });

  test("GET conversations (list) never leaks the other tenant's rows", async () => {
    freshStore();
    const northCookie = cookieFor("kai@northwind.test");
    const res = await conversationsRoute.GET(
      apiReq("GET", "/parley/api/conversations", { cookie: northCookie }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    for (const c of json.conversations) expect(c.tenantId).toBe(NORTHWIND);
  });

  test("unknown tenantSlug on POST conversations → 404", async () => {
    freshStore();
    const res = await conversationsRoute.POST(
      apiReq("POST", "/parley/api/conversations", {
        body: { tenantSlug: "ghost", subject: "s", customerName: "n", customerEmail: "e@x.com" },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("canned [id] on the other tenant's canned → 404", async () => {
    freshStore();
    const northCookie = cookieFor("ingrid@northwind.test");
    const lumenCanned = getParley().canned.find((c) => c.tenantId === LUMEN)!;
    const res = await cannedIdRoute.PATCH(
      apiReq("PATCH", `/parley/api/canned/${lumenCanned.id}`, { cookie: northCookie, body: { title: "x", body: "y" } }),
      idParam(lumenCanned.id),
    );
    expect(res.status).toBe(404);
  });

  test("members/[id] role/remove on the other tenant's membership → 404", async () => {
    freshStore();
    const northCookie = cookieFor("ingrid@northwind.test");
    const lumenMem = getParley().memberships.find((m) => m.tenantId === LUMEN && m.id !== "mem-owner")!;
    const roleRes = await import("@/app/parley/api/members/[id]/role/route");
    const r = await roleRes.POST(
      apiReq("POST", `/parley/api/members/${lumenMem.id}/role`, { cookie: northCookie, body: { role: "agent" } }),
      idParam(lumenMem.id),
    );
    expect(r.status).toBe(404);
  });
});

describe("RBAC 403 rungs (named permission, cross-tenant never 403)", () => {
  test("a viewer's conversation.reply → 403 naming conversation.reply", async () => {
    freshStore();
    const viewer = cookieFor("sam@lumen.test");
    const lumenConvo = convoIdFor(LUMEN, 0);
    const res = await replyRoute.POST(
      apiReq("POST", `/parley/api/conversations/${lumenConvo}/reply`, { cookie: viewer, body: { body: "hi" } }),
      idParam(lumenConvo),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("forbidden");
    expect(json.permission).toBe("conversation.reply");
  });

  test("a viewer's assign/status/priority/tags → 403 each", async () => {
    freshStore();
    const viewer = cookieFor("sam@lumen.test");
    const lumenConvo = convoIdFor(LUMEN, 0);
    for (const [route, body] of [
      [assignRoute, { userId: "usr-ada" }],
      [statusRoute, { status: "closed" }],
      [priorityRoute, { priority: "high" }],
      [tagsRoute, { tags: ["x"] }],
    ] as const) {
      const res = await route.POST(
        apiReq("POST", "/parley/api/conversations/x", { cookie: viewer, body }),
        idParam(lumenConvo),
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("forbidden");
    }
  });

  test("an agent's canned.manage → 403", async () => {
    freshStore();
    const agent = cookieFor("ada@lumen.test");
    const res = await cannedRoute.POST(
      apiReq("POST", "/parley/api/canned", { cookie: agent, body: { title: "t", body: "b" } }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("canned.manage");
  });

  test("an agent's audit.read → 403", async () => {
    freshStore();
    const agent = cookieFor("ada@lumen.test");
    const res = await auditRoute.GET(apiReq("GET", "/parley/api/audit", { cookie: agent }));
    expect(res.status).toBe(403);
  });

  test("an agent's usage.read → 403 (viewer would pass)", async () => {
    freshStore();
    const agent = cookieFor("ada@lumen.test");
    const res = await usageRoute.GET(apiReq("GET", "/parley/api/usage", { cookie: agent }));
    expect(res.status).toBe(403);
    const viewer = cookieFor("sam@lumen.test");
    const v = await usageRoute.GET(apiReq("GET", "/parley/api/usage", { cookie: viewer }));
    expect(v.status).toBe(200);
  });

  test("an unauthenticated call → 401 (the auth rung first)", async () => {
    freshStore();
    const res = await membersRoute.GET(apiReq("GET", "/parley/api/members"));
    expect(res.status).toBe(401);
  });
});
