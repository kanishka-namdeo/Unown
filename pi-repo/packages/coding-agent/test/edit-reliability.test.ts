import { describe, expect, test } from "vitest";
import { join } from "path";
import { applyEditsToNormalizedContent } from "../src/core/tools/edit-diff.ts";
import { createEditToolDefinition, type EditOperations } from "../src/core/tools/edit.ts";

/**
 * Edit-reliability transparency (the aider "% correct edit format" lesson):
 * the edit tool already falls back to whitespace/Unicode-tolerant matching —
 * these tests pin that the fallback is now OBSERVABLE: the applied-edits
 * result reports it, and the tool result tells the model its oldText was not
 * byte-exact so it self-corrects (the receipts ledger records the signal).
 */

interface MemoryOps extends EditOperations {
        files: Map<string, string>;
}

function memoryOps(initial: Record<string, string>): MemoryOps {
        const files = new Map<string, string>(Object.entries(initial));
        return {
                files,
                access: async () => {},
                readFile: async (p) => Buffer.from(files.get(p) ?? "", "utf-8"),
                writeFile: async (p, c) => {
                        files.set(p, c);
                },
        };
}

describe("applyEditsToNormalizedContent — fuzzy-match reporting", () => {
        test("an exact match reports no fuzzy usage", () => {
                const result = applyEditsToNormalizedContent("alpha\nbeta\n", [{ oldText: "alpha", newText: "ALPHA" }], "f.txt");
                expect(result.usedFuzzyMatch).toBe(false);
                expect(result.fuzzyEditIndices).toEqual([]);
                expect(result.newContent).toBe("ALPHA\nbeta\n");
        });

        test("trailing-whitespace drift in oldText reports the fuzzy edit by index", () => {
                const result = applyEditsToNormalizedContent("alpha\nbeta\n", [
                        { oldText: "alpha   \nbeta", newText: "ALPHA\nbeta" },
                ], "f.txt");
                expect(result.usedFuzzyMatch).toBe(true);
                expect(result.fuzzyEditIndices).toEqual([0]);
                expect(result.newContent).toContain("ALPHA");
        });

        test("mixed edits report only the drifted one", () => {
                const result = applyEditsToNormalizedContent(
                        "alpha\nbeta\ngamma\n",
                        [
                                { oldText: "alpha", newText: "ALPHA" },
                                { oldText: "beta   \ngamma", newText: "BETA\ngamma" },
                        ],
                        "f.txt",
                );
                expect(result.usedFuzzyMatch).toBe(true);
                expect(result.fuzzyEditIndices).toEqual([1]);
        });

        test("Unicode punctuation drift reports the fuzzy edit", () => {
                const result = applyEditsToNormalizedContent("say \u201Chello\u201D\n", [
                        { oldText: 'say "hello"', newText: "say 'hi'" },
                ], "f.txt");
                expect(result.usedFuzzyMatch).toBe(true);
                expect(result.newContent).toContain("say 'hi'");
        });
});

describe("edit tool result — reliability note", () => {
        test("a byte-exact edit stays silent", async () => {
                const file = join(process.cwd(), "reliability-exact.txt");
                const ops = memoryOps({ [file]: "alpha\nbeta\n" });
                const tool = createEditToolDefinition(process.cwd(), { operations: ops });
                const result = await tool.execute("t1", { path: file, edits: [{ oldText: "alpha", newText: "ALPHA" }] });
                const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("");
                expect(text).toContain("Successfully replaced 1 block(s)");
                expect(text).not.toContain("normalization");
        });

        test("a fuzzy edit tells the model its oldText was not byte-exact", async () => {
                const file = join(process.cwd(), "reliability-fuzzy.txt");
                const ops = memoryOps({ [file]: "alpha   \nbeta\ngamma\n" });
                const tool = createEditToolDefinition(process.cwd(), { operations: ops });
                const result = await tool.execute("t2", {
                        path: file,
                        edits: [{ oldText: "alpha\nbeta", newText: "ALPHA\nbeta" }],
                });
                const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("");
                expect(text).toContain("Successfully replaced 1 block(s)");
                expect(text).toContain("normalization");
                expect(text).toContain("copy the text exactly");
                // The replacement landed and unchanged lines kept their bytes.
                expect(ops.files.get(file)).toContain("ALPHA");
                expect(ops.files.get(file)).toContain("gamma");
        });
});
