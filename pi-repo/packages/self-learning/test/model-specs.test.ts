// model-specs.test.ts — the known-model spec catalog.
//
// Pins the two-sided contract of modelSpec():
//   - ids with officially published limits get their exact spec (the catalog
//     exists so seeding paths stop stamping 131072/8192 on models that
//     serve 512K/65K — a silent capability cut on every Agnes upstream)
//   - unknown ids keep the historical conservative defaults — guessing is
//     worse than under-promising (compaction too late / upstream truncation)
// and the integrity of the catalog itself: every entry carries sane,
// self-consistent limits (maxTokens fits inside contextWindow, nothing
// below the old defaults that would be a regression).
import { describe, expect, test } from "bun:test";
import { DEFAULT_MODEL_SPEC, KNOWN_MODEL_SPECS, modelSpec } from "../src/model-specs.ts";

describe("modelSpec — lookup and fallback", () => {
        test("every catalog id resolves to its own spec", () => {
                expect(modelSpec("agnes-3.0-flash")).toEqual({ contextWindow: 524288, maxTokens: 65536 });
                expect(modelSpec("agnes-2.5-flash")).toEqual({ contextWindow: 524288, maxTokens: 65536 });
                expect(modelSpec("kimi-k2.5")).toEqual({ contextWindow: 262144, maxTokens: 16384 });
                expect(modelSpec("qwen3.7-plus")).toEqual({ contextWindow: 1000000, maxTokens: 131072 });
                expect(modelSpec("qwen3.6-plus")).toEqual({ contextWindow: 1000000, maxTokens: 65536 });
        });

        test("unknown ids get the conservative defaults", () => {
                expect(modelSpec("mystery-7b")).toEqual(DEFAULT_MODEL_SPEC);
                expect(modelSpec("")).toEqual(DEFAULT_MODEL_SPEC);
                expect(modelSpec("AGNES-3.0-FLASH")).toEqual(DEFAULT_MODEL_SPEC); // exact ids only — no case folding
        });

        test("prefixes do not match (a matching prefix is a coincidence, not a spec)", () => {
                expect(modelSpec("agnes-3.0")).toEqual(DEFAULT_MODEL_SPEC);
                expect(modelSpec("kimi-k2.5-preview")).toEqual(DEFAULT_MODEL_SPEC);
                expect(modelSpec("qwen3.7-plus-2026-05-26")).toEqual(DEFAULT_MODEL_SPEC);
        });
});

describe("the catalog's own integrity", () => {
        test("every entry is self-consistent and at least the old defaults", () => {
                for (const [id, spec] of Object.entries(KNOWN_MODEL_SPECS)) {
                        expect(spec.maxTokens).toBeGreaterThan(0);
                        expect(spec.contextWindow).toBeGreaterThanOrEqual(DEFAULT_MODEL_SPEC.contextWindow);
                        expect(spec.maxTokens).toBeGreaterThanOrEqual(DEFAULT_MODEL_SPEC.maxTokens);
                        expect(spec.maxTokens).toBeLessThan(spec.contextWindow); // output fits in context
                        expect(Number.isInteger(spec.contextWindow)).toBe(true);
                        expect(Number.isInteger(spec.maxTokens)).toBe(true);
                        expect(id.length).toBeGreaterThan(0);
                }
        });
});
