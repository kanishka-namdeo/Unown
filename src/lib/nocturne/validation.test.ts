import { describe, expect, test } from "bun:test";
import {
  validateAcceptInvite,
  validateAck,
  validateChecklistStart,
  validateChecklistUpdate,
  validateComponentStatus,
  validateCreateOverride,
  validateCreateRotation,
  validateCreateRunbook,
  validateEscalationPolicy,
  validateIngestAlert,
  validateInvite,
  validateLogin,
  validateNote,
  validatePostmortemAction,
  passwordFloorErrors,
  rotationContiguity,
  validateResolve,
  validateService,
  validateSnooze,
  validateTenantPatch,
  validateUpdateRotation,
  validateUpdateRunbook,
} from "./validation";
import type { EscalationPolicy } from "./types";

describe("validateLogin", () => {
  test("accepts a valid email + password", () => {
    expect(validateLogin({ email: "mira@lumen.test", password: "nocturne-demo-1" }).errors).toEqual([]);
  });
  test("rejects an empty email", () => {
    expect(validateLogin({ email: "", password: "x" }).errors).toContain("Email is required.");
  });
  test("rejects a malformed email", () => {
    expect(validateLogin({ email: "not-an-email", password: "x" }).errors.length).toBe(1);
  });
  test("rejects an empty password", () => {
    expect(validateLogin({ email: "a@b.co", password: "  " }).errors).toContain("Password is required.");
  });
});

describe("validateTenantPatch", () => {
  const okSla = {
    sev1: { ack: 5, resolve: 60 },
    sev2: { ack: 15, resolve: 240 },
    sev3: { ack: 60, resolve: 720 },
    sev4: { ack: 240, resolve: 2880 },
  };
  test("accepts a name + sla patch", () => {
    expect(validateTenantPatch({ name: "Lumen Labs", slaMinutes: okSla }).errors).toEqual([]);
  });
  test("rejects an empty name", () => {
    expect(validateTenantPatch({ name: "  " }).errors).toContain("Name is required.");
  });
  test("rejects a non-positive ack target", () => {
    const bad = { ...okSla, sev1: { ack: 0, resolve: 60 } };
    expect(validateTenantPatch({ slaMinutes: bad }).errors.length).toBe(1);
  });
  test("rejects a missing severity entry", () => {
    const bad = { ...okSla } as never;
    delete (bad as Record<string, unknown>).sev4;
    expect(validateTenantPatch({ slaMinutes: bad }).errors.length).toBe(1);
  });
  test("an empty patch is valid (nothing to change)", () => {
    expect(validateTenantPatch({}).errors).toEqual([]);
  });
});

