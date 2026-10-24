/**
 * output-schema.ts — `unown -p --output-schema <file.json>` (the 2026-10-24
 * CI round; Codex `exec --output-schema` / Claude Code `--json-schema`
 * parity). The headless run becomes a pipeline STEP: the final answer must
 * parse as JSON and validate against a JSON Schema, or the run exits 3 —
 * composable with `--output-format json` (the envelope gains `schema_valid`
 * + `schema_issues`) and refused with `--mode json` (an event stream has no
 * single final answer to validate).
 *
 * Leniency contract (the LLM-reality half, from the subagent output_schema
 * lane's design): models wrap JSON in \`\`\`json fences and pad it with
 * prose — the extractor strips ONE leading/trailing fence pair and parses
 * the remainder; a total parse failure is a schema failure with the
 * actionable message, never a crash. Validation itself reuses the
 * dependency-free validator the `task` tool's output_schema runs
 * (jsonschema.ts — the practical draft-2020-12 subset, JSON-path issues).
 *
 * Exit codes: 0 ok · 1 run error/empty answer · 2 usage · 3 schema-invalid
 * (3 is this flag's addition, documented in the CLI help).
 */

import { readFileSync } from "node:fs";
import { checkSchemaShape, validateJsonSchema, type SchemaIssue } from "./jsonschema.ts";

/** Load + structurally check a schema file. Never throws. */
export function loadOutputSchema(path: string): { ok: true; schema: unknown } | { ok: false; error: string } {
    let text: string;
    try {
        text = readFileSync(path, "utf8");
    } catch (err: any) {
        return { ok: false, error: `--output-schema: cannot read ${path} (${err instanceof Error ? err.message : String(err)})` };
    }
    let doc: unknown;
    try {
        doc = JSON.parse(text);
    } catch (err: any) {
        return { ok: false, error: `--output-schema: ${path} is not valid JSON (${err instanceof Error ? err.message : String(err)})` };
    }
    const shape = checkSchemaShape(doc);
    if (!shape.ok) return { ok: false, error: `--output-schema: ${path}: ${shape.error}` };
    return { ok: true, schema: doc };
}

/** Strip ONE wrapping code fence (```json … ``` / ``` … ```) — the common
 *  LLM padding. Bare JSON and multi-fence texts pass through untouched. */
export function stripCodeFence(text: string): string {
    const trimmed = text.trim();
    const m = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(trimmed);
    return m ? m[1].trim() : trimmed;
}

/** Parse the final answer text as JSON (fence-stripped). */
export function parseAnswerJson(text: string): { ok: true; data: unknown } | { ok: false; error: string } {
    const cleaned = stripCodeFence(text ?? "");
    if (!cleaned) return { ok: false, error: "the final answer is empty" };
    try {
        return { ok: true, data: JSON.parse(cleaned) };
    } catch (err: any) {
        return { ok: false, error: `the final answer is not valid JSON (${err instanceof Error ? err.message : String(err)})` };
    }
}

export interface SchemaValidation {
    valid: boolean;
    /** The parsed data when the answer was valid JSON (null otherwise). */
    data: unknown;
    /** Human-readable issues: the parse error or the validator's JSON paths. */
    issues: string[];
}

/** Full validation: fence-strip → parse → validate. Pure; never throws. */
export function validateAnswerAgainstSchema(text: string, schema: unknown): SchemaValidation {
    const parsed = parseAnswerJson(text);
    if (!parsed.ok) return { valid: false, data: null, issues: [parsed.error] };
    try {
        const res = validateJsonSchema(parsed.data, schema);
        if (res.valid) return { valid: true, data: parsed.data, issues: [] };
        return { valid: false, data: null, issues: res.issues.map(formatIssue) };
    } catch (err: any) {
        // A malformed schema passed the shape check — report, never crash.
        return { valid: false, data: null, issues: [err instanceof Error ? err.message : String(err)] };
    }
}

function formatIssue(issue: SchemaIssue): string {
    return `${issue.path}: ${issue.message}`;
}

/** The stderr block a failed validation prints. */
export function renderSchemaFailure(issues: string[]): string {
    const shown = issues.slice(0, 8);
    const more = issues.length > shown.length ? `\n  … +${issues.length - shown.length} more` : "";
    return `unown: --output-schema validation FAILED (${issues.length} issue(s)):\n${shown.map((i) => `  ${i}`).join("\n")}${more}`;
}
