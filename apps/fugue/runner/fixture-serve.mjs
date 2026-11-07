#!/usr/bin/env bun
/**
 * fixture-serve.mjs — the F-5 e2e lane's engine stub boot (chunk 6).
 *
 * Starts F-3's fixture server (the stub engine on 4130) and keeps it
 * alive until SIGTERM/SIGINT. The e2e webServer lane boots this so
 * the PWA's live proxy path reaches a canned, contract-pinned
 * engine — the flow spec's hard assertions ride a GUARANTEED live
 * lane, not a degraded if-guard.
 *
 * The Bun.serve handler is wrapped in place: a /__fixture-health
 * probe answers for the Playwright webServer url check; every other
 * path flows through the frozen fixture table verbatim (fixture-
 * server.ts is unmodified — only this boot shim wraps the handler).
 */
import { startFixtureServer } from "./fixture-server.ts";

const port = Number(process.env.FUGUE_FIXTURE_PORT ?? 4130);
// Port 0 → the stub's internal Bun.serve binds an OS-assigned port it
// never listens on for anything; this shim's Bun.serve owns `port`.
const stub = startFixtureServer({ port: 0, reseed: true });

// Playwright's webServer url probe: answer /__fixture-health on the
// shim's port; /api/** flows through stub.handle to the frozen
// fixture table untouched.
const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/__fixture-health") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname.startsWith("/api/")) {
      // CORS preflight — the browser PWA's OPTIONS probe (fixture-server
      // already handles this on its own socket; the shim must answer it
      // here because the browser talks to 4130 = this shim's socket).
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": req.headers.get("origin") ?? "*",
            "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
            "access-control-allow-headers": "Content-Type, Authorization",
            "access-control-max-age": "86400",
            vary: "Origin",
          },
        });
      }
      const cors = {};
      const origin = req.headers.get("origin");
      if (origin) {
        cors["access-control-allow-origin"] = origin;
        cors["access-control-allow-headers"] = "Content-Type, Authorization";
        cors["access-control-max-age"] = "86400";
        cors["vary"] = "Origin";
      }
      const out = await stub.handle(req.method, url.pathname, url, req);
      if (out.status === 204) return new Response(null, { status: 204, headers: cors });
      return new Response(JSON.stringify(out.body), {
        status: out.status,
        headers: { "content-type": "application/json", ...cors },
      });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  },

});

console.log(`[fugue-fixture] stub engine serving on 127.0.0.1:${server.port}`);

async function shutdown() {
  // F-5 chunk 7 (Defect 4): Bun's Server has no close() — stop() is the
  // correct Bun 1.4.3 API; the prior close() threw TypeError on SIGTERM,
  // so the shim never reached process.exit(0).
  server.stop();
  await stub.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
