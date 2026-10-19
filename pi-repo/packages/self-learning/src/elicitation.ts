/**
 * elicitation.ts — MCP mid-turn structured input (Milestone 2.3).
 *
 * Reverse-engineered from goose's `elicitation.rs` + the MCP standard's
 * elicitation capability. A headless agent cannot surface a JSON-schema
 * prompt to a human mid-turn, so this module is the pure, testable core
 * that decides what to do with an `elicitation/create` request from an
 * MCP server:
 *
 *   - `accept`  — synthesize dummy data satisfying `requestedSchema` and
 *     return it; the server proceeds as if the user filled the form.
 *     Only happens when the per-server config opts into `autoAccept`
 *     (the model is the "user" in a headless context, the server is
 *     trusted) AND the dummy data actually validates against the
 *     schema. If the schema requires fields the dummy doesn't have,
 *     the request is declined (never crashes, never sends invalid data
 *     to a server).
 *   - `decline` — the default for a headless agent. The server gets a
 *     structured "user declined" reply and may choose to surface its
 *     own fallback path; the agent never sees the request directly.
 *     Also returned when the request is well-formed JSON-RPC but the
 *     schema is not an object schema we can synthesize from, or when
 *     `autoAccept` is on but the dummy data fails validation against
 *     the schema.
 *   - `cancel`  — the request was malformed (missing message or
 *     requestedSchema, or requestedSchema is not an object), OR the
 *     per-server policy opted out of both autoAccept and autoDecline
 *     (no opinion — the server may try again later).
 *
 * No pi imports — pure module. The MCP transport layer (mcp.ts) wires
 * this into the JSON-RPC `elicitation/create` server→client request
 * path; the policy is read from `.unown/mcp.json` (or
 * `~/.unown/agent/mcp.json`) per server:
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "my-server": {
 *       "command": "npx",
 *       "args": ["-y", "my-mcp-server"],
 *       "elicitation": {
 *         "autoAccept": false,
 *         "autoDecline": true,
 *         "defaultReason": "auto-declined by unown (no UI)"
 *       }
 *     }
 *   }
 * }
 * ```
 */
import { validateJsonSchema } from "./jsonschema.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Per-server elicitation policy. All fields optional — when absent the
 * defaults from `defaultElicitationConfig()` apply (`autoDecline: true`
 * with the headless-no-UI reason).
 */
export interface ElicitationConfig {
        /** Server may elicit any data without confirmation (use with caution). */
        autoAccept?: boolean;
        /** Default true: server requests are declined with `defaultReason`. */
        autoDecline?: boolean;
        /** Reason placed in the `content.reason` field when declining. */
        defaultReason?: string;
}

/** A fully-resolved elicitation policy (no optional fields). */
export type ResolvedElicitationConfig = Required<ElicitationConfig>;

/**
 * The incoming `elicitation/create` request payload from the server, in
 * the shape the MCP standard defines:
 *
 * ```jsonc
 * {
 *   "message": "Please confirm deletion of 5 files",
 *   "requestedSchema": { "type": "object", "properties": { ... }, "required": [...] }
 * }
 * ```
 *
 * Both fields are typed as `unknown` so the decision function can
 * validate them itself — the server is a remote process and its data
 * is untrusted.
 */
export interface ElicitationRequest {
        message?: unknown;
        requestedSchema?: unknown;
}

/**
 * The decision returned by `decideElicitation`. Maps 1:1 to the MCP
 * `elicitation/create` result envelope:
 *
 *   - `accept` carries `content` with the synthesized data.
 *   - `decline` carries no `content` (the transport layer may attach
 *     the `defaultReason` for debugging — see `mcp.ts:handleElicitation`).
 *   - `cancel` carries no `content`.
 */
