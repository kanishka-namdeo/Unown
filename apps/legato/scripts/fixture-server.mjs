#!/usr/bin/env bun
/**
 * fixture-server.mjs — Legato B-16 substrate (ticket L-3).
 *
 * B-16 is the Vivace round's hostile-fixture holdout: a static
 * fixture dir + a dynamic-route server that exercises every
 * `ClipError` taxonomy entry (T-1..T-7) against the clip
 * pipeline. This file is the substrate RealFetcher points at in
 * the L-11 e2e battery; it is NOT a host edge the app ships with
 * (PLAN §1.2 seam ruling).
 *
 * PORT: LEGATO_FIXTURE_PORT, default 4018 (127.0.0.1).
 *
 * ROUTES:
 *
 *  STATIC — serve `fixtures/*.html` at their own path
 *    (`/fixtures/clean.html`, `/fixtures/huge.html`, …).
 *
 *  DYNAMIC (the L-3 skeleton):
 *    GET /redirect-chain   — a 3-hop 302 chain ending in clean
 *    GET /redirect-loop    — a 2-hop cycle: /a → /b → /a
 *    GET /walled-403       — 403 with a tiny body
 *    GET /walled-429       — 429 with a Retry-After header
 *    GET /slow             — a 5-second delay, then 200 + a clean
 *                            body (the timeout-masking pin, T-7)
 *    GET /health           — the cheap liveness probe
 *
 * Runs under `bun` only. Plain Node/ES, no TypeScript.
 */
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURES_DIR = resolve(ROOT, "fixtures");
const PORT = Number(process.env.LEGATO_FIXTURE_PORT ?? 4018);

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
};

// Preload the static fixtures at boot so the dynamic routes can
// reference them without a disk hit per request (the L-11 e2e
// lane is latency-sensitive).
let cleanBody = "";
try {
  cleanBody = await readFile(resolve(FIXTURES_DIR, "clean.html"), "utf8");
} catch {
  cleanBody = "<html><body>clean</body></html>";
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: async (req) => {
    const url = new URL(req.url);
    const path = url.pathname;

    // ---- the cheap liveness probe (L-11's webServer waits on this) ----
    if (req.method === "GET" && path === "/health") {
      return new Response(JSON.stringify({ ok: true, port: PORT }), {
        headers: { "content-type": "application/json" },
      });
    }

    // ---- static fixtures: serve any fixtures/*.html at /fixtures/<name> ----
    if (req.method === "GET" && path.startsWith("/fixtures/")) {
      const filename = path.slice("/fixtures/".length);
      // Path-traversal guard: only allow .html files in the dir.
      if (filename.includes("..") || filename.includes("/")) {
        return new Response("not found", { status: 404 });
      }
      try {
        const buf = await readFile(resolve(FIXTURES_DIR, filename));
        const ct = MIME[extname(filename)] ?? "application/octet-stream";
        return new Response(buf, { headers: { "content-type": ct } });
      } catch {
        return new Response("not found", { status: 404 });
      }
    }

    // ---- dynamic routes (the L-3 skeleton) ----

    // T-2: the 3-hop chain ending in a clean page.
    //   /redirect-chain → 302 /hop-1 → 302 /hop-2 → 302 /fixtures/clean.html
    if (req.method === "GET" && path === "/redirect-chain") {
      return new Response(null, {
        status: 302,
        headers: { location: "/hop-1" },
      });
    }
    if (req.method === "GET" && path === "/hop-1") {
      return new Response(null, {
        status: 302,
        headers: { location: "/hop-2" },
      });
    }
    if (req.method === "GET" && path === "/hop-2") {
      return new Response(null, {
        status: 302,
        headers: { location: "/fixtures/clean.html" },
      });
    }

    // T-2: the 2-hop cycle (the redirect-loop pin).
    //   /redirect-loop → 302 /loop-a → 302 /loop-b → 302 /loop-a (cycle)
    if (req.method === "GET" && path === "/redirect-loop") {
      return new Response(null, {
        status: 302,
        headers: { location: "/loop-a" },
      });
    }
    if (req.method === "GET" && path === "/loop-a") {
      return new Response(null, {
        status: 302,
        headers: { location: "/loop-b" },
      });
    }
    if (req.method === "GET" && path === "/loop-b") {
      return new Response(null, {
        status: 302,
        headers: { location: "/loop-a" }, // cycles back — no infinite follow
      });
    }

    // T-3: the 403 wall.
    if (req.method === "GET" && path === "/walled-403") {
      return new Response("<html><body>403 forbidden</body></html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      });
    }

    // T-3: the 429 wall.
    if (req.method === "GET" && path === "/walled-429") {
      return new Response("<html><body>429 too many requests</body></html>", {
        status: 429,
        headers: {
          "content-type": "text/html",
          "retry-after": "60",
        },
      });
    }

    // T-7: the slow route (the timeout-masking pin).
    //   5-second delay, then 200 + the clean body. The app-side
    //   fetch cap (RealFetcher, default 15 s) must NOT fire here;
    //   the L-11 e2e spec pairs this route with a shorter cap to
    //   pin the fetch-failed lane.
    if (req.method === "GET" && path === "/slow") {
      await new Promise((r) => setTimeout(r, 5000));
      return new Response(cleanBody, {
        headers: { "content-type": "text/html" },
      });
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`[legato fixture] B-16 substrate at http://127.0.0.1:${PORT}`);