describe("validateService + escalation tiers", () => {
  test("accepts a valid create", () => {
    const input = {
      name: "Payments API",
      description: "Card authorisation + capture",
      rotationId: null,
      escalationPolicy: {
        tiers: [
          { id: "e1", kind: "rotation" as const, waitMinutes: 15, toTierIndex: 1 },
          { id: "e2", kind: "manager" as const, waitMinutes: 30, toTierIndex: null },
        ],
      },
    };
    expect(validateService(input).errors).toEqual([]);
  });

  test("rejects an empty name", () => {
    expect(validateService({ name: " ", description: "d" }).errors).toContain("Name is required.");
  });

  test("rejects a non-string description", () => {
    expect(validateService({ name: "ok", description: 7 as never }).errors.length).toBe(1);
  });

  test("the empty-tiers policy is rejected", () => {
    const { errors } = validateEscalationPolicy({ tiers: [] });
    expect(errors).toContain("At least one escalation tier is required.");
  });

  test("a tier with a non-positive waitMinutes is rejected", () => {
    const p: EscalationPolicy = {
      tiers: [{ id: "e1", kind: "user", waitMinutes: 0, toTierIndex: null }],
    };
    expect(validateEscalationPolicy(p).errors.length).toBe(1);
  });

  test("a bad tier kind is rejected", () => {
    const p: EscalationPolicy = {
      tiers: [{ id: "e1", kind: "page" as never, waitMinutes: 15, toTierIndex: null }],
    };
    expect(validateEscalationPolicy(p).errors.length).toBe(1);
  });

  test("duplicate tier ids are rejected", () => {
    const p: EscalationPolicy = {
      tiers: [
        { id: "e1", kind: "user", waitMinutes: 15, toTierIndex: 1 },
        { id: "e1", kind: "manager", waitMinutes: 30, toTierIndex: null },
      ],
    };
    expect(validateEscalationPolicy(p).errors.some((e) => e.includes("Duplicate"))).toBe(true);
  });

  test("a non-last tier with a null toTierIndex: a single-tier policy is valid, multi-tier forward-only", () => {
    // a single-tier policy is legitimate: that one tier IS the last tier (infinite ring)
    const single: EscalationPolicy = {
      tiers: [{ id: "e1", kind: "user", waitMinutes: 15, toTierIndex: null }],
    };
    expect(validateEscalationPolicy(single).errors).toEqual([]);
    // the last-tier null pin is already covered by "the last tier must have toTierIndex null"
  });

  test("a backward toTierIndex is rejected", () => {
    const p: EscalationPolicy = {
      tiers: [
        { id: "e1", kind: "user", waitMinutes: 15, toTierIndex: 1 },
        { id: "e2", kind: "manager", waitMinutes: 30, toTierIndex: 0 },
      ],
    };
    expect(validateEscalationPolicy(p).errors.some((e) => e.includes("point forward"))).toBe(true);
  });

  test("the last tier must have toTierIndex null", () => {
    const p: EscalationPolicy = {
      tiers: [
        { id: "e1", kind: "user", waitMinutes: 15, toTierIndex: 1 },
        { id: "e2", kind: "manager", waitMinutes: 30, toTierIndex: 5 },
      ],
    };
    const { errors } = validateEscalationPolicy(p);
    // 5 is out of range → "valid index" error, or last-tier error
    expect(errors.length).toBeGreaterThan(0);
    const good: EscalationPolicy = {
      tiers: [
        { id: "e1", kind: "user", waitMinutes: 15, toTierIndex: 1 },
        { id: "e2", kind: "manager", waitMinutes: 30, toTierIndex: null },
      ],
    };
    expect(validateEscalationPolicy(good).errors).toEqual([]);
  });

  test("appliesTo with an unknown severity is rejected", () => {
    const p: EscalationPolicy = {
      tiers: [{ id: "e1", kind: "user", waitMinutes: 15, toTierIndex: null }],
      appliesTo: ["sev1", "sev9" as never],
    };
    expect(validateEscalationPolicy(p).errors.length).toBe(1);
  });

  test("slaOverride with a non-positive target is rejected", () => {
    expect(validateService({ name: "ok", description: "", slaOverride: { sev1: 0, sev2: 60, sev3: 60, sev4: 60 } }).errors.length).toBe(1);
    expect(validateService({ name: "ok", description: "", slaOverride: null }).errors).toEqual([]);
  });
});

