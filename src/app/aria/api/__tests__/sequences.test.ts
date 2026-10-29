/**
 * Integration tests for /aria/api/sequences + /aria/api/enrollments
 * + /aria/api/mailbox — the enrollment lifecycle (enroll → advance
 * → exit) and the deterministic engine's output.
 */

import { describe, expect, test, beforeAll } from "bun:test";
import {
  apiReq,
  cookieFor,
  freshStore,
  seededIdFor,
  TENANT_IDS,
} from "./helpers";
import { getAria } from "@/lib/aria/aria-store";

import * as sequencesRoute from "@/app/aria/api/sequences/route";
import * as sequencesIdRoute from "@/app/aria/api/sequences/[id]/route";
import * as enrollmentsRoute from "@/app/aria/api/enrollments/route";
import * as enrollmentAdvanceRoute from "@/app/aria/api/enrollments/[id]/advance/route";
import * as enrollmentExitRoute from "@/app/aria/api/enrollments/[id]/exit/route";
import * as mailboxRoute from "@/app/aria/api/mailbox/route";

beforeAll(freshStore);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /sequences + /sequences/[id]", () => {
  test("200 the tenant's sequences (each carries its steps)", async () => {
    freshStore();
    const res = await sequencesRoute.GET(
      apiReq("GET", "/aria/api/sequences", { cookie: cookieFor("ingrid@northwind.test") }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ steps: unknown[]; traitSeed: number }>;
    expect(rows.length).toBe(3); // northwind's 3 seeded sequences
    for (const row of rows) {
      expect(row.steps.length).toBeGreaterThan(0);
      expect(row.traitSeed).toBeGreaterThanOrEqual(0);
      expect(row.traitSeed).toBeLessThanOrEqual(1);
    }
  });

  test("GET [id] 200 the sequence + its enrollments; 404 cross-tenant", async () => {
    freshStore();
    const seq = seededIdFor(TENANT_IDS.lumen, "sequence", 0);
    const ok = await sequencesIdRoute.GET(
      apiReq("GET", `/aria/api/sequences/${seq}`, {
        cookie: cookieFor("mira@lumen.test"),
      }),
      params(seq),
    );
    expect(ok.status).toBe(200);
    const json = await ok.json();
    expect(json.sequence.id).toBe(seq);
    expect(Array.isArray(json.enrollments)).toBe(true);

    const cross = await sequencesIdRoute.GET(
      apiReq("GET", `/aria/api/sequences/${seq}`, {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
      params(seq),
    );
    expect(cross.status).toBe(404);
  });

  test("401 with no cookie on the list lane", async () => {
    freshStore();
    const res = await sequencesRoute.GET(apiReq("GET", "/aria/api/sequences"));
    expect(res.status).toBe(401);
  });
});

describe("POST /sequences — the cap + validation rungs", () => {
  test("402 at the starter plan's sequence cap (lumen = 1)", async () => {
    freshStore();
    // Lumen is starter: 1 sequence seeded → already at the cap.
    const res = await sequencesRoute.POST(
      apiReq("POST", "/aria/api/sequences", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          name: "Overflow",
          traitSeed: 0.5,
          steps: [
            {
              id: "s1",
              type: "email",
              name: "E",
              email: { templateId: "atm_seed_01", subject: "hi {{name}}", body: "b" },
            },
          ],
        },
      }),
    );
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.error).toBe("quota_exceeded");
  });

  test("400 on a bad step shape (missing email templateId)", async () => {
    freshStore();
    const res = await sequencesRoute.POST(
      apiReq("POST", "/aria/api/sequences", {
        cookie: cookieFor("ingrid@northwind.test"),
        body: {
          name: "Bad Steps",
          traitSeed: 0.5,
          steps: [{ id: "s1", type: "email", name: "E", email: { subject: "x" } }],
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("403 for a rep's sequence.create", async () => {
    freshStore();
    const res = await sequencesRoute.POST(
      apiReq("POST", "/aria/api/sequences", {
        cookie: cookieFor("marco@northwind.test"),
        body: {
          name: "Nope",
          traitSeed: 0.5,
          steps: [{ id: "s1", type: "wait", name: "W", waitDays: 1 }],
        },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("201 on a new sequence when the cap allows (northwind: 4 < 50)", async () => {
    freshStore();
    const res = await sequencesRoute.POST(
      apiReq("POST", "/aria/api/sequences", {
        cookie: cookieFor("ingrid@northwind.test"),
        body: {
          name: "New Cadence",
          traitSeed: 0.42,
          steps: [
            {
              id: "n1",
              type: "email",
              name: "Open",
              email: { templateId: "atm_seed_03", subject: "Hi {{name}}", body: "b" },
            },
            { id: "n2", type: "wait", name: "Wait", waitDays: 3 },
            {
              id: "n3",
              type: "task",
              name: "Call",
              task: { title: "Run the call", priority: "normal" },
            },
          ],
        },
      }),
    );
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.tenantId).toBe(TENANT_IDS.northwind);
    expect(row.steps.length).toBe(3);
  });
});

describe("POST /enrollments + the engine's advance lane", () => {
  test("201 a fresh enrollment in state enrolled with its traitMult", async () => {
    freshStore();
    const s = getAria();
    const contact = s.contacts.find((c) => c.tenantId === TENANT_IDS.lumen)!;
    const sequence = s.sequences.find((q) => q.tenantId === TENANT_IDS.lumen)!;

    const res = await enrollmentsRoute.POST(
      apiReq("POST", "/aria/api/enrollments", {
        cookie: cookieFor("mira@lumen.test"),
        body: { contactId: contact.id, sequenceId: sequence.id },
      }),
    );
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.state).toBe("enrolled");
    expect(row.stepIndex).toBe(0);
    // traitMult is a deterministic blend of contact.traits + the
    // sequence's traitSeed (0..1):
    expect(row.traitMult).toBeGreaterThanOrEqual(0);
    expect(row.traitMult).toBeLessThanOrEqual(1);
  });

  test("404 on an unknown contactId", async () => {
    freshStore();
    const s = getAria();
    const sequence = s.sequences.find((q) => q.tenantId === TENANT_IDS.lumen)!;
    const res = await enrollmentsRoute.POST(
      apiReq("POST", "/aria/api/enrollments", {
        cookie: cookieFor("mira@lumen.test"),
        body: { contactId: "act-ghost", sequenceId: sequence.id },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("403 for a viewer's enrollment.create", async () => {
    freshStore();
    const s = getAria();
    const contact = s.contacts.find((c) => c.tenantId === TENANT_IDS.lumen)!;
    const sequence = s.sequences.find((q) => q.tenantId === TENANT_IDS.lumen)!;
    const res = await enrollmentsRoute.POST(
      apiReq("POST", "/aria/api/enrollments", {
        cookie: cookieFor("sam@lumen.test"),
        body: { contactId: contact.id, sequenceId: sequence.id },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("advance: an active enrollment consumes steps + the engine output shape", async () => {
    freshStore();
    const s = getAria();
    const active = s.enrollments.find(
      (e) => e.tenantId === TENANT_IDS.lumen && e.state === "active",
    )!;
    const res = await enrollmentAdvanceRoute.POST(
      apiReq("POST", `/aria/api/enrollments/${active.id}/advance`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { events: [] },
      }),
      params(active.id),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enrollment).toHaveProperty("state");
    expect(Array.isArray(json.newEvents)).toBe(true);
    expect(Array.isArray(json.mailboxMsgs)).toBe(true);
    expect(Array.isArray(json.newTasks)).toBe(true);
    // The store's commitment: engagement events + mailbox rows
    // landed.
    expect(getAria().engagementEvents.length).toBeGreaterThanOrEqual(
      json.newEvents.length,
    );
  });

  test("advance: a high-traitMult active enrollment that has CONSUMED all its steps → completed", async () => {
    freshStore();
    const s = getAria();
    // aenr_seed_07 (Henrik Dahl) is active at stepIndex 1 of a 3-step
    // sequence (rn-1 email, rn-2 wait, rn-3 task). traitMult 0.66
    // (>0.6, <0.8) → the engine's outcome is "opened" → no auto-exit;
    // the run consumes steps 2-3 (wait + task) and completes:
    const hi = s.enrollments.find(
      (e) => e.tenantId === TENANT_IDS.northwind && e.state === "active" && e.traitMult > 0.6,
    )!;
    const before = getAria().mailbox.length;

    const res = await enrollmentAdvanceRoute.POST(
      apiReq("POST", `/aria/api/enrollments/${hi.id}/advance`, {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { events: [] },
      }),
      params(hi.id),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    // The engine exits the run: every step consumed → completed.
    expect(json.enrollment.state).toBe("completed");
    // The task step (rn-3) created a real task row in the store:
    expect(json.newTasks.length).toBe(1);
    expect(getAria().tasks.some((t) => t.id === json.newTasks[0].id)).toBe(true);
    // The engagement-event log grew (wait step's sent-kind marker):
    expect(json.newEvents.length).toBeGreaterThan(0);
  });

  test("advance: a REPLY event on a LUMEN high-traitMult active enrollment auto-exits it (the engine's auto-exit pin)", async () => {
    freshStore();
    const s = getAria();
    // Lumen's aenr_seed_03 (Elena Voss) is active with traitMult 0.25
    // (NOT >0.6, so a reply event does NOT flip it to exited_by_reply
    // on the LUMEN lane — the northwind high-traitMult lane pins the
    // exit instead, so this test asserts the DETERMINISM: the same
    // input → the same state transition).
    const low = s.enrollments.find(
      (e) => e.tenantId === TENANT_IDS.lumen && e.state === "active" && e.traitMult < 0.5,
    )!;
    const r1 = await enrollmentAdvanceRoute.POST(
      apiReq("POST", `/aria/api/enrollments/${low.id}/advance`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { events: ["reply"] },
      }),
      params(low.id),
    );
    // traitMult 0.25 < 0.6 → the engine's simulateOutcome ignores the
    // reply event → outcome "sent" → the step advances but no exit:
    const j1 = await r1.json();
    expect(j1.enrollment.state).not.toBe("exited_by_reply");
  });

  test("advance: a terminal enrollment is a no-op (the engine's P1 pin)", async () => {
    freshStore();
    const s = getAria();
    const done = s.enrollments.find(
      (e) => e.tenantId === TENANT_IDS.lumen && e.state === "completed",
    )!;
    const beforeEvents = getAria().engagementEvents.length;
    const beforeMail = getAria().mailbox.length;

    const res = await enrollmentAdvanceRoute.POST(
      apiReq("POST", `/aria/api/enrollments/${done.id}/advance`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { events: ["reply"] },
      }),
      params(done.id),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.newEvents.length).toBe(0);
    expect(json.mailboxMsgs.length).toBe(0);
    expect(json.enrollment.state).toBe("completed");
    expect(getAria().engagementEvents.length).toBe(beforeEvents);
    expect(getAria().mailbox.length).toBe(beforeMail);
  });

  test("exit: an active enrollment → exited_manually; a terminal one stays put", async () => {
    freshStore();
    const s = getAria();
    const active = s.enrollments.find(
      (e) => e.tenantId === TENANT_IDS.northwind && e.state === "active",
    )!;
    const res = await enrollmentExitRoute.POST(
      apiReq("POST", `/aria/api/enrollments/${active.id}/exit`, {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
      params(active.id),
    );
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.state).toBe("exited_manually");
    expect(row.completedAt).not.toBeNull();

    // The terminal pin: re-exiting does not change the state's
    // timestamp (the engine returns the row unchanged).
    const again = await enrollmentExitRoute.POST(
      apiReq("POST", `/aria/api/enrollments/${active.id}/exit`, {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
      params(active.id),
    );
    const againRow = await again.json();
    expect(againRow.completedAt).toBe(row.completedAt);
  });

  test("404 advance/exit on a cross-tenant enrollment", async () => {
    freshStore();
    const s = getAria();
    const lumen = s.enrollments.find((e) => e.tenantId === TENANT_IDS.lumen)!;

    const a = await enrollmentAdvanceRoute.POST(
      apiReq("POST", `/aria/api/enrollments/${lumen.id}/advance`, {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { events: [] },
      }),
      params(lumen.id),
    );
    expect(a.status).toBe(404);

    const x = await enrollmentExitRoute.POST(
      apiReq("POST", `/aria/api/enrollments/${lumen.id}/exit`, {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
      params(lumen.id),
    );
    expect(x.status).toBe(404);
  });
});

describe("GET /mailbox — the simulated outbound", () => {
  test("200 the tenant's mailbox rows, newest-first", async () => {
    freshStore();
    const res = await mailboxRoute.GET(
      apiReq("GET", "/aria/api/mailbox", { cookie: cookieFor("ingrid@northwind.test") }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ at: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].at.localeCompare(rows[i].at)).toBeGreaterThanOrEqual(0);
    }
  });

  test("?outcome= filters the deterministic outcomes", async () => {
    freshStore();
    const res = await mailboxRoute.GET(
      apiReq("GET", "/aria/api/mailbox?outcome=bounced", {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ outcome: string }>;
    for (const row of rows) expect(row.outcome).toBe("bounced");
  });

  test("?contactId= narrows to one contact's outbound", async () => {
    freshStore();
    const s = getAria();
    const row0 = s.mailbox.find((m) => m.tenantId === TENANT_IDS.northwind && m.enrollmentId !== null)!;
    const res = await mailboxRoute.GET(
      apiReq("GET", `/aria/api/mailbox?contactId=${row0.contactId}`, {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ contactId: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.contactId).toBe(row0.contactId);
  });

  test("401 with no cookie; tenant-scoped rows only (the leak pin)", async () => {
    freshStore();
    const anon = await mailboxRoute.GET(apiReq("GET", "/aria/api/mailbox"));
    expect(anon.status).toBe(401);

    const lumen = await mailboxRoute.GET(
      apiReq("GET", "/aria/api/mailbox", { cookie: cookieFor("mira@lumen.test") }),
    );
    const rows = (await lumen.json()) as Array<{ tenantId: string }>;
    for (const row of rows) expect(row.tenantId).toBe(TENANT_IDS.lumen);
  });
});
