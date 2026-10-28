import { describe, expect, test } from "bun:test";
import {
  checkDate,
  checkEmail,
  checkIso,
  checkTraits,
  passwordFloorErrors,
  TAG_MAX,
  validateAcceptInvite,
  validateCreateAccount,
  validateCreateContact,
  validateCreateDeal,
  validateCreateLead,
  validateCreateNote,
  validateCreatePipeline,
  validateCreateSequence,
  validateImport,
  validateInvite,
  validateLogin,
  validateTenantPatch,
  validateUpdateContact,
  validateUpdateDeal,
  validateUpdateLead,
} from "./validation";

describe("shared primitives", () => {
  test("checkEmail: empty → required", () => {
    expect(checkEmail("", "Email")).toEqual(["Email is required."]);
    expect(checkEmail(undefined, "Email")).toEqual(["Email is required."]);
  });

  test("checkEmail: malformed → invalid", () => {
    for (const bad of ["not-an-email", "a@b", "a@b.", "@x.com", "x@.com", "a b@c.com"]) {
      expect(checkEmail(bad, "Email")).toEqual(["Email must be a valid email address."]);
    }
  });

  test("checkEmail: valid emails pass", () => {
    for (const good of ["a@b.co", "user+tag@sub.domain.com", "x_y@z.io"]) {
      expect(checkEmail(good, "Email")).toEqual([]);
    }
  });

  test("checkDate: only YYYY-MM-DD valid dates pass", () => {
    expect(checkDate("2026-10-31", "Close")).toEqual([]);
    for (const bad of ["", "2026-10-31x", "31/10/2026", "2026-13-01", "2026-02-30", "20261031"]) {
      expect(checkDate(bad, "Close").length).toBeGreaterThan(0);
    }
  });

  test("checkIso: valid ISO passes, garbage fails", () => {
    expect(checkIso("2026-10-28T12:00:00Z", "At")).toEqual([]);
    expect(checkIso("not-a-date", "At").length).toBeGreaterThan(0);
    expect(checkIso("", "At")).toEqual(["At is required."]);
  });

  test("checkTraits: rates in 0..1, busySignal boolean", () => {
    expect(checkTraits({ replyRate: 0.5, openRate: 0.9, busySignal: false }, "Traits")).toEqual([]);
    expect(checkTraits({ replyRate: 1.5 }, "Traits")).toEqual(["Traits rates must be in 0..1."]);
    expect(checkTraits({ openRate: -0.1 }, "Traits").length).toBeGreaterThan(0);
    expect(checkTraits({ busySignal: "yes" as never }, "Traits")).toEqual(["Traits.busySignal must be a boolean."]);
  });

  test("passwordFloorErrors: 8+ chars, letter, digit", () => {
    expect(passwordFloorErrors("abcd1234")).toEqual([]);
    expect(passwordFloorErrors("short1")).toEqual(["Password must be at least 8 characters."]);
    expect(passwordFloorErrors("abcdefgh")).toEqual(["Password must contain at least one digit."]);
    expect(passwordFloorErrors("12345678")).toEqual(["Password must contain at least one letter."]);
  });
});

describe("validateLogin", () => {
  test("missing email + password → 2 errors", () => {
    const r = validateLogin({ email: "", password: "" });
    expect(r.errors).toHaveLength(2);
  });

  test("valid login → no errors", () => {
    expect(validateLogin({ email: "a@b.co", password: "x" }).errors).toEqual([]);
  });
});

describe("validateCreateAccount", () => {
  test("all fields required", () => {
    const r = validateCreateAccount({ name: "", domain: "", industry: "", size: 0, ownerId: "" });
    expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });

  test("bad domain rejected", () => {
    const r = validateCreateAccount({ name: "A", domain: "not a domain", industry: "x", size: 5, ownerId: "u1" });
    expect(r.errors.join()).toMatch(/domain/i);
  });

  test("size < 1 rejected", () => {
    const r = validateCreateAccount({ name: "A", domain: "a.co", industry: "x", size: 0, ownerId: "u1" });
    expect(r.errors.join()).toMatch(/size/i);
  });

  test("valid input → no errors", () => {
    const r = validateCreateAccount({ name: "Acme", domain: "acme.com", industry: "SaaS", size: 50, ownerId: "u1" });
    expect(r.errors).toEqual([]);
  });
});

