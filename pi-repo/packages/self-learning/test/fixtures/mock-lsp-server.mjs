#!/usr/bin/env node
// Minimal LSP server for tests — Content-Length framed JSON-RPC over stdio.
// Protocol subset: initialize/initialized/shutdown/exit, didOpen/didChange
// with diagnostics publishing, hover, definition, references, documentSymbol.
//
// Diagnostics rules (deterministic):
//   - a line containing "ERROR_TOKEN" → severity 1 (error) at that line
//   - a line containing "warn_token"  → severity 2 (warning) at that line
//   - anything else                   → empty diagnostics (the "clean" publish)
//
// Fault-injection modes for the H1 transport/restart tests (env vars):
//   MOCK_LSP_STRICT=1     didChange for a never-opened doc is IGNORED
//                         (protocol-correct: proves the client re-didOpens
//                         after a server crash instead of sending a lone
//                         didChange the new process never saw a didOpen for)
//   MOCK_LSP_SILENT=1     never publishes diagnostics (wait-skip heuristic)
//   MOCK_LSP_NOISE=1      emits a garbage banner block ("…\r\n\r\n") before
//                         the framed initialize response (header resync)
//   MOCK_LSP_BIG_HEADER=1 answers initialize with a header claiming a 4 GiB
//                         body (Content-Length cap / connection recycle)
//   MOCK_LSP_LF=1         frames with LF-only headers ("\n\n")
//   $/mockCrash request   process.exit(1) — mid-session crash on demand
//
// H2 modes:
//   MOCK_LSP_PROBE=1      right after the initialize reply, SENDS two
//                         server→client requests — workspace/configuration
//                         (numeric id 9101) and an unknown method (string id
//                         "probe-2") — and records the client's replies;
//                         the $/probeStatus request reports them (deferred
//                         until both replies arrived, so the test cannot
//                         race the round-trip).
//   MOCK_LSP_STRING_ID=1  echoes every RESPONSE id as a STRING — proves the
//                         client normalizes pending-request keys with
//                         String(id) instead of strict numeric matching.
//
// URI handling is spec-correct (H2): incoming document URIs are decoded to
// file PATHS (fragment/query split + percent-decoding, like a real server
// mapping URI→filename), documents are keyed by path, and every outgoing URI
// (publishDiagnostics, definition/references results) is re-encoded. A
// client that leaves '#', '?', '%' or control bytes raw in its URIs names a
// different document than the file on disk, so didOpen↔publishDiagnostics
// stop agreeing — exactly what the exotic-filename tests pin down.
import { stdin, stdout } from "node:process";

const strict = process.env.MOCK_LSP_STRICT === "1";
const silent = process.env.MOCK_LSP_SILENT === "1";
const noise = process.env.MOCK_LSP_NOISE === "1";
const bigHeader = process.env.MOCK_LSP_BIG_HEADER === "1";
const lfOnly = process.env.MOCK_LSP_LF === "1";
const probe = process.env.MOCK_LSP_PROBE === "1";
const stringifyIds = process.env.MOCK_LSP_STRING_ID === "1";

let buffer = Buffer.alloc(0);
const docs = new Map(); // decoded file path -> text
const probeReplies = { config: null, unknown: null };
const probeStatusWaiters = [];

function send(msg) {
    if (stringifyIds && msg.method === undefined && msg.id !== undefined) {
        msg = { ...msg, id: String(msg.id) };
    }
    const body = Buffer.from(JSON.stringify(msg), "utf8");
    const sep = lfOnly ? "\n\n" : "\r\n\r\n";
    stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}${sep}`, "ascii"), body]));
}

// --- spec-correct URI ↔ path conversion (mirrors the client's H2 encoder) ---

const URI_PATH_SAFE = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/]$/;

function encodePath(p) {
    let out = "";
    for (const ch of p) {
        if (URI_PATH_SAFE.test(ch)) {
            out += ch;
            continue;
        }
        for (const b of Buffer.from(ch, "utf8")) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
    }
    return out;
}

function decodePath(uri) {
    let raw = uri.startsWith("file://") ? uri.slice("file://".length) : uri;
    const hash = raw.indexOf("#");
    if (hash >= 0) raw = raw.slice(0, hash); // a real server parses the fragment OFF
    const query = raw.indexOf("?");
    if (query >= 0) raw = raw.slice(0, query); // …and the query too
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

function fileUri(path) {
    return `file://${encodePath(path)}`;
}

function rng(sl, sc, el, ec) {
    return { start: { line: sl, character: sc }, end: { line: el, character: ec } };
}

function publish(key, text) {
    if (silent) return;
    const diagnostics = [];
    const lines = text.split("\n");
    lines.forEach((line, i) => {
        if (line.includes("ERROR_TOKEN")) {
            diagnostics.push({
                range: rng(i, line.indexOf("ERROR_TOKEN"), i, line.indexOf("ERROR_TOKEN") + 11),
                severity: 1,
                message: "ERROR_TOKEN is not allowed",
                source: "mock-ls",
            });
        }
        if (line.includes("warn_token")) {
            diagnostics.push({ range: rng(i, 0, i, 1), severity: 2, message: "warn_token found", source: "mock-ls" });
        }
    });
    send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: fileUri(key), diagnostics } });
}

