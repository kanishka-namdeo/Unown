/**
 * Integration tests for /aria/api/tasks — CRUD + the computed
 * slaState (ok / late / done).
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { apiReq, cookieFor, freshStore, TENANT_IDS } from "./helpers";
import { getAria } from "@/lib/aria/aria-store";

import * as tasksRoute from "@/app/aria/api/tasks/route";
import * as tasksIdRoute from "@/app/aria/api/tasks/[id]/route";

beforeAll(freshStore);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /tasks — the list + the computed slaState", () => {
  test("200 the tenant's tasks, each row carries its slaState", async () => {
    freshStore();
    const res = await tasksRoute.GET(
      apiReq("GET", "/aria/api/tasks", { cookie: cookieFor("ingrid@northwind.test") }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ slaState: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(["ok", "late", "done"]).toContain(row.slaState);
    }
  });

  test("done tasks report slaState=done (regardless of the due date)", async () => {
    freshStore();
    const res = await tasksRoute.GET(
      apiReq("GET", "/aria/api/tasks?done=true", {
        cookie: cookieFor("mira@lumen.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ done: boolean; slaState: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.done).toBe(true);
      expect(row.slaState).toBe("done");
    }
  });

  test("an open task past its due date reports slaState=late", async () => {
    freshStore();
    const s = getAria();
    const asOfMs = new Date("2026-10-28T12:00:00Z").getTime();
    const late = s.tasks.find(
      (t) =>
        t.tenantId === TENANT_IDS.lumen &&
        t.done === false &&
        new Date(t.due).getTime() < asOfMs,
    )!;
    // atsk_seed_02 is due 2 days BEFORE AS_OF → late:
    expect(late).toBeDefined();
    expect(late!.id).toBe("atsk_seed_02");
    const res = await tasksRoute.GET(
      apiReq("GET", "/aria/api/tasks", { cookie: cookieFor("mira@lumen.test") }),
    );
    const rows = (await res.json()) as Array<{ id: string; slaState: string }>;
    const row = rows.find((r) => r.id === late!.id)!;
    expect(row.slaState).toBe("late");
  });

  test("the ?slaState= filter returns only that bucket", async () => {
    freshStore();
    const res = await tasksRoute.GET(
      apiReq("GET", "/aria/api/tasks?slaState=late", {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ slaState: string }>;
    for (const row of rows) expect(row.slaState).toBe("late");
  });

  test("the ?entityId= filter narrows to one entity's tasks", async () => {
    freshStore();
    const s = getAria();
    const task = s.tasks.find((t) => t.tenantId === TENANT_IDS.lumen)!;
    const res = await tasksRoute.GET(
      apiReq("GET", `/aria/api/tasks?entityId=${task.entityId}`, {
        cookie: cookieFor("mira@lumen.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ entityId: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.entityId).toBe(task.entityId);
  });

  test("the ?ownerId= filter narrows to one rep's tasks", async () => {
    freshStore();
    const s = getAria();
    const owner = s.memberships.find(
      (m) => m.tenantId === TENANT_IDS.northwind && m.role === "rep",
    )!.userId;
    const res = await tasksRoute.GET(
      apiReq("GET", `/aria/api/tasks?ownerId=${owner}`, {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ ownerId: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.ownerId).toBe(owner);
  });

  test("401 with no cookie", async () => {
    freshStore();
    const res = await tasksRoute.GET(apiReq("GET", "/aria/api/tasks"));
    expect(res.status).toBe(401);
  });
});

describe("POST /tasks", () => {
  test("201 a new task (rep lane — reps may create tasks)", async () => {
    freshStore();
    const s = getAria();
    const contact = s.contacts.find((c) => c.tenantId === TENANT_IDS.northwind)!;
    const res = await tasksRoute.POST(
      apiReq("POST", "/aria/api/tasks", {
        cookie: cookieFor("marco@northwind.test"),
        body: {
          title: "Fresh follow-up",
          ownerId: "usr-nw-marco",
          entityType: "contact",
          entityId: contact.id,
          due: "2026-11-05T00:00:00Z",
          priority: "high",
        },
      }),
    );
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.done).toBe(false);
    expect(row.doneAt).toBe(null);
    expect(getAria().tasks.some((t) => t.id === row.id)).toBe(true);
  });

  test("400 on a bad priority / due shape", async () => {
    freshStore();
    const res = await tasksRoute.POST(
      apiReq("POST", "/aria/api/tasks", {
        cookie: cookieFor("marco@northwind.test"),
        body: {
          title: "x",
          ownerId: "u",
          entityType: "contact",
          entityId: "c",
          due: "not-an-iso-date",
          priority: "bogus",
        },
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("validation failed");
    expect(json.errors.length).toBeGreaterThan(0);
  });

  test("403 for a viewer's task.create", async () => {
    freshStore();
    const res = await tasksRoute.POST(
      apiReq("POST", "/aria/api/tasks", {
        cookie: cookieFor("sam@lumen.test"),
        body: {
          title: "x",
          ownerId: "u",
          entityType: "lead",
          entityId: "l",
          due: "2026-11-05T00:00:00Z",
          priority: "low",
        },
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("PATCH /tasks/[id]", () => {
  test("toggling done fills in the doneAt timestamp (200)", async () => {
    freshStore();
    const s = getAria();
    const open = s.tasks.find(
      (t) => t.tenantId === TENANT_IDS.lumen && t.done === false,
    )!;
    const res = await tasksIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/tasks/${open.id}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { done: true },
      }),
      params(open.id),
    );
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.done).toBe(true);
    expect(row.doneAt).not.toBeNull();
  });

  test("re-opening clears the doneAt (the store's done semantics)", async () => {
    freshStore();
    const s = getAria();
    const done = s.tasks.find(
      (t) => t.tenantId === TENANT_IDS.lumen && t.done === true,
    )!;
    const res = await tasksIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/tasks/${done.id}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { done: false },
      }),
      params(done.id),
    );
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.done).toBe(false);
    expect(row.doneAt).toBe(null);
  });

  test("404 cross-tenant (northwind cookie × lumen task)", async () => {
    freshStore();
    const s = getAria();
    const lumenTask = s.tasks.find((t) => t.tenantId === TENANT_IDS.lumen)!;
    const res = await tasksIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/tasks/${lumenTask.id}`, {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { title: "probe" },
      }),
      params(lumenTask.id),
    );
    expect(res.status).toBe(404);
  });

  test("400 on a non-boolean done value", async () => {
    freshStore();
    const s = getAria();
    const task = s.tasks.find((t) => t.tenantId === TENANT_IDS.lumen)!;
    const res = await tasksIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/tasks/${task.id}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { done: "yes" },
      }),
      params(task.id),
    );
    expect(res.status).toBe(400);
  });
});
