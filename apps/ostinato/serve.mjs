#!/usr/bin/env bun
/**
 * Ostinato — transpiling static dev/test server (ticket O-1 skeleton).
 *
 * Coda `scripts/serve.mjs` port, trimmed to the skeleton: serves
 * apps/ostinato/ as the document root — plain static files, .ts modules
 * transpiled on the fly (Bun.Transpiler, loader "tsx"), extensionless
 * import resolution (<path>.ts then <path>.js). O-3 adds the import
 * map and vendor alias when the UI shell lands; the skeleton has no
 * runtime closure yet, so no /vendor/* alias.
 *
 * Runs under `bun` only (Bun.Transpiler is bun-only). ES2020+ plain JS,
 * no TypeScript syntax. Dev/test server: no caching headers, no auth,
 * bound to 127.0.0.1.
 */
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

const ROOT = resolve(import.meta.dirname);
const PORT = Number(process.env.OSTINATO_PORT ?? 4013);

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
    // transformSync, NOT transform: the async form returns a Promise, and
    // Response(promise) coerces the body to the literal string
    // "[object Promise]" — the browser then fails with
    // "Unexpected identifier 'Promise'" (caught live by the Coda C4 lane).
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
    return res ?? new Response("not found", { status: 404 });
  },
});

console.log(`[ostinato] serving ${ROOT} at http://127.0.0.1:${PORT}`);