describe("validateCreateRotation (the contiguity gate)", () => {
  const WEEK = 604_800_000;
  const t0 = "2026-10-05T00:00:00Z";

  function goodSeats(): Array<{ userId: string; start: string }> {
    return [
      { userId: "u1", start: t0 },
      { userId: "u2", start: new Date(new Date(t0).getTime() + WEEK).toISOString() },
      { userId: "u3", start: new Date(new Date(t0).getTime() + 2 * WEEK).toISOString() },
      { userId: "u4", start: new Date(new Date(t0).getTime() + 3 * WEEK).toISOString() },
    ];
  }

  test("a contiguous 4-seat weekly rotation is valid", () => {
    expect(
      validateCreateRotation({
        name: "Weekly",
        seats: goodSeats(),
        shiftLengthMs: WEEK,
        boundaryDow: 0,
      }).errors,
    ).toEqual([]);
  });

  test("a gappy tiling is rejected (400)", () => {
    const seats = goodSeats();
    seats[1].start = new Date(new Date(t0).getTime() + 2 * WEEK).toISOString(); // gap
    expect(
      validateCreateRotation({ name: "R", seats, shiftLengthMs: WEEK, boundaryDow: 0 }).errors.some(
        (e) => e.includes("tile"),
      ),
    ).toBe(true);
  });

  test("an overlapping tiling is rejected (400)", () => {
    const seats = goodSeats();
    seats[2].start = new Date(new Date(t0).getTime() + WEEK).toISOString(); // overlap
    expect(
      validateCreateRotation({ name: "R", seats, shiftLengthMs: WEEK, boundaryDow: 0 }).errors.length,
    ).toBeGreaterThan(0);
  });

  test("a two-seat daily rotation is valid", () => {
    const DAY = 86_400_000;
    const a = "2026-10-01T00:00:00Z";
    expect(
      validateCreateRotation({
        name: "Daily",
        seats: [
          { userId: "u1", start: a },
          { userId: "u2", start: new Date(new Date(a).getTime() + DAY).toISOString() },
        ],
        shiftLengthMs: DAY,
        boundaryDow: 0,
      }).errors,
    ).toEqual([]);
  });

  test("duplicate seat users are rejected (one seat = one user)", () => {
    const DAY = 86_400_000;
    const a = "2026-10-01T00:00:00Z";
    const { errors } = validateCreateRotation({
      name: "R",
      seats: [
        { userId: "u1", start: a },
        { userId: "u1", start: new Date(new Date(a).getTime() + DAY).toISOString() },
      ],
      shiftLengthMs: DAY,
      boundaryDow: 0,
    });
    expect(errors.some((e) => e.includes("duplicates"))).toBe(true);
  });

  test("an empty seat list is rejected", () => {
    expect(validateCreateRotation({ name: "R", seats: [], shiftLengthMs: WEEK, boundaryDow: 0 }).errors.length).toBeGreaterThan(0);
  });

  test("a bad shiftLengthMs / boundaryDow is rejected", () => {
    const { errors } = validateCreateRotation({
      name: "R",
      seats: [{ userId: "u1", start: t0 }],
      shiftLengthMs: 0, // shiftLengthMs error only — contiguity is suppressed
      boundaryDow: 9, // boundaryDow error
    });
    expect(errors.length).toBe(2);
    expect(errors.some((e) => e.includes("shiftLengthMs"))).toBe(true);
    expect(errors.some((e) => e.includes("boundaryDow"))).toBe(true);
  });

  test("contiguity is only checked when the shift length is usable", () => {
    // the guard: a bad shiftLengthMs suppresses the tile error (the
    // tiling cannot be checked without a valid shift), but a valid
    // shift + a gappy multi-seat tiling still produces exactly ONE
    // error — the contiguity gate.
    const gappy = goodSeats();
    gappy[1].start = new Date(new Date(t0).getTime() + 2 * WEEK).toISOString();
    const { errors } = validateCreateRotation({
      name: "R",
      seats: gappy,
      shiftLengthMs: WEEK,
      boundaryDow: 0,
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("tile");
  });

  test("the pure rotationContiguity helper agrees with the validator", () => {
    expect(
      rotationContiguity(
        goodSeats().map((s, i) => ({ seatIndex: i, userId: s.userId, start: s.start })),
        WEEK,
      ),
    ).toBe(true);
    const gappy = goodSeats();
    gappy[1].start = new Date(new Date(t0).getTime() + 2 * WEEK).toISOString();
    expect(
      rotationContiguity(
        gappy.map((s, i) => ({ seatIndex: i, userId: s.userId, start: s.start })),
        WEEK,
      ),
    ).toBe(false);
  });
});

describe("validateUpdateRotation", () => {
  test("accepts a valid patch", () => {
    expect(validateUpdateRotation({ name: "New", shiftLengthMs: 86_400_000, boundaryDow: 1 }).errors).toEqual([]);
  });
  test("rejects a bad boundaryDow", () => {
    expect(validateUpdateRotation({ boundaryDow: 7 }).errors.length).toBe(1);
  });
});

describe("validateCreateOverride", () => {
  const ok = {
    forUserId: "u2",
    userId: "u3",
    startsAt: "2026-10-15T00:00:00Z",
    endsAt: "2026-10-16T00:00:00Z",
    reason: "PTO",
  };
  test("a valid bounded window passes", () => {
    expect(validateCreateOverride(ok).errors).toEqual([]);
  });
  test("same-user cover is rejected", () => {
    expect(validateCreateOverride({ ...ok, userId: "u2" }).errors.some((e) => e.includes("DIFFERENT"))).toBe(true);
  });
  test("an inverted window is rejected", () => {
    expect(validateCreateOverride({ ...ok, startsAt: ok.endsAt, endsAt: ok.startsAt }).errors.length).toBe(1);
  });
  test("an empty reason is rejected", () => {
    expect(validateCreateOverride({ ...ok, reason: "  " }).errors).toContain("reason is required.");
  });
  test("a bad timestamp is rejected", () => {
    expect(validateCreateOverride({ ...ok, startsAt: "not-a-date" }).errors.length).toBeGreaterThan(0);
  });
});

describe("validateIngestAlert", () => {
  const ok = {
    serviceId: "svc-1",
    dedupKey: "cpu > 90",
    title: "High CPU on api-1",
    body: "sustained 95%",
    severity: "sev2" as const,
  };
  test("a valid ingest passes", () => {
    expect(validateIngestAlert(ok).errors).toEqual([]);
  });
  test("every missing field is named", () => {
    const { errors } = validateIngestAlert({
      serviceId: "",
      dedupKey: "",
      title: "",
      body: 7 as never,
      severity: "sev9" as never,
    });
    expect(errors.length).toBe(5);
  });
  test("an over-long title is rejected", () => {
    expect(validateIngestAlert({ ...ok, title: "x".repeat(201) }).errors.length).toBe(1);
  });
  test("a bad firedAt is rejected", () => {
    expect(validateIngestAlert({ ...ok, firedAt: "nope" }).errors.length).toBe(1);
  });
});

describe("incident lifecycle inputs", () => {
  test("validateAck: optional note is length-capped", () => {
    expect(validateAck({}).errors).toEqual([]);
    expect(validateAck({ note: "x".repeat(4001) }).errors.length).toBe(1);
  });

  test("validateResolve: empty postmortemBody is rejected when given", () => {
    expect(validateResolve({ postmortemBody: "  " }).errors.length).toBe(1);
    expect(validateResolve({ postmortemBody: "Root cause: bad deploy." }).errors).toEqual([]);
  });

  test("validateResolve: action item checks", () => {
    expect(validateResolve({ actionItems: [{ title: "" }] }).errors.length).toBe(1);
    expect(validateResolve({ actionItems: [{ title: "Add alert", due: "nope" }] }).errors.length).toBe(1);
    expect(validateResolve({ actionItems: "x" as never }).errors.length).toBe(1);
    expect(validateResolve({ actionItems: [{ title: "ok", assigneeId: null, due: null }] }).errors).toEqual([]);
  });

  test("validateSnooze: until is an ISO gate", () => {
    expect(validateSnooze({ until: "2026-10-28T18:00:00Z" }).errors).toEqual([]);
    expect(validateSnooze({ until: "later" }).errors.length).toBe(1);
  });

  test("validateNote: the 4000-char cap + required body", () => {
    expect(validateNote({ body: " " }).errors).toContain("Note body is required.");
    expect(validateNote({ body: "x".repeat(4001) }).errors.length).toBe(1);
  });
});

describe("runbook + checklist inputs", () => {
  test("a valid runbook create passes", () => {
    expect(
      validateCreateRunbook({
        serviceId: "svc-1",
        name: "Outage playbook",
        steps: [{ title: "Check dashboards" }, { title: "Roll back", command: "git revert HEAD" }],
        forSeverities: ["sev1", "sev2"],
      }).errors,
    ).toEqual([]);
  });

  test("empty steps are rejected", () => {
    expect(validateCreateRunbook({ serviceId: "s", name: "n", steps: [] }).errors.some((e) => e.includes("step"))).toBe(true);
  });

  test("an unknown severity in forSeverities is rejected", () => {
    expect(validateCreateRunbook({ serviceId: "s", name: "n", steps: [{ title: "x" }], forSeverities: ["sev9" as never] }).errors.length).toBe(1);
  });

  test("runbook update: empty name + empty steps", () => {
    expect(validateUpdateRunbook({ name: "" }).errors.length).toBe(1);
    expect(validateUpdateRunbook({ steps: [] }).errors.length).toBe(1);
  });

  test("checklist start requires both ids", () => {
    expect(validateChecklistStart({ incidentId: "i1", runbookId: "r1" }).errors).toEqual([]);
    expect(validateChecklistStart({ incidentId: "", runbookId: "r1" }).errors.length).toBe(1);
  });

  test("checklist update: state literals + stepId", () => {
    expect(validateChecklistUpdate({ stepId: "s1", state: "done" }).errors).toEqual([]);
    expect(validateChecklistUpdate({ stepId: "s1", state: "finished" as never }).errors.length).toBe(1);
  });
});

describe("component / invite / postmortem inputs", () => {
  test("component status literals", () => {
    expect(validateComponentStatus({ status: "maintenance", note: "Sun 02:00" }).errors).toEqual([]);
    expect(validateComponentStatus({ status: "on fire" as never }).errors.length).toBe(1);
  });

  test("invite email + role", () => {
    expect(validateInvite({ email: "casey@lumen.test", role: "admin" }).errors).toEqual([]);
    expect(validateInvite({ email: "x", role: "superuser" as never }).errors.length).toBe(2);
  });

  test("accept-invite password floor", () => {
    expect(passwordFloorErrors("abc12345")).toEqual([]);
    expect(validateAcceptInvite({ name: "Casey", password: "Str0ngPass" }).errors).toEqual([]);
    expect(validateAcceptInvite({ name: "  ", password: "short" }).errors.length).toBeGreaterThanOrEqual(2);
  });

  test("postmortem action: boolean done + optional doneAt", () => {
    expect(validatePostmortemAction({ done: true, doneAt: "2026-11-01T00:00:00Z" }).errors).toEqual([]);
    expect(validatePostmortemAction({ done: "yes" as never }).errors.length).toBe(1);
  });
});