export interface ElicitationDecision {
        action: "accept" | "decline" | "cancel";
        content?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Defaults + dummy
// ---------------------------------------------------------------------------

/**
 * The synthesized data returned on `accept`. Only `confirmed` is
 * auto-set (the most common boolean-confirmation shape); `reason` is
 * a marker string the server can surface in its own logs. If the
 * server's `requestedSchema` requires fields outside this dummy, the
 * request is declined — never an invalid accept.
 */
export const ELICITATION_DEFAULT_DUMMY: Readonly<Record<string, unknown>> = Object.freeze({
        confirmed: true,
        reason: "auto-accepted by unown",
});

/**
 * The default elicitation policy: a headless agent declines every
 * server-initiated elicitation with the headless-no-UI reason. Servers
 * that need auto-accept must opt in per-entry in `.unown/mcp.json`.
 */
export function defaultElicitationConfig(): ResolvedElicitationConfig {
        return {
                autoAccept: false,
                autoDecline: true,
                defaultReason: "auto-declined by unown (no UI)",
        };
}

/**
 * Resolve a per-server `elicitation` block against the defaults. Missing
 * fields fall back to `defaultElicitationConfig()`:
 *   - `autoAccept` defaults to `false` (must be explicitly `true`).
 *   - `autoDecline` defaults to `true` (must be explicitly `false`).
 *   - `defaultReason` defaults to the headless-no-UI string when empty
 *     or non-string.
 */
export function resolveElicitationConfig(cfg: ElicitationConfig | undefined): ResolvedElicitationConfig {
        const d = defaultElicitationConfig();
        const e = cfg ?? {};
        return {
                autoAccept: e.autoAccept === true,
                autoDecline: e.autoDecline !== false,
                defaultReason: typeof e.defaultReason === "string" && e.defaultReason ? e.defaultReason : d.defaultReason,
        };
}

// ---------------------------------------------------------------------------
// Schema validation (minimal — wraps jsonschema.ts)
// ---------------------------------------------------------------------------

/**
 * Validate `data` against `schema` (a JSON Schema object). Returns
 * `true` when valid, `false` otherwise. A malformed schema (not an
 * object, references that escape the document, etc.) is treated as
 * invalid — the auto-accept path then declines rather than emitting
 * potentially-wrong data.
 *
 * Wraps `validateJsonSchema` from `./jsonschema.ts` (the existing
 * minimal draft 2020-12 subset validator used by subagent structured
 * outputs) — no re-implementation.
 */
export function validateAgainstSchema(data: unknown, schema: unknown): boolean {
        try {
                return validateJsonSchema(data, schema).valid;
        } catch {
                // SchemaError (malformed schema) — treat as invalid so the caller
                // declines instead of accepting with potentially-wrong data.
                return false;
        }
}

// ---------------------------------------------------------------------------
// The decision function (pure, testable core)
// ---------------------------------------------------------------------------

/**
 * Decide how to respond to an `elicitation/create` server→client request.
 *
 * Decision tree:
 *   1. **Malformed request** — no `message` (or not a string), no
 *      `requestedSchema` (or not an object) → `cancel` (the server did
 *      not send a usable JSON-RPC payload; we cannot even classify it
 *      as accept-or-decline).
 *   2. **`requestedSchema` is not an object schema** with a `properties`
 *      map (e.g. `{type: "string"}`) → `decline` (the request was
 *      well-formed JSON-RPC, but we cannot synthesize data of the
 *      declared shape — the server deserves a definitive "no" so it can
 *      move to its fallback).
 *   3. **`requestedSchema.required` is malformed** (not an array of
 *      strings) → `decline` (we cannot trust the schema's contract).
 *   4. **`autoAccept: true`** — validate `ELICITATION_DEFAULT_DUMMY`
 *      against the schema. If it validates → `accept` with the dummy
 *      as `content`. If it doesn't (e.g. the schema requires a field
 *      the dummy doesn't have) → `decline` (never send invalid data,
 *      never cancel — the request was well-formed, we just couldn't
 *      satisfy it).
 *   5. **`autoDecline: true`** (the default) → `decline`.
 *   6. **Neither autoAccept nor autoDecline** → `cancel` (the user did
 *      not opt into either path; treat as cancelled, which the server
 *      may interpret as "try again later").
 *
 * Precedence: `autoAccept` wins over `autoDecline` when both are `true`
 * (the explicit opt-in is the stronger signal — test 6 of the spec
 * pins this). Malformed requests short-circuit to `cancel` regardless
 * of config (we cannot pretend to accept or decline a request we
 * don't understand).
 */
export function decideElicitation(
        request: ElicitationRequest | null | undefined,
        config: ElicitationConfig | ResolvedElicitationConfig | undefined,
): ElicitationDecision {
        const cfg = resolveElicitationConfig(config);

        // (1) Malformed request — no usable message or requestedSchema.
        if (
                !request ||
                typeof request !== "object" ||
                typeof request.message !== "string" ||
                typeof request.requestedSchema !== "object" ||
                request.requestedSchema === null ||
                Array.isArray(request.requestedSchema)
        ) {
                return { action: "cancel" };
        }

        const schema = request.requestedSchema as {
                type?: unknown;
                properties?: unknown;
                required?: unknown;
        };

        // (2) requestedSchema is present but is not an object schema with
        // a properties map → decline (we cannot synthesize data, but the
        // request was well-formed JSON-RPC — the server deserves a "no").
        if (schema.type !== "object" || typeof schema.properties !== "object" || schema.properties === null) {
                return { action: "decline" };
        }

        // (3) Malformed `required` (must be an array of strings, if present).
        if (schema.required !== undefined) {
                if (!Array.isArray(schema.required) || !schema.required.every((r) => typeof r === "string")) {
                        return { action: "decline" };
                }
        }

        // (4) autoAccept path — validate the dummy against the schema.
        if (cfg.autoAccept) {
                if (validateAgainstSchema(ELICITATION_DEFAULT_DUMMY, schema)) {
                        return { action: "accept", content: { ...ELICITATION_DEFAULT_DUMMY } };
                }
                // The dummy does not satisfy the schema (typically a missing
                // required field the server declared) → decline. We do NOT
                // cancel here: the request was well-formed, the server
                // deserves a definitive "no" so it can move to its fallback.
                return { action: "decline" };
        }

        // (5) autoDecline path (the default).
        if (cfg.autoDecline) {
                return { action: "decline" };
        }

        // (6) Neither autoAccept nor autoDecline → cancel.
        return { action: "cancel" };
}
