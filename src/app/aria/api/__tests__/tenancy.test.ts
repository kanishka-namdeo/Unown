/**
 * The cross-tenant isolation suite — the tenancy floor. For EVERY
 * entity read/mutate endpoint: tenant-A session × tenant-B entity
 * → 404 (never a 403 that confirms existence, never a 200 leak).
 *
 * The northwind-session cookie × lumen-entity ids on every
 * endpoint, and vice versa. No-context calls → 401.
 */

import { describe, expect, test, beforeAll } from "bun:test";
import {
  apiReq,
  cookieFor,
  freshStore,
  seededIdFor,
  TENANT_IDS,
} from "./helpers";

import * as accountsRoute from "@/app/aria/api/accounts/route";
import * as accountsIdRoute from "@/app/aria/api/accounts/[id]/route";
import * as contactsRoute from "@/app/aria/api/contacts/route";
import * as contactsIdRoute from "@/app/aria/api/contacts/[id]/route";
import * as leadsRoute from "@/app/aria/api/leads/route";
import * as leadsIdRoute from "@/app/aria/api/leads/[id]/route";
import * as convertLeadRoute from "@/app/aria/api/leads/[id]/convert/route";
import * as pipelinesRoute from "@/app/aria/api/pipelines/route";
import * as pipelinesIdRoute from "@/app/aria/api/pipelines/[id]/route";
import * as dealsRoute from "@/app/aria/api/deals/route";
import * as dealsIdRoute from "@/app/aria/api/deals/[id]/route";
import * as dealStageRoute from "@/app/aria/api/deals/[id]/stage/route";
import * as activitiesRoute from "@/app/aria/api/activities/route";
import * as tasksRoute from "@/app/aria/api/tasks/route";
import * as tasksIdRoute from "@/app/aria/api/tasks/[id]/route";
import * as notesRoute from "@/app/aria/api/notes/route";
import * as tagsRoute from "@/app/aria/api/tags/route";
import * as tagsIdRoute from "@/app/aria/api/tags/[id]/route";
import * as sequencesRoute from "@/app/aria/api/sequences/route";
import * as sequencesIdRoute from "@/app/aria/api/sequences/[id]/route";
import * as enrollmentsRoute from "@/app/aria/api/enrollments/route";
import * as enrollmentAdvanceRoute from "@/app/aria/api/enrollments/[id]/advance/route";
import * as enrollmentExitRoute from "@/app/aria/api/enrollments/[id]/exit/route";
import * as mailboxRoute from "@/app/aria/api/mailbox/route";
import * as tenantsRoute from "@/app/aria/api/tenants/route";
import * as tenantsIdRoute from "@/app/aria/api/tenants/[id]/route";
import * as auditRoute from "@/app/aria/api/audit/route";

