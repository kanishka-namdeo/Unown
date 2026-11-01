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
  // Dev-origin allowlist (the browser autonomy round, 2026-10-31): Next 16's
  // dev server blocks "cross-origin" dev resources — fonts, the HMR socket —
  // when the browser reaches it by an origin it does not recognize as its
  // own, and the block is silent on the page: the SSR HTML renders, no
  // console error surfaces, and client hydration never completes, so every
  // interactive element is dead. `127.0.0.1` is the canonical loopback
  // literal (agents and curl reach for it first precisely because `localhost`
  // can resolve to ::1), so it is allowlisted here. Production builds are
  // unaffected (the allowlist is dev-only); the e2e lane boots a production
  // build, which is why this could never surface in CI — pinned instead by
  // src/next-config.test.ts and receipted in the round's session log (F4).
  allowedDevOrigins: ["127.0.0.1"],
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
      {
        // /nocturne (the nocturne round, 2026-10-29) is embedded the same
        // way: the live-demo gallery iframes /nocturne?embed=1 same-origin.
        source: "/nocturne/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // /encore (the Website Excellence round, 2026-10-29) is embedded
        // the same way: the live-demo gallery iframes /encore?embed=1
        // same-origin (gallery app #8).
        source: "/encore/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // /ledger (the Website Excellence round 2, 2026-10-30) — gallery
        // app #9, the fintech dashboard fixture. Same frame hardening.
        source: "/ledger/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
