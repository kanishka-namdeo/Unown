#!/usr/bin/env bun
/**
 * Bolero — transpiling static dev/test server (ticket S-5, the V-18
 * topology the operator handed down).
 *
 * Ostinato `serve.mjs` port, with the one bolero twist: it reverse-
 * proxies /api/* and /health to the real API server (BOLERO_PORT,
 * default 4050) so the dashboard is same-origin everywhere — zero
 * CORS, zero static coupling inside the API server.
 *
 * Serves apps/bolero/ as the document root — plain static files, .ts
 * modules transpiled on the fly (Bun.Transpiler, loader "tsx"),
 * extensionless import resolution (<path>.ts then <path>.js), plus
 * the .js→.ts swap (compiled module graphs request .js-convention
 * specifiers; this serves them from the .ts sources). Port 4051 via
 * BOLERO_STATIC_PORT (the API owns 4050).
 *
 * Runs under `bun` only (Bun.Transpiler is bun-only). ES2020+ plain
 * JS, no TypeScript syntax. Dev/test server: no caching headers, no
 * auth, bound to 127.0.0.1.
 */
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

const ROOT = resolve(import.meta.dirname);
const PORT = Number(process.env.BOLERO_STATIC_PORT ?? 4051);
const API_PORT = Number(process.env.BOLERO_PORT ?? 4050);

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
};

const transpiler = new Bun.Transpiler({ loader: "tsx" });

async function tryFile(p) {
  try {
    const buf = await readFile(p);
    const type = MIME[extname(p)] ?? "application/octet-stream";
    // transformSync, NOT transform: the async form returns a Promise, and
    // Response(promise) coerces the body to the literal string
    // "[object Promise]" — the browser then fails with
    // "Unexpected identifier 'Promise'" (the Coda C4 lane).
    const body = extname(p) === ".ts" ? transpiler.transformSync(buf.toString("utf8")) : buf;
    return new Response(body, {
      headers: extname(p) === ".ts" ? { "content-type": "text/javascript" } : { "content-type": type },
    });
  } catch {
    return null;
  }
}

// The bolero twist: same-origin API passthrough. The dashboard fetches
// /api/* and /health through THIS origin; they proxy to the real server
// so the PWA shell has zero CORS and zero static coupling.
async function proxyApi(req, url) {
  const target = `http://127.0.0.1:${API_PORT}${url.pathname}${url.search}`;
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
      redirect: "follow",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return new Response(JSON.stringify({ reason: "api unreachable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: async (req) => {
    const url = new URL(req.url);
    const p = url.pathname.replace(/^\/+/, "");

    // API + health passthrough (same-origin, zero CORS).
    if (p === "health" || p.startsWith("api/")) {
      return proxyApi(req, url);
    }

    let path = decodeURIComponent(p);
    path = path === "" ? "index.html" : path;
    let res = await tryFile(resolve(ROOT, path));
    if (!res) res = await tryFile(resolve(ROOT, path + ".ts"));
    if (!res) res = await tryFile(resolve(ROOT, path + ".js"));
    // TS-in-browser dev-server rule: compiled module graphs keep the
    // `./x.js` specifier convention; map it back to the `x.ts` source.
    if (!res && path.endsWith(".js")) res = await tryFile(resolve(ROOT, path.slice(0, -3) + ".ts"));
    return res ?? new Response("not found", { status: 404 });
  },
});

console.log(`[bolero] serving ${ROOT} at http://127.0.0.1:${PORT} (API proxied to 127.0.0.1:${API_PORT})`);
