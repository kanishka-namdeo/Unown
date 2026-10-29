/**
 * Integration tests for /aria/api/contacts — the P0 email
 * uniqueness pin (the create + the update lanes), the visibility
 * scope on reads, and the 400/404/409 ladder. (The accounts+
 * contacts CRUD coverage lives in accounts.test.ts; this file
 * pins the contact-specific invariants.)
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { apiReq, cookieFor, freshStore, seededIdFor, TENANT_IDS } from "./helpers";
import { getAria } from "@/lib/aria/aria-store";

import * as contactsRoute from "@/app/aria/api/contacts/route";
import * as contactsIdRoute from "@/app/aria/api/contacts/[id]/route";

beforeAll(freshStore);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("contact.create — the P0 email-uniqueness invariant", () => {
  test("case-insensitive duplicate → 409, store unchanged", async () => {
    freshStore();
    const s = getAria();
    const account = s.accounts.find((a) => a.tenantId === TENANT_IDS.lumen)!;
    const existing = s.contacts.find((c) => c.tenantId === TENANT_IDS.lumen)!;
    const before = s.contacts.length;

    const res = await contactsRoute.POST(
      apiReq("POST", "/aria/api/contacts", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          accountId: account.id,
          name: "Dup Probe",
          email: existing.email.toUpperCase(),
          title: "Probe",
          ownerId: "usr-lumen-mira",
        },
      }),
    );
    expect(res.status).toBe(409);
    expect(getAria().contacts.length).toBe(before);
  });

  test("two different tenants may share the same email (per-tenant scope)", async () => {
    freshStore();
    const s = getAria();
    const lumenAcct = s.accounts.find((a) => a.tenantId === TENANT_IDS.lumen)!;
    const nwAcct = s.accounts.find((a) => a.tenantId === TENANT_IDS.northwind)!;

    const r1 = await contactsRoute.POST(
      apiReq("POST", "/aria/api/contacts", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          accountId: lumenAcct.id,
          name: "Shared",
          email: "shared@probe.test",
          title: "Shared",
          ownerId: "usr-lumen-mira",
        },
      }),
    );
    expect(r1.status).toBe(201);

    const r2 = await contactsRoute.POST(
      apiReq("POST", "/aria/api/contacts", {
        cookie: cookieFor("ingrid@northwind.test"),
        body: {
          accountId: nwAcct.id,
          name: "Shared NW",
          email: "shared@probe.test",
          title: "Shared NW",
          ownerId: "usr-nw-ingrid",
        },
      }),
    );
    expect(r2.status).toBe(201);
  });

  test("the traits defaults land when omitted", async () => {
    freshStore();
    const s = getAria();
    const account = s.accounts.find((a) => a.tenantId === TENANT_IDS.lumen)!;
    const res = await contactsRoute.POST(
      apiReq("POST", "/aria/api/contacts", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          accountId: account.id,
          name: "No Traits",
          email: "notraits@probe.test",
          title: "T",
          ownerId: "usr-lumen-mira",
        },
      }),
    );
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.traits).toEqual({ replyRate: 0.5, openRate: 0.5, busySignal: false });
  });
});

describe("contact.update — the 409 gate on the email field", () => {
  test("renaming to another contact's email → 409 (the P0 gate)", async () => {
    freshStore();
    const s = getAria();
    const [a, b] = s.contacts.filter((c) => c.tenantId === TENANT_IDS.lumen);
    const res = await contactsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/contacts/${a.id}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { email: b.email },
      }),
      params(a.id),
    );
    expect(res.status).toBe(409);
  });

  test("a non-email patch (name + title + traits) → 200 + audit", async () => {
    freshStore();
    const s = getAria();
    const a = s.contacts.find((c) => c.tenantId === TENANT_IDS.lumen)!;
    const auditBefore = getAria().audit.length;
    const res = await contactsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/contacts/${a.id}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { title: "Updated", traits: { replyRate: 0.1, openRate: 0.2, busySignal: true } },
      }),
      params(a.id),
    );
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.title).toBe("Updated");
    expect(row.traits.busySignal).toBe(true);
    expect(getAria().audit.length).toBeGreaterThan(auditBefore);
  });

  test("400 on a bad traits shape in the update", async () => {
    freshStore();
    const s = getAria();
    const a = s.contacts.find((c) => c.tenantId === TENANT_IDS.lumen)!;
    const res = await contactsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/contacts/${a.id}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { traits: { replyRate: 2 } },
      }),
      params(a.id),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /contacts — the list lane", () => {
  test("the accountId filter narrows to one account's people", async () => {
    freshStore();
    const s = getAria();
    const account = s.accounts.find((a) => a.tenantId === TENANT_IDS.northwind)!;
    const res = await contactsRoute.GET(
      apiReq("GET", `/aria/api/contacts?accountId=${account.id}`, {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ accountId: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.accountId).toBe(account.id);
  });

  test("the q filter matches name OR email (case-insensitive)", async () => {
    freshStore();
    const res = await contactsRoute.GET(
      apiReq("GET", "/aria/api/contacts?q=dana", {
        cookie: cookieFor("mira@lumen.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ email: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].email.toLowerCase()).toContain("dana");
  });

  test("a rep's list is visibility-narrowed to their owned contacts", async () => {
    freshStore();
    const res = await contactsRoute.GET(
      apiReq("GET", "/aria/api/contacts", { cookie: cookieFor("ada@lumen.test") }),
    );
    const rows = (await res.json()) as Array<{ ownerId: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.ownerId).toBe("usr-lumen-ada");
  });
});

describe("GET /contacts/[id] — the detail lane", () => {
  test("200 the contact + deals + activities (the plan's body)", async () => {
    freshStore();
    const contact = seededIdFor(TENANT_IDS.lumen, "contact", 0);
    const res = await contactsIdRoute.GET(
      apiReq("GET", `/aria/api/contacts/${contact}`, {
        cookie: cookieFor("mira@lumen.test"),
      }),
      params(contact),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.contact.id).toBe(contact);
    expect(Array.isArray(json.deals)).toBe(true);
    expect(Array.isArray(json.activities)).toBe(true);
  });

  test("a rep reading someone else's contact → 404 rung holds at the store", async () => {
    freshStore();
    // The store's getContact is tenant-scoped only (no visibility),
    // so the 404 pin here is the cross-tenant case:
    const lumenContact = seededIdFor(TENANT_IDS.lumen, "contact", 0);
    const res = await contactsIdRoute.GET(
      apiReq("GET", `/aria/api/contacts/${lumenContact}`, {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
      params(lumenContact),
    );
    expect(res.status).toBe(404);
  });
});
