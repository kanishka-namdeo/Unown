#!/usr/bin/env node
// Minimal LSP server for tests — Content-Length framed JSON-RPC over stdio.
// Protocol subset: initialize/initialized/shutdown/exit, didOpen/didChange
// with diagnostics publishing, hover, definition, references, documentSymbol.
//
// Diagnostics rules (deterministic):
//   - a line containing "ERROR_TOKEN" → severity 1 (error) at that line
//   - a line containing "warn_token"  → severity 2 (warning) at that line
//   - anything else                   → empty diagnostics (the "clean" publish)
import { stdin, stdout } from "node:process";

let buffer = Buffer.alloc(0);
const docs = new Map(); // uri -> text

function send(msg) {
    const body = Buffer.from(JSON.stringify(msg), "utf8");
    stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]));
}

function rng(sl, sc, el, ec) {
    return { start: { line: sl, character: sc }, end: { line: el, character: ec } };
}

function publish(uri, text) {
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
    send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics } });
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

function handle(msg) {
    const { id, method, params } = msg;
    switch (method) {
        case "initialize":
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
            break;
        case "initialized":
            break;
        case "shutdown":
            send({ jsonrpc: "2.0", id, result: null });
            break;
        case "exit":
            process.exit(0);
            break;
        case "textDocument/didOpen":
            docs.set(params.textDocument.uri, params.textDocument.text);
            publish(params.textDocument.uri, params.textDocument.text);
            break;
        case "textDocument/didChange":
            docs.set(params.textDocument.uri, params.contentChanges[0].text);
            publish(params.textDocument.uri, params.contentChanges[0].text);
            break;
        case "textDocument/hover": {
            const text = docs.get(params.textDocument.uri) ?? "";
            send({
                jsonrpc: "2.0",
                id,
                result: { contents: `hover(${wordAt(text, params.position.line, params.position.character)})` },
            });
            break;
        }
        case "textDocument/definition":
            send({ jsonrpc: "2.0", id, result: [{ uri: params.textDocument.uri, range: rng(0, 0, 0, 1) }] });
            break;
        case "textDocument/references":
            send({
                jsonrpc: "2.0",
                id,
                result: [
                    {
                        uri: params.textDocument.uri,
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
