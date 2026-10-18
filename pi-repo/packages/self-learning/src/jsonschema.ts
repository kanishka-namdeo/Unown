/**
 * jsonschema.ts — a minimal, dependency-free JSON Schema validator for
 * subagent structured outputs (the oh-my-pi `task` outputSchema port).
 *
 * Scope: the practical subset of draft 2020-12 that LLM-emitted schemas use —
 * type (string form or array), properties/required/additionalProperties,
 * items/prefixItems, enum/const, numeric/string/array/object constraints,
 * anyOf/oneOf/allOf/not, and local $ref resolution against #/definitions and
 * #/$defs. Formats are NOT validated (a "format" keyword is accepted and
 * ignored — matching the common lenient behavior; our caller treats schemas
 * as contracts about SHAPE, not string encodings).
 *
 * Design goals, in priority order:
 *   1. Actionable errors — every failure carries a JSON path
 *      ("$.results[0].title: expected string") and the failing rule, so the
 *      subagent retry loop can quote the exact defect back to the model.
 *   2. Total on adversarial schemas — a malformed schema is a schema error
 *      (reported up front), never an exception mid-validation; deep nesting
 *      is capped rather than blowing the stack.
 *   3. Zero dependencies — the vendored pi substrate stays addon-free.
 */

/** One validation finding: where it failed and why. */
export interface SchemaIssue {
	/** JSON path of the failing value, "$"-rooted, e.g. "$.a[0].b". */
	path: string;
	/** Human explanation, e.g. "expected string, got number". */
	message: string;
}

export interface ValidationResult {
	valid: boolean;
	/** Present iff !valid. */
	issues: SchemaIssue[];
}

/** Structural problems in the SCHEMA itself (not the data). */
export class SchemaError extends Error {}

const MAX_DEPTH = 64;

/** Validate `data` against `schema` (a JSON Schema object). Throws SchemaError
 *  when the schema itself is malformed; returns issues for data problems. */
export function validateJsonSchema(data: unknown, schema: unknown): ValidationResult {
	const root = normalizeSchema(schema, "$schema");
	const issues: SchemaIssue[] = [];
	validate(data, root, "$", issues, 0, root);
	return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Schema normalization
// ---------------------------------------------------------------------------

type Schema = Record<string, unknown>;

const SCHEMA_KEYS = new Set([
	"type", "properties", "required", "additionalProperties", "items", "prefixItems",
	"enum", "const", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
	"multipleOf", "minLength", "maxLength", "pattern", "minItems", "maxItems",
	"uniqueItems", "minProperties", "maxProperties", "anyOf", "oneOf", "allOf",
	"not", "$ref", "title", "description", "format", "default", "examples", "$defs",
	"definitions", "deprecated", "additionalItems",
]);

function normalizeSchema(schema: unknown, where: string): Schema {
	if (typeof schema === "boolean") {
		// JSON Schema allows true (accept all) / false (accept nothing).
		return schema ? {} : { not: {} };
	}
	if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
		throw new SchemaError(`${where}: schema must be an object, got ${describe(schema)}`);
	}
	return schema as Schema;
}

function lookupRef(root: Schema, ref: string, where: string): Schema {
	if (typeof ref !== "string" || !ref.startsWith("#")) {
		throw new SchemaError(`${where}: only local $ref ("#/…") is supported, got ${JSON.stringify(ref)}`);
	}
	const parts = ref.slice(1).split("/").filter(Boolean);
	let node: unknown = root;
	for (const raw of parts) {
		const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
		if (node === null || typeof node !== "object") {
			throw new SchemaError(`${where}: $ref ${ref} escapes the document structure`);
		}
		node = (node as Record<string, unknown>)[key];
	}
	if (node === undefined) throw new SchemaError(`${where}: $ref ${ref} resolves to nothing`);
	return normalizeSchema(node, `${where} ($ref ${ref})`);
}

// ---------------------------------------------------------------------------
// Core walk
// ---------------------------------------------------------------------------

