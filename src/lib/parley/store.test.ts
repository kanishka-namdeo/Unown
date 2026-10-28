import { describe, expect, test, beforeAll, beforeEach } from "bun:test";
import { now as clockNow, setClock, resetClock } from "./clock";
import { AS_OF } from "./types";
import type { ParleyState } from "./types";
import { seedParley } from "./seed";
import {
  assign,
  auditFeed,
  changeRole,
  createConvo,
  createInvite,
  acceptInvite,
  deleteCanned,
  ForbiddenError,
  getConvo,
  getCustomer,
  getEvents,
  getThread,
  InviteUsedError,
  listConvos,
  listCanned,
  listMembers,
  NoTenantContextError,
  NotFoundError,
  QuotaExceededError,
  removeMember,
  appendMessage,
  resetParley,
  setPriority,
  setStatus,
  setTags,
  upsertCanned,
  sessionActor,
  liveSession,
  getParley,
} from "./store";
import { makeCtx, NoTenantContextError as NCE } from "./tenancy";
import { hashPassword } from "./password";

/*
 * The fail-closed ladder: no-context throws, cross-tenant → null,
 * quota → QuotaExceeded, every mutation emits its audit event
 * (13 assertions — one per mutator, the brief's floor item).
 */

describe("store fail-closed contract", () => {
  beforeEach(() => {
    resetClock();
    resetParley();
  });

  test("no-context repository calls throw NoTenantContextError", () => {
    expect(() => listConvos(null as never)).toThrow(NoTenantContextError);
    expect(() => getConvo(undefined as never, "x")).toThrow(NoTenantContextError);
    expect(() => appendMessage({} as never, "x", "y")).toThrow(NoTenantContextError);
    expect(() =>
      createConvo(null as never, { subject: "s", customerName: "n", customerEmail: "e@x.com" }),
    ).toThrow(NoTenantContextError);
  });

  test("cross-tenant read returns null (never a leak)", () => {
    const lumen = makeCtx("tn-lumen", "usr-mira", "owner");
    // a Northwind conversation, read through a Lumen context → null
    const northwindConvo = getParley().conversations.find((c) => c.tenantId === "tn-northwind")!;
    expect(getConvo(lumen, northwindConvo.id)).toBe(null);
  });

  test("cross-tenant mutation returns null", () => {
    const lumen = makeCtx("tn-lumen", "usr-mira", "owner");
    const northwindConvo = getParley().conversations.find((c) => c.tenantId === "tn-northwind")!;
    expect(setStatus(lumen, northwindConvo.id, "closed")).toBe(null);
    expect(assign(lumen, northwindConvo.id, "usr-ada")).toBe(null);
    expect(setTags(lumen, northwindConvo.id, ["x"])).toBe(null);
    expect(appendMessage(lumen, northwindConvo.id, "hi")).toBe(null);
  });
});

describe("store quota gate", () => {
  beforeEach(() => {
    resetClock();
    resetParley();
  });

  test("Northwind at cap (47/50) → canCreate still true; pushing past cap throws", () => {
    const north = makeCtx("tn-northwind", "usr-ingrid", "owner");
    // Northwind is at 47/50 at AS_OF — canCreate is true (47 < 50)
    // Push it to 50/50 by creating 3 more → the 4th throws
    for (let i = 0; i < 3; i++) {
      createConvo(north, {
        subject: `Top-up ${i}`,
        customerName: "Test",
        customerEmail: `test-${i}@x.com`,
      });
    }
    // now at 50/50 — the next create throws
    expect(() =>
      createConvo(north, {
        subject: "Over the cap",
        customerName: "Test",
        customerEmail: "over@x.com",
      }),
    ).toThrow(QuotaExceededError);
  });
});

describe("store reset determinism", () => {
  test("two resets → deep-equal states", () => {
    resetClock();
    const a = resetParley();
    const b = resetParley();
    // strip the live demo sessions (they carry counter-suffixed ids)
    // and compare the seeded rows
    const strip = (s: ParleyState) => ({ ...s, sessions: [], audit: s.audit.filter((e) => e.id.startsWith("aud-seed")) });
    expect(strip(a.state)).toEqual(strip(b.state));
  });
});