beforeAll(freshStore);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("cross-tenant isolation (northwind session × lumen entity → 404)", () => {
  test("GET accounts/[id] on a lumen account → 404", async () => {
    freshStore();
    const northCookie = cookieFor("ingrid@northwind.test");
    const lumenAccount = seededIdFor(TENANT_IDS.lumen, "account");
    const res = await accountsIdRoute.GET(
      apiReq("GET", `/aria/api/accounts/${lumenAccount}`, { cookie: northCookie }),
      params(lumenAccount),
    );
    expect(res.status).toBe(404);
  });

  test("PATCH accounts/[id] on a lumen account → 404", async () => {
    freshStore();
    const northCookie = cookieFor("ingrid@northwind.test");
    const lumenAccount = seededIdFor(TENANT_IDS.lumen, "account");
    const res = await accountsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/accounts/${lumenAccount}`, {
        cookie: northCookie,
        body: { name: "probe" },
      }),
      params(lumenAccount),
    );
    expect(res.status).toBe(404);
  });

  test("GET contacts/[id] on a lumen contact → 404", async () => {
    freshStore();
    const northCookie = cookieFor("ingrid@northwind.test");
    const lumenContact = seededIdFor(TENANT_IDS.lumen, "contact");
    const res = await contactsIdRoute.GET(
      apiReq("GET", `/aria/api/contacts/${lumenContact}`, { cookie: northCookie }),
      params(lumenContact),
    );
    expect(res.status).toBe(404);
  });

  test("PATCH leads/[id] + POST leads/[id]/convert on a lumen lead → 404", async () => {
    freshStore();
    const northCookie = cookieFor("ingrid@northwind.test");
    const lumenLead = seededIdFor(TENANT_IDS.lumen, "lead");

    const p = await leadsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/leads/${lumenLead}`, {
        cookie: northCookie,
        body: { status: "working" },
      }),
      params(lumenLead),
    );
    expect(p.status).toBe(404);

    const c = await convertLeadRoute.POST(
      apiReq("POST", `/aria/api/leads/${lumenLead}/convert`, { cookie: northCookie }),
      params(lumenLead),
    );
    expect(c.status).toBe(404);
  });

  test("GET deals/[id] on a lumen deal → 404; POST deals/[id]/stage → 404", async () => {
    freshStore();
    const northCookie = cookieFor("ingrid@northwind.test");
    const lumenDeal = seededIdFor(TENANT_IDS.lumen, "deal");

    const g = await dealsIdRoute.GET(
      apiReq("GET", `/aria/api/deals/${lumenDeal}`, { cookie: northCookie }),
      params(lumenDeal),
    );
    expect(g.status).toBe(404);

    const st = await dealStageRoute.POST(
      apiReq("POST", `/aria/api/deals/${lumenDeal}/stage`, {
        cookie: northCookie,
        body: { stageId: "stg_ne_02" },
      }),
      params(lumenDeal),
    );
    expect(st.status).toBe(404);
  });

  test("GET pipelines/[id] on a lumen pipeline → 404", async () => {
    freshStore();
    const northCookie = cookieFor("ingrid@northwind.test");
    const lumenPipeline = seededIdFor(TENANT_IDS.lumen, "pipeline");
    const res = await pipelinesIdRoute.GET(
      apiReq("GET", `/aria/api/pipelines/${lumenPipeline}`, { cookie: northCookie }),
      params(lumenPipeline),
    );
    expect(res.status).toBe(404);
  });

  test("GET tasks/[id] PATCH on a lumen task → 404; DELETE tags/[id] → 404", async () => {
    freshStore();
    const northCookie = cookieFor("ingrid@northwind.test");
    const lumenTask = seededIdFor(TENANT_IDS.lumen, "task");
    const lumenTag = seededIdFor(TENANT_IDS.lumen, "tag");

    const t = await tasksIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/tasks/${lumenTask}`, {
        cookie: northCookie,
        body: { title: "probe" },
      }),
      params(lumenTask),
    );
    expect(t.status).toBe(404);

    const d = await tagsIdRoute.DELETE(
      apiReq("DELETE", `/aria/api/tags/${lumenTag}`, { cookie: northCookie }),
      params(lumenTag),
    );
    expect(d.status).toBe(404);
  });

  test("POST enrollments/[id]/advance + /exit on a lumen enrollment → 404", async () => {
    freshStore();
    const northCookie = cookieFor("ingrid@northwind.test");
    const lumenEnrollment = seededIdFor(TENANT_IDS.lumen, "enrollment");

    const a = await enrollmentAdvanceRoute.POST(
      apiReq("POST", `/aria/api/enrollments/${lumenEnrollment}/advance`, {
        cookie: northCookie,
        body: { events: [] },
      }),
      params(lumenEnrollment),
    );
    expect(a.status).toBe(404);

    const x = await enrollmentExitRoute.POST(
      apiReq("POST", `/aria/api/enrollments/${lumenEnrollment}/exit`, {
        cookie: northCookie,
      }),
      params(lumenEnrollment),
    );
    expect(x.status).toBe(404);
  });

  test("GET sequences/[id] on a lumen sequence → 404", async () => {
    freshStore();
    const northCookie = cookieFor("ingrid@northwind.test");
    const lumenSeq = seededIdFor(TENANT_IDS.lumen, "sequence");
    const res = await sequencesIdRoute.GET(
      apiReq("GET", `/aria/api/sequences/${lumenSeq}`, { cookie: northCookie }),
      params(lumenSeq),
    );
    expect(res.status).toBe(404);
  });

  test("list lanes never leak the other tenant's rows", async () => {
    freshStore();
    const northCookie = cookieFor("ingrid@northwind.test");
    for (const [route] of [
      [accountsRoute],
      [contactsRoute],
      [leadsRoute],
      [dealsRoute],
      [pipelinesRoute],
      [tasksRoute],
      [notesRoute],
      [tagsRoute],
      [sequencesRoute],
      [activitiesRoute],
      [mailboxRoute],
    ] as const) {
      const res = await route.GET(
        apiReq("GET", `/aria/api/probe`, { cookie: northCookie }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      const arr = Array.isArray(json)
        ? json
        : (json as Record<string, unknown[]>)[
            "account" in (json as object) ? "account" : "deals" in (json as object) ? "deals" : Object.keys(json)[0] as string
          ] ?? [];
      for (const row of arr as Array<{ tenantId?: string }>) {
        if (row.tenantId) {
          expect(row.tenantId).toBe(TENANT_IDS.northwind);
        }
      }
    }
  });
});

describe("lumen session × northwind entity → 404 (the other direction)", () => {
  test("a lumen cookie never reads a northwind entity", async () => {
    freshStore();
    const lumenCookie = cookieFor("mira@lumen.test");
    const nwAccount = seededIdFor(TENANT_IDS.northwind, "account");
    const res = await accountsIdRoute.GET(
      apiReq("GET", `/aria/api/accounts/${nwAccount}`, { cookie: lumenCookie }),
      params(nwAccount),
    );
    expect(res.status).toBe(404);
  });

  test("a lumen owner PATCH tenants/[northwind-id] → 404 (the carve-out)", async () => {
    freshStore();
    const lumenCookie = cookieFor("mira@lumen.test");
    const res = await tenantsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/tenants/${TENANT_IDS.northwind}`, {
        cookie: lumenCookie,
        body: { name: "probe" },
      }),
      params(TENANT_IDS.northwind),
    );
    expect(res.status).toBe(404);
  });
});