function validate(data: unknown, schema: Schema, path: string, issues: SchemaIssue[], depth: number, root: Schema): void {
	if (depth > MAX_DEPTH) {
		issues.push({ path, message: `schema nesting exceeds ${MAX_DEPTH} levels` });
		return;
	}

	// Combinators first — allOf merges constraints, anyOf/oneOf are exclusive.
	if (Array.isArray(schema.allOf)) {
		for (const sub of schema.allOf) validate(data, normalizeSchema(sub, `${path} allOf`), path, issues, depth + 1, root);
	}
	if (schema.$ref !== undefined) {
		const target = lookupRef(root, schema.$ref as string, path);
		validate(data, target, path, issues, depth + 1, root);
	}
	if (Array.isArray(schema.anyOf)) {
		const anyOk = schema.anyOf.some((sub) => {
			const probe: SchemaIssue[] = [];
			validate(data, normalizeSchema(sub, `${path} anyOf`), path, probe, depth + 1, root);
			return probe.length === 0;
		});
		if (!anyOk) issues.push({ path, message: "does not match any of the anyOf alternatives" });
	}
	if (Array.isArray(schema.oneOf)) {
		const matches = schema.oneOf.filter((sub) => {
			const probe: SchemaIssue[] = [];
			validate(data, normalizeSchema(sub, `${path} oneOf`), path, probe, depth + 1, root);
			return probe.length === 0;
		});
		if (matches.length !== 1) {
			issues.push({ path, message: `matches ${matches.length} of the oneOf alternatives (exactly 1 required)` });
		}
	}
	if (schema.not !== undefined) {
		const probe: SchemaIssue[] = [];
		validate(data, normalizeSchema(schema.not, `${path} not`), path, probe, depth + 1, root);
		if (probe.length === 0) issues.push({ path, message: "must NOT match the 'not' schema" });
	}

	// enum / const — checked against the raw value.
	if (Array.isArray(schema.enum)) {
		const ok = schema.enum.some((candidate) => deepEqual(data, candidate));
		if (!ok) issues.push({ path, message: `must be one of ${shortList(schema.enum)}, got ${describe(data)}` });
	}
	if (schema.const !== undefined && !deepEqual(data, schema.const)) {
		issues.push({ path, message: `must equal ${JSON.stringify(schema.const)}, got ${describe(data)}` });
	}

	// type — string form or array form.
	const typeOk = checkType(data, schema.type);
	if (typeOk !== null) issues.push({ path, message: typeOk });

	// Per-type constraints. Each runs only when the data is the right shape —
	// a wrong-typed value already carries a type issue; piling "minLength"
	// onto a number would just be noise.
	if (typeof data === "string") validateString(data, schema, path, issues);
	if (typeof data === "number") validateNumber(data, schema, path, issues);
	if (Array.isArray(data)) validateArray(data, schema, path, issues, depth, root);
	if (data !== null && typeof data === "object" && !Array.isArray(data)) {
		validateObject(data as Record<string, unknown>, schema, path, issues, depth, root);
	}
}

function checkType(data: unknown, type: unknown): string | null {
	if (type === undefined) return null;
	const allowed = Array.isArray(type) ? type : [type];
	if (allowed.some((t) => typeof t !== "string")) {
		throw new SchemaError(`"type" must be a string or array of strings, got ${describe(type)}`);
	}
	const actual = dataType(data);
	// "integer" accepts numbers that are integral (JSON has no int type; the
	// spec says integer = number with zero fractional part).
	if (!allowed.includes(actual) && !(actual === "number" && allowed.includes("integer") && Number.isInteger(data))) {
		return `expected ${allowed.join(" | ")}, got ${describe(data)}`;
	}
	return null;
}

function dataType(data: unknown): string {
	if (data === null) return "null";
	if (Array.isArray(data)) return "array";
	if (typeof data === "number") return "number";
	if (typeof data === "string") return "string";
	if (typeof data === "boolean") return "boolean";
	return "object";
}

function validateString(data: string, schema: Schema, path: string, issues: SchemaIssue[]): void {
	const min = schema.minLength;
	if (typeof min === "number" && data.length < min) {
		issues.push({ path, message: `shorter than minLength ${min} (${data.length} chars)` });
	}
	const max = schema.maxLength;
	if (typeof max === "number" && data.length > max) {
		issues.push({ path, message: `longer than maxLength ${max} (${data.length} chars)` });
	}
	const pattern = schema.pattern;
	if (typeof pattern === "string") {
		let re: RegExp;
		try {
			re = new RegExp(pattern);
		} catch {
			throw new SchemaError(`${path}: schema "pattern" ${JSON.stringify(pattern)} is not a valid RegExp`);
		}
		if (!re.test(data)) issues.push({ path, message: `does not match pattern ${JSON.stringify(pattern)}` });
	}
}

function validateNumber(data: number, schema: Schema, path: string, issues: SchemaIssue[]): void {
	const min = schema.minimum;
	if (typeof min === "number" && data < min) issues.push({ path, message: `below minimum ${min} (got ${data})` });
	const max = schema.maximum;
	if (typeof max === "number" && data > max) issues.push({ path, message: `above maximum ${max} (got ${data})` });
	const emin = schema.exclusiveMinimum;
	if (typeof emin === "number" && data <= emin) issues.push({ path, message: `must be > ${emin} (got ${data})` });
	const emax = schema.exclusiveMaximum;
	if (typeof emax === "number" && data >= emax) issues.push({ path, message: `must be < ${emax} (got ${data})` });
	const mult = schema.multipleOf;
	if (typeof mult === "number" && mult > 0) {
		// Floating multipleOf: quotient must be (near-)integral — the standard
		// tolerance approach, so multipleOf: 0.01 works.
		const q = data / mult;
		if (Math.abs(q - Math.round(q)) > 1e-9) issues.push({ path, message: `not a multiple of ${mult}` });
	}
}

