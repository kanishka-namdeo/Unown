import { describe, expect, test } from "bun:test";
import { ACTIONS, can, MATRIX, PERMISSION_NAMES } from "./rbac";
import type { Action } from "./rbac";
import type { Role } from "./types";
import { ROLES } from "./types";

/**
 * The full matrix as a parametrized table test — every role × every
 * action, asserted against the brief's literal matrix row-by-row
 * (the ✗ cells included: a cell that should be denied IS asserted
 * denied, not just the ✓ cells).
 */

// The brief's literal matrix (owner/admin/agent/viewer ✓/✗)
const BRIEF_MATRIX: Record<Action, [boolean, boolean, boolean, boolean]> = {
  "conversation.list": [true, true, true, true],
  "conversation.read": [true, true, true, true],
  "conversation.reply": [true, true, true, false],
  "conversation.assign": [true, true, true, false],
  "conversation.status": [true, true, true, false],
  "conversation.priority": [true, true, true, false],
  "conversation.tags": [true, true, true, false],
  "canned.manage": [true, true, false, false],
  "canned.read": [true, true, true, false],
  "invite.create": [true, true, false, false],
  "invite.role_change": [true, true, false, false],
  "member.list": [true, true, true, true],
  "audit.read": [true, true, false, false],
  "usage.read": [true, true, false, true],
  "analytics.read": [true, true, false, true],
  "tenant.settings": [true, false, false, false],
  "plan.change": [true, false, false, false],
  "tenant.delete": [true, false, false, false],
};

describe("rbac matrix", () => {
  test("every role × every action matches the brief's literal matrix", () => {
    for (const action of ACTIONS) {
      const [owner, admin, agent, viewer] = BRIEF_MATRIX[action];
      for (const [role, expected] of [
        ["owner", owner],
        ["admin", admin],
        ["agent", agent],
        ["viewer", viewer],
      ] as [Role, boolean][]) {
        expect(MATRIX[action][role], `${role} → ${action}`).toBe(expected);
        expect(can(role, action), `can(${role}, ${action})`).toBe(expected);
      }
    }
  });

  test("MATRIX and can() agree on every cell (no divergence)", () => {
    for (const action of ACTIONS) {
      for (const role of ROLES) {
        expect(can(role, action)).toBe(MATRIX[action][role]);
      }
    }
  });

  test("can() returns false for unknown actions (fail-closed)", () => {
    expect(can("owner", "nonexistent.action" as Action)).toBe(false);
  });
});

describe("owner-seat carve-out", () => {
  const OWNER_MEM = "mem-owner";

  test("admin denied invite.create targeting the owner seat", () => {
    expect(can("admin", "invite.create", OWNER_MEM, OWNER_MEM)).toBe(false);
  });

  test("admin denied invite.role_change targeting the owner seat", () => {
    expect(can("admin", "invite.role_change", OWNER_MEM, OWNER_MEM)).toBe(false);
  });

  test("admin allowed invite.create targeting a non-owner seat", () => {
    expect(can("admin", "invite.create", "mem-theo", OWNER_MEM)).toBe(true);
  });

  test("admin allowed with no resource (general capability check)", () => {
    expect(can("admin", "invite.create", undefined, OWNER_MEM)).toBe(true);
  });

  test("owner is never gated on the owner seat (owner can always)", () => {
    expect(can("owner", "invite.create", OWNER_MEM, OWNER_MEM)).toBe(true);
    expect(can("owner", "invite.role_change", OWNER_MEM, OWNER_MEM)).toBe(true);
  });
});

describe("PERMISSION_NAMES", () => {
  test("every action has a human-readable name", () => {
    for (const a of ACTIONS) {
      expect(PERMISSION_NAMES[a]).toBe(a); // the name is the action string
      expect(typeof PERMISSION_NAMES[a]).toBe("string");
    }
  });
});
