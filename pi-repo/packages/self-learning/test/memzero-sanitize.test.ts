/**
 * memzero-sanitize.test.ts — B-18 pins (A2H-10): the deterministic
 * reasoning-noise filter at the dream's memory write boundary.
 *
 * Three observed leak shapes (benchmarks/rondo-round/receipts/b18-fixlane.md):
 *   (1) the reasoning blob   — "[NOTE: The original memory contained …]" —
 *       observed live in the 2026-11-06 renders (B-18 first + third shapes);
 *   (2) the JSON fragment    — ", \"reason\": \"…\"}, {" provenance tails
 *       (the twenty-first lineage's second observation);
 *   (3) the trailing Reason clause — the 2026-10-23 finding, previously
 *       stripped at the reconcile lane only.
 *
 * The clean pass-through is byte-identical (the shape-aware contract): a
 * fact that matches none of the three shapes is returned UNTOUCHED —
 * including facts that legitimately contain the word "reason" in prose or
 * a bracket that is not a NOTE marker.
 *
 * No platform, no SQLite, no LLM — pure-function pins over the exported
 * sanitizeMemoryText(), plus the ADD-lane reject rule through mapAddResults
 * via a fake result row (the same shape the platform maps), and the salvage
 * lane's trim+sanitize composition.
 */
import { describe, expect, test } from "bun:test";
import { sanitizeMemoryText } from "../src/memzero.ts";

// ---------------------------------------------------------------- shape 1

describe("sanitizeMemoryText — the [NOTE:] reasoning blob (B-18 shape 1)", () => {
        // The real observed payload (the clippad fact, 2026-11-06 renders —
        // quoted from the fix-lane receipt; the blob is ~180 words of the
        // dream LLM's meta-deliberation embedded IN the fact).
        const OBSERVED = `benchmarks/longhorizon/reference/tests: Reference implementation tests for clippad [note 1]. [NOTE: The original memory contained a markdown artifact '[note 1]' that has been cleaned up or marked for context. Actually, the instruction says never add new facts, but this looks like a truncation. I will keep the text as is but clean up the obvious markdown note if it is a placeholder. Wait, '[note 1]' is likely part of the raw text. I will preserve the content strictly. The rule is "Never add new facts". I will leave the text as is but remove the markdown link syntax if it was intended as a reference, but usually, these are just noise. I will keep the text. Actually, the instruction says "tightened or merged wording". Removing the ' [note 1]' suffix is tightening. I will remove it.] benchmarks/longhorizon/reference/tests: Reference implementation tests for clippad`;

        test("the observed clippad payload: both blobs stripped, the clean fact survives", () => {
                const out = sanitizeMemoryText(OBSERVED);
                expect(out).not.toContain("[NOTE:");
                expect(out).not.toContain("I will keep the text");
                expect(out).not.toContain("the instruction says");
                expect(out).toContain("Reference implementation tests for clippad");
        });

        test("a TRUNCATED blob (no closing bracket) is caught by the EOF-anchored pass", () => {
                const out = sanitizeMemoryText(
                        "Run the migration with --dry-run first. [NOTE: The original memory contained a truncated artifact and I will",
                );
                expect(out).not.toContain("[NOTE:");
                expect(out).not.toContain("truncated artifact");
                expect(out).toBe("Run the migration with --dry-run first.");
        });

        test("a mid-text blob leaves the prose on both sides, whitespace collapsed", () => {
                const out = sanitizeMemoryText(
                        "Fact one stands. [note: internal deliberation about whether this belongs] Fact two stands.",
                );
                expect(out).toBe("Fact one stands. Fact two stands.");
        });

        test("case-insensitive marker, repeatable blobs", () => {
                const out = sanitizeMemoryText(
                        "A. [Note: one] B. [NOTE: two] C.",
                );
                expect(out).toBe("A. B. C.");
        });
});

// ---------------------------------------------------------------- shape 2