function validateArray(data: unknown[], schema: Schema, path: string, issues: SchemaIssue[], depth: number, root: Schema): void {
	const min = schema.minItems;
	if (typeof min === "number" && data.length < min) {
		issues.push({ path, message: `has ${data.length} items, minItems is ${min}` });
	}
	const max = schema.maxItems;
	if (typeof max === "number" && data.length > max) {
		issues.push({ path, message: `has ${data.length} items, maxItems is ${max}` });
	}
	if (schema.uniqueItems === true) {
		for (let i = 0; i < data.length; i++) {
			for (let j = i + 1; j < data.length; j++) {
				if (deepEqual(data[i], data[j])) {
					issues.push({ path: `${path}[${j}]`, message: `duplicate of item [${i}] (uniqueItems)` });
					break;
				}
			}
		}
	}
	const prefix = schema.prefixItems;
	if (Array.isArray(prefix)) {
		for (let i = 0; i < Math.min(prefix.length, data.length); i++) {
			validate(data[i], normalizeSchema(prefix[i], `${path}[${i}] prefixItems`), `${path}[${i}]`, issues, depth + 1, root);
		}
	}
	const items = schema.items;
	if (items !== undefined && !Array.isArray(items)) {
		const itemSchema = normalizeSchema(items, `${path} items`);
		for (let i = 0; i < data.length; i++) {
			validate(data[i], itemSchema, `${path}[${i}]`, issues, depth + 1, root);
		}
	}
}

function validateObject(
	data: Record<string, unknown>,
	schema: Schema,
	path: string,
	issues: SchemaIssue[],
	depth: number,
	root: Schema,
): void {
	const props = schema.properties;
	const required = schema.required;
	if (Array.isArray(required)) {
		for (const key of required) {
			if (typeof key !== "string") throw new SchemaError(`"required" must contain strings, got ${describe(key)}`);
			if (!(key in data)) issues.push({ path, message: `missing required property "${key}"` });
		}
	}
	const minProps = schema.minProperties;
	if (typeof minProps === "number" && Object.keys(data).length < minProps) {
		issues.push({ path, message: `has ${Object.keys(data).length} properties, minProperties is ${minProps}` });
	}
	const maxProps = schema.maxProperties;
	if (typeof maxProps === "number" && Object.keys(data).length > maxProps) {
		issues.push({ path, message: `has ${Object.keys(data).length} properties, maxProperties is ${maxProps}` });
	}
	if (props !== undefined) {
		if (props === null || typeof props !== "object" || Array.isArray(props)) {
			throw new SchemaError(`"properties" must be an object, got ${describe(props)}`);
		}
		for (const [key, sub] of Object.entries(props as Record<string, unknown>)) {
			if (key in data) {
				validate(data[key], normalizeSchema(sub, `${path}.${key} property schema`), `${path}.${key}`, issues, depth + 1, root);
			}
		}
	}
	const additional = schema.additionalProperties;
	if (additional !== undefined) {
		const known = new Set(Object.keys((props as Record<string, unknown>) ?? {}));
		if (additional === false) {
			for (const key of Object.keys(data)) {
				if (!known.has(key)) issues.push({ path: `${path}.${key}`, message: `unexpected property (additionalProperties: false)` });
			}
		} else if (additional !== true) {
			const addl = normalizeSchema(additional, `${path} additionalProperties`);
			for (const key of Object.keys(data)) {
				if (!known.has(key)) {
					validate(data[key], addl, `${path}.${key}`, issues, depth + 1, root);
				}
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null || typeof a !== "object") return false;
	const aArr = Array.isArray(a);
	const bArr = Array.isArray(b);
	if (aArr !== bArr) return false;
	if (aArr && bArr) {
		if (a.length !== b.length) return false;
		return a.every((v, i) => deepEqual(v, b[i]));
	}
	const aObj = a as Record<string, unknown>;
	const bObj = b as Record<string, unknown>;
	const aKeys = Object.keys(aObj);
	const bKeys = Object.keys(bObj);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every((k) => k in bObj && deepEqual(aObj[k], bObj[k]));
}

function describe(value: unknown): string {
	if (value === undefined) return "undefined";
	const t = dataType(value);
	if (t === "string") return JSON.stringify(String(value).slice(0, 40));
	if (t === "number" || t === "boolean" || t === "null") return String(value);
	return t;
}

function shortList(values: unknown[]): string {
	const shown = values.slice(0, 5).map((v) => JSON.stringify(v)).join(", ");
	return values.length > 5 ? `${shown}, …` : shown;
}

/** Validate a schema's SHAPE up front (before any subagent runs) — the
 *  caller reports malformed schemas immediately instead of after a paid
 *  model call. Checks the keywords we interpret for structure; unknown
 *  keywords are allowed (forward-compat) but noted. */
export function checkSchemaShape(schema: unknown): { ok: boolean; error?: string } {
	try {
		const normalized = normalizeSchema(schema, "schema");
		const unknown = Object.keys(normalized).filter((k) => !SCHEMA_KEYS.has(k));
		if (unknown.length > 0 && unknown.length === Object.keys(normalized).length) {
			// Every keyword is unknown — almost certainly not a JSON Schema.
			return { ok: false, error: `no recognized JSON Schema keywords (found: ${unknown.slice(0, 5).join(", ")})` };
		}
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
