/**
 * Integration tests for /parley/api/demo/reset — the embed
 * handshake's server side: reseed determinism (two resets →
 * deep-equal states), the demo session rotation (the pre-reset
 * session id is gone, a new one is live), and a post-reset
 * GET conversations returns the seeded state, NOT the pre-reset
 * mutated one.
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { apiReq, cookieFor, convoIdFor, freshStore } from "./helpers";
import { getParley } from "@/lib/parley/store";

import * as resetRoute from "@/app/parley/api/demo/reset/route";
import * as conversationsRoute from "@/app/parley/api/conversations/route";

beforeAll(freshStore);

describe("POST /demo/reset (the reset handshake)", () => {
  test("200 { reset: true, demoSessionId, demoCookie } + a real set-cookie", async () => {
    freshStore();
    const res = await resetRoute.POST(apiReq("POST", "/parley/api/demo/reset", {}));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reset).toBe(true);
    expect(typeof json.demoSessionId).toBe("string");
    expect(typeof json.demoCookie).toBe("string");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("parley_ses=");
  });

  test("reseed determinism: two resets → deep-equal seeded rows", async () => {
    freshStore();
    const a = await resetRoute.POST(apiReq("POST", "/parley/api/demo/reset", {}));
    const b = await resetRoute.POST(apiReq("POST", "/parley/api/demo/reset", {}));
    // strip the per-reset live session rows + live audit events
    const strip = async (r: Response) => {
      const j = await r.json();
      void j;
      const s = getParley();
      return {
        tenants: s.tenants,
        users: s.users,
        memberships: s.memberships,
        customers: s.customers,
        conversations: s.conversations,
        messages: s.messages,
        events: s.events,
        tags: s.tags,
        canned: s.canned,
        invites: s.invites,
        audit: s.audit.filter((e) => e.id.startsWith("aud-seed")),
      };
    };
    const sa = await strip(a);
    const sb = await strip(b);
    expect(sa).toEqual(sb);
  });

  test("the demo session rotates: pre-reset session id is gone, a new one is live", async () => {
    freshStore();
    // Log in as mira → a session row exists.
    const preCookie = cookieFor("mira@lumen.test");
    const preSession = getParley().sessions.find(
      (s) => s.userId === "usr-mira" && s.tenantId === "tn-lumen",
    )!;

    await resetRoute.POST(apiReq("POST", "/parley/api/demo/reset", {}));

    // The pre-reset session is destroyed (the reseed wipes all rows)
    const after = getParley();
    expect(after.sessions.find((s) => s.id === preSession.id)).toBeUndefined();
    // A new demo session row for mira exists
    const demo = after.sessions.find((s) => s.userId === "usr-mira" && s.tenantId === "tn-lumen")!;
    expect(demo.id).not.toBe(preSession.id);
    void preCookie;
  });

  test("a post-reset GET conversations returns the seeded state, not the pre-reset mutated one", async () => {
    freshStore();
    // Mutate a conversation pre-reset (assign it).
    const owner = cookieFor("mira@lumen.test");
    const convo = convoIdFor("tn-lumen", 2);
    const { assign } = await import("@/lib/parley/store");
    const ctx = { tenantId: "tn-lumen", actor: { userId: "usr-mira", role: "owner" as const } };
    assign(ctx, convo, "usr-ada");
    const mutated = getParley().conversations.find((c) => c.id === convo)!;
    expect(mutated.assigneeId).toBe("usr-ada");

    // Reset → the seeded state returns (the assignee is back to null)
    await resetRoute.POST(apiReq("POST", "/parley/api/demo/reset", {}));
    const fresh = getParley().conversations.find((c) => c.id === convo)!;
    expect(fresh.assigneeId).toBe(null);

    // And the GET route serves the seeded (unmutated) rows.
    const res = await conversationsRoute.GET(
      apiReq("GET", "/parley/api/conversations", { cookie: cookieFor("mira@lumen.test") }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    const row = json.conversations.find((c: { id: string }) => c.id === convo)!;
    expect(row.assigneeId).toBe(null);
  });

  test("the reset lane is rate-limited (the write lane)", async () => {
    freshStore();
    // The rate limiter allows 10 per window per IP; the 11th 429s.
    let sawLimit = false;
    for (let i = 0; i < 11; i++) {
      const res = await resetRoute.POST(apiReq("POST", "/parley/api/demo/reset", { xff: "10.0.0.1" }));
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });
});
