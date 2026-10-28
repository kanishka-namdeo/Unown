/**
 * Integration tests for /parley/api/conversations — the happy paths,
 * the 401/403/404 ladder per route, the quota 402 on Northwind at
 * cap, the first-reply sets firstRespondedAt + the system event,
 * and the assign/status/priority/tags + audit landing.
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { apiReq, cookieFor, convoIdFor, freshStore } from "./helpers";
import { getParley } from "@/lib/parley/store";

import * as conversationsRoute from "@/app/parley/api/conversations/route";
import * as convoIdRoute from "@/app/parley/api/conversations/[id]/route";
import * as replyRoute from "@/app/parley/api/conversations/[id]/reply/route";
import * as assignRoute from "@/app/parley/api/conversations/[id]/assign/route";
import * as statusRoute from "@/app/parley/api/conversations/[id]/status/route";
import * as priorityRoute from "@/app/parley/api/conversations/[id]/priority/route";
import * as tagsRoute from "@/app/parley/api/conversations/[id]/tags/route";

beforeAll(freshStore);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /conversations (list + filters + SLA chips)", () => {
  test("200 the list with computed slaState + slaLabel on each row", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const res = await conversationsRoute.GET(apiReq("GET", "/parley/api/conversations", { cookie: owner }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.conversations)).toBe(true);
    expect(json.conversations.length).toBeGreaterThan(0);
    for (const c of json.conversations) {
      expect(["met", "ok", "at_risk", "breached"]).toContain(c.slaState);
      expect(typeof c.slaLabel).toBe("string");
    }
    expect(json.counts).toHaveProperty("all");
    expect(json.counts).toHaveProperty("sla_risk");
  });

  test("the sla_risk filter returns only at_risk + breached rows", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const res = await conversationsRoute.GET(
      apiReq("GET", "/parley/api/conversations?filter=sla_risk", { cookie: owner }),
    );
    const json = await res.json();
    for (const c of json.conversations) {
      expect(["at_risk", "breached"]).toContain(c.slaState);
    }
  });

  test("the q filter is a free-text subject search", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const res = await conversationsRoute.GET(
      apiReq("GET", "/parley/api/conversations?q=bluetooth", { cookie: owner }),
    );
    const json = await res.json();
    expect(json.conversations.length).toBeGreaterThan(0);
    for (const c of json.conversations) {
      expect(c.subject.toLowerCase()).toContain("bluetooth");
    }
  });

  test("401 when unauthenticated", async () => {
    freshStore();
    const res = await conversationsRoute.GET(apiReq("GET", "/parley/api/conversations"));
    expect(res.status).toBe(401);
  });
});

describe("GET /conversations/[id] (the full thread)", () => {
  test("200 the conversation + messages + events + customer card", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const convo = convoIdFor("tn-lumen", 0);
    const res = await convoIdRoute.GET(
      apiReq("GET", `/parley/api/conversations/${convo}`, { cookie: owner }),
      params(convo),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.conversation.id).toBe(convo);
    expect(Array.isArray(json.messages)).toBe(true);
    expect(Array.isArray(json.events)).toBe(true);
    expect(json.customer).toHaveProperty("email");
  });

  test("404 for an unknown convo id (the cross-tenant rung)", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const res = await convoIdRoute.GET(
      apiReq("GET", "/parley/api/conversations/cnv-nope", { cookie: owner }),
      params("cnv-nope"),
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /conversations/[id]/reply (first-reply semantics)", () => {
  test("a first reply sets firstRespondedAt + appends the 'replied' event", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    // Pick a convo with no reply yet (firstRespondedAt null).
    const openUnreplied = getParley().conversations.find(
      (c) => c.tenantId === "tn-lumen" && c.firstRespondedAt === null,
    )!;
    expect(openUnreplied.firstRespondedAt).toBe(null);

    const res = await replyRoute.POST(
      apiReq("POST", `/parley/api/conversations/${openUnreplied.id}/reply`, {
        cookie: owner,
        body: { body: "First agent reply" },
      }),
      params(openUnreplied.id),
    );
    expect(res.status).toBe(201);
    const msg = await res.json();
    expect(msg.role).toBe("agent");

    // firstRespondedAt is now set + the "replied" event landed.
    const after = getParley().conversations.find((c) => c.id === openUnreplied.id)!;
    expect(after.firstRespondedAt).not.toBeNull();
    const events = getParley().events.filter(
      (e) => e.conversationId === openUnreplied.id && e.kind === "replied",
    );
    expect(events.length).toBe(1);
  });

  test("201 on a valid reply; 400 on an empty body", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const convo = convoIdFor("tn-lumen", 0);
    const ok = await replyRoute.POST(
      apiReq("POST", "/x", { cookie: owner, body: { body: "a reply" } }),
      params(convo),
    );
    expect(ok.status).toBe(201);

    const bad = await replyRoute.POST(
      apiReq("POST", "/x", { cookie: owner, body: { body: "  " } }),
      params(convo),
    );
    expect(bad.status).toBe(400);
  });

  test("the viewer's 403 rung names conversation.reply", async () => {
    freshStore();
    const viewer = cookieFor("sam@lumen.test");
    const convo = convoIdFor("tn-lumen", 0);
    const res = await replyRoute.POST(
      apiReq("POST", "/x", { cookie: viewer, body: { body: "x" } }),
      params(convo),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("conversation.reply");
  });
});

describe("POST /conversations/[id]/{assign,status,priority,tags}", () => {
  test("assign lands + audit event", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const convo = convoIdFor("tn-lumen", 2); // the unassigned-normal fixture
    const res = await assignRoute.POST(
      apiReq("POST", "/x", { cookie: owner, body: { userId: "usr-ada" } }),
      params(convo),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.assigneeId).toBe("usr-ada");
    const audit = getParley().audit.filter((e) => e.action === "conversation.assign");
    expect(audit.length).toBeGreaterThan(0);
  });

  test("status lands + a closed status sets closedAt", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const convo = convoIdFor("tn-lumen", 0);
    const res = await statusRoute.POST(
      apiReq("POST", "/x", { cookie: owner, body: { status: "closed" } }),
      params(convo),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("closed");
    expect(json.closedAt).not.toBeNull();
  });

  test("priority lands (field-only, no system event)", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const convo = convoIdFor("tn-lumen", 0);
    const res = await priorityRoute.POST(
      apiReq("POST", "/x", { cookie: owner, body: { priority: "urgent" } }),
      params(convo),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.priority).toBe("urgent");
  });

  test("tags land + the tag_changed event", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const convo = convoIdFor("tn-lumen", 0);
    const res = await tagsRoute.POST(
      apiReq("POST", "/x", { cookie: owner, body: { tags: ["firmware", "urgent"] } }),
      params(convo),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tags).toEqual(["firmware", "urgent"]);
  });

  test("an invalid status literal → 400", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const convo = convoIdFor("tn-lumen", 0);
    const res = await statusRoute.POST(
      apiReq("POST", "/x", { cookie: owner, body: { status: "bogus" } }),
      params(convo),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /conversations (customer-side create, quota-gated)", () => {
  test("201 a new conversation under the cap (Lumen team, 500/mo)", async () => {
    freshStore();
    const res = await conversationsRoute.POST(
      apiReq("POST", "/parley/api/conversations", {
        body: {
          tenantSlug: "lumen",
          subject: "New ticket",
          customerName: "Jo",
          customerEmail: "jo@x.com",
          priority: "normal",
        },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.status).toBe("open");
  });

  test("402 quota_exceeded when the tenant is at its cap", async () => {
    freshStore();
    // Northwind is at 47/50 on its free plan. Push it to 50/50 by
    // creating 3 more, then the 4th must 402.
    for (let i = 0; i < 3; i++) {
      const r = await conversationsRoute.POST(
        apiReq("POST", "/parley/api/conversations", {
          body: {
            tenantSlug: "northwind",
            subject: `Top-up ${i}`,
            customerName: "Jo",
            customerEmail: `jo-${i}@x.com`,
          },
        }),
      );
      expect(r.status).toBe(201);
    }
    // Now at 50/50 → the next create throws.
    const over = await conversationsRoute.POST(
      apiReq("POST", "/parley/api/conversations", {
        body: {
          tenantSlug: "northwind",
          subject: "Over the cap",
          customerName: "Jo",
          customerEmail: "jo-over@x.com",
        },
      }),
    );
    expect(over.status).toBe(402);
    const json = await over.json();
    expect(json.error).toBe("quota_exceeded");
  });

  test("400 on a missing customer email", async () => {
    freshStore();
    const res = await conversationsRoute.POST(
      apiReq("POST", "/parley/api/conversations", {
        body: { tenantSlug: "lumen", subject: "s", customerName: "n" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("unknown tenantSlug → 404 (the cross-tenant-shape 404)", async () => {
    freshStore();
    const res = await conversationsRoute.POST(
      apiReq("POST", "/parley/api/conversations", {
        body: { tenantSlug: "ghost", subject: "s", customerName: "n", customerEmail: "e@x.com" },
      }),
    );
    expect(res.status).toBe(404);
  });
});
