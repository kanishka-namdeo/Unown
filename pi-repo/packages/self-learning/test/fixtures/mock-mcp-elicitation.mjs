#!/usr/bin/env node
// Minimal MCP stdio server for the elicitation tests (Milestone 2.3).
//
// After the initialize handshake the server sends one `elicitation/create`
// request to the client and stashes the client's reply on disk so the test
// can assert on the exact JSON-RPC response shape (action: accept/decline/
// cancel + content). The schema + message are configurable via env vars:
//
//   MOCK_ELICITATION_MESSAGE    default "Please confirm deletion"
//   MOCK_ELICITATION_SCHEMA     JSON-encoded requestedSchema (object schema)
//   MOCK_ELICITATION_RESULT     file path to write the client's reply to
//   MOCK_ELICITATION_MALFORMED  "1" — send a malformed elicitation/create
//                               (no message + no requestedSchema) — exercises
//                               the cancel path
//   MOCK_ELICITATION_BADSCHEMA  "1" — send a schema that is not an object
//                               schema with properties (exercises decline)
//   MOCK_INIT_PARAMS_PATH       file path to write the initialize params the
//                               client sent (capabilities, clientInfo,
//                               protocolVersion) — lets tests assert on the
//                               capability advertisement without Bun.serve.
import { stdin, stdout } from "node:process";
import { writeFileSync } from "node:fs";

const MESSAGE = process.env.MOCK_ELICITATION_MESSAGE ?? "Please confirm deletion";
const RESULT_PATH = process.env.MOCK_ELICITATION_RESULT ?? "";
const INIT_PARAMS_PATH = process.env.MOCK_INIT_PARAMS_PATH ?? "";
const MALFORMED = process.env.MOCK_ELICITATION_MALFORMED === "1";
const BADSCHEMA = process.env.MOCK_ELICITATION_BADSCHEMA === "1";
const SCHEMA = process.env.MOCK_ELICITATION_SCHEMA
    ? JSON.parse(process.env.MOCK_ELICITATION_SCHEMA)
    : {
            type: "object",
            properties: {
                confirmed: { type: "boolean" },
                reason: { type: "string" },
            },
            required: ["confirmed"],
        };

function send(msg) {
    stdout.write(JSON.stringify(msg) + "\n");
}

let elicitationSent = false;

function maybeSendElicitation() {
    if (elicitationSent) return;
    elicitationSent = true;
    const id = 42;
    if (MALFORMED) {
        send({ jsonrpc: "2.0", id, method: "elicitation/create", params: { /* no message, no requestedSchema */ } });
    } else if (BADSCHEMA) {
        send({
            jsonrpc: "2.0",
            id,
            method: "elicitation/create",
            params: { message: MESSAGE, requestedSchema: { type: "string" } },
        });
    } else {
        send({
            jsonrpc: "2.0",
            id,
            method: "elicitation/create",
            params: { message: MESSAGE, requestedSchema: SCHEMA },
        });
    }
}

function handle(msg) {
    const { id, method, params } = msg;
    switch (method) {
        case "initialize":
            // Stash the initialize params so tests can assert on the client's
            // advertised capabilities (elicitation: {}) without needing
            // Bun.serve — keeps the test on the stdio transport that does
            // not exhibit the HPE_UNEXPECTED_CONTENT_LENGTH race under
            // bun:test.
            if (INIT_PARAMS_PATH) {
                try {
                    writeFileSync(INIT_PARAMS_PATH, JSON.stringify(params, null, 2));
                } catch {
                    /* best effort */
                }
            }
            send({
                jsonrpc: "2.0",
                id,
                result: {
                    protocolVersion: "2025-06-18",
                    capabilities: { tools: {}, elicitation: {} },
                    serverInfo: { name: "mock-elicitation", version: "1.0.0" },
                },
            });
            // Fire the elicitation/create once the client is initialized.
            // (microtask delay so the client registers our initialized
            // notification first)
            setTimeout(maybeSendElicitation, 10);
            break;
        case "notifications/initialized":
            break;
        case "ping":
            send({ jsonrpc: "2.0", id, result: {} });
            break;
        case "tools/list":
            send({ jsonrpc: "2.0", id, result: { tools: [] } });
            break;
        default:
            if (id !== undefined) {
                send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
            }
    }
}

let buffer = "";
stdin.setEncoding("utf8");
stdin.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
            msg = JSON.parse(line);
        } catch {
            continue;
        }
        // Capture the client's elicitation/create reply (it has our id=42
        // and a `result.action` field). Stash it on disk for the test.
        if (msg.id === 42 && msg.result && typeof msg.result.action === "string") {
            if (RESULT_PATH) {
                try {
                    writeFileSync(RESULT_PATH, JSON.stringify(msg, null, 2));
                } catch {
                    /* best effort */
                }
            }
            continue;
        }
        handle(msg);
    }
});
stdin.on("end", () => process.exit(0));
