#!/usr/bin/env node
// Minimal MCP stdio server for tests — newline-delimited JSON-RPC.
// Protocol subset: initialize, notifications/initialized, tools/list (with
// cursor pagination on demand), tools/call (echo + add), ping, and unknown
// methods → JSON-RPC error. Set MOCK_MCP_PRETTY=1 to emit pretty-printed
// multi-line JSON (exercises the depth-aware client parser).
//
// Fault-injection modes for the H1 transport tests (env vars):
//   MOCK_MCP_GARBAGE=1  before the initialize response, emit stray closers,
//                       NULs and a text banner — exercises the accumulator's
//                       garbage recovery on a real transport
//   $/mockCrash method  process.exit(1) — mid-session crash on demand
import { stdin, stdout } from "node:process";

const pretty = process.env.MOCK_MCP_PRETTY === "1";
const garbage = process.env.MOCK_MCP_GARBAGE === "1";
const TOOLS = [
    {
        name: "echo",
        description: "Echo a message back with a prefix.",
        inputSchema: {
            type: "object",
            properties: { message: { type: "string", description: "text to echo" } },
            required: ["message"],
        },
    },
    {
        name: "add",
        description: "Add two numbers.",
        inputSchema: {
            type: "object",
            properties: { a: { type: "number" }, b: { type: "number" } },
            required: ["a", "b"],
        },
    },
    {
        name: "schemaless",
        description: "Tool with no usable input schema.",
    },
];

function send(msg) {
    const text = JSON.stringify(msg, null, pretty ? 2 : 0);
    stdout.write(text + "\n");
}

function handle(msg) {
    const { id, method, params } = msg;
    switch (method) {
        case "initialize":
            if (garbage) {
                // Stray closers + NULs + a banner line — all classic stdout
                // pollution. A depth-clamped, garbage-isolating accumulator
                // must still deliver the initialize response after it.
                stdout.write("]}\n\0\0mock-mcp starting up\n");
            }
            send({
                jsonrpc: "2.0",
                id,
                result: {
                    protocolVersion: "2025-06-18",
                    capabilities: { tools: {} },
                    serverInfo: { name: "mock-mcp", version: "1.0.0" },
                },
            });
            break;
        case "notifications/initialized":
            break;
        case "ping":
            send({ jsonrpc: "2.0", id, result: {} });
            break;
        case "$/mockCrash":
            process.exit(1);
            break;
        case "tools/list": {
            const cursor = typeof params?.cursor === "string" ? Number(params.cursor) : 0;
            if (Number.isNaN(cursor) || cursor < 0 || cursor >= TOOLS.length) {
                send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
                break;
            }
            // one tool per page when a cursor flow is requested
            send({
                jsonrpc: "2.0",
                id,
                result: { tools: [TOOLS[cursor]], nextCursor: cursor + 1 < TOOLS.length ? String(cursor + 1) : undefined },
            });
            break;
        }
        case "tools/call": {
            const name = params?.name;
            const args = params?.arguments ?? {};
            if (name === "echo") {
                send({
                    jsonrpc: "2.0",
                    id,
                    result: { content: [{ type: "text", text: `echo: ${String(args.message ?? "")}` }] },
                });
            } else if (name === "add") {
                send({
                    jsonrpc: "2.0",
                    id,
                    result: { content: [{ type: "text", text: String(Number(args.a ?? 0) + Number(args.b ?? 0)) }] },
                });
            } else if (name === "schemaless") {
                send({
                    jsonrpc: "2.0",
                    id,
                    result: { content: [{ type: "text", text: `got ${JSON.stringify(args)}` }] },
                });
            } else {
                send({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool ${name}` } });
            }
            break;
        }
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
    // NDJSON: one message per line (multi-line objects are not sent by OUR client)
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
        handle(msg);
    }
});
stdin.on("end", () => process.exit(0));