describe("every mutation emits its audit event (13 mutators)", () => {
  function seedFresh() {
    setClock(AS_OF);
    resetParley();
  }

  test("appendMessage → audit action conversation.reply", () => {
    seedFresh();
    const ctx = makeCtx("tn-lumen", "usr-ada", "agent");
    const convo = getParley().conversations.find((c) => c.id === "cnv-seed-01")!;
    const msg = appendMessage(ctx, convo.id, "We're on it.")!;
    const feed = auditFeed(ctx, "conversation.reply");
    expect(feed[0].entityId).toBe(msg.id);
  });

  test("assign → audit action conversation.assign", () => {
    seedFresh();
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const convo = getParley().conversations.find((c) => c.id === "cnv-seed-03")!;
    const updated = assign(ctx, convo.id, "usr-ada")!;
    expect(updated.assigneeId).toBe("usr-ada");
    expect(auditFeed(ctx, "conversation.assign")[0].entityId).toBe(convo.id);
  });

  test("setStatus → audit action conversation.status", () => {
    seedFresh();
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const convo = getParley().conversations.find((c) => c.id === "cnv-seed-03")!;
    setStatus(ctx, convo.id, "pending");
    expect(auditFeed(ctx, "conversation.status")[0].entityId).toBe(convo.id);
  });

  test("setPriority → audit action conversation.priority", () => {
    seedFresh();
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const convo = getParley().conversations.find((c) => c.id === "cnv-seed-03")!;
    setPriority(ctx, convo.id, "high");
    expect(auditFeed(ctx, "conversation.priority")[0].entityId).toBe(convo.id);
  });

  test("setTags → audit action conversation.tags", () => {
    seedFresh();
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const convo = getParley().conversations.find((c) => c.id === "cnv-seed-03")!;
    setTags(ctx, convo.id, ["firmware"]);
    expect(auditFeed(ctx, "conversation.tags")[0].entityId).toBe(convo.id);
  });

  test("createConvo → audit action conversation.create", () => {
    seedFresh();
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const c = createConvo(ctx, { subject: "New", customerName: "J", customerEmail: "j@x.com" });
    expect(auditFeed(ctx, "conversation.create")[0].entityId).toBe(c.id);
  });

  test("createInvite → audit action invite.create", () => {
    seedFresh();
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const inv = createInvite(ctx, "new@example.com", "agent");
    expect(auditFeed(ctx, "invite.create")[0].entityId).toBe(inv.id);
  });

  test("acceptInvite → audit action invite.accept", () => {
    seedFresh();
    const s = getParley();
    const pendingInvite = s.invites.find((i) => i.usedAt === null)!;
    const { user, membership } = acceptInvite(pendingInvite.token, "Casey", "Str0ngPass9");
    const ctx = makeCtx(pendingInvite.tenantId, user.id, membership.role);
    const feed = auditFeed(ctx, "invite.accept");
    expect(feed[0].entityId).toBe(membership.id);
  });

  test("changeRole → audit action member.role_change", () => {
    seedFresh();
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const target = getParley().memberships.find((m) => m.id === "mem-theo")!;
    changeRole(ctx, target.id, "agent");
    expect(auditFeed(ctx, "member.role_change")[0].entityId).toBe(target.id);
  });

  test("removeMember → audit action member.remove", () => {
    seedFresh();
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const target = getParley().memberships.find((m) => m.id === "mem-sam")!;
    removeMember(ctx, target.id);
    expect(auditFeed(ctx, "member.remove")[0].entityId).toBe(target.id);
  });

  test("upsertCanned (create) → audit action canned.create", () => {
    seedFresh();
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const c = upsertCanned(ctx, { title: "New", body: "Body" });
    expect(auditFeed(ctx, "canned.create")[0].entityId).toBe(c.id);
  });

  test("upsertCanned (update) → audit action canned.update", () => {
    seedFresh();
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const existing = getParley().canned.find((c) => c.tenantId === "tn-lumen")!;
    upsertCanned(ctx, { id: existing.id, title: "Updated", body: "B" });
    expect(auditFeed(ctx, "canned.update")[0].entityId).toBe(existing.id);
  });

  test("deleteCanned → audit action canned.delete", () => {
    seedFresh();
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const target = getParley().canned.find((c) => c.tenantId === "tn-lumen")!;
    deleteCanned(ctx, target.id);
    expect(auditFeed(ctx, "canned.delete")[0].entityId).toBe(target.id);
  });
});

describe("invite accept ladder", () => {
  beforeEach(() => {
    setClock(AS_OF);
    resetParley();
  });

  test("unknown token → NotFoundError", () => {
    expect(() => acceptInvite("tok-nonexistent-000001", "X", "Pass1234")).toThrow(NotFoundError);
  });

  test("used token → InviteUsedError('used')", () => {
    const s = getParley();
    const pending = s.invites.find((i) => i.usedAt === null)!;
    acceptInvite(pending.token, "First", "Pass12345");
    expect(() => acceptInvite(pending.token, "Second", "Pass12345")).toThrow(InviteUsedError);
  });

  test("accept creates a real user (a real passwordHash from the submitted password)", () => {
    const s = getParley();
    const pending = s.invites.find((i) => i.usedAt === null)!;
    const { user, membership } = acceptInvite(pending.token, "Casey", "CaseyPass1");
    expect(user.email).toBe(pending.email);
    expect(membership.role).toBe(pending.role);
    // the new user's hash is NOT the demo hash
    const demoHash = hashPassword("parley-demo-1", user.salt).hash;
    expect(user.passwordHash).not.toBe(demoHash);
  });
});

describe("auditFeed ordering", () => {
  test("newest first (the feed's ordering)", () => {
    setClock(AS_OF);
    resetParley();
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const feed = auditFeed(ctx);
    for (let i = 0; i < feed.length - 1; i++) {
      expect(new Date(feed[i].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(feed[i + 1].createdAt).getTime(),
      );
    }
  });

  test("action filter narrows the feed", () => {
    setClock(AS_OF);
    resetParley();
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const all = auditFeed(ctx);
    const onlyAssign = auditFeed(ctx, "conversation.assign");
    expect(onlyAssign.length).toBeLessThanOrEqual(all.length);
    for (const e of onlyAssign) expect(e.action).toBe("conversation.assign");
  });
});

describe("listConvos filters", () => {
  beforeEach(() => {
    setClock(AS_OF);
    resetParley();
  });

  test("the unassigned filter returns only null-assignee convos", () => {
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const out = listConvos(ctx, { filter: "unassigned" });
    for (const c of out) expect(c.assigneeId).toBe(null);
  });

  test("the q filter is a free-text subject search", () => {
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const out = listConvos(ctx, { q: "bluetooth" });
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) expect(c.subject.toLowerCase()).toContain("bluetooth");
  });

  test("cross-tenant isolation: a Lumen context never sees Northwind rows", () => {
    const ctx = makeCtx("tn-lumen", "usr-mira", "owner");
    const out = listConvos(ctx, { filter: "all" });
    for (const c of out) expect(c.tenantId).toBe("tn-lumen");
  });
});