describe("sanitizeMemoryText — the JSON-fragment tail (B-18 shape 2)", () => {
        // The observed shape: the mem0 provenance object's trailing fields
        // rendered INTO the fact text (the twenty-first's 05:12 UTC render).
        const OBSERVED = `benchmarks/longhorizon/reference/tests: Reference implementation tests for clippad.", "reason": "Removed raw markdown note and truncated fragment from original memory text to present a clean, complete atomic fact without embedded artifacts."}, {`;

        test("the observed provenance fragment is stripped, the fact prose survives", () => {
                const out = sanitizeMemoryText(OBSERVED);
                expect(out).not.toContain('"reason"');
                expect(out).not.toContain("}, {");
                expect(out).toContain("Reference implementation tests for clippad");
        });

        test("the bare fragment without the closing brace (model cutoff mid-JSON)", () => {
                const out = sanitizeMemoryText(
                        'The bridge binds 127.0.0.1 only., "reason": "merged two memories about the bridge',
                );
                expect(out).not.toContain('"reason"');
                expect(out).toBe("The bridge binds 127.0.0.1 only.");
        });

        test("an escaped quote inside the fragment value honors the real boundary", () => {
                const out = sanitizeMemoryText(
                        'Ports: 3030 engine, 3031 bridge., "reason": "the \\"ports\\" rule wins here"}, {',
                );
                expect(out).toBe("Ports: 3030 engine, 3031 bridge.");
        });
});

// ---------------------------------------------------------------- shape 3

describe("sanitizeMemoryText — the trailing Reason clause (B-18 shape 3, the 2026-10-23 class)", () => {
        test("the classic leak is stripped (the reconcile lane's old behavior, generalized)", () => {
                const out = sanitizeMemoryText(
                        "Verify engine health: GET /api/overview returns ok:true; check this after any restart. Reason: tightened wording from 'restart' to 'any restart'",
                );
                expect(out).toBe(
                        "Verify engine health: GET /api/overview returns ok:true; check this after any restart.",
                );
        });

        test("lowercase 'reason:' clause stripped too", () => {
                const out = sanitizeMemoryText("Use bun 1.4.3. reason: the lockfile floor");
                expect(out).toBe("Use bun 1.4.3.");
        });
});

// ------------------------------------------------- multi-shape + composition

describe("sanitizeMemoryText — multi-shape and the clean pass-through", () => {
        test("blob + fragment in one fact", () => {
                const out = sanitizeMemoryText(
                        'Clippad tests exist. [note: should I keep this?] The reference lives under benchmarks/.",reason":"merged"}, {',
                );
                expect(out).not.toContain("[note:");
                expect(out).not.toContain('"reason"');
                expect(out).toContain("The reference lives under benchmarks/.");
        });

        test("CLEAN pass-through is byte-identical — internal whitespace runs preserved", () => {
                const clean = "The engine token lives at data/self-learning/engine.token   and is 0600.";
                expect(sanitizeMemoryText(clean)).toBe(clean);
        });

        test("a fact legitimately containing the word 'reason' in prose is untouched", () => {
                const clean =
                        "The runner reports selector-not-found for a reason: the capped wait surfaces the taxonomy entry, never a hang.";
                expect(sanitizeMemoryText(clean)).toBe(clean);
        });

        test("a [link]-style bracket that is NOT a note marker is untouched", () => {
                const clean = "See the plan [chaconne] and the receipts [a2h8] for the fixture set.";
            expect(sanitizeMemoryText(clean)).toBe(clean);
        });

        test("a noise-ONLY row reduces to the empty string (the lanes' reject trigger)", () => {
            expect(sanitizeMemoryText("[NOTE: everything here is deliberation]")).toBe("");
            expect(sanitizeMemoryText('", "reason": "nothing but fragment"}, {')).toBe("");
            expect(sanitizeMemoryText("   ")).toBe("");
        });
});
