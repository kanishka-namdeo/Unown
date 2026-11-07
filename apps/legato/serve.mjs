#!/usr/bin/env bun
/**
 * Legato — transpiling static dev/test server (ticket L-1 scaffold).
 *
 * The Ostinato/Fugue serve.mjs port, trimmed to the skeleton: serves
 * apps/legato/ as the document root — plain static files, .ts modules
 * transpiled on the fly (Bun.Transpiler, loader "tsx"), extensionless
 * import resolution (<path>.ts then <path>.js). L-5 adds the UI shell
 * entry when it lands; the skeleton has no runtime closure yet.
 *
 * PORT HISTORY (the 4016-history comment law, PLAN §5.1 — the scar is
 * documented, not accidental):
 *   4012 coda        (CODA_PORT, apps/coda/serve.mjs)
 *   4013 ostinato    (OSTINATO_PORT, apps/ostinato/serve.mjs)
 *   4014 chaconne    (CHACONNE_PORT, apps/chaconne/serve.mjs)
 *   4015 fugue app   (FUGUE_PORT, apps/fugue/serve.mjs)
 *   4016 fugue capture-usage lane (devils-advocate ruling, F-11 runbook)
 *   4017 LEGATO APP lane (this server — LEGATO_PORT)
 *   4018 LEGATO fixture/capture lane (LEGATO_FIXTURE_PORT — the hostile
 *           fixture server to come at L-3/L-10: scripts/fixture-server.mjs)
 *
 * 4017 HISTORY: the 2026-10-17 4017 incident receipt confirms 4017 was
 * the colliding party in that historical episode, never a permanent
 * claim; no serve.mjs in the repo defaulted to 4017 before this file.
 * 4016 = the fugue capture-usage lane; 4050/4051 = bolero API/static.
 * 4017 is free now and claimed by Legato (PLAN §5.1 ruling).
 *
 * `GET /health` answers `{ "ok": true, "port": <PORT> }` — the cheap
 * liveness probe the e2e webServer entries assert on before launching
 * specs (fugue/ostinato shape verbatim; L-10's playwright.legato.config.ts
 * pins LEGATO_PORT=4017 here — one file per port, no scattered literals).
 *
 * Runs under `bun` only (Bun.Transpiler is bun-only). ES2020+ plain JS,
 * no TypeScript syntax. Dev/test server: no caching headers, no auth,
 * bound to 127.0.0.1.
 */
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

const ROOT = resolve(import.meta.dirname);
const PORT = Number(process.env.LEGATO_PORT ?? 4017);

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".ts": "text/javascript",
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
    // "Unexpected identifier 'Promise'" (the Coda/Ostinato live receipt).
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

    // The cheap liveness probe the e2e webServer waits on (L-10's
    // playwright.legato.config.ts asserts /health before launching specs).
    if (req.method === "GET" && path === "health") {
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

console.log(`[legato] serving ${ROOT} at http://127.0.0.1:${PORT}`);
