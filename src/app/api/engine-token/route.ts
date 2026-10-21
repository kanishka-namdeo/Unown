// M7 keep-alive shim (dies with the web dashboard in D7):
// the engine now requires its per-boot bearer token (src/engine-auth.ts). The
// BROWSER cannot read DATA_DIR/engine.token — but the Next server can (it runs
// same-user). This route hands the token to same-origin dashboard code at
// request time (never build time — the token rotates per boot).
//
// Hardening: the Host header must be loopback (or an IP literal / on the
// UNOWN_ENGINE_HOSTS allow-list) — same rule the engine enforces — so a
// same-port DNS-rebind (Host: evil.com → 127.0.0.1:3000) cannot read the
// token through this route.
import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

function isLoopbackHost(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (bare === "localhost" || bare.endsWith(".localhost")) return true;
  if (bare === "::1") return true;
  if (/^127(\.\d{1,3}){3}$/.test(bare)) return true;
  return false;
}

function isIpLiteral(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(bare)) return true;
  return bare.includes(":");
}

export async function GET(req: Request) {
  const host = (req.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  const allow = (process.env.UNOWN_ENGINE_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (host && !(isLoopbackHost(host) || isIpLiteral(host) || allow.includes(host))) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }
  const pinned = (process.env.UNOWN_ENGINE_TOKEN ?? "").trim();
  if (pinned) return NextResponse.json({ token: pinned });
  const dataDir =
    process.env.PI_SELFLEARNING_DATA ?? join(process.cwd(), "data", "self-learning");
  try {
    const token = readFileSync(join(dataDir, "engine.token"), "utf8").trim();
    if (!token) return NextResponse.json({ error: "no engine token" }, { status: 404 });
    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: "engine token not found (engine down?)" }, { status: 404 });
  }
}
