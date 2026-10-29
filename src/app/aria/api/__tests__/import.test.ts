/**
 * Integration tests for /aria/api/import — the CSV dry-run
 * validation, duplicate email/domain detection, and the per-row
 * error shape.
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { apiReq, cookieFor, freshStore, TENANT_IDS } from "./helpers";
import { getAria } from "@/lib/aria/aria-store";

import * as importRoute from "@/app/aria/api/import/route";

beforeAll(freshStore);

describe("POST /import — the dry-run lane", () => {
  test("200 a dry-run report: per-row errors + duplicates, store untouched", async () => {
    freshStore();
    const s = getAria();
    const account = s.accounts.find((a) => a.tenantId === TENANT_IDS.lumen)!;
    const existingContact = s.contacts.find((c) => c.tenantId === TENANT_IDS.lumen)!;
    const contactsBefore = s.contacts.length;
    const auditBefore = s.audit.length;

    const csv = [
      "name,email,title,accountId",
      `Good Row,good.row@probe.test,CIO,${account.id}`,
      `Bad Email,notanemail,CIO,${account.id}`,
      `Duplicate,${existingContact.email},Title,${account.id}`,
      ` ,missing-email,CIO,${account.id}`,
    ].join("\n");

    const res = await importRoute.POST(
      apiReq("POST", "/aria/api/import", {
        cookie: cookieFor("mira@lumen.test"),
        body: { type: "contacts", csv, dryRun: true },
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();

    // Per-row error shape: { row, field, message }
    expect(json.errors.length).toBeGreaterThan(0);
    for (const err of json.errors) {
      expect(err).toHaveProperty("row");
      expect(err).toHaveProperty("field");
      expect(err).toHaveProperty("message");
    }
    // The bad-email row is flagged:
    expect(json.errors.some((e: { field: string }) => e.field === "email")).toBe(true);
    // The duplicate is DETECTED, not counted as imported:
    expect(
      json.duplicates.some((d: { emailOrDomain: string }) =>
        d.emailOrDomain.toLowerCase() === existingContact.email.toLowerCase(),
      ),
    ).toBe(true);
    // Exactly one valid row is importable:
    expect(json.imported).toBe(1);
    // Dry-run: NOTHING committed.
    expect(getAria().contacts.length).toBe(contactsBefore);
    expect(getAria().audit.length).toBe(auditBefore);
  });

  test("a committed import (dryRun=false) lands the valid rows + an audit event", async () => {
    freshStore();
    const s = getAria();
    const account = s.accounts.find((a) => a.tenantId === TENANT_IDS.lumen)!;
    const contactsBefore = s.contacts.length;

    const csv = [
      "name,email,title,accountId",
      `New One,one@probe.test,CIO,${account.id}`,
      `New Two,two@probe.test,CTO,${account.id}`,
    ].join("\n");

    const res = await importRoute.POST(
      apiReq("POST", "/aria/api/import", {
        cookie: cookieFor("mira@lumen.test"),
        body: { type: "contacts", csv, dryRun: false },
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.imported).toBe(2);
    expect(getAria().contacts.length).toBe(contactsBefore + 2);
    // The audit's import event:
    expect(
      getAria().audit.some((e) => e.action === "import.run"),
    ).toBe(true);
  });

  test("duplicates skip (not errors) and are not counted as imported", async () => {
    freshStore();
    const s = getAria();
    const lumen = s.contacts
      .filter((c) => c.tenantId === TENANT_IDS.lumen)
      .slice(0, 2);
    const account = s.accounts.find((a) => a.tenantId === TENANT_IDS.lumen)!;
    const csv = [
      "name,email,title,accountId",
      ...lumen.map(
        (c) => `Clone,${c.email},Clone,${account.id}`,
      ),
    ].join("\n");

    const res = await importRoute.POST(
      apiReq("POST", "/aria/api/import", {
        cookie: cookieFor("mira@lumen.test"),
        body: { type: "contacts", csv, dryRun: false },
      }),
    );
    const json = await res.json();
    expect(json.imported).toBe(0);
    expect(json.duplicates.length).toBe(lumen.length);
    for (const d of json.duplicates) {
      expect(d).toHaveProperty("existingId");
    }
    expect(getAria().contacts.length).toBe(s.contacts.length);
  });

  test("the deals import type: per-row validation + unknown-pipeline errors", async () => {
    freshStore();
    const s = getAria();
    const pipeline = s.pipelines.find((p) => p.tenantId === TENANT_IDS.lumen)!;
    const account = s.accounts.find((a) => a.tenantId === TENANT_IDS.lumen)!;
    const contact = s.contacts.find((c) => c.tenantId === TENANT_IDS.lumen)!;
    const csv = [
      "amount,pipelineId,accountId,contactId,forecastCategory",
      `5000,${pipeline.id},${account.id},${contact.id},pipeline`,
      `7500,bogus-pipeline,${account.id},${contact.id},commit`,
      `-5,${pipeline.id},${account.id},${contact.id},pipeline`,
    ].join("\n");

    const res = await importRoute.POST(
      apiReq("POST", "/aria/api/import", {
        cookie: cookieFor("mira@lumen.test"),
        body: { type: "deals", csv, dryRun: true },
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    // Row 2 is valid (1 imported).
    // Row 3 has an unknown pipeline → a per-row pipelineId error.
    // Row 4's negative amount is flagged.
    const fields = json.errors.map((e: { field: string }) => e.field);
    expect(json.imported).toBe(1);
    expect(fields).toContain("pipelineId");
    expect(fields).toContain("amount");
  });

  test("an empty CSV → 400 (the validation rung)", async () => {
    freshStore();
    const res = await importRoute.POST(
      apiReq("POST", "/aria/api/import", {
        cookie: cookieFor("mira@lumen.test"),
        body: { type: "contacts", csv: "", dryRun: true },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("a bad type → 400", async () => {
    freshStore();
    const res = await importRoute.POST(
      apiReq("POST", "/aria/api/import", {
        cookie: cookieFor("mira@lumen.test"),
        body: { type: "accounts", csv: "a,b", dryRun: true },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("403 for a rep's import.run (the matrix's ✗)", async () => {
    freshStore();
    const res = await importRoute.POST(
      apiReq("POST", "/aria/api/import", {
        cookie: cookieFor("ada@lumen.test"),
        body: { type: "contacts", csv: "name,email,title,accountId\nx@x.com", dryRun: true },
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("import.run");
  });

  test("401 with no cookie", async () => {
    freshStore();
    const res = await importRoute.POST(
      apiReq("POST", "/aria/api/import", {
        body: { type: "contacts", csv: "x", dryRun: true },
      }),
    );
    expect(res.status).toBe(401);
  });
});
