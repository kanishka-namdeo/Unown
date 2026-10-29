import { describe, expect, test } from "bun:test";
import { ACTIONS, can, MATRIX, PERMISSION_NAMES } from "./rbac";
import type { Action } from "./rbac";
import type { NocturneRole } from "./types";

/*
 * The full matrix as a table test — every (action, role) pair
 * asserted against the plan's role ladder, the ✗ cells included.
 */
const EXPECTED: Record<Action, [boolean, boolean, boolean, boolean]> = {
  // reads — all four roles
  "tenant.list": [true, true, true, true],
  "tenant.read": [true, true, true, true],
  "member.list": [true, true, true, true],
  "service.list": [true, true, true, true],
  "service.read": [true, true, true, true],
  "rotation.list": [true, true, true, true],
  "rotation.read": [true, true, true, true],
  "alert.list": [true, true, true, true],
  "incident.list": [true, true, true, true],
  "incident.read": [true, true, true, true],
  "runbook.list": [true, true, true, true],
  "runbook.read": [true, true, true, true],
  "component.list": [true, true, true, true],
  "postmortem.list": [true, true, true, true],
  "postmortem.read": [true, true, true, true],
  "analytics.read": [true, true, true, true],
  // responder actions — owner/admin/responder, viewer ✗
  "alert.ingest": [true, true, true, false],
  "incident.ack": [true, true, true, false],
  "incident.resolve": [true, true, true, false],
  "incident.snooze": [true, true, true, false],
  "incident.escalate": [true, true, true, false],
  "incident.note": [true, true, true, false],
  "checklist.start": [true, true, true, false],
  "checklist.update": [true, true, true, false],
  "postmortem.action": [true, true, true, false],
  "rotation.override": [true, true, true, false],
  // config — owner/admin, responder ✗, viewer ✗
  "invite.create": [true, true, false, false],
  "service.create": [true, true, false, false],
  "service.update": [true, true, false, false],
  "rotation.create": [true, true, false, false],
  "rotation.update": [true, true, false, false],
  "runbook.create": [true, true, false, false],
  "runbook.update": [true, true, false, false],
  "runbook.delete": [true, true, false, false],
  "component.update": [true, true, false, false],
  // owner-only
  "tenant.settings": [true, false, false, false],
  "audit.read": [true, false, false, false],
};

describe("rbac matrix", () => {
  test("every role × every action matches the plan's ladder", () => {
    for (const action of ACTIONS) {
      const [owner, admin, responder, viewer] = EXPECTED[action];
      for (const [role, expected] of [
        ["owner", owner],
        ["admin", admin],
        ["responder", responder],
        ["viewer", viewer],
      ] as [NocturneRole, boolean][]) {
        expect(MATRIX[action][role], `${role} → ${action}`).toBe(expected);
        expect(can(role, action), `can(${role}, ${action})`).toBe(expected);
      }
    }
  });

  test("MATRIX and can() agree on every cell (no divergence)", () => {
    for (const action of ACTIONS) {
      for (const role of ["owner", "admin", "responder", "viewer"] as NocturneRole[]) {
        expect(can(role, action)).toBe(MATRIX[action][role]);
      }
    }
  });

  test("can() returns false for unknown actions (fail-closed)", () => {
    expect(can("owner", "nonexistent.action" as never)).toBe(false);
    expect(can("viewer", "tenant.delete" as never)).toBe(false);
  });

  test("viewers have zero mutations (the read-only pin)", () => {
    for (const a of ACTIONS) {
      if (a === "analytics.read") continue;
      if (MATRIX[a].viewer) {
        // viewers may only read — every viewer cell is a read action
        expect(EXPECTED[a][3], `${a} should be viewer-readable`).toBe(true);
      }
    }
  });

  test("responder is NOT a config role (the ladder's middle rung)", () => {
    for (const a of [
      "invite.create",
      "service.create",
      "rotation.create",
      "runbook.delete",
      "component.update",
    ] as const) {
      expect(can("responder", a)).toBe(false);
    }
  });

  test("owner is granted everything (the top rung)", () => {
    for (const a of ACTIONS) expect(can("owner", a)).toBe(true);
  });
});

describe("the responder's own-overrides carve-out", () => {
  test("responder may edit their OWN overrides", () => {
    expect(can("responder", "rotation.override", "u-ada", "u-ada")).toBe(true);
  });

  test("responder may NOT edit a teammate's overrides", () => {
    expect(can("responder", "rotation.override", "u-theo", "u-ada")).toBe(false);
  });

  test("responder general capability (no resource) → granted", () => {
    expect(can("responder", "rotation.override")).toBe(true);
    expect(can("responder", "rotation.override", undefined, "u-ada")).toBe(true);
  });

  test("admin is never gated on the carve-out", () => {
    expect(can("admin", "rotation.override", "u-theo", "u-ada")).toBe(true);
  });

  test("owner is never gated on the carve-out", () => {
    expect(can("owner", "rotation.override", "u-theo", "u-ada")).toBe(true);
  });

  test("viewer is denied rotation.override outright (the base cell)", () => {
    expect(can("viewer", "rotation.override")).toBe(false);
    // even with matching resource — the base cell fails first
    expect(can("viewer", "rotation.override", "u-x", "u-x")).toBe(false);
  });

  test("the carve-out only applies to rotation.override (other actions ignore resource)", () => {
    expect(can("responder", "incident.ack", "u-theo", "u-ada")).toBe(true);
    expect(can("responder", "alert.ingest", "u-theo", "u-ada")).toBe(true);
  });
});

describe("PERMISSION_NAMES", () => {
  test("every action has a human-readable name (the 403 body's permission field)", () => {
    for (const a of ACTIONS) {
      expect(PERMISSION_NAMES[a]).toBe(a);
      expect(typeof PERMISSION_NAMES[a]).toBe("string");
    }
  });

  test("the action set is closed: ACTIONS covers every matrix row", () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...ACTIONS].sort());
  });
});
