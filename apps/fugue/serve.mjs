#!/usr/bin/env bun
/**
 * Fugue — transpiling dev/test server (ticket F-4, the PWA shell).
 *
 * The ostinato/bolero `serve.mjs` port, trimmed: serves
 * apps/fugue/ as the document root — plain static files, .ts modules
 * transpiled on the fly (Bun.Transpiler, loader "tsx"), extensionless
 * import resolution (<path>.ts then <path>.js). The FUGUE_PORT env
 * var picks the port (default 4015 — the PLAN §5 ops contract; the
 * capture-usage lane takes 4016).
 *
 * `GET /health` answers `{ "ok": true, "port": <PORT> }` — the cheap
 * liveness probe the e2e webServer asserts on before launching specs.
 *
 * Runs under `bun` only (Bun.Transpiler is bun-only). ES2020+ plain
 * JS, no TypeScript syntax. Dev/test server: no caching headers, no
 * auth, bound to 127.0.0.1.
 */
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

const ROOT = resolve(import.meta.dirname);
const PORT = Number(process.env.FUGUE_PORT ?? 4015);

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
    // "Unexpected identifier 'Promise'" (the Coda C4 lane's pitfall).
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
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");

    // The cheap liveness probe the e2e webServer waits on.
    if (path === "health") {
      return new Response(JSON.stringify({ ok: true, port: PORT }), {
        headers: { "content-type": "application/json" },
      });
    }

    let p = path === "" ? "index.html" : path;
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

console.log(`[fugue] serving ${ROOT} at http://127.0.0.1:${PORT}`);
