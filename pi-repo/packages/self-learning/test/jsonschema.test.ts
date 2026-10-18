// jsonschema.test.ts — unit tests for the dependency-free JSON Schema
// validator backing the task tool's structured outputs (oh-my-pi outputSchema
// port). Pins: the supported keyword subset, error paths, adversarial schemas
// (SchemaError, never an exception mid-walk), and the up-front shape check.
import { describe, expect, test } from "bun:test";
import { checkSchemaShape, SchemaError, validateJsonSchema } from "../src/jsonschema.ts";
import { extractJsonReply, formatSchemaIssues } from "../src/tools.ts";

const v = (data: unknown, schema: unknown) => validateJsonSchema(data, schema).valid;

describe("validateJsonSchema — types", () => {
        const typeCases: Array<[unknown, string, boolean]> = [
                ["hi", "string", true],
                [42, "string", false],
                [42, "number", true],
                [42, "integer", true],
                [4.2, "integer", false],
                [true, "boolean", true],
                [null, "null", true],
                [{ a: 1 }, "object", true],
                [[1], "array", true],
                [[1], "object", false],
                ["x", ["string", "number"], true],
                [null, ["string", "null"], true],
        ];
        for (const [data, type, expected] of typeCases) {
                test(`type ${JSON.stringify(type)} vs ${JSON.stringify(data)} -> ${expected}`, () => {
                        expect(v(data, { type })).toBe(expected);
                });
        }
});

describe("validateJsonSchema — object keywords", () => {
        const schema = {
                type: "object",
                properties: {
                        name: { type: "string", minLength: 2 },
                        count: { type: "integer", minimum: 0, maximum: 10 },
                        email: { type: "string", pattern: "^[^@]+@[^@]+$" },
                },
                required: ["name"],
                additionalProperties: false,
        };

        test("valid payload", () => {
                expect(v({ name: "ab", count: 3, email: "a@b.c" }, schema)).toBe(true);
        });

        test("missing required carries a path-annotated issue", () => {
                const res = validateJsonSchema({ count: 1 }, schema);
                expect(res.valid).toBe(false);
                expect(res.issues.some((i) => i.message.includes('"name"') && i.path === "$")).toBe(true);
        });

        test("wrong property type names the property", () => {
                const res = validateJsonSchema({ name: 5 }, schema);
                expect(res.issues.some((i) => i.path === "$.name" && i.message.includes("expected string"))).toBe(true);
        });

        test("additionalProperties: false rejects extras", () => {
                const res = validateJsonSchema({ name: "ab", surprise: 1 }, schema);
                expect(res.issues.some((i) => i.path === "$.surprise" && i.message.includes("unexpected property"))).toBe(true);
        });

        test("nested paths reach array items", () => {
                const res = validateJsonSchema(
                        { name: "ab", list: [{ ok: true }, { ok: 1 }] },
                        { type: "object", properties: { list: { type: "array", items: { type: "object", properties: { ok: { type: "boolean" } } } } } },
                );
                expect(res.issues.some((i) => i.path === "$.list[1].ok")).toBe(true);
        });

        test("minLength / minimum / maximum / pattern failures", () => {
                expect(v({ name: "a" }, schema)).toBe(false);
                expect(v({ name: "ab", count: -1 }, schema)).toBe(false);
                expect(v({ name: "ab", count: 11 }, schema)).toBe(false);
                expect(v({ name: "ab", email: "not-an-email" }, schema)).toBe(false);
        });

        test("minProperties / maxProperties", () => {
                expect(v({ a: 1, b: 2 }, { type: "object", minProperties: 2 })).toBe(true);
                expect(v({ a: 1 }, { type: "object", minProperties: 2 })).toBe(false);
                expect(v({ a: 1, b: 2, c: 3 }, { type: "object", maxProperties: 2 })).toBe(false);
        });
});

describe("validateJsonSchema — array keywords", () => {
        test("minItems / maxItems / uniqueItems", () => {
                expect(v([1, 2], { type: "array", minItems: 2 })).toBe(true);
                expect(v([1], { type: "array", minItems: 2 })).toBe(false);
                expect(v([1, 2, 3], { type: "array", maxItems: 2 })).toBe(false);
                expect(v([1, 2], { type: "array", uniqueItems: true })).toBe(true);
                expect(v([1, 1], { type: "array", uniqueItems: true })).toBe(false);
        });

        test("prefixItems (tuple)", () => {
                const schema = { type: "array", prefixItems: [{ type: "string" }, { type: "number" }] };
                expect(v(["a", 1], schema)).toBe(true);
                expect(v(["a", "b"], schema)).toBe(false);
        });
});