describe("validateCreateContact", () => {
  test("email uniqueness is NOT here (the route's 409) — shape only", () => {
    const r = validateCreateContact({
      accountId: "a1",
      name: "Dana",
      email: "dana@acme.com",
      title: "CTO",
      ownerId: "u1",
    });
    expect(r.errors).toEqual([]);
  });

  test("bad email → error", () => {
    const r = validateCreateContact({ accountId: "a1", name: "D", email: "nope", title: "T", ownerId: "u1" });
    expect(r.errors).toHaveLength(1);
  });

  test("traits out of range → error", () => {
    const r = validateCreateContact({
      accountId: "a1",
      name: "D",
      email: "d@a.com",
      title: "T",
      ownerId: "u1",
      traits: { replyRate: 2 },
    });
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("validateCreateLead", () => {
  test("all four priorities accepted", () => {
    for (const p of ["low", "normal", "high", "urgent"] as const) {
      const r = validateCreateLead({ name: "N", email: "n@a.com", source: "inbound", priority: p, ownerId: "u1" });
      expect(r.errors, p).toEqual([]);
    }
  });

  test("invalid priority rejected", () => {
    const r = validateCreateLead({ name: "N", email: "n@a.com", source: "in", priority: "critical" as never, ownerId: "u1" });
    expect(r.errors.join()).toMatch(/priority/i);
  });

  test("missing source rejected", () => {
    const r = validateCreateLead({ name: "N", email: "n@a.com", source: "", priority: "normal", ownerId: "u1" });
    expect(r.errors.join()).toMatch(/source/i);
  });
});

describe("validateUpdateLead", () => {
  test("valid statuses accepted", () => {
    for (const s of ["new", "working", "nurturing", "unqualified", "qualified", "converted"]) {
      expect(validateUpdateLead({ status: s }).errors).toEqual([]);
    }
  });

  test("invalid status rejected", () => {
    expect(validateUpdateLead({ status: "bogus" }).errors.length).toBeGreaterThan(0);
  });
});

describe("validateCreatePipeline", () => {
  test("empty stages rejected", () => {
    expect(validateCreatePipeline({ name: "P", stages: [] }).errors.length).toBeGreaterThan(0);
  });

  test("probability must be 0..1", () => {
    const r = validateCreatePipeline({ name: "P", stages: [{ name: "S", probability: 1.5, state: "open" }] });
    expect(r.errors.join()).toMatch(/probability/i);
  });

  test("stage states restricted to the three", () => {
    const r = validateCreatePipeline({ name: "P", stages: [{ name: "S", probability: 0.5, state: "weird" }] });
    expect(r.errors.length).toBeGreaterThan(0);
    const ok = validateCreatePipeline({ name: "P", stages: [{ name: "S", probability: 0.5, state: "closed_won" }] });
    expect(ok.errors).toEqual([]);
  });
});

describe("validateCreateDeal", () => {
  test("amount must be a non-negative number", () => {
    expect(validateCreateDeal({ pipelineId: "p", stageId: "s", accountId: "a", contactId: "c", amount: -5, forecastCategory: "commit", ownerId: "u", expectedCloseDate: "2026-11-01" }).errors.length).toBeGreaterThan(0);
  });

  test("forecast category restricted", () => {
    const bad = validateCreateDeal({ pipelineId: "p", stageId: "s", accountId: "a", contactId: "c", amount: 10, forecastCategory: "guessed" as never, ownerId: "u", expectedCloseDate: "2026-11-01" });
    expect(bad.errors.join()).toMatch(/category/i);
  });

  test("close date must be YYYY-MM-DD", () => {
    const bad = validateCreateDeal({ pipelineId: "p", stageId: "s", accountId: "a", contactId: "c", amount: 10, forecastCategory: "commit", ownerId: "u", expectedCloseDate: "next friday" });
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  test("valid deal → no errors", () => {
    const r = validateCreateDeal({ pipelineId: "p1", stageId: "s1", accountId: "a1", contactId: "c1", amount: 10_000, forecastCategory: "commit", ownerId: "u1", expectedCloseDate: "2026-11-01" });
    expect(r.errors).toEqual([]);
  });
});

describe("validateCreateSequence", () => {
  test("empty steps rejected", () => {
    expect(validateCreateSequence({ name: "S", steps: [], traitSeed: 0.5 }).errors.length).toBeGreaterThan(0);
  });

  test("traitSeed must be 0..1", () => {
    expect(validateCreateSequence({ name: "S", steps: [{ id: "s1", type: "email", name: "E", email: { templateId: "t", subject: "x", body: "y" } }], traitSeed: 2 }).errors.join()).toMatch(/trait/i);
  });

  test("duplicate step ids rejected", () => {
    const r = validateCreateSequence({
      name: "S",
      steps: [
        { id: "s1", type: "email", name: "E1", email: { templateId: "t", subject: "x", body: "y" } },
        { id: "s1", type: "wait", name: "W", waitDays: 1 },
      ],
      traitSeed: 0.5,
    });
    expect(r.errors.join()).toMatch(/duplicate/i);
  });

  test("email step requires templateId + subject", () => {
    const r = validateCreateSequence({
      name: "S",
      steps: [{ id: "s1", type: "email", name: "E" }],
      traitSeed: 0.5,
    });
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  test("branch target must reference a declared step id", () => {
    const r = validateCreateSequence({
      name: "S",
      steps: [
        { id: "s1", type: "branch", name: "B", branch: { onEngagement: "replied", targetStepId: "nope" } },
      ],
      traitSeed: 0.5,
    });
    expect(r.errors.join()).toMatch(/targetStepId/);
  });

  test("a valid sequence passes", () => {
    const r = validateCreateSequence({
      name: "S",
      steps: [
        { id: "s1", type: "email", name: "E", email: { templateId: "t", subject: "x", body: "y" } },
        { id: "s2", type: "wait", name: "W", waitDays: 2 },
        { id: "s3", type: "task", name: "T", task: { title: "call", priority: "high" } },
        { id: "s4", type: "branch", name: "B", branch: { onEngagement: "opened", targetStepId: "s1" } },
      ],
      traitSeed: 0.4,
    });
    expect(r.errors).toEqual([]);
  });
});

describe("validateInvite / validateAcceptInvite / validateTenantPatch", () => {
  test("invite: role must be one of the five", () => {
    expect(validateInvite({ email: "a@b.co", role: "chief" as never }).errors.length).toBeGreaterThan(0);
    for (const r of ["owner", "admin", "manager", "rep", "viewer"]) {
      expect(validateInvite({ email: "a@b.co", role: r as never }).errors).toEqual([]);
    }
  });

  test("accept invite: name + password floor", () => {
    expect(validateAcceptInvite({ name: "", password: "x" }).errors.length).toBeGreaterThanOrEqual(2);
    expect(validateAcceptInvite({ name: "New Rep", password: "abcd1234" }).errors).toEqual([]);
  });

  test("tenant patch: plan restricted, quotas non-negative", () => {
    expect(validateTenantPatch({ plan: "platinum" as never }).errors.length).toBeGreaterThan(0);
    expect(validateTenantPatch({ quotas: { u1: -5 } }).errors.length).toBeGreaterThan(0);
    expect(validateTenantPatch({ name: "X", plan: "growth", quotas: { u1: 100 } }).errors).toEqual([]);
  });
});

describe("validateImport", () => {
  test("type restricted to contacts|deals", () => {
    expect(validateImport({ type: "invoices", csv: "a", dryRun: true }).errors.length).toBeGreaterThan(0);
    expect(validateImport({ type: "contacts", csv: "a,b\n1,2", dryRun: true }).errors).toEqual([]);
  });

  test("empty csv rejected", () => {
    expect(validateImport({ type: "deals", csv: "  ", dryRun: false }).errors.length).toBeGreaterThan(0);
  });
});

describe("misc validators", () => {
  test("note: entity type restricted, body capped", () => {
    expect(validateCreateNote({ entityType: "weird" as never, entityId: "x", body: "b" }).errors.length).toBeGreaterThan(0);
    expect(validateCreateNote({ entityType: "deal", entityId: "d1", body: "x".repeat(4001) }).errors.length).toBeGreaterThan(0);
    expect(validateCreateNote({ entityType: "deal", entityId: "d1", body: "ok" }).errors).toEqual([]);
  });

  test("TAG_MAX is 32", () => {
    expect(TAG_MAX).toBe(32);
  });

  test("update deal: category + date checks", () => {
    expect(validateUpdateDeal({ forecastCategory: "nope" as never }).errors.length).toBeGreaterThan(0);
    expect(validateUpdateDeal({ expectedCloseDate: "soon" }).errors.length).toBeGreaterThan(0);
    expect(validateUpdateDeal({ amount: 100 }).errors).toEqual([]);
  });

  test("update contact: email + traits", () => {
    expect(validateUpdateContact({ email: "bad" }).errors.length).toBeGreaterThan(0);
    expect(validateUpdateContact({ traits: { replyRate: 5 } }).errors.length).toBeGreaterThan(0);
    expect(validateUpdateContact({ title: "VP" }).errors).toEqual([]);
  });
});
