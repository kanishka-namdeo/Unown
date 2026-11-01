import { describe, it, expect } from "bun:test";
import { multiply } from "../src/calc.ts";

describe("multiply", () => {
        it("multiplies two positive numbers", () => {
                expect(multiply(2, 3)).toBe(6);
        });

        it("handles two negatives", () => {
                expect(multiply(-2, -3)).toBe(6);
        });

        it("returns zero when either argument is zero", () => {
                expect(multiply(0, 5)).toBe(0);
                expect(multiply(7, 0)).toBe(0);
        });

        it("multiplies non-integers", () => {
                expect(multiply(2.5, 4)).toBe(10);
        });

        it("returns the operand when multiplying by one", () => {
                expect(multiply(1, 42)).toBe(42);
        });
});
