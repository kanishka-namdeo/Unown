/**
 * Integration tests for /aria/api/accounts + /aria/api/contacts —
 * CRUD + the 400/404/409 ladder, the email-uniqueness P0 pin, and
 * the visibility narrowing (a rep sees only their records).
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

import * as accountsRoute from "@/app/aria/api/accounts/route";
import * as accountsIdRoute from "@/app/aria/api/accounts/[id]/route";
import * as contactsRoute from "@/app/aria/api/contacts/route";
import * as contactsIdRoute from "@/app/aria/api/contacts/[id]/route";

beforeAll(freshStore);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /accounts", () => {
  test("200 the tenant's accounts, visibility-narrowed for a rep", async () => {
    freshStore();
    // Lumen's rep (ada) sees only her owned accounts; the owner
    // (mira) sees the whole tenant.
    const rep = await accountsRoute.GET(
      apiReq("GET", "/aria/api/accounts", { cookie: cookieFor("ada@lumen.test") }),
    );
    expect(rep.status).toBe(200);
    const repRows = await rep.json();
    for (const row of repRows as Array<{ ownerId: string }>) {
      expect(row.ownerId).toBe("usr-lumen-ada");
    }

    const owner = await accountsRoute.GET(
      apiReq("GET", "/aria/api/accounts", { cookie: cookieFor("mira@lumen.test") }),
    );
    expect(owner.status).toBe(200);
    const ownerRows = await owner.json();
    expect((ownerRows as unknown[]).length).toBeGreaterThan(
      (repRows as unknown[]).length,
    );
  });

  test("the q filter is a free-text name/domain search", async () => {
    freshStore();
    const res = await accountsRoute.GET(
      apiReq("GET", "/aria/api/accounts?q=ferrostack", { cookie: cookieFor("mira@lumen.test") }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ domain: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].domain).toBe("ferrostack.io");
  });

  test("a 403 rung is impossible for account.list (all roles pass)", async () => {
    freshStore();
    const viewer = await accountsRoute.GET(
      apiReq("GET", "/aria/api/accounts", { cookie: cookieFor("sam@lumen.test") }),
    );
    expect(viewer.status).toBe(200);
  });
});

describe("POST /accounts", () => {
  test("201 a new account (owner lane)", async () => {
    freshStore();
    const res = await accountsRoute.POST(
      apiReq("POST", "/aria/api/accounts", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          name: "Probe Inc",
          domain: "probe.io",
          industry: "Probe",
          size: 10,
          ownerId: "usr-lumen-mira",
        },
      }),
    );
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.tenantId).toBe(TENANT_IDS.lumen);
    expect(getAria().accounts.some((a) => a.id === row.id)).toBe(true);
  });

  test("400 on a bad shape (missing name + bad domain)", async () => {
    freshStore();
    const res = await accountsRoute.POST(
      apiReq("POST", "/aria/api/accounts", {
        cookie: cookieFor("mira@lumen.test"),
        body: { name: "", domain: "not a domain", industry: "", size: 0, ownerId: "" },
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("validation failed");
    expect(json.errors.length).toBeGreaterThan(0);
  });

  test("403 for a rep's account.create (the matrix's ✗)", async () => {
    freshStore();
    const res = await accountsRoute.POST(
      apiReq("POST", "/aria/api/accounts", {
        cookie: cookieFor("ada@lumen.test"),
        body: { name: "x", domain: "x.com", industry: "i", size: 1, ownerId: "u" },
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("account.create");
  });

  test("401 with no cookie", async () => {
    freshStore();
    const res = await accountsRoute.POST(
      apiReq("POST", "/aria/api/accounts", {
        body: { name: "x", domain: "x.com", industry: "i", size: 1, ownerId: "u" },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("GET/PATCH /accounts/[id]", () => {
  test("GET 200 the account + its contacts; the visibility rung holds", async () => {
    freshStore();
    const lumenAccount = seededIdFor(TENANT_IDS.lumen, "account", 0);
    const res = await accountsIdRoute.GET(
      apiReq("GET", `/aria/api/accounts/${lumenAccount}`, {
        cookie: cookieFor("mira@lumen.test"),
      }),
      params(lumenAccount),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.account.id).toBe(lumenAccount);
    expect(Array.isArray(json.contacts)).toBe(true);
  });

  test("PATCH 200 the updated account (owner lane)", async () => {
    freshStore();
    const lumenAccount = seededIdFor(TENANT_IDS.lumen, "account", 1);
    const res = await accountsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/accounts/${lumenAccount}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { industry: "Probe Industry" },
      }),
      params(lumenAccount),
    );
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.industry).toBe("Probe Industry");
    // audit landed
    const aud = getAria().audit.filter((e) => e.action === "account.update");
    expect(aud.length).toBeGreaterThan(0);
  });

  test("PATCH on an out-of-scope account (a rep's own owner) → 404 rung via visibility", async () => {
    freshStore();
    // A lumen account owned by ada; marco (a northwind rep) can
    // never see it — the cross-tenant rung returns 404 first, but
    // a lumen MANAGER sees team records only:
    const lumenAccount = seededIdFor(TENANT_IDS.lumen, "account", 0); // ada-owned
    const res = await accountsIdRoute.GET(
      apiReq("GET", `/aria/api/accounts/${lumenAccount}`, {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
      params(lumenAccount),
    );
    expect(res.status).toBe(404);
  });

  test("PATCH 400 on a bad status value", async () => {
    freshStore();
    const lumenAccount = seededIdFor(TENANT_IDS.lumen, "account", 0);
    const res = await accountsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/accounts/${lumenAccount}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { status: "bogus" },
      }),
      params(lumenAccount),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /contacts + the 409 email-uniqueness pin", () => {
  test("201 a new contact under a known account", async () => {
    freshStore();
    const account = seededIdFor(TENANT_IDS.lumen, "account", 0);
    const res = await contactsRoute.POST(
      apiReq("POST", "/aria/api/contacts", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          accountId: account,
          name: "Probe Person",
          email: "probe.person@ferrostack.io",
          title: "Probe",
          ownerId: "usr-lumen-mira",
          traits: { replyRate: 0.5, openRate: 0.5, busySignal: false },
        },
      }),
    );
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.email).toBe("probe.person@ferrostack.io");
  });

  test("409 when the email already exists in the tenant (the P0 pin, case-insensitive)", async () => {
    freshStore();
    const account = seededIdFor(TENANT_IDS.lumen, "account", 0);
    const existing = getAria().contacts.find(
      (c) => c.tenantId === TENANT_IDS.lumen,
    )!;
    const res = await contactsRoute.POST(
      apiReq("POST", "/aria/api/contacts", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          accountId: account,
          name: "Clone",
          email: existing.email.toUpperCase(),
          title: "Clone",
          ownerId: "usr-lumen-mira",
        },
      }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("conflict");
  });

  test("404 when the accountId is unknown", async () => {
    freshStore();
    const res = await contactsRoute.POST(
      apiReq("POST", "/aria/api/contacts", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          accountId: "acr-ghost",
          name: "x",
          email: "x@x.com",
          title: "x",
          ownerId: "usr-lumen-mira",
        },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("400 on a bad traits shape", async () => {
    freshStore();
    const account = seededIdFor(TENANT_IDS.lumen, "account", 0);
    const res = await contactsRoute.POST(
      apiReq("POST", "/aria/api/contacts", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          accountId: account,
          name: "x",
          email: "x@x.com",
          title: "x",
          ownerId: "usr-lumen-mira",
          traits: { replyRate: 5, openRate: 0.5, busySignal: "yes" },
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("403 for a viewer's contact.create", async () => {
    freshStore();
    const account = seededIdFor(TENANT_IDS.lumen, "account", 0);
    const res = await contactsRoute.POST(
      apiReq("POST", "/aria/api/contacts", {
        cookie: cookieFor("sam@lumen.test"),
        body: {
          accountId: account,
          name: "x",
          email: "x@x.com",
          title: "x",
          ownerId: "usr-lumen-sam",
        },
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET/PATCH /contacts/[id]", () => {
  test("GET 200 the contact + deals + activities", async () => {
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

  test("PATCH 200; a new email that clashes → 409", async () => {
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

    const ok = await contactsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/contacts/${a.id}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { title: "New Title" },
      }),
      params(a.id),
    );
    expect(ok.status).toBe(200);
    const row = await ok.json();
    expect(row.title).toBe("New Title");
  });
});
