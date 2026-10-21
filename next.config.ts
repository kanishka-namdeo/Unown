import type { NextConfig } from "next";

/**
 * Landing-page build (D7): the web dashboard is retired — mission control is
 * `unown dashboard`, the TUI on the pi-tui stack, talking to the engine API
 * directly (engineFetch, M7 auth). This Next config now serves exactly one
 * page: the marketing landing (Vercel-hosted). No API routes, no env
 * plumbing for engine bases, no dashboard-specific config remains.
 *
 * `output: "standalone"` stays: the e2e lane boots the built server without
 * a full node_modules copy (playwright.config.ts webServer).
 */
const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
