/**
 * Integration tests for /parley/api/canned + audit + usage +
 * analytics + mailbox — the canned CRUD + the 403 for agent/viewer
 * on canned.manage, the audit feed's newest-first + action filter +
 * an event-present pin per the 13 mutation sites, the usage panel's
 * overage, the analytics numbers.
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { apiReq, cookieFor, freshStore } from "./helpers";
import { getParley } from "@/lib/parley/store";

import * as cannedRoute from "@/app/parley/api/canned/route";
import * as cannedIdRoute from "@/app/parley/api/canned/[id]/route";
import * as auditRoute from "@/app/parley/api/audit/route";
import * as usageRoute from "@/app/parley/api/usage/route";
import * as analyticsRoute from "@/app/parley/api/analytics/route";

beforeAll(freshStore);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /canned (the composer's /-prefix source)", () => {
  test("owner/admin/agent pass; viewer → 403 naming canned.read", async () => {
    freshStore();
    for (const c of [cookieFor("mira@lumen.test"), cookieFor("theo@lumen.test"), cookieFor("ada@lumen.test")]) {
      const res = await cannedRoute.GET(apiReq("GET", "/parley/api/canned", { cookie: c }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.length).toBe(2); // lumen has 2 canned
    }
    const viewer = cookieFor("sam@lumen.test");
    const v = await cannedRoute.GET(apiReq("GET", "/parley/api/canned", { cookie: viewer }));
    expect(v.status).toBe(403);
    const json = await v.json();
    expect(json.permission).toBe("canned.read");
  });
});

describe("canned CRUD (owner/admin manage, agent ✗)", () => {
  test("POST /canned create → 201", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const res = await cannedRoute.POST(
      apiReq("POST", "/parley/api/canned", { cookie: owner, body: { title: "New canned", body: "Body text" } }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.title).toBe("New canned");
    expect(getParley().audit.some((e) => e.action === "canned.create")).toBe(true);
  });

  test("PATCH /canned/[id] update → 200", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const target = getParley().canned.find((c) => c.tenantId === "tn-lumen")!;
    const res = await cannedIdRoute.PATCH(
      apiReq("PATCH", "/x", { cookie: owner, body: { title: "Updated", body: "B" } }),
      params(target.id),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.title).toBe("Updated");
    expect(getParley().audit.some((e) => e.action === "canned.update" && e.entityId === target.id)).toBe(true);
  });

  test("DELETE /canned/[id] → 204", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const target = getParley().canned.find((c) => c.tenantId === "tn-lumen")!;
    const res = await cannedIdRoute.DELETE(
      apiReq("DELETE", "/x", { cookie: owner }),
      params(target.id),
    );
    expect(res.status).toBe(204);
    expect(getParley().audit.some((e) => e.action === "canned.delete" && e.entityId === target.id)).toBe(true);
  });

  test("an agent's canned.manage → 403", async () => {
    freshStore();
    const agent = cookieFor("ada@lumen.test");
    const target = getParley().canned.find((c) => c.tenantId === "tn-lumen")!;
    const res = await cannedIdRoute.DELETE(
      apiReq("DELETE", "/x", { cookie: agent }),
      params(target.id),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("canned.manage");
  });

  test("an agent's canned.read → 200 (agent reads but can't manage)", async () => {
    freshStore();
    const agent = cookieFor("ada@lumen.test");
    const res = await cannedRoute.GET(apiReq("GET", "/parley/api/canned", { cookie: agent }));
    expect(res.status).toBe(200);
  });
});

describe("GET /audit (admin-only, newest first, action filter)", () => {
  test("owner/admin pass; agent + viewer → 403", async () => {
    freshStore();
    for (const c of [cookieFor("mira@lumen.test"), cookieFor("theo@lumen.test")]) {
      const res = await auditRoute.GET(apiReq("GET", "/parley/api/audit", { cookie: c }));
      expect(res.status).toBe(200);
    }
    for (const c of [cookieFor("ada@lumen.test"), cookieFor("sam@lumen.test")]) {
      const res = await auditRoute.GET(apiReq("GET", "/parley/api/audit", { cookie: c }));
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.permission).toBe("audit.read");
    }
  });

  test("newest first + an action filter narrows the feed", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const res = await auditRoute.GET(apiReq("GET", "/parley/api/audit", { cookie: owner }));
    const all = await res.json();
    for (let i = 0; i < all.length - 1; i++) {
      expect(new Date(all[i].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(all[i + 1].createdAt).getTime(),
      );
    }

    const filtered = await auditRoute.GET(
      apiReq("GET", "/parley/api/audit?action=conversation.assign", { cookie: owner }),
    );
    const json = await filtered.json();
    for (const e of json) expect(e.action).toBe("conversation.assign");
  });

  test("an event-present pin per the 13 mutation sites (a reply shows up)", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const { appendMessage } = await import("@/lib/parley/store");
    const convo = getParley().conversations.find((c) => c.tenantId === "tn-lumen" && c.firstRespondedAt === null)!;
    const ctx = { tenantId: "tn-lumen", actor: { userId: "usr-mira", role: "owner" as const } };
    appendMessage(ctx, convo.id, "a test reply");
    const res = await auditRoute.GET(apiReq("GET", "/parley/api/audit?action=conversation.reply", { cookie: owner }));
    const json = await res.json();
    expect(json.length).toBeGreaterThan(0);
    expect(json[0].entityType).toBe("message");
  });
});

describe("GET /usage (the overage panel's data)", () => {
  test("Northwind's free plan shows 47/50 near-cap (over: false)", async () => {
    freshStore();
    const ingrid = cookieFor("ingrid@northwind.test");
    const res = await usageRoute.GET(apiReq("GET", "/parley/api/usage", { cookie: ingrid }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.overage.convos.used).toBe(47);
    expect(json.overage.convos.cap).toBe(50);
    expect(json.overage.convos.over).toBe(false);
    expect(json.plan).toBe("free");
  });

  test("Lumen's team plan shows a high cap, not near", async () => {
    freshStore();
    const mira = cookieFor("mira@lumen.test");
    const res = await usageRoute.GET(apiReq("GET", "/parley/api/usage", { cookie: mira }));
    const json = await res.json();
    expect(json.plan).toBe("team");
    expect(json.overage.convos.cap).toBe(500);
    expect(json.overage.convos.over).toBe(false);
  });

  test("a viewer can read usage (the matrix's unusual row)", async () => {
    freshStore();
    const sam = cookieFor("sam@lumen.test");
    const res = await usageRoute.GET(apiReq("GET", "/parley/api/usage", { cookie: sam }));
    expect(res.status).toBe(200);
  });

  test("an agent can't read usage → 403 naming usage.read", async () => {
    freshStore();
    const ada = cookieFor("ada@lumen.test");
    const res = await usageRoute.GET(apiReq("GET", "/parley/api/usage", { cookie: ada }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("usage.read");
  });
});

describe("GET /analytics (the read-only dashboard's data)", () => {
  test("200 the volume-by-status + median first-response + resolution rate", async () => {
    freshStore();
    const mira = cookieFor("mira@lumen.test");
    const res = await analyticsRoute.GET(apiReq("GET", "/parley/api/analytics", { cookie: mira }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.volumeByStatus).toHaveProperty("open");
    expect(json.volumeByStatus).toHaveProperty("pending");
    expect(json.volumeByStatus).toHaveProperty("closed");
    expect(typeof json.medianFirstResponseMs).toBe("number");
    expect(typeof json.resolutionRate).toBe("number");
    expect(json.resolutionRatePercent).toBe(Math.round(json.resolutionRate * 1000) / 10);
    expect(json.perAgentLoad).toBeDefined();
  });

  test("a viewer can read analytics; an agent can't", async () => {
    freshStore();
    const sam = cookieFor("sam@lumen.test");
    const ok = await analyticsRoute.GET(apiReq("GET", "/parley/api/analytics", { cookie: sam }));
    expect(ok.status).toBe(200);

    const ada = cookieFor("ada@lumen.test");
    const denied = await analyticsRoute.GET(apiReq("GET", "/parley/api/analytics", { cookie: ada }));
    expect(denied.status).toBe(403);
    const json = await denied.json();
    expect(json.permission).toBe("analytics.read");
  });
});
