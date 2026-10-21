/**
 * engine-auth.ts — the engine API's authentication layer (M7).
 *
 * The engine is a detached HTTP server holding the learning surface: session
 * notes (transcript-derived text), memory versions, provider keys, scheduled
 * agent runs. Until M7 it was loopback-bound but COMPLETELY unauthenticated,
 * and CORS only gated what a browser could READ — never what it could SEND:
 * a `text/plain` POST is a CORS "simple request" (no preflight), and
 * `apiRequestBody()` parses any content-type, so any website the user visits
 * could drive `POST /api/automations` (arbitrary prompt execution),
 * `POST /api/notes` (memory poisoning), `POST /api/providers` (re-route LLM
 * traffic) or `POST /api/shutdown` through their own browser. Same-port DNS
 * rebinding (Host: evil.com → 127.0.0.1) additionally defeated CORS entirely
 * and allowed full reads. See docs/detached-engine-architecture.md
 * "Engine API authentication" for the design and the precedent trail
 * (Jupyter token files, Docker's socket, Vite's allowedHosts / CVE-2025-24010).
 *
 * The layer has three parts, all enforced in the Bun.serve fetch wrapper —
 * NEVER in handleApi (the unit suite calls handleApi directly with the body
 * already parsed; HTTP-level concerns must stay above it):
 *
 *   1. Host-header validation (Vite-style) — kills same-port DNS rebinding.
 *   2. Origin enforcement — a request that CARRIES an Origin header must be
 *      on the CORS allow-list or it is rejected before routing. Browsers
 *      always attach Origin to cross-origin POSTs, so the preflight-free
 *      `text/plain` blind-write hole closes in every browser, independent of
 *      the arriving PNA/LNA permission work. Non-browser clients (curl, the
 *      CLI, the bridge) send no Origin and are untouched.
 *   3. Bearer token (Jupyter-style) — a per-boot random token written to
 *      DATA_DIR/engine.token (0600) BEFORE the port is bound; same-user
 *      clients auto-discover it (engineFetch) so the default costs nothing.
 *      Mandatory when the bind is widened off loopback; `UNOWN_ENGINE_AUTH=off`
 *      is refused at boot for non-loopback binds (an Ollama-style accidental
 *      0.0.0.0-with-no-auth can never exist again).
 *
 * Honest threat model: the token protects against OTHER LOCAL USERS and
 * BROWSER confused-deputy attacks. It cannot protect against same-user
 * malware — that code can read the token file and the SQLite DB directly;
 * for that, the sandbox/policy layers are the answer. The one query-param
 * exception is `?token=` on `/api/events` only (EventSource cannot set
 * headers) — the Jupyter precedent, narrowed to a single endpoint.
 *
 * Purity: node:fs / node:path / node:crypto only (+ the DATA_DIR const from
 * store.ts, import-safe since M2). No pi imports, no LLM, fully unit-testable.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./store.ts";

// ---------------------------------------------------------------------------
// Config resolution (server side)
// ---------------------------------------------------------------------------

export const ENGINE_TOKEN_FILE = "engine.token";

/** Where the per-boot token lives — inside the engine's data dir, which tests
 *  redirect via PI_SELFLEARNING_DATA and installs redirect via UNOWN_HOME. */
export function engineTokenPath(): string {
        return join(DATA_DIR, ENGINE_TOKEN_FILE);
}

export interface AuthPolicy {
        /** "token" (default) or "off" — the UNOWN_ENGINE_AUTH mode. */
        mode: "token" | "off";
        /** The token to require, or null when mode is off / not pinned. */
        token: string | null;
        /** True when the bind host is non-loopback (token becomes mandatory). */
        widenedBind: boolean;
        /** Extra DNS hostnames allowed in the Host header (UNOWN_ENGINE_HOSTS). */
        hostsAllow: string[];
        /** Boot must be refused: non-loopback bind with auth disabled. */
        refuse: boolean;
        /** Human-readable reason when refuse is true. */
        refuseReason: string | null;
}

/** Is `host` an IP literal (v4 or v6, bare or bracketed)? */
function isIpLiteral(host: string): boolean {
        const bare = host.replace(/^\[|\]$/g, "");
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(bare)) return true; // IPv4
        return bare.includes(":"); // IPv6 (contains at least one colon)
}

/** Loopback hostname? (127/8, ::1, localhost — the bind's default family.) */
export function isLoopbackHost(host: string): boolean {
        const bare = host.replace(/^\[|\]$/g, "");
        if (bare === "localhost" || bare.endsWith(".localhost")) return true;
        if (bare === "::1") return true;
        if (/^127(\.\d{1,3}){3}$/.test(bare)) return true;
        return false;
}

