import { describe, expect, test } from "bun:test";
import { ACTIONS, can, MATRIX, PERMISSION_NAMES } from "./rbac";
import type { AriaRole } from "./types";
import { ARIA_ROLES } from "./types";

/**
 * The full matrix as a parametrized table test — every role × every
 * action, asserted row-by-row (the denied cells included: a cell
 * that should be denied IS asserted denied, not just the ✓ cells).
 *
 * Role order for the tuples: owner, admin, manager, rep, viewer.
 */
const BRIEF_MATRIX: Record<string, [boolean, boolean, boolean, boolean, boolean]> = {
  "tenant.list": [true, true, true, true, true],
  "tenant.read": [true, true, true, true, true],
  "tenant.settings": [true, false, false, false, false],
  "member.list": [true, true, true, true, true],
  "invite.create": [true, true, false, false, false],
  "account.list": [true, true, true, true, true],
  "account.read": [true, true, true, true, true],
  "account.create": [true, true, true, false, false],
  "account.update": [true, true, true, false, false],
  "contact.list": [true, true, true, true, true],
  "contact.read": [true, true, true, true, true],
  "contact.create": [true, true, true, true, false],
  "contact.update": [true, true, true, true, false],
  "lead.list": [true, true, true, true, true],
  "lead.read": [true, true, true, true, true],
  "lead.create": [true, true, true, true, false],
  "lead.update": [true, true, true, true, false],
  "lead.convert": [true, true, true, true, false],
  "pipeline.list": [true, true, true, true, true],
  "pipeline.read": [true, true, true, true, true],
  "pipeline.create": [true, true, false, false, false],
  "pipeline.update": [true, true, false, false, false],
  "deal.list": [true, true, true, true, true],
  "deal.read": [true, true, true, true, true],
  "deal.create": [true, true, true, true, false],
  "deal.update": [true, true, true, true, false],
  "deal.stage": [true, true, true, true, false],
  "activity.list": [true, true, true, true, true],
  "activity.create": [true, true, true, true, false],
  "task.list": [true, true, true, true, true],
  "task.create": [true, true, true, true, false],
  "task.update": [true, true, true, true, false],
  "note.list": [true, true, true, true, true],
  "note.create": [true, true, true, true, false],
  "tag.list": [true, true, true, true, true],
  "tag.create": [true, true, false, false, false],
  "tag.update": [true, true, false, false, false],
  "tag.delete": [true, true, false, false, false],
  "sequence.list": [true, true, true, true, true],
  "sequence.read": [true, true, true, true, true],
  "sequence.create": [true, true, true, false, false],
  "enrollment.create": [true, true, true, true, false],
  "enrollment.advance": [true, true, true, true, false],
  "enrollment.exit": [true, true, true, true, false],
  "mailbox.list": [true, true, true, true, true],
  "report.read": [true, true, true, true, true],
  "triage.read": [true, true, true, true, true],
  "import.run": [true, true, true, false, false],
  "audit.read": [true, true, true, false, false],
  "forecast.capture": [true, true, true, false, false],
};

const ROLE_NAMES: AriaRole[] = ["owner", "admin", "manager", "rep", "viewer"];

describe("rbac matrix", () => {
  test("every role × every action matches the documented matrix", () => {
    for (const action of ACTIONS) {
      const expected = BRIEF_MATRIX[action];
      expect(expected, `${action} missing from the test table`).toBeDefined();
      for (let i = 0; i < ROLE_NAMES.length; i++) {
        const role = ROLE_NAMES[i];
        expect(MATRIX[action as keyof typeof MATRIX][role], `${role} → ${action}`).toBe(expected[i]);
        expect(can(role, action as never), `can(${role}, ${action})`).toBe(expected[i]);
      }
    }
  });

  test("MATRIX and can() agree on every cell (no divergence)", () => {
    for (const action of ACTIONS) {
      for (const role of ARIA_ROLES) {
        expect(can(role, action as never)).toBe(MATRIX[action as keyof typeof MATRIX][role]);
      }
    }
  });

  test("can() returns false for unknown actions (fail-closed)", () => {
    expect(can("owner", "nonexistent.action" as never)).toBe(false);
    expect(can("viewer", "nonexistent.action" as never)).toBe(false);
  });

  test("viewers can read every surface but mutate nothing", () => {
    const READISH = (action: string) =>
      action.endsWith(".list") ||
      action.endsWith(".read") ||
      action === "report.read" ||
      action === "triage.read" ||
      action === "mailbox.list";
    const VIEWER_DENIED = new Set(["audit.read"]); // the 27-probe pattern: audit is admin+
    for (const action of ACTIONS) {
      const viewerAllowed = can("viewer", action as never);
      if (VIEWER_DENIED.has(action)) {
        expect(viewerAllowed, `viewer must not ${action} (audit is admin+ only)`).toBe(false);
      } else if (READISH(action)) {
        expect(viewerAllowed, `viewer should read ${action}`).toBe(true);
      } else {
        expect(viewerAllowed, `viewer must not ${action}`).toBe(false);
      }
    }
  });

  test("the owner has every permission", () => {
    for (const action of ACTIONS) {
      expect(can("owner", action as never), `owner → ${action}`).toBe(true);
    }
  });
});

describe("owner-seat carve-out (tenant.settings resource gate)", () => {
  test("owner managing their own tenant → allowed", () => {
    expect(can("owner", "tenant.settings", "tn-1", "tn-1")).toBe(true);
  });

  test("owner acting on another tenant's settings → denied (the resource is not their seat)", () => {
    expect(can("owner", "tenant.settings", "tn-2", "tn-1")).toBe(false);
  });

  test("no resource = general capability check → allowed for owner", () => {
    expect(can("owner", "tenant.settings", undefined, "tn-1")).toBe(true);
  });

  test("non-owner roles are not resource-gated (the matrix already denies them)", () => {
    expect(can("admin", "tenant.settings", "tn-1", "tn-1")).toBe(false);
    expect(can("viewer", "tenant.settings", "tn-1", "tn-1")).toBe(false);
  });

  test("the carve-out only applies to tenant.settings (other actions ignore the resource)", () => {
    expect(can("owner", "deal.stage", "deal-99", "tn-1")).toBe(true);
    expect(can("rep", "deal.stage", "deal-99", "tn-1")).toBe(true);
  });
});

describe("PERMISSION_NAMES", () => {
  test("every action has a human-readable name (the 403 body's permission field)", () => {
    for (const a of ACTIONS) {
      expect(typeof PERMISSION_NAMES[a as keyof typeof PERMISSION_NAMES]).toBe("string");
      expect(PERMISSION_NAMES[a as keyof typeof PERMISSION_NAMES]).toBe(a);
    }
  });
});
