import type { NextConfig } from "next";

/**
 * Landing-page build (D7): the web dashboard is retired — mission control is
 * `unown dashboard`, the TUI on the pi-tui stack, talking to the engine API
 * directly (engineFetch, M7 auth). This Next config now serves exactly one
 * page: the marketing landing (Vercel-hosted). The demo routes carry their
 * own API handlers (the apps are genuine fullstack builds).
 *
 * `output: "standalone"` stays: the e2e lane boots the built server without
 * a full node_modules copy (playwright.config.ts webServer).
 *
 * Demo frame hardening (the commerce round, 2026-10-28): /demo and /bazaar
 * are iframed by the landing page in browser chrome. frame-ancestors 'self'
 * stops third-party sites framing them (clickjacking) — it supersedes
 * X-Frame-Options for modern browsers; the SAMEORIGIN header stays as the
 * legacy fallback. Vercel sends no X-Frame-Options by default, so same-
 * origin framing works out of the box; these headers make it POLICY.
 * /cadence (the cadence round, 2026-10-28) is embedded the same way:
 * the live-demo gallery's third app is iframed into the band, so the
 * identical headers block applies.
 * /fugue (the SOTA round, 2026-10-28) and /aria (the aria round,
 * 2026-10-29) join the same block: the live-demo gallery iframes them
 * same-origin in browser chrome.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: "/demo/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        source: "/bazaar/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        source: "/cadence/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // /parley (the parley round, 2026-10-28) is embedded the same way:
        // the live-demo gallery iframes /parley?embed=1 same-origin.
        source: "/parley/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // /fugue (the SOTA round, 2026-10-28) is embedded the same way:
        // the live-demo gallery iframes /fugue/flows?embed=1 same-origin.
        source: "/fugue/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // /aria (the aria round, 2026-10-29) is embedded the same way:
        // the live-demo gallery iframes /aria?embed=1 same-origin.
        source: "/aria/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