/**
 * Resolve the auth policy from the environment. Pure (env injected) so the
 * refusal matrix is unit-testable without binding anything.
 *
 *   UNOWN_ENGINE_AUTH   "token" (default) | "off"
 *   UNOWN_ENGINE_TOKEN  pin the token instead of generating per-boot (also
 *                       the CLIENT-side override for remote engines)
 *   UNOWN_ENGINE_HOSTS  comma list of extra allowed Host header values
 *                       (DNS names — the Vite allowedHosts lane)
 *   UNOWN_ENGINE_HOST   the bind host (already consulted by startServer;
 *                       read here only to decide loopback-ness)
 */
export function resolveAuthPolicy(env: NodeJS.ProcessEnv): AuthPolicy {
        const mode = (env.UNOWN_ENGINE_AUTH ?? "").trim() === "off" ? "off" : "token";
        const pinned = (env.UNOWN_ENGINE_TOKEN ?? "").trim() || null;
        const bindHost = (env.UNOWN_ENGINE_HOST ?? "").trim();
        const widenedBind = bindHost !== "" && !isLoopbackHost(bindHost);
        const hostsAllow = (env.UNOWN_ENGINE_HOSTS ?? "")
                .split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
        const refuse = mode === "off" && widenedBind;
        return {
                mode,
                token: mode === "token" ? pinned : null,
                widenedBind,
                hostsAllow,
                refuse,
                refuseReason: refuse
                        ? `UNOWN_ENGINE_HOST=${bindHost} binds the engine off loopback, and UNOWN_ENGINE_AUTH=off would leave the whole learning surface (notes, memory, providers, automations) unauthenticated on the network. Either remove UNOWN_ENGINE_AUTH=off or require the token (default).`
                        : null,
        };
}

// ---------------------------------------------------------------------------
// Token file lifecycle (server side)
// ---------------------------------------------------------------------------

/** Generate a per-boot token: 64 hex chars, no new deps (node:crypto). */
export function generateEngineToken(): string {
        return randomBytes(32).toString("hex");
}

/**
 * Write the token file BEFORE the port is bound (no torn reads: clients can
 * never observe a listening engine without a readable token on disk).
 *
 * Permissions: 0600 on POSIX. On Windows the mode bits are advisory — the
 * practical boundary is that DATA_DIR lives under the user profile
 * (%USERPROFILE%\.unown\...), whose ACL is per-user by default (the same
 * posture Jupyter's secure_write takes with its explicit DACL; see
 * docs/detached-engine-architecture.md for the Windows notes).
 */
export function writeEngineTokenFile(path: string, token: string): void {
        rmSync(path, { force: true }); // never resurrect a previous boot's token
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, token, { mode: 0o600 });
}

/** Remove the token file at drain time (mirrors Jupyter's runtime-file
 *  lifecycle). Ownership-checked (audit M5): a drain may overlap a newer
 *  boot in the same data dir — bun --hot reloads the entry on source change
 *  (e.g. `unown update`'s git pull), and the supervisor restart path can
 *  start the replacement before the old instance finishes draining. An
 *  unconditional rm here could delete the NEW boot's token, leaving an
 *  engine that answers 401 to everyone with no discoverable token. When
 *  `expected` is given, the file is only removed when it still contains
 *  THIS instance's token; a file with different content belongs to a newer
 *  boot and is left alone. */
export function removeEngineTokenFile(path: string, expected?: string): void {
        if (expected !== undefined) {
                try {
                        const onDisk = readFileSync(path, "utf8").trim();
                        if (onDisk !== expected) return; // a newer boot owns the file now
                } catch {
                        /* unreadable/missing — the force-rm below is a no-op then */
                }
        }
        rmSync(path, { force: true });
}

/** Re-write the token file when it went missing under a live engine
 *  (audit M5 self-heal): the drain/new-boot overlap above is closed by the
 *  ownership check, but a stale drain from an OLD binary (pre-ownership
 *  check) or a user's stray `rm` can still leave a token-required engine
 *  with no discoverable token. Only a MISSING/unreadable file is rewritten —
 *  a file holding a DIFFERENT token belongs to a newer boot in the same data
 *  dir and is never clobbered. The maintenance tick calls this; rewriting is
 *  idempotent (same token, mode 0600 preserved). */
export function healEngineTokenFile(path: string, token: string): boolean {
        let present: string | null = null;
        try {
                present = readFileSync(path, "utf8").trim() || null;
        } catch {
                present = null; // missing/unreadable — the only case we rewrite
        }
        if (present === token) return false; // intact
        if (present !== null) return false; // a newer boot owns this file
        try {
                writeEngineTokenFile(path, token);
                return true;
        } catch {
                return false; // read-only fs etc. — the in-memory token still works for env-pinned clients
        }
}

// ---------------------------------------------------------------------------
// Request-level checks (server side) — pure, Request in / boolean out
// ---------------------------------------------------------------------------

/**
 * Host-header validation (Vite allowedHosts / CVE-2025-24010 lane): accept
 * localhost (+ *.localhost), IP literals (v4/v6 incl. brackets) and anything
 * on the UNOWN_ENGINE_HOSTS allow-list; reject DNS names otherwise. Kills
 * same-port DNS rebinding, where the page origin EQUALS the target origin and
 * CORS never applies at all.
 */
