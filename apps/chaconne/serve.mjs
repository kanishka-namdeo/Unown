#!/usr/bin/env bun
/**
 * Chaconne — transpiling static dev/test server (C-3; the Ostinato
 * serve.mjs port, verbatim shape).
 *
 * Serves apps/chaconne/ as the document root: plain static files, .ts
 * modules transpiled on the fly (Bun.Transpiler, loader "tsx"),
 * extensionless + .js→.ts import resolution (the compiled module graph
 * keeps the `./x.js` convention; the server maps it back to the x.ts
 * source). Serves the test/fixtures/ tree too (the P0 #5 fixture lane —
 * the e2e + the runner's real adapter address them at
 * http://127.0.0.1:4014/test/fixtures/…).
 *
 * Runs under `bun` only (Bun.Transpiler is bun-only). ES2020+ plain
 * JS, no TypeScript syntax. Dev/test server: no caching headers, no
 * auth, bound to 127.0.0.1. Port: CHACONNE_PORT, default 4014 (the
 * next free port after Ostinato's 4013; the PLAN §4 naming ruling).
 */
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

const ROOT = resolve(import.meta.dirname);
const PORT = Number(process.env.CHACONNE_PORT ?? 4014);

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const transpiler = new Bun.Transpiler({ loader: "tsx" });

async function tryFile(p) {
  try {
    const buf = await readFile(p);
    const type = MIME[extname(p)] ?? "application/octet-stream";
    // transformSync, NOT transform: the async form returns a Promise,
    // and Response(promise) coerces the body to the literal string
    // "[object Promise]" — the browser then fails with
    // "Unexpected identifier 'Promise'" (the Ostinato/Coda live receipt).
    const body = extname(p) === ".ts" ? transpiler.transformSync(buf.toString("utf8")) : buf;
    return new Response(body, {
      headers: extname(p) === ".ts" ? { "content-type": "text/javascript" } : { "content-type": type },
    });
  } catch {
    return null;
  }
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: async (req) => {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    p = p === "" ? "index.html" : p;
    let res = await tryFile(resolve(ROOT, p));
    if (!res) res = await tryFile(resolve(ROOT, p + ".ts"));
    if (!res) res = await tryFile(resolve(ROOT, p + ".js"));
    // TS-in-browser dev-server rule: compiled module graphs keep the
    // `./x.js` specifier convention; map it back to the `x.ts` source
    // (tryFile transpiles it).
    if (!res && p.endsWith(".js")) res = await tryFile(resolve(ROOT, p.slice(0, -3) + ".ts"));
    return res ?? new Response("not found", { status: 404 });
  },
});

console.log(`[chaconne] serving ${ROOT} at http://127.0.0.1:${PORT}`);
