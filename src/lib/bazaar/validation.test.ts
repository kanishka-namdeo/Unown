import { describe, expect, test } from "bun:test";
import {
  expiryNotPast,
  formatCardNumber,
  luhnValid,
  paymentErrors,
  validateCardNumber,
  validateCvv,
  validateExpiry,
  validateShipping,
} from "./validation";

describe("Luhn validator", () => {
  test("4242 4242 4242 4242 passes", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(luhnValid("4242 4242 4242 4242")).toBe(true); // spaces ignored
  });

  test("4242 4242 4242 4243 fails (off by one)", () => {
    expect(luhnValid("4242424242424243")).toBe(false);
  });

  test("1234567812345678 is not Luhn-valid", () => {
    expect(luhnValid("1234567812345678")).toBe(false);
  });

  test("luhnValid is length-agnostic; validateCardNumber enforces 16 digits", () => {
    expect(luhnValid("49927398716")).toBe(true); // 11-digit Luhn classic passes the checksum
    expect(validateCardNumber("49927398716")).toMatch(/16 digits/);
    expect(validateCardNumber("42424242424242421")).toMatch(/16 digits/);
  });

  test("79927398713 is the classic Stripe example, and passes", () => {
    expect(luhnValid("79927398713")).toBe(true); // 11-digit Luhn classic
    expect(luhnValid("79927398710")).toBe(false);
  });

  test("validateCardNumber gives field-level actionable errors", () => {
    expect(validateCardNumber("")).toBe("Please enter a card number.");
    expect(validateCardNumber("4242424242424243")).toMatch(/Luhn check/);
    expect(validateCardNumber("424242")).toMatch(/16 digits/);
    expect(validateCardNumber("4242424242424242")).toBeNull();
  });

  test("16-digit Luhn-valid Mastercard number passes", () => {
    expect(luhnValid("5105105105105100")).toBe(true);
    expect(luhnValid("5105105105105101")).toBe(false);
  });
});

describe("expiry validator", () => {
  const now = new Date(2026, 6, 15); // fixed 2026-07-15

  test("valid future expiry passes", () => {
    expect(validateExpiry("08/28", now)).toBeNull();
    expect(expiryNotPast("12/26", now)).toBe(true);
  });

  test("expiry in the past fails", () => {
    expect(validateExpiry("06/26", now)).toMatch(/expired/);
    expect(expiryNotPast("01/24", now)).toBe(false);
  });

  test("the current month itself still counts as valid", () => {
    expect(validateExpiry("07/26", now)).toBeNull();
  });

  test("bad formats fail with a helpful message", () => {
    expect(validateExpiry("13/26", now)).toMatch(/expired|MM\/YY/);
    expect(validateExpiry("7/26", now)).toMatch(/MM\/YY/);
    expect(validateExpiry("", now)).toMatch(/MM\/YY/);
  });
});

describe("CVV validator", () => {
  test("3 digits pass, anything else fails", () => {
    expect(validateCvv("123")).toBeNull();
    expect(validateCvv("12")).toMatch(/3 digits/);
    expect(validateCvv("1234")).toMatch(/3 digits/);
    expect(validateCvv("abc")).toMatch(/3 digits/);
    expect(validateCvv("")).toMatch(/CVV/);
  });
});

describe("shipping field validators", () => {
  test("all required fields reject empty values with actionable messages", () => {
    expect(validateShipping("name", "")).toMatch(/name/i);
    expect(validateShipping("address", "  ")).toMatch(/address/i);
    expect(validateShipping("city", "")).toMatch(/city/i);
  });

  test("email must be a practical shape", () => {
    expect(validateShipping("email", "ada@lovelace.dev")).toBeNull();
    expect(validateShipping("email", "nope")).toMatch(/email/i);
    expect(validateShipping("email", "@x.com")).toMatch(/email/i);
  });

  test("ZIP must be exactly 5 digits", () => {
    expect(validateShipping("zip", "94103")).toBeNull();
    expect(validateShipping("zip", "9410")).toMatch(/5 digits/);
    expect(validateShipping("zip", "94a03")).toMatch(/5 digits/);
  });

  test("paymentErrors aggregates field errors or returns empty when clean", () => {
    const errs = paymentErrors(
      { cardNumber: "4242424242424242", expiry: "08/29", cvv: "123" },
      new Date(2026, 0, 1),
    );
    expect(Object.keys(errs)).toHaveLength(0);
    const bad = paymentErrors(
      { cardNumber: "4242424242424243", expiry: "01/24", cvv: "12" },
      new Date(2026, 0, 1),
    );
    expect(Object.keys(bad)).toEqual(expect.arrayContaining(["cardNumber", "expiry", "cvv"]));
  });
});

describe("formatCardNumber", () => {
  test("groups into 4-digit chunks and strips junk", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    expect(formatCardNumber("4242-4242 4242*4242")).toBe("4242 4242 4242 4242");
    expect(formatCardNumber("123456789012345678")).toBe("1234 5678 9012 3456"); // capped at 16
  });
});
