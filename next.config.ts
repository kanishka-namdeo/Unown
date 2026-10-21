import type { NextConfig } from "next";

/**
 * Dashboard API base (P0 fix — audited live): the dashboard talks to the
 * self-learning engine. Two modes exist in src/lib/agent-api.ts:
 *   DIRECT  — absolute base URL (e.g. http://127.0.0.1:3030 or an API-gateway
 *             prefix); requests go straight to the engine.
 *   GATEWAY — relative URLs + ?XTransformPort=3030, for origins behind the
 *             z.ai sandbox preview gateway (the only environment that routes
 *             cross-port requests this way).
 *
 * Before this default, an unset/empty NEXT_PUBLIC_AGENT_API_BASE silently put
 * every stock install in GATEWAY mode — on a normal machine (no such gateway)
 * every engine call from the dashboard 404'd and all tabs rendered empty
 * (measured; docs/troubleshooting.md documented the symptom as a user fix).
 * Now the build/dev default is the local engine — which `bun run agent:start`
 * always launches — while explicit values always win:
 *   NEXT_PUBLIC_AGENT_API_BASE=http://127.0.0.1:3030   → DIRECT (same as default)
 *   NEXT_PUBLIC_AGENT_API_BASE=gateway                 → GATEWAY (sandbox preview)
 *   NEXT_PUBLIC_AGENT_API_BASE=https://host/agent-api  → DIRECT via a prefix
 * Empty/whitespace normalizes to the default (an empty .env line must not
 * resurrect the broken gateway default).
 */
const RAW_API_BASE = (process.env.NEXT_PUBLIC_AGENT_API_BASE ?? "").trim();
const DEFAULT_API_BASE = "http://127.0.0.1:3030";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  env: {
    NEXT_PUBLIC_AGENT_API_BASE: RAW_API_BASE.length > 0 ? RAW_API_BASE : DEFAULT_API_BASE,
  },
};

export default nextConfig;
