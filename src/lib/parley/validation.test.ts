import { describe, expect, test } from "bun:test";
import {
  CANNED_TITLE_MAX,
  REPLY_MAX,
  SUBJECT_MAX,
  TAG_MAX,
  passwordFloorErrors,
  validateAcceptInvite,
  validateAssign,
  validateCanned,
  validateCreateConvo,
  validateInvite,
  validateLogin,
  validatePriority,
  validateRemoveMember,
  validateReply,
  validateStatus,
  validateTags,
} from "./validation";
import type { Priority, Status } from "./types";

describe("validateLogin", () => {
  test("accepts a valid email + password", () => {
    expect(validateLogin({ email: "mira@lumen.test", password: "parley-demo-1" }).errors).toEqual([]);
  });
  test("rejects an empty email", () => {
    const { errors } = validateLogin({ email: "", password: "x" });
    expect(errors).toContain("Email is required.");
  });
  test("rejects a malformed email", () => {
    const { errors } = validateLogin({ email: "not-an-email", password: "x" });
    expect(errors.some((e) => e.includes("valid email"))).toBe(true);
  });
  test("rejects an empty password", () => {
    expect(validateLogin({ email: "a@b.co", password: "  " }).errors).toContain("Password is required.");
  });
});

describe("validateCreateConvo", () => {
  const ok = { subject: "Firmware not flashing", customerName: "Jo", customerEmail: "jo@example.com" };
  test("accepts a valid create", () => {
    expect(validateCreateConvo(ok).errors).toEqual([]);
  });
  test("rejects an empty subject", () => {
    expect(validateCreateConvo({ ...ok, subject: "  " }).errors).toContain("Subject is required.");
  });
  test("rejects an over-long subject", () => {
    expect(validateCreateConvo({ ...ok, subject: "x".repeat(SUBJECT_MAX + 1) }).errors.length).toBe(1);
  });
  test("rejects a missing customer name", () => {
    expect(validateCreateConvo({ ...ok, customerName: "" }).errors).toContain("Customer name is required.");
  });
  test("rejects a bad customer email", () => {
    expect(validateCreateConvo({ ...ok, customerEmail: "nope" }).errors.length).toBe(1);
  });
  test("rejects an invalid priority literal", () => {
    expect(validateCreateConvo({ ...ok, priority: "critical" as never }).errors.length).toBe(1);
  });
});

describe("validateReply", () => {
  test("accepts a non-empty body", () => {
    expect(validateReply({ body: "Thanks — on it." }).errors).toEqual([]);
  });
  test("rejects an empty body", () => {
    expect(validateReply({ body: "   " }).errors).toContain("Reply body is required.");
  });
  test("rejects an over-long body", () => {
    expect(validateReply({ body: "x".repeat(REPLY_MAX + 1) }).errors.length).toBe(1);
  });
});

describe("validateAssign", () => {
  test("accepts a real user id", () => {
    expect(validateAssign({ userId: "u-ada" }).errors).toEqual([]);
  });
  test("accepts an explicit null (unassign)", () => {
    expect(validateAssign({ userId: null }).errors).toEqual([]);
  });
  test("rejects a blank string", () => {
    expect(validateAssign({ userId: "  " }).errors).toContain("Assign a user id, or null to unassign.");
  });
});

describe("validateStatus / validatePriority", () => {
  test("status accepts each literal and rejects others", () => {
    for (const s of ["open", "pending", "closed"] as Status[])
      expect(validateStatus({ status: s }).errors).toEqual([]);
    expect(validateStatus({ status: ("wip" as unknown) as Status }).errors.length).toBe(1);
  });
  test("priority accepts each literal and rejects others", () => {
    for (const p of ["low", "normal", "high", "urgent"] as Priority[])
      expect(validatePriority({ priority: p }).errors).toEqual([]);
    expect(validatePriority({ priority: "normal" }).errors).toEqual([]);
    expect(validatePriority({ priority: ("urgent!" as unknown) as Priority }).errors.length).toBe(1);
  });
});

describe("validateTags", () => {
  test("accepts a valid, unique tag set", () => {
    expect(validateTags({ tags: ["billing", "hardware"] }).errors).toEqual([]);
  });
  test("rejects an empty label", () => {
    expect(validateTags({ tags: ["billing", "  "] }).errors).toContain("Tags must not be empty.");
  });
  test("rejects an over-long label", () => {
    expect(validateTags({ tags: ["x".repeat(TAG_MAX + 1)] }).errors.length).toBe(1);
  });
  test("rejects duplicates case-insensitively", () => {
    expect(validateTags({ tags: ["Billing", "billing"] }).errors).toContain('Duplicate tag: "billing".');
  });
  test("rejects a non-array", () => {
    expect(validateTags({ tags: "nope" as never }).errors).toEqual(["Tags must be an array."]);
  });
});

describe("validateInvite", () => {
  test("accepts a valid invite", () => {
    expect(validateInvite({ email: "casey@lumen.test", role: "admin" }).errors).toEqual([]);
  });
  test("rejects a bad email", () => {
    expect(validateInvite({ email: "x", role: "admin" }).errors.length).toBe(1);
  });
  test("rejects a role outside the 4 literals", () => {
    expect(validateInvite({ email: "a@b.co", role: "superuser" as never }).errors.length).toBe(1);
  });
});

describe("passwordFloorErrors / validateAcceptInvite", () => {
  test("the password floor: 8+ chars, a letter, a digit", () => {
    expect(passwordFloorErrors("abc12345")).toEqual([]);
    expect(passwordFloorErrors("short1")).toEqual(["Password must be at least 8 characters."]);
    expect(passwordFloorErrors("abcdefghijkl")).toEqual(["Password must contain at least one digit."]);
  });
  test("accept-validate: a real credential passes", () => {
    expect(validateAcceptInvite({ name: "Casey", password: "Sunny7day!" }).errors).toEqual([]);
  });
  test("rejects a missing name + weak password", () => {
    const { errors } = validateAcceptInvite({ name: "  ", password: "short" });
    expect(errors).toContain("Name is required.");
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("validateCanned", () => {
  test("accepts a title + body", () => {
    expect(validateCanned({ title: "Outage ack", body: "We see it." }).errors).toEqual([]);
  });
  test("rejects a missing title or body", () => {
    expect(validateCanned({ title: "", body: "" }).errors.length).toBe(2);
  });
  test("rejects an over-long title", () => {
    expect(validateCanned({ title: "x".repeat(CANNED_TITLE_MAX + 1), body: "b" }).errors.length).toBe(1);
  });
});

describe("validateRemoveMember", () => {
  test("accepts a real membership id", () => {
    expect(validateRemoveMember({ membershipId: "mem-theo" }).errors).toEqual([]);
  });
  test("rejects a blank id", () => {
    expect(validateRemoveMember({ membershipId: "  " }).errors).toContain("Membership id is required.");
  });
});