function wordAt(text, line, char) {
    const lines = text.split("\n");
    const l = lines[line] ?? "";
    let s = char;
    while (s > 0 && /\w/.test(l[s - 1])) s--;
    let e = char;
    while (e < l.length && /\w/.test(l[e])) e++;
    return l.slice(s, e) || "unknown";
}

/** Record the client's replies to the H2 probe requests (mock asserts on stdin). */
function recordProbeReply(msg) {
    if (msg.id === 9101) probeReplies.config = msg;
    if (msg.id === "probe-2") probeReplies.unknown = msg;
    if (probeReplies.config && probeReplies.unknown) {
        for (const w of probeStatusWaiters.splice(0)) w();
    }
}

function handle(msg) {
    // A RESPONSE from the client (no method): either a probe reply (record
    // it) or nothing the mock needs — never fall through to the request
    // switch, which would "reply" to a reply.
    if (msg.method === undefined && msg.id !== undefined) {
        if (probe) recordProbeReply(msg);
        return;
    }
    const { id, method, params } = msg;
    switch (method) {
        case "initialize":
            if (bigHeader) {
                // Poisoned framing: a plausible header claiming a 4 GiB body.
                stdout.write("Content-Length: 4294967296\r\n\r\n{}");
                return;
            }
            if (noise) {
                // Startup banner block (no Content-Length, blank-line ended)
                // co-buffered ahead of the real framed response.
                stdout.write("mock-ls listening on port 1234\r\n\r\n");
            }
            send({
                jsonrpc: "2.0",
                id,
                result: {
                    capabilities: {
                        textDocumentSync: 1,
                        hoverProvider: true,
                        definitionProvider: true,
                        referencesProvider: true,
                        documentSymbolProvider: true,
                    },
                },
            });
            if (probe) {
                // H2 probe: a known server→client request with a NUMERIC id
                // and an unknown one with a STRING id — the client must reply
                // result [] / error -32601 respectively, echoing both id forms.
                send({ jsonrpc: "2.0", id: 9101, method: "workspace/configuration", params: { items: [{ section: "ts" }] } });
                send({ jsonrpc: "2.0", id: "probe-2", method: "workspace/unknownProbe", params: {} });
            }
            break;
        case "initialized":
            break;
        case "shutdown":
            send({ jsonrpc: "2.0", id, result: null });
            break;
        case "exit":
            process.exit(0);
            break;
        case "$/mockCrash":
            process.exit(1);
            break;
        case "$/probeStatus": {
            const reply = () =>
                send({ jsonrpc: "2.0", id, result: { config: probeReplies.config, unknown: probeReplies.unknown } });
            if (!probe || (probeReplies.config && probeReplies.unknown)) reply();
            else probeStatusWaiters.push(reply); // flush when both probes are answered
            break;
        }
        case "textDocument/didOpen": {
            const key = decodePath(params.textDocument.uri);
            docs.set(key, params.textDocument.text);
            publish(key, params.textDocument.text);
            break;
        }
        case "textDocument/didChange": {
            const key = decodePath(params.textDocument.uri);
            if (strict && !docs.has(key)) {
                // Protocol-correct servers ignore didChange for unknown docs.
                return;
            }
            docs.set(key, params.contentChanges[0].text);
            publish(key, params.contentChanges[0].text);
            break;
        }
        case "textDocument/hover": {
            const text = docs.get(decodePath(params.textDocument.uri)) ?? "";
            send({
                jsonrpc: "2.0",
                id,
                result: { contents: `hover(${wordAt(text, params.position.line, params.position.character)})` },
            });
            break;
        }
        case "textDocument/definition": {
            const key = decodePath(params.textDocument.uri);
            send({ jsonrpc: "2.0", id, result: [{ uri: fileUri(key), range: rng(0, 0, 0, 1) }] });
            break;
        }
        case "textDocument/references": {
            const key = decodePath(params.textDocument.uri);
            send({
                jsonrpc: "2.0",
                id,
                result: [
                    {
                        uri: fileUri(key),
                        range: rng(
                            params.position.line,
                            params.position.character,
                            params.position.line,
                            params.position.character + 1,
                        ),
                    },
                ],
            });
            break;
        }
        case "textDocument/documentSymbol":
            send({
                jsonrpc: "2.0",
                id,
                result: [
                    {
                        name: "mockFn",
                        kind: 12,
                        range: rng(0, 0, 2, 0),
                        selectionRange: rng(0, 0, 0, 6),
                        children: [{ name: "inner", kind: 8, range: rng(1, 0, 1, 5), selectionRange: rng(1, 0, 1, 5) }],
                    },
                ],
            });
            break;
        default:
            // Unknown server→client request: reply null so the client moves on.
            if (id !== undefined) send({ jsonrpc: "2.0", id, result: null });
    }
}

stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString("ascii");
        const m = /Content-Length:\s*(\d+)/i.exec(header);
        if (!m) {
            buffer = Buffer.alloc(0);
            return;
        }
        const len = Number(m[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + len) return;
        const body = buffer.subarray(bodyStart, bodyStart + len).toString("utf8");
        buffer = buffer.subarray(bodyStart + len);
        let msg;
        try {
            msg = JSON.parse(body);
        } catch {
            continue;
        }
        handle(msg);
    }
});

stdin.on("end", () => process.exit(0));