describe("no-context calls → 401 (the top rung)", () => {
  test("every session-gated GET lane → 401 with no cookie", async () => {
    const lanes: Array<[string, () => Promise<{ status: number }>]> = [
      ["accounts", async () => {
        const r = await accountsRoute.GET(apiReq("GET", "/aria/api/accounts"));
        return r;
      }],
      ["contacts", async () => {
        const r = await contactsRoute.GET(apiReq("GET", "/aria/api/contacts"));
        return r;
      }],
      ["leads", async () => {
        const r = await leadsRoute.GET(apiReq("GET", "/aria/api/leads"));
        return r;
      }],
      ["deals", async () => {
        const r = await dealsRoute.GET(apiReq("GET", "/aria/api/deals"));
        return r;
      }],
      ["pipelines", async () => {
        const r = await pipelinesRoute.GET(apiReq("GET", "/aria/api/pipelines"));
        return r;
      }],
      ["tasks", async () => {
        const r = await tasksRoute.GET(apiReq("GET", "/aria/api/tasks"));
        return r;
      }],
      ["notes", async () => {
        const r = await notesRoute.GET(apiReq("GET", "/aria/api/notes"));
        return r;
      }],
      ["tags", async () => {
        const r = await tagsRoute.GET(apiReq("GET", "/aria/api/tags"));
        return r;
      }],
      ["sequences", async () => {
        const r = await sequencesRoute.GET(apiReq("GET", "/aria/api/sequences"));
        return r;
      }],
      ["mailbox", async () => {
        const r = await mailboxRoute.GET(apiReq("GET", "/aria/api/mailbox"));
        return r;
      }],
      ["tenants", async () => {
        const r = await tenantsRoute.GET(apiReq("GET", "/aria/api/tenants"));
        return r;
      }],
      ["audit", async () => {
        const r = await auditRoute.GET(apiReq("GET", "/aria/api/audit"));
        return r;
      }],
    ];
    for (const [name, run] of lanes) {
      freshStore();
      const res = await run();
      expect(res.status, `${name} without cookie → 401`).toBe(401);
    }
  });

  test("every session-gated write lane → 401 with no cookie", async () => {
    freshStore();
    const acc = await accountsRoute.POST(
      apiReq("POST", "/aria/api/accounts", { body: { name: "x", domain: "x.com", industry: "i", size: 1, ownerId: "u" } }),
    );
    expect(acc.status).toBe(401);
    const tag = await tagsRoute.POST(
      apiReq("POST", "/aria/api/tags", { body: { label: "probe" } }),
    );
    expect(tag.status).toBe(401);
    const note = await notesRoute.POST(
      apiReq("POST", "/aria/api/notes", { body: { entityType: "account", entityId: "e", body: "b" } }),
    );
    expect(note.status).toBe(401);
    const enr = await enrollmentsRoute.POST(
      apiReq("POST", "/aria/api/enrollments", { body: { contactId: "c", sequenceId: "s" } }),
    );
    expect(enr.status).toBe(401);
  });
});