describe("validateJsonSchema — combinators and refs", () => {
        test("enum + const", () => {
                expect(v("red", { enum: ["red", "green"] })).toBe(true);
                expect(v("blue", { enum: ["red", "green"] })).toBe(false);
                expect(v(7, { const: 7 })).toBe(true);
                expect(v(8, { const: 7 })).toBe(false);
        });

        test("anyOf / oneOf / allOf / not", () => {
                expect(v(5, { anyOf: [{ type: "string" }, { type: "number" }] })).toBe(true);
                expect(v(true, { anyOf: [{ type: "string" }, { type: "number" }] })).toBe(false);
                expect(v("a", { oneOf: [{ type: "string" }, { minLength: 1 }] })).toBe(false); // matches both
                expect(v(3, { allOf: [{ minimum: 1 }, { maximum: 5 }] })).toBe(true);
                expect(v(9, { allOf: [{ minimum: 1 }, { maximum: 5 }] })).toBe(false);
                expect(v(3, { not: { maximum: 1 } })).toBe(true);
        });

        test("$ref to #/$defs", () => {
                const schema = {
                        type: "object",
                        properties: { items: { type: "array", items: { $ref: "#/$defs/thing" } } },
                        $defs: { thing: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
                };
                expect(v({ items: [{ id: 1 }] }, schema)).toBe(true);
                expect(v({ items: [{ nope: 1 }] }, schema)).toBe(false);
        });

        test("non-local $ref is a SchemaError", () => {
                expect(() => validateJsonSchema(1, { $ref: "https://example.com/x" })).toThrow(SchemaError);
        });
});

describe("validateJsonSchema — adversarial robustness", () => {
        test("boolean schemas (true = anything, false = nothing)", () => {
                expect(v(1, true)).toBe(true);
                expect(v(1, false)).toBe(false);
        });

        test("malformed schema throws SchemaError, not a crash", () => {
                expect(() => validateJsonSchema(1, "not a schema")).toThrow(SchemaError);
                expect(() => validateJsonSchema(1, { type: 5 })).toThrow(SchemaError);
                // keyword validation is lazy (runs when the data shape reaches it) —
                // malformed "required"/"pattern" surface on matching data
                expect(() => validateJsonSchema({}, { required: [5] })).toThrow(SchemaError);
                expect(() => validateJsonSchema("x", { pattern: "(" })).toThrow(SchemaError);
        });

        test("deeply nested schemas stop at the depth cap instead of blowing the stack", () => {
                let schema: unknown = { type: "integer" };
                for (let i = 0; i < 200; i++) schema = { properties: { a: schema }, type: "object" };
                let data: unknown = 1;
                for (let i = 0; i < 200; i++) data = { a: data };
                const res = validateJsonSchema(data, schema); // must not throw
                expect(res.valid).toBe(false);
                expect(res.issues.some((i) => i.message.includes("nesting"))).toBe(true);
        });

        test("multipleOf tolerates floats", () => {
                expect(v(0.3, { type: "number", multipleOf: 0.1 })).toBe(true);
                expect(v(0.35, { type: "number", multipleOf: 0.1 })).toBe(false);
        });
});

describe("checkSchemaShape", () => {
        test("recognizes a real schema", () => {
                expect(checkSchemaShape({ type: "object", properties: { a: { type: "string" } } }).ok).toBe(true);
        });

        test("rejects non-schemas up front", () => {
                const junk = checkSchemaShape({ hello: "world", nope: 1 });
                expect(junk.ok).toBe(false);
                expect(checkSchemaShape(null).ok).toBe(false);
                expect(checkSchemaShape("x").ok).toBe(false);
        });
});

describe("extractJsonReply (tools.ts)", () => {
        test("bare JSON", () => {
                const r = extractJsonReply('{"a":1}');
                expect(r.ok && (r.data as any).a === 1).toBe(true);
        });

        test("fenced ```json block", () => {
                const r = extractJsonReply('```json\n{"a": 1}\n```');
                expect(r.ok && (r.data as any).a === 1).toBe(true);
        });

        test("prose around one balanced object", () => {
                const r = extractJsonReply('Here you go:\n\n{"a": {"b": "c}"}, "n": 2}\n\nHope that helps!');
                expect(r.ok && (r.data as any).n === 2).toBe(true);
        });

        test("braces inside strings do not confuse the scanner", () => {
                const r = extractJsonReply('prefix {"s": "tricky ] and { stuff"} suffix');
                expect(r.ok && (r.data as any).s.includes("tricky")).toBe(true);
        });

        test("arrays are extracted too", () => {
                const r = extractJsonReply("Result: [1, 2, 3]");
                expect(r.ok && JSON.stringify(r.data) === "[1,2,3]").toBe(true);
        });

        test("empty / garbage", () => {
                expect(extractJsonReply("").ok).toBe(false);
                expect(extractJsonReply("no json here at all").ok).toBe(false);
        });
});

describe("formatSchemaIssues", () => {
        test("path-annotated, capped", () => {
                const issues = [
                        { path: "$.a", message: "x1" },
                        { path: "$.b", message: "x2" },
                        { path: "$.c", message: "x3" },
                ];
                const out = formatSchemaIssues(issues, 2);
                expect(out).toBe("$.a: x1; $.b: x2 (+1 more)");
        });
});