export function hostHeaderAllowed(req: Request, policy: Pick<AuthPolicy, "hostsAllow">): boolean {
        const host = (req.headers.get("host") ?? "").toLowerCase();
        if (host === "") return false;
        const hostname = host.replace(/:\d+$/, "").trim(); // strip port (no IPv6 colon damage: [::1]:3030 → [::1])
        if (hostname === "" ) return false;
        if (isLoopbackHost(hostname)) return true;
        if (isIpLiteral(hostname)) return true;
        return policy.hostsAllow.includes(hostname);
}

/**
 * Origin enforcement: a request that CARRIES an Origin header (i.e. comes
 * from a browser) must be on the CORS allow-list. Non-browser clients send
 * no Origin. This closes the preflight-free `text/plain` POST hole in every
 * browser regardless of the arriving Private/Local Network Access work.
 * Takes the already-computed `allowedOrigin` so the allow-list has exactly
 * one definition (allowedCorsOrigin in server.ts).
 */
export function originAllowed(req: Request, allowedOrigin: string | null): boolean {
        const origin = req.headers.get("origin");
        if (!origin) return true; // non-browser client
        if (origin === "null") return false; // sandboxed iframe / opaque origin — no legitimate engine client
        return allowedOrigin !== null;
}

/** Extract the presented token: `Authorization: Bearer <t>`, plus the narrow
 *  `?token=` exception for `/api/events` ONLY (EventSource cannot set headers). */
export function requestToken(req: Request, url: URL): string | null {
        const auth = req.headers.get("authorization") ?? "";
        const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
        if (m) return m[1].trim();
        if (url.pathname === "/api/events") {
                const q = url.searchParams.get("token");
                if (q) return q.trim();
        }
        return null;
}

/** Constant-time token comparison (length mismatch short-circuits — the only
 *  leak is the token LENGTH, which is public knowledge: 64 hex). */
export function tokenMatches(presented: string | null, expected: string): boolean {
        if (!presented) return false;
        const a = Buffer.from(presented, "utf8");
        const b = Buffer.from(expected, "utf8");
        if (a.length !== b.length) return false;
        return timingSafeEqual(a, b);
}

/** Should this request skip the token gate? The plain-text liveness root
 *  (reveals only engine presence — gives third-party probes something to
 *  ping) and CORS preflights (cannot carry credentials by design). */
export function tokenExempt(method: string, pathname: string): boolean {
        if (method === "OPTIONS") return true;
        if (pathname === "/") return true;
        return false;
}

// ---------------------------------------------------------------------------
// Client side — same-user discovery + the shared fetch helper
// ---------------------------------------------------------------------------

let cachedToken: string | null | undefined;

/** The token this process should present: UNOWN_ENGINE_TOKEN (remote engines /
 *  CI pins) beats the local token file. Cached; re-read via invalidate. */
export function engineToken(): string | null {
        if (cachedToken !== undefined) return cachedToken;
        const env = (process.env.UNOWN_ENGINE_TOKEN ?? "").trim();
        if (env) {
                cachedToken = env;
                return cachedToken;
        }
        try {
                cachedToken = readFileSync(engineTokenPath(), "utf8").trim() || null;
        } catch {
                cachedToken = null; // engine down / never booted / remote — fine
        }
        return cachedToken;
}

/** Forget the cached token (called after a 401 — the engine may have rebooted
 *  with a fresh per-boot token; one re-read, then one retry). */
export function invalidateEngineToken(): void {
        cachedToken = undefined;
}

export interface EngineFetchInit extends Omit<RequestInit, "headers"> {
        headers?: HeadersInit;
        /** Internal: guards the single 401 retry (per-boot rotation). */
        __engineAuthRetry?: boolean;
}

/**
 * engineFetch — every in-tree engine client goes through here (term.ts probe
 * + note delivery, supervisor, engine-cli, automations-cli, tools, doctor).
 * Attaches `Authorization: Bearer` when a token is discoverable; on a 401 it
 * invalidates the cache, re-reads the token file once and retries once (the
 * engine rotates the token each boot; a live agent crossing an engine
 * restart heals on the next request). Never throws for auth reasons — the
 * Response is returned and callers degrade exactly as they do today (M6:
 * the agent works engine-down).
 */
export async function engineFetch(url: string, init: EngineFetchInit = {}): Promise<Response> {
        const headers = new Headers(init.headers ?? undefined);
        const tok = engineToken();
        if (tok && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${tok}`);
        const res = await fetch(url, { ...init, headers });
        if (res.status !== 401 || init.__engineAuthRetry) return res;
        // Per-boot rotation: the engine we were talking to rebooted with a new
        // token. Re-read once (env pin stays; the file may have changed) and
        // retry once. A second 401 is a real "not our engine" and flows back
        // to the caller's engine-down handling.
        invalidateEngineToken();
        const fresh = engineToken();
        if (fresh && fresh === tok) return res; // pinned token didn't change — genuine reject
        return engineFetch(url, { ...init, __engineAuthRetry: true });
}
